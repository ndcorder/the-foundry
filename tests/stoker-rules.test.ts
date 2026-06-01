import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "yaml";
import { setRootDir } from "../src/root.js";
import {
  clearConsumedStokerDirective,
  emptyStokerDirective,
  formatStokerDirective,
  generateStokerDirective,
  getStokerRefineryReadinessStatus,
  getStokerTokenHeatStatus,
  loadStokerDirective,
  saveStokerDirective,
} from "../src/stoker/index.js";
import type { ComplexityBias } from "../src/complexity/index.js";
import type { StokerIterationEntry, StokerSignals } from "../src/stoker/types.js";
import type { StreakHistory } from "../src/streaks/index.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "foundry-stoker-"));
  setRootDir(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function entry(
  iteration: number,
  outcome: "shipped" | "killed" | "skipped" = "shipped",
  domain: string = "prose",
  rating: string = "4.0",
): StokerIterationEntry {
  return {
    iteration,
    outcome,
    domain,
    mean_rating: rating,
    token_usage: { input: 1000, output: 500 },
    duration_ms: 1000,
  };
}

function streak(overrides: Partial<StreakHistory> = {}): StreakHistory {
  return {
    current: null,
    recent_breaks: [],
    cooldown_domains: [],
    cooldown_remaining: 0,
    ...overrides,
  };
}

function bias(favor: "S" | "M" | "L" | "XL" | "balanced" = "balanced"): ComplexityBias {
  return {
    updated_at: "2026-01-01T00:00:00Z",
    updated_iteration: 10,
    yields: favor === "balanced" ? [] : [
      { tier: favor, shipped_count: 3, mean_rating: 4.0, mean_token_cost: 6000, roi: 0.67 },
    ],
    recommendation: {
      favor,
      avoid: [],
      confidence: favor === "balanced" ? "low" : "medium",
      reason: favor === "balanced" ? "No signal." : `${favor} is strongest.`,
    },
  };
}

function signals(overrides: Partial<StokerSignals> = {}): StokerSignals {
  return {
    current_iteration: 12,
    for_iteration: 13,
    recent_iterations: [],
    streak: streak(),
    complexity_bias: bias(),
    mood: null,
    dream_count: 0,
    last_refinery_iteration: null,
    ...overrides,
  };
}

describe("stoker/generateStokerDirective", () => {
  it("amplifies strong streaks and follows actionable complexity bias", () => {
    const directive = generateStokerDirective(signals({
      streak: streak({
        current: {
          active: true,
          length: 3,
          domain: "code",
          avg_rating: 4.1,
          start_iteration: 9,
          last_iteration: 12,
          artifact_ids: ["0009", "0010", "0011"],
          project_id: null,
        },
      }),
      complexity_bias: bias("M"),
    }));

    expect(directive.for_iteration).toBe(13);
    expect(directive.streak_instruction).toBe("amplify");
    expect(directive.complexity_override).toBe("M");
    expect(directive.ideator_hint).toContain("Push the code streak further");
    expect(directive.rules_fired).toEqual(expect.arrayContaining(["hot_streak", "complexity_bias"]));
  });

  it("lowers urgency after a high recent kill rate", () => {
    const recent = Array.from({ length: 10 }, (_, i) =>
      entry(i + 1, i < 6 ? "killed" : "shipped", "prose", "3.6"),
    );

    const directive = generateStokerDirective(signals({ recent_iterations: recent }));

    expect(directive.urgency).toBe("low");
    expect(directive.ideator_hint).toContain("Play it safe");
    expect(directive.complexity_override).toBe("S");
    expect(directive.rules_fired).toContain("kill_rate_hot");
  });

  it("turns forced quality escalation into a concrete recovery directive", () => {
    const directive = generateStokerDirective(signals({
      force_reason: "quality_escalation",
      force_context: {
        title: "Almost Good Artifact",
        domain: "prose",
        rating: 3.2,
        threshold: 3.5,
      },
    } as any));

    expect(directive.urgency).toBe("high");
    expect(directive.complexity_override).toBe("S");
    expect(directive.ideator_hint).toContain("Recover quality after Almost Good Artifact in prose");
    expect(directive.ideator_hint).toContain("mean rating 3.2 below 3.5");
    expect(directive.rules_fired).toContain("quality_escalation");
  });

  it("turns forced failure escalation into a concrete recovery directive", () => {
    const directive = generateStokerDirective(signals({
      force_reason: "failure_escalation",
      force_context: {
        title: "Rejected Artifact",
        domain: "code-tool",
        reason: "Gate 2 rejected the artifact for weak validation.",
      },
    } as any));

    expect(directive.urgency).toBe("high");
    expect(directive.streak_instruction).toBe("break");
    expect(directive.complexity_override).toBe("S");
    expect(directive.ideator_hint).toContain("Recover from killed artifact Rejected Artifact in code-tool");
    expect(directive.ideator_hint).toContain("Gate 2 rejected the artifact for weak validation.");
    expect(directive.rules_fired).toContain("failure_escalation");
  });

  it("turns forced success amplification into a concrete follow-up directive", () => {
    const directive = generateStokerDirective(signals({
      force_reason: "success_amplification",
      force_context: {
        title: "Breakthrough Artifact",
        domain: "poetry",
        rating: 4.3,
        threshold: 4.0,
      },
    } as any));

    expect(directive.urgency).toBe("high");
    expect(directive.streak_instruction).toBe("amplify");
    expect(directive.ideator_hint).toContain("Amplify the successful pattern from Breakthrough Artifact in poetry");
    expect(directive.ideator_hint).toContain("mean rating 4.3 met the amplification threshold 4.0");
    expect(directive.rules_fired).toContain("success_amplification");
  });

  it("turns forced dimension repair into a concrete quality directive", () => {
    const directive = generateStokerDirective(signals({
      force_reason: "dimension_repair",
      force_context: {
        title: "Uneven Artifact",
        domain: "game",
        dimension: "surprise",
        rating: 3,
        threshold: 4,
      },
    } as any));

    expect(directive.urgency).toBe("high");
    expect(directive.ideator_hint).toContain("Repair the weakest Critic dimension from Uneven Artifact in game");
    expect(directive.ideator_hint).toContain("surprise rated 3.0 below 4.0");
    expect(directive.ideator_hint).toContain("make that dimension visibly stronger");
    expect(directive.rules_fired).toContain("dimension_repair");
  });

  it("turns forced human redirects into a concrete operator-aligned directive", () => {
    const directive = generateStokerDirective(signals({
      force_reason: "human_redirect",
      force_context: {
        request_file: "requests.md",
        request_preview: "Make the next iteration a tiny playable puzzle. Domain: game",
      },
    } as any));

    expect(directive.urgency).toBe("high");
    expect(directive.ideator_hint).toContain("Human redirect queued in requests.md");
    expect(directive.ideator_hint).toContain("Make the next iteration a tiny playable puzzle. Domain: game");
    expect(directive.ideator_hint).toContain("Treat this as the controlling brief");
    expect(directive.rules_fired).toContain("human_redirect");
  });

  it("turns forced monitor warnings into immediate anti-entropy pressure", () => {
    const directive = generateStokerDirective(signals({
      force_reason: "monitor_warning",
      force_context: {
        warning_count: 2,
        critical_warning_count: 0,
        reason: "quality: Quality dip detected",
      },
    } as any));

    expect(directive.urgency).toBe("high");
    expect(directive.ideator_hint).toContain("Anti-entropy monitor forced this handoff");
    expect(directive.ideator_hint).toContain("2 warnings");
    expect(directive.ideator_hint).toContain("quality: Quality dip detected");
    expect(directive.rules_fired).toContain("monitor_warning");
  });

  it("turns forced underburn into a concrete larger-scope directive", () => {
    const directive = generateStokerDirective(signals({
      force_reason: "underburn",
      force_context: {
        title: "Tiny Spark",
        domain: "code-tool",
        complexity: "S",
        spent_tokens: 900,
        target_tokens: 6250,
      },
    } as any));

    expect(directive.urgency).toBe("high");
    expect(directive.complexity_override).toBe("M");
    expect(directive.ideator_hint).toContain("Token underburn after Tiny Spark in code-tool");
    expect(directive.ideator_hint).toContain("900 tokens against a 6250-token floor");
    expect(directive.ideator_hint).toContain("choose a deeper M-tier proposal");
    expect(directive.rules_fired).toContain("underburn");
  });

  it("turns startup underburn into first-iteration token prime pressure", () => {
    const directive = generateStokerDirective(signals({
      force_reason: "startup_underburn",
      force_context: {
        spent_tokens: 1500,
        target_tokens: 50000,
      },
    } as any));

    expect(directive.urgency).toBe("high");
    expect(directive.complexity_override).toBe("M");
    expect(directive.ideator_hint).toContain("Startup token prime");
    expect(directive.ideator_hint).toContain("1500 tokens against a 50000-token cold-start floor");
    expect(directive.ideator_hint).toContain("richer M-tier proposal");
    expect(directive.rules_fired).toContain("startup_underburn");
  });

  it("turns forced domain ruts into a concrete pivot directive", () => {
    const directive = generateStokerDirective(signals({
      force_reason: "domain_rut",
      force_context: {
        domain: "code-tool",
        streak_length: 3,
      },
    } as any));

    expect(directive.urgency).toBe("high");
    expect(directive.domain_pressure?.away_from).toContain("code-tool");
    expect(directive.ideator_hint).toContain("Domain rut detected");
    expect(directive.ideator_hint).toContain("3 straight shipped artifacts in code-tool");
    expect(directive.ideator_hint).toContain("pivot away from code-tool");
    expect(directive.rules_fired).toContain("domain_rut");
  });

  it("queues one refinery job when dream fuel is available and the gap is sufficient", () => {
    const directive = generateStokerDirective(signals({
      dream_count: 4,
      last_refinery_iteration: 6,
      current_iteration: 12,
    }));

    expect(directive.refinery_queue).toBe(1);
    expect(directive.rules_fired).toContain("refinery_fuel");

    const tooSoon = generateStokerDirective(signals({
      dream_count: 4,
      last_refinery_iteration: 10,
      current_iteration: 12,
    }));
    expect(tooSoon.refinery_queue).toBeUndefined();
  });

  it("queues refinery work when deterministic target discovery finds fuel", () => {
    const directive = generateStokerDirective(signals({
      dream_count: 0,
      refinery_target_count: 1,
      current_iteration: 12,
      last_refinery_iteration: null,
    }));

    expect(directive.refinery_queue).toBe(1);
    expect(directive.rules_fired).toContain("refinery_fuel");
  });

  it("honors the configured refinery gap before queueing another job", () => {
    const tooSoon = generateStokerDirective(signals({
      dream_count: 0,
      refinery_target_count: 1,
      current_iteration: 20,
      last_refinery_iteration: 14,
      refinery_min_iterations_between_runs: 8,
    }));

    expect(tooSoon.refinery_queue).toBeUndefined();

    const afterGap = generateStokerDirective(signals({
      dream_count: 0,
      refinery_target_count: 1,
      current_iteration: 20,
      last_refinery_iteration: 12,
      refinery_min_iterations_between_runs: 8,
    }));

    expect(afterGap.refinery_queue).toBe(1);
    expect(afterGap.rules_fired).toContain("refinery_fuel");
  });

  it("defers refinery work when recent main-loop token spend is already hot", () => {
    const recent = Array.from({ length: 5 }, (_, i) => ({
      ...entry(i + 1, "shipped", "code-tool", "4.0"),
      token_usage: { input: 150_000, output: 80_000 },
    }));

    const directive = generateStokerDirective(signals({
      recent_iterations: recent,
      dream_count: 0,
      refinery_target_count: 1,
      current_iteration: 20,
      last_refinery_iteration: null,
    }));

    expect(directive.refinery_queue).toBeUndefined();
    expect(directive.rules_fired).toContain("token_heat_refinery_deferral");
    expect(directive.ideator_hint).toContain("Defer refinery");
  });

  it("uses configured token heat threshold and window for refinery deferral", () => {
    const recent = [
      { ...entry(1), token_usage: { input: 40_000, output: 10_000 } },
      { ...entry(2), token_usage: { input: 40_000, output: 10_000 } },
      { ...entry(3), token_usage: { input: 250_000, output: 50_000 } },
    ];
    const overrides = {
      recent_iterations: recent,
      dream_count: 0,
      refinery_target_count: 1,
      current_iteration: 20,
      last_refinery_iteration: null,
      refinery_token_heat_threshold: 200_000,
      refinery_token_heat_window: 1,
    } as Partial<StokerSignals> & {
      refinery_token_heat_threshold: number;
      refinery_token_heat_window: number;
    };

    const directive = generateStokerDirective(signals(overrides));

    expect(directive.refinery_queue).toBeUndefined();
    expect(directive.rules_fired).toContain("token_heat_refinery_deferral");
  });

  it("pushes away from a collapsed recent domain", () => {
    const recent = [
      ...Array.from({ length: 13 }, (_, i) => entry(i + 1, "shipped", "code-tool")),
      ...Array.from({ length: 7 }, (_, i) => entry(i + 14, "shipped", "poetry")),
    ];

    const directive = generateStokerDirective(signals({ recent_iterations: recent }));

    expect(directive.domain_pressure?.away_from).toContain("code-tool");
    expect(directive.rules_fired).toContain("domain_collapse");
  });
});

describe("stoker/getStokerTokenHeatStatus", () => {
  it("reports average recent token heat against the configured refinery threshold", () => {
    const status = getStokerTokenHeatStatus([
      { ...entry(1), token_usage: { input: 40_000, output: 10_000 } },
      { ...entry(2), token_usage: { input: 100_000, output: 50_000 } },
      { ...entry(3), token_usage: { input: 250_000, output: 50_000 } },
    ], {
      enabled: true,
      run_interval: 5,
      refinery_token_heat_window: 2,
      refinery_token_heat_threshold: 200_000,
    });

    expect(status).toEqual({
      window: 2,
      threshold: 200_000,
      samples: 2,
      averageTokens: 225_000,
      totalTokens: 450_000,
      peakTokens: 300_000,
      thresholdPercent: 113,
      remainingTokensToThreshold: 0,
      pressure: "hot",
      hot: true,
    });
  });

  it("reports warm pressure before the hard hot threshold is crossed", () => {
    const status = getStokerTokenHeatStatus([
      { ...entry(1), token_usage: { input: 100_000, output: 50_000 } },
      { ...entry(2), token_usage: { input: 100_000, output: 50_000 } },
    ], {
      enabled: true,
      run_interval: 5,
      refinery_token_heat_window: 2,
      refinery_token_heat_threshold: 200_000,
    });

    expect(status).toMatchObject({
      averageTokens: 150_000,
      totalTokens: 300_000,
      peakTokens: 150_000,
      thresholdPercent: 75,
      remainingTokensToThreshold: 50_000,
      pressure: "warm",
      hot: false,
    });
  });
});

describe("stoker/getStokerRefineryReadinessStatus", () => {
  it("reports ready when fuel, cooldown, and heat gates are clear", () => {
    const status = getStokerRefineryReadinessStatus({
      cadence: {
        enabled: true,
        minIterationsBetweenRuns: 5,
        lastIteration: 9,
        nextEligibleIteration: 14,
        iterationsUntilEligible: 0,
      },
      fuel: {
        enabled: true,
        queueLimit: 1,
        available: 2,
        byType: { dream: 1, companion: 1, lowRated: 0 },
        topTargets: [],
      },
      heat: {
        window: 5,
        threshold: 200_000,
        samples: 2,
        averageTokens: 75_000,
        hot: false,
      },
    });

    expect(status).toEqual({
      state: "ready",
      canQueue: true,
      blockers: [],
      reason: "Refinery fuel is available and cooldown/heat gates are clear.",
    });
  });

  it("reports the first active blocker with all contributing blockers", () => {
    const status = getStokerRefineryReadinessStatus({
      cadence: {
        enabled: true,
        minIterationsBetweenRuns: 5,
        lastIteration: 12,
        nextEligibleIteration: 17,
        iterationsUntilEligible: 3,
      },
      fuel: {
        enabled: true,
        queueLimit: 1,
        available: 2,
        byType: { dream: 2, companion: 0, lowRated: 0 },
        topTargets: [],
      },
      heat: {
        window: 5,
        threshold: 200_000,
        samples: 5,
        averageTokens: 225_000,
        hot: true,
      },
    });

    expect(status).toEqual({
      state: "cooldown",
      canQueue: false,
      blockers: ["cooldown", "hot"],
      reason: "Refinery cooldown has 3 iterations remaining.",
    });
  });
});

describe("stoker/formatStokerDirective", () => {
  it("formats directive context for the ideator and suppresses stale iteration targets", () => {
    const directive = {
      ...emptyStokerDirective(7, 8),
      urgency: "high" as const,
      ideator_hint: "Take a sharper risk.",
      complexity_override: "L" as const,
      domain_pressure: { toward: ["fiction"], away_from: ["code-tool"] },
      mood_amplifier: "Channel confidence into bolder structure.",
      refinery_queue: 1,
    };

    const formatted = formatStokerDirective(directive, 8);
    expect(formatted).toContain("## Stoker Directive");
    expect(formatted).toContain("Take a sharper risk.");
    expect(formatted).toContain("Prefer L-tier");
    expect(formatted).toContain("Lean toward fiction");
    expect(formatted).toContain("Avoid code-tool");
    expect(formatted).toContain("Refinery queue: 1");

    expect(formatStokerDirective(directive, 9)).toBe("");
  });
});

describe("stoker/persistence", () => {
  it("saves and loads directives as YAML", async () => {
    const directive = {
      ...emptyStokerDirective(3, 4),
      urgency: "normal" as const,
      ideator_hint: "Keep the furnace steady.",
      rules_fired: ["cruising"],
    };

    await saveStokerDirective(directive);

    const filePath = path.join(tempDir, "identity", "stoker-directive.yml");
    expect(existsSync(filePath)).toBe(true);
    expect(yaml.parse(readFileSync(filePath, "utf-8")).ideator_hint).toBe("Keep the furnace steady.");

    const loaded = await loadStokerDirective();
    expect(loaded?.for_iteration).toBe(4);
    expect(loaded?.ideator_hint).toBe("Keep the furnace steady.");
  });

  it("returns null when no directive exists", async () => {
    await expect(loadStokerDirective()).resolves.toBeNull();
  });

  it("clears directives once their target iteration has been consumed", async () => {
    await saveStokerDirective({
      ...emptyStokerDirective(3, 4),
      urgency: "high",
      ideator_hint: "Use the current pressure once.",
      rules_fired: ["running_cold"],
    });

    const filePath = path.join(tempDir, "identity", "stoker-directive.yml");
    await clearConsumedStokerDirective(3);
    expect(existsSync(filePath)).toBe(true);

    await clearConsumedStokerDirective(4);
    expect(existsSync(filePath)).toBe(false);
    await expect(loadStokerDirective()).resolves.toBeNull();
  });
});
