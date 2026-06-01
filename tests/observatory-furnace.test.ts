import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setRootDir } from "../src/root.js";

const repoRoot = process.cwd();
const tempDirs: string[] = [];

function makeTempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "foundry-observatory-"));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, "identity"), { recursive: true });
  mkdirSync(path.join(dir, "workspace"), { recursive: true });
  mkdirSync(path.join(dir, "logs"), { recursive: true });
  return dir;
}

function writeFixture(root: string): void {
  writeFileSync(path.join(root, "identity", "stoker-directive.yml"), [
    "generated_at: 2026-05-30T00:00:00.000Z",
    "generated_iteration: 30",
    "for_iteration: 31",
    "urgency: high",
    "streak_instruction: amplify",
    "ideator_hint: Push the current vein until it sparks.",
    "complexity_override: S",
    "refinery_queue: 1",
    "rules_fired:",
    "  - hot_streak",
    "  - refinery_fuel",
    "",
  ].join("\n"));

  writeFileSync(path.join(root, "identity", "complexity-bias.yml"), [
    "updated_at: 2026-05-30T00:00:00.000Z",
    "updated_iteration: 30",
    "yields:",
    "  - tier: S",
    "    shipped_count: 5",
    "    mean_rating: 4.1",
    "    mean_token_cost: 10000",
    "    roi: 0.41",
    "recommendation:",
    "  favor: S",
    "  avoid:",
    "    - XL",
    "  confidence: high",
    "  reason: S is producing the best value per token.",
    "",
  ].join("\n"));

  writeFileSync(path.join(root, "identity", "streaks.yml"), [
    "current:",
    "  active: true",
    "  length: 4",
    "  domain: fiction",
    "  avg_rating: 4.2",
    "  start_iteration: 27",
    "  last_iteration: 30",
    "  artifact_ids:",
    "    - \"0027\"",
    "    - \"0028\"",
    "    - \"0029\"",
    "    - \"0030\"",
    "  project_id: null",
    "recent_breaks: []",
    "cooldown_domains: []",
    "cooldown_remaining: 0",
    "",
  ].join("\n"));

  writeFileSync(path.join(root, "identity", "dreams.yml"), [
    "updated_at: 2026-05-30T00:00:00.000Z",
    "dreams:",
    "  - artifact_id: \"0011\"",
    "    title: Fallen Clock",
    "    domain: prose",
    "    pitch: A clock complains about time.",
    "    kill_reason: Execution failed, but the premise was strong.",
    "    iteration: 11",
    "    what_was_good: The object voice was specific.",
    "    resurrection_hint: Rebuild it as a complaint ledger with escalating timestamps and margin notes.",
    "    added_at: 2026-05-30T00:00:00.000Z",
    "  - artifact_id: \"0012\"",
    "    title: Static Orchard",
    "    domain: code-art",
    "    pitch: A garden rendered from broken telemetry.",
    "    kill_reason: Structure failed, but the image was strong.",
    "    iteration: 12",
    "    what_was_good: The sensory constraint was sharp.",
    "    resurrection_hint: Rebuild it as an instrument panel.",
    "    added_at: 2026-05-30T00:00:00.000Z",
    "",
  ].join("\n"));

  writeFileSync(path.join(root, "workspace", "speculative.yml"), [
    "updated_at: 2026-05-30T00:00:00.000Z",
    "ideas:",
    "  - proposal:",
    "      title: Doorway Index",
    "      pitch: A catalog of impossible thresholds.",
    "      domain: poetry",
    "      complexity: S",
    "      why_this_matters: It compresses worldbuilding into ritual.",
    "    critic_evaluation:",
    "      decision: revise",
    "      reasons: Strong image, needs sharper constraint.",
    "    iteration: 30",
    "    salvageable: true",
    "",
  ].join("\n"));

  writeFileSync(path.join(root, "logs", "refinery.jsonl"), [
    JSON.stringify({ iteration: 12, source_id: "0007", source_type: "dream", result: "killed" }),
    JSON.stringify({ iteration: 29, source_id: "0019", source_type: "companion", result: "shipped" }),
    "",
  ].join("\n"));

  writeFileSync(path.join(root, "logs", "iterations.jsonl"), [
    JSON.stringify({ iteration: 29, outcome: "shipped", title: "Prior Work", token_usage: { input: 100000, output: 50000 } }),
    JSON.stringify({ iteration: 30, outcome: "shipped", title: "Latest Work", token_usage: { input: 200000, output: 100000 } }),
    "",
  ].join("\n"));
}

function writeFoundryConfig(root: string, activeWarningWindow: number): void {
  mkdirSync(path.join(root, "config"), { recursive: true });
  writeFileSync(path.join(root, "config", "foundry.yml"), [
    "foundry:",
    "  name: test",
    "  version: 0.1.0",
    "iteration:",
    "  max_idea_retries: 3",
    "  max_revision_rounds: 2",
    "  max_test_fix_cycles: 2",
    "  curator_interval: 10",
    "  domain_cooldown: 3",
    "  novelty_window: 5",
    "projects:",
    "  max_active: 3",
    "  max_iterations_per_project: 10",
    "  allow_standalone_interrupts: true",
    "stimuli:",
    "  enabled: false",
    "  stimuli_ttl: 24",
    "  skills_per_context: 2",
    "  mcp_timeout_seconds: 30",
    "context:",
    "  journal_compressed_max_tokens: 4000",
    "  portfolio_index_max_entries: 50",
    "  critic_review_history: 5",
    "  critic_gate1_history: 5",
    "intervention:",
    "  requests_file: requests.md",
    "  stop_file: STOP",
    "logging:",
    "  log_all_prompts: false",
    "  log_token_usage: true",
    "  log_decisions: true",
    "  log_test_reports: true",
    "recovery:",
    "  checkpoint_every: 5",
    "  resume_on_crash: true",
    "loop:",
    "  cooldown_seconds: 0",
    "  disk_space_min_gb: 0",
    "monitor:",
    `  active_warning_window: ${activeWarningWindow}`,
    "",
  ].join("\n"));
}

function writeStimuliFixture(root: string): void {
  mkdirSync(path.join(root, "stimuli"), { recursive: true });
  writeFileSync(path.join(root, "stimuli", "stimuli.yml"), [
    "mcp:",
    "  news:",
    "    server: tavily",
    "    query_template: interesting news",
    "    max_items: 5",
    "    refresh_interval: 10",
    "  cultural:",
    "    server: tavily",
    "    queries:",
    "      - trending repos",
    "    max_items: 5",
    "    refresh_interval: 20",
    "  knowledge:",
    "    server: context7",
    "    strategy: random",
    "    max_items: 3",
    "    refresh_interval: 10",
    "stimuli_ttl: 24",
    "skills_per_context: 2",
    "",
  ].join("\n"));
}

function writeCheckpointWithStimuli(root: string): void {
  writeFileSync(path.join(root, "checkpoint.json"), JSON.stringify({
    iteration: 30,
    active_project_ids: [],
    domain_counts: {},
    last_stimuli_refresh: {
      news: {
        last_refresh_iteration: 18,
        consecutive_failures: 2,
        disabled: false,
      },
      cultural: {
        last_refresh_iteration: 12,
        consecutive_failures: 3,
        disabled: true,
      },
      knowledge: 29,
    },
    last_curator_run: 20,
    stats: {
      iteration: 30,
      shipped: 2,
      killed: 0,
      skipped: 0,
      domain_counts: {},
      recent_outcomes: [],
      critic_rejection_window: [],
      total_tokens: { input: 0, output: 0 },
    },
    saved_at: "2026-05-30T00:00:00.000Z",
  }, null, 2));
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForApi(port: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/iterations`);
      if (response.ok) return;
    } catch {
      // server still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("dashboard server did not start");
}

afterEach(() => {
  setRootDir(repoRoot);
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Observatory furnace telemetry", () => {
  it("aggregates live furnace state from persisted identity and workspace files", async () => {
    const root = makeTempRoot();
    writeFixture(root);
    writeStimuliFixture(root);
    writeCheckpointWithStimuli(root);
    setRootDir(root);

    const { readFurnaceTelemetry } = await import("../src/observatory/furnace.js");
    const telemetry = await readFurnaceTelemetry();

    expect(telemetry.stoker).toMatchObject({
      forIteration: 31,
      urgency: "high",
      refineryQueue: 1,
      hint: "Push the current vein until it sparks.",
      rules: ["hot_streak", "refinery_fuel"],
    });
    expect(telemetry.stokerCadence).toEqual({
      enabled: true,
      runInterval: 5,
      nextRunIteration: 35,
      iterationsUntilRun: 5,
    });
    expect(telemetry.stokerHeat).toEqual({
      window: 5,
      threshold: 200000,
      samples: 2,
      averageTokens: 225000,
      totalTokens: 450000,
      peakTokens: 300000,
      thresholdPercent: 113,
      remainingTokensToThreshold: 0,
      pressure: "hot",
      hot: true,
    });
    expect(telemetry.critic).toEqual({
      artifactRejection: {
        samples: 2,
        killed: 0,
        shipped: 2,
        rejectionRate: 0,
        threshold: 0.4,
        pressure: "normal",
      },
    });
    expect(telemetry.stimuli).toEqual({
      enabled: false,
      sources: 3,
      healthy: 1,
      due: 1,
      failing: 1,
      disabled: 1,
      entries: [
        {
          source: "news",
          server: "tavily",
          refreshInterval: 10,
          lastRefreshIteration: 18,
          iterationsSinceRefresh: 12,
          consecutiveFailures: 2,
          disabled: false,
          due: true,
          state: "failing",
        },
        {
          source: "cultural",
          server: "tavily",
          refreshInterval: 20,
          lastRefreshIteration: 12,
          iterationsSinceRefresh: 18,
          consecutiveFailures: 3,
          disabled: true,
          due: false,
          state: "disabled",
        },
        {
          source: "knowledge",
          server: "context7",
          refreshInterval: 10,
          lastRefreshIteration: 29,
          iterationsSinceRefresh: 1,
          consecutiveFailures: 0,
          disabled: false,
          due: false,
          state: "healthy",
        },
      ],
    });
    expect(telemetry.complexity).toMatchObject({
      favor: "S",
      avoid: ["XL"],
      confidence: "high",
      reason: "S is producing the best value per token.",
    });
    expect(telemetry.complexity?.yields).toEqual([
      expect.objectContaining({ tier: "S", shippedCount: 5, roi: 0.41 }),
    ]);
    expect(telemetry.streak).toMatchObject({
      active: true,
      domain: "fiction",
      length: 4,
      avgRating: 4.2,
      cooldownDomains: [],
      cooldownRemaining: 0,
    });
    expect(telemetry.speculative).toMatchObject({
      count: 1,
      staleCount: 0,
      ideas: [
        expect.objectContaining({
          title: "Doorway Index",
          domain: "poetry",
          complexity: "S",
          decision: "revise",
          iteration: 30,
        }),
      ],
    });
    expect(telemetry.refinery).toEqual({
      enabled: true,
      minIterationsBetweenRuns: 5,
      lastIteration: 29,
      nextEligibleIteration: 34,
      iterationsUntilEligible: 4,
    });
    expect(telemetry.refineryFuel).toMatchObject({
      enabled: true,
      queueLimit: 1,
      available: 2,
      byType: { dream: 2, companion: 0, lowRated: 0 },
    });
    expect(telemetry.refineryFuel.topTargets[0]).toMatchObject({
      sourceType: "dream",
      title: "Fallen Clock",
    });
    expect(telemetry.refineryReadiness).toEqual({
      state: "cooldown",
      canQueue: false,
      blockers: ["cooldown", "hot"],
      reason: "Refinery cooldown has 4 iterations remaining.",
    });
    expect(telemetry.logs).toMatchObject({
      activeFiles: 2,
      archiveCount: 0,
      largestActive: { name: "iterations.jsonl" },
      rotationThresholdBytes: 50 * 1024 * 1024,
      largestActivePercent: 0,
      rotationPressure: "clear",
      healthState: "healthy",
      malformedActiveLines: 0,
      malformedActiveFiles: [],
      malformedActiveFileDetails: [],
    });
    expect(telemetry.logs.totalActiveBytes).toBeGreaterThan(0);
    expect(telemetry.logs.totalArchiveBytes).toBe(0);
    expect(telemetry.logs.totalLogBytes).toBe(telemetry.logs.totalActiveBytes);
    expect(telemetry.logs.largestArchive).toBeNull();
    expect(telemetry.logs.largestActiveBytesRemaining).toBeGreaterThan(0);
    expect(telemetry.monitor).toEqual({
      counts: { critical: 0, warning: 0, info: 0 },
      activeCounts: { critical: 0, warning: 0, info: 0 },
      activeWarnings: [],
      activeWindow: { currentIteration: 30, iterations: 10 },
      recentWarnings: [],
      latestWarning: null,
    });
    expect(telemetry.health).toEqual({
      level: "warning",
      reasons: [
        "1 stimuli source failing",
        "1 stimuli source disabled",
      ],
      actions: [
        "Inspect stimuli source health and recover disabled or failing feeds.",
      ],
    });
  });

  it("summarizes recent monitor warnings in furnace telemetry", async () => {
    const root = makeTempRoot();
    writeFixture(root);
    writeFileSync(path.join(root, "logs", "monitor.jsonl"), [
      JSON.stringify({ detector: "log_health", severity: "critical", message: "Malformed active log", iteration: 30, timestamp: "2026-05-30T00:00:00.000Z" }),
      "",
    ].join("\n"));
    setRootDir(root);

    const { readFurnaceTelemetry } = await import("../src/observatory/furnace.js");
    const telemetry = await readFurnaceTelemetry();

    expect(telemetry.monitor).toEqual({
      counts: { critical: 1, warning: 0, info: 0 },
      activeCounts: { critical: 1, warning: 0, info: 0 },
      activeWarnings: [
        {
          detector: "log_health",
          severity: "critical",
          message: "Malformed active log",
          iteration: 30,
          timestamp: "2026-05-30T00:00:00.000Z",
        },
      ],
      activeWindow: { currentIteration: 30, iterations: 10 },
      recentWarnings: [
        {
          detector: "log_health",
          severity: "critical",
          message: "Malformed active log",
          iteration: 30,
          timestamp: "2026-05-30T00:00:00.000Z",
        },
      ],
      latestWarning: {
        detector: "log_health",
        severity: "critical",
        message: "Malformed active log",
        iteration: 30,
        timestamp: "2026-05-30T00:00:00.000Z",
      },
    });
    expect(telemetry.health).toEqual({
      level: "critical",
      reasons: ["1 critical monitor warning"],
      actions: ["Inspect logs/monitor.jsonl for recent monitor warnings."],
    });
  });

  it("uses configured monitor active warning window in furnace telemetry", async () => {
    const root = makeTempRoot();
    writeFixture(root);
    writeFoundryConfig(root, 20);
    writeFileSync(path.join(root, "logs", "monitor.jsonl"), [
      JSON.stringify({ detector: "slop", severity: "warning", message: "Older warning still actionable", iteration: 15, timestamp: "2026-05-30T00:00:00.000Z" }),
      "",
    ].join("\n"));
    setRootDir(root);

    const { readFurnaceTelemetry } = await import("../src/observatory/furnace.js");
    const telemetry = await readFurnaceTelemetry();

    expect(telemetry.monitor.counts).toEqual({ critical: 0, warning: 1, info: 0 });
    expect(telemetry.monitor.activeCounts).toEqual({ critical: 0, warning: 1, info: 0 });
    expect(telemetry.monitor.activeWindow).toEqual({ currentIteration: 30, iterations: 20 });
    expect(telemetry.health).toEqual({
      level: "warning",
      reasons: ["1 monitor warning"],
      actions: ["Inspect logs/monitor.jsonl for recent monitor warnings."],
    });
  });

  it("serves furnace telemetry through the dashboard API", async () => {
    const root = makeTempRoot();
    writeFixture(root);
    const port = await getFreePort();
    const tsx = path.resolve(repoRoot, "node_modules", ".bin", "tsx");
    const serverPath = path.resolve(repoRoot, "dashboard", "server.ts");
    const child: ChildProcessWithoutNullStreams = spawn(tsx, [serverPath], {
      cwd: root,
      env: { ...process.env, PORT: String(port) },
    });

    try {
      await waitForApi(port);
      const response = await fetch(`http://127.0.0.1:${port}/api/furnace`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.stoker.urgency).toBe("high");
      expect(body.stokerCadence.nextRunIteration).toBe(35);
      expect(body.stokerHeat.hot).toBe(true);
      expect(body.stokerHeat.averageTokens).toBe(225000);
      expect(body.stokerHeat.pressure).toBe("hot");
      expect(body.stokerHeat.thresholdPercent).toBe(113);
      expect(body.critic.artifactRejection).toEqual({
        samples: 2,
        killed: 0,
        shipped: 2,
        rejectionRate: 0,
        threshold: 0.4,
        pressure: "normal",
      });
      expect(body.complexity.favor).toBe("S");
      expect(body.speculative.count).toBe(1);
      expect(body.speculative.staleCount).toBe(0);
      expect(body.refinery.lastIteration).toBe(29);
      expect(body.refinery.nextEligibleIteration).toBe(34);
      expect(body.refineryFuel.available).toBe(2);
      expect(body.refineryFuel.byType.dream).toBe(2);
      expect(body.refineryReadiness.state).toBe("cooldown");
      expect(body.refineryReadiness.blockers).toEqual(["cooldown", "hot"]);
      expect(body.logs.activeFiles).toBe(2);
      expect(body.logs.largestActive.name).toBe("iterations.jsonl");
      expect(body.logs.rotationThresholdBytes).toBe(50 * 1024 * 1024);
      expect(body.logs.largestActiveBytesRemaining).toBeGreaterThan(0);
      expect(body.logs.rotationPressure).toBe("clear");
      expect(body.logs.healthState).toBe("healthy");
      expect(body.logs.malformedActiveLines).toBe(0);
      expect(body.logs.malformedActiveFileDetails).toEqual([]);
      expect(body.logs.totalArchiveBytes).toBe(0);
      expect(body.logs.totalLogBytes).toBe(body.logs.totalActiveBytes);
      expect(body.logs.largestArchive).toBeNull();
      expect(body.monitor.counts).toEqual({ critical: 0, warning: 0, info: 0 });
      expect(body.monitor.activeCounts).toEqual({ critical: 0, warning: 0, info: 0 });
      expect(body.monitor.activeWindow).toEqual({ currentIteration: 30, iterations: 10 });
      expect(body.health).toEqual({
        level: "healthy",
        reasons: [],
        actions: [],
      });
    } finally {
      child.kill();
    }
  });

  it("suppresses stale stoker directives based on the iteration log", async () => {
    const root = makeTempRoot();
    writeFixture(root);
    writeFileSync(path.join(root, "logs", "iterations.jsonl"), [
      JSON.stringify({ iteration: 31, outcome: "shipped", title: "Already Ran" }),
      "",
    ].join("\n"));
    setRootDir(root);

    const { readFurnaceTelemetry } = await import("../src/observatory/furnace.js");
    const telemetry = await readFurnaceTelemetry();

    expect(telemetry.stoker).toBeNull();
    expect(telemetry.speculative.count).toBe(0);
    expect(telemetry.speculative.staleCount).toBe(1);
    expect(telemetry.speculative.ideas).toEqual([]);
  });

  it("wires furnace telemetry into the Observatory UI", () => {
    const html = readFileSync(path.resolve(repoRoot, "dashboard", "public", "index.html"), "utf-8");

    expect(html).toContain("Furnace State");
    expect(html).toContain("fetch('/api/furnace')");
    expect(html).toContain("function renderFurnace");
    expect(html).toContain("Next stoke");
    expect(html).toContain("Token heat");
    expect(html).toContain("Token pressure");
    expect(html).toContain("Critic pressure");
    expect(html).toContain("artifact decisions");
    expect(html).toContain("Stimuli");
    expect(html).toContain("source health");
    expect(html).toContain("disabled feeds");
    expect(html).toContain("Stale speculative");
    expect(html).toContain("Refinery fuel");
    expect(html).toContain("Refinery readiness");
    expect(html).toContain("Furnace health");
    expect(html).toContain("Monitor");
    expect(html).toContain("eligible #");
    expect(html).toContain("Logs");
    expect(html).toContain("Log state");
    expect(html).toContain("Log actions");
    expect(html).toContain("archived bytes");
    expect(html).toContain("first line");
    expect(html).toContain("rotation limit");
  });
});
