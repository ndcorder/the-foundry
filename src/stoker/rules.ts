import type {
  StokerConfig,
  StokerDirective,
  StokerDomainPressure,
  StokerIterationEntry,
  StokerRefineryReadinessStatus,
  StokerSignals,
  StokerTokenHeatStatus,
} from "./types.js";
import type { RefineryCadenceStatus, RefineryFuelStatus } from "../refinery/index.js";

export const DEFAULT_STOKER_CONFIG: StokerConfig = {
  enabled: true,
  run_interval: 5,
  refinery_token_heat_window: 5,
  refinery_token_heat_threshold: 200_000,
};

const QUALITY_WINDOW = 10;
const DOMAIN_WINDOW = 20;
const DREAM_FUEL_THRESHOLD = 3;
const MIN_REFINERY_GAP = 5;

export function emptyStokerDirective(
  generatedIteration: number = 0,
  forIteration: number = generatedIteration + 1,
): StokerDirective {
  return {
    generated_at: new Date().toISOString(),
    generated_iteration: generatedIteration,
    for_iteration: forIteration,
    streak_instruction: "neutral",
    urgency: "normal",
    rules_fired: [],
  };
}

export function shouldRunStoker(iteration: number, config?: Partial<StokerConfig>): boolean {
  const merged = { ...DEFAULT_STOKER_CONFIG, ...config };
  if (!merged.enabled) return false;
  const interval = Math.max(1, Math.floor(merged.run_interval));
  return iteration > 0 && iteration % interval === 0;
}

function parseRating(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function addRule(directive: StokerDirective, rule: string): void {
  if (!directive.rules_fired.includes(rule)) directive.rules_fired.push(rule);
}

function appendHint(directive: StokerDirective, hint: string): void {
  directive.ideator_hint = directive.ideator_hint
    ? `${directive.ideator_hint} ${hint}`
    : hint;
}

function mergeDomainPressure(
  existing: StokerDomainPressure | undefined,
  next: Partial<StokerDomainPressure>,
): StokerDomainPressure {
  const toward = new Set(existing?.toward ?? []);
  const awayFrom = new Set(existing?.away_from ?? []);
  for (const domain of next.toward ?? []) toward.add(domain);
  for (const domain of next.away_from ?? []) awayFrom.add(domain);
  return {
    toward: [...toward],
    away_from: [...awayFrom],
  };
}

function recent(entries: StokerIterationEntry[], count: number): StokerIterationEntry[] {
  return entries.slice(-count);
}

function mean(numbers: number[]): number {
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

function tokenTotal(entry: StokerIterationEntry): number | null {
  if (!entry.token_usage) return null;
  const total = entry.token_usage.input + entry.token_usage.output;
  return Number.isFinite(total) ? total : null;
}

export function getStokerTokenHeatStatus(
  entries: StokerIterationEntry[],
  config?: Partial<StokerConfig>,
): StokerTokenHeatStatus {
  const merged = { ...DEFAULT_STOKER_CONFIG, ...config };
  const window = Math.max(1, Math.floor(merged.refinery_token_heat_window));
  const threshold = Math.max(0, Math.floor(merged.refinery_token_heat_threshold));
  const totals = recent(entries, window)
    .map(tokenTotal)
    .filter((total): total is number => total != null);
  const averageTokens = totals.length > 0 ? mean(totals) : 0;
  const totalTokens = totals.reduce((sum, total) => sum + total, 0);
  const peakTokens = totals.length > 0 ? Math.max(...totals) : 0;
  const hot = averageTokens >= threshold;
  const thresholdPercent = threshold > 0
    ? Math.round((averageTokens / threshold) * 100)
    : hot ? 100 : 0;
  const pressure: StokerTokenHeatStatus["pressure"] = hot
    ? "hot"
    : thresholdPercent >= 75
      ? "warm"
      : "cool";

  return {
    window,
    threshold,
    samples: totals.length,
    averageTokens,
    totalTokens,
    peakTokens,
    thresholdPercent,
    remainingTokensToThreshold: Math.max(0, Math.round(threshold - averageTokens)),
    pressure,
    hot,
  };
}

export function getStokerRefineryReadinessStatus(input: {
  cadence: RefineryCadenceStatus;
  fuel: RefineryFuelStatus;
  heat: StokerTokenHeatStatus;
}): StokerRefineryReadinessStatus {
  const blockers: StokerRefineryReadinessStatus["blockers"] = [];
  if (!input.cadence.enabled || !input.fuel.enabled) blockers.push("disabled");
  if (input.fuel.available <= 0) blockers.push("empty");
  if ((input.cadence.iterationsUntilEligible ?? 0) > 0) blockers.push("cooldown");
  if (input.heat.hot) blockers.push("hot");

  const canQueue = blockers.length === 0;
  const state: StokerRefineryReadinessStatus["state"] = canQueue ? "ready" : blockers[0];
  const reason = state === "disabled"
    ? "Refinery is disabled."
    : state === "empty"
      ? "No eligible refinery fuel is available."
      : state === "cooldown"
        ? `Refinery cooldown has ${input.cadence.iterationsUntilEligible ?? 0} iterations remaining.`
        : state === "hot"
          ? "Token heat is above threshold; refinery should defer."
          : "Refinery fuel is available and cooldown/heat gates are clear.";

  return {
    state,
    canQueue,
    blockers,
    reason,
  };
}

function strongestDomain(entries: StokerIterationEntry[]): { domain: string; ratio: number } | null {
  const domains = entries.map((entry) => entry.domain).filter((d): d is string => Boolean(d));
  if (domains.length === 0) return null;

  const counts = new Map<string, number>();
  for (const domain of domains) counts.set(domain, (counts.get(domain) ?? 0) + 1);

  let best: { domain: string; count: number } | null = null;
  for (const [domain, count] of counts.entries()) {
    if (!best || count > best.count) best = { domain, count };
  }
  return best ? { domain: best.domain, ratio: best.count / domains.length } : null;
}

function forceContextTitle(signals: StokerSignals): string {
  return signals.force_context?.title?.trim() || "the latest artifact";
}

function forceContextDomain(signals: StokerSignals): string {
  const domain = signals.force_context?.domain?.trim();
  return domain ? ` in ${domain}` : "";
}

function forceContextRating(signals: StokerSignals): string {
  const rating = signals.force_context?.rating;
  const threshold = signals.force_context?.threshold;
  if (typeof rating !== "number" || !Number.isFinite(rating)) return "below the high-quality threshold";
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
    return `at mean rating ${rating.toFixed(1)}`;
  }
  return `at mean rating ${rating.toFixed(1)} below ${threshold.toFixed(1)}`;
}

function forceContextReason(signals: StokerSignals): string {
  return signals.force_context?.reason?.trim() || "the prior artifact was rejected";
}

function forceContextSuccessRating(signals: StokerSignals): string {
  const rating = signals.force_context?.rating;
  const threshold = signals.force_context?.threshold;
  if (typeof rating !== "number" || !Number.isFinite(rating)) return "excellent work";
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
    return `mean rating ${rating.toFixed(1)}`;
  }
  return `mean rating ${rating.toFixed(1)} met the amplification threshold ${threshold.toFixed(1)}`;
}

function forceContextDimensionRepair(signals: StokerSignals): string {
  const dimension = signals.force_context?.dimension?.trim() || "weakest dimension";
  const rating = signals.force_context?.rating;
  const threshold = signals.force_context?.threshold;
  if (typeof rating !== "number" || !Number.isFinite(rating)) return `${dimension} needs repair`;
  if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
    return `${dimension} rated ${rating.toFixed(1)}`;
  }
  return `${dimension} rated ${rating.toFixed(1)} below ${threshold.toFixed(1)}`;
}

function forceContextRequestFile(signals: StokerSignals): string {
  return signals.force_context?.request_file?.trim() || "requests.md";
}

function forceContextRequestPreview(signals: StokerSignals): string {
  return signals.force_context?.request_preview?.trim() || "review the queued human redirect";
}

function formatMonitorWarningCount(signals: StokerSignals): string {
  const count = signals.force_context?.warning_count;
  if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) {
    return "monitor warnings";
  }
  const label = count === 1 ? "warning" : "warnings";
  const critical = signals.force_context?.critical_warning_count;
  const criticalSuffix = typeof critical === "number" && Number.isFinite(critical) && critical > 0
    ? ` including ${Math.round(critical)} critical`
    : "";
  return `${Math.round(count)} ${label}${criticalSuffix}`;
}

function nextComplexityTier(tier: string | undefined): "S" | "M" | "L" | "XL" {
  if (tier === "S") return "M";
  if (tier === "M") return "L";
  return "XL";
}

function formatUnderburnTokens(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}`
    : "too few";
}

function forceContextRutDomain(signals: StokerSignals): string {
  return signals.force_context?.domain?.trim() || "the repeated domain";
}

function forceContextRutLength(signals: StokerSignals): number {
  const length = signals.force_context?.streak_length;
  return typeof length === "number" && Number.isFinite(length) && length > 0
    ? Math.round(length)
    : 3;
}

export function generateStokerDirective(signals: StokerSignals): StokerDirective {
  const directive = emptyStokerDirective(
    signals.current_iteration,
    signals.for_iteration ?? signals.current_iteration + 1,
  );

  const qualityWindow = recent(signals.recent_iterations, QUALITY_WINDOW);
  if (qualityWindow.length > 0) {
    const kills = qualityWindow.filter((entry) => entry.outcome === "killed").length;
    if (kills / qualityWindow.length > 0.5) {
      directive.urgency = "low";
      directive.complexity_override = "S";
      appendHint(directive, "Play it safe this iteration: choose S-tier work in a proven domain and rebuild momentum.");
      addRule(directive, "kill_rate_hot");
    }

    const shipped = qualityWindow.filter((entry) => entry.outcome === "shipped");
    const ratings = shipped.map((entry) => parseRating(entry.mean_rating)).filter((rating): rating is number => rating != null);
    if (shipped.length / qualityWindow.length > 0.8 && ratings.length >= 3 && mean(ratings) > 3.5) {
      directive.urgency = "high";
      appendHint(directive, "Take a risk. Propose something ambitious enough to stretch the system.");
      addRule(directive, "running_cold");
    }
  }

  const activeStreak = signals.streak.current;
  if (activeStreak && activeStreak.length >= 3 && activeStreak.avg_rating >= 3.8) {
    directive.streak_instruction = "amplify";
    appendHint(directive, `Push the ${activeStreak.domain} streak further with a new angle instead of a repeat.`);
    addRule(directive, "hot_streak");
  } else if (!activeStreak && signals.streak.cooldown_remaining > 0 && signals.streak.cooldown_domains.length > 0) {
    directive.streak_instruction = "break";
    directive.domain_pressure = mergeDomainPressure(directive.domain_pressure, {
      away_from: signals.streak.cooldown_domains,
    });
    appendHint(directive, `Pivot away from ${signals.streak.cooldown_domains.join(", ")} while the broken streak cools down.`);
    addRule(directive, "broken_streak");
  }

  const complexity = signals.complexity_bias.recommendation;
  if (complexity.confidence !== "low" && complexity.favor !== "balanced") {
    directive.complexity_override = complexity.favor;
    addRule(directive, "complexity_bias");
  }

  if (signals.mood) {
    const label = signals.mood.dominant_mood.toLowerCase();
    if (label.includes("frustrated") || label.includes("defiant")) {
      directive.mood_amplifier = "Channel frustration into unconventional work with a clean, testable shape.";
      addRule(directive, "mood_channel");
    } else if (label.includes("confident") || label.includes("flow")) {
      directive.mood_amplifier = "The system is in flow; trust the strongest instinct and make it sharper.";
      addRule(directive, "mood_flow");
    }
  }

  const refineryMinGap = Math.max(0, Math.floor(signals.refinery_min_iterations_between_runs ?? MIN_REFINERY_GAP));
  const refineryGap = signals.last_refinery_iteration == null
    ? Number.POSITIVE_INFINITY
    : signals.current_iteration - signals.last_refinery_iteration;
  const refineryFuelCount = signals.refinery_target_count ?? (signals.dream_count >= DREAM_FUEL_THRESHOLD ? 1 : 0);
  const tokenHeat = getStokerTokenHeatStatus(signals.recent_iterations, {
    refinery_token_heat_window: signals.refinery_token_heat_window
      ?? DEFAULT_STOKER_CONFIG.refinery_token_heat_window,
    refinery_token_heat_threshold: signals.refinery_token_heat_threshold
      ?? DEFAULT_STOKER_CONFIG.refinery_token_heat_threshold,
  });
  if (refineryFuelCount > 0 && refineryGap >= refineryMinGap && tokenHeat.hot) {
    appendHint(directive, `Defer refinery; recent main-loop token spend is already hot at ${Math.round(tokenHeat.averageTokens)} tokens on average.`);
    addRule(directive, "token_heat_refinery_deferral");
  } else if (refineryFuelCount > 0 && refineryGap >= refineryMinGap) {
    directive.refinery_queue = 1;
    addRule(directive, "refinery_fuel");
  }

  const collapsed = strongestDomain(recent(signals.recent_iterations, DOMAIN_WINDOW));
  if (collapsed && collapsed.ratio > 0.6) {
    directive.domain_pressure = mergeDomainPressure(directive.domain_pressure, {
      away_from: [collapsed.domain],
    });
    addRule(directive, "domain_collapse");
  }

  if (signals.force_reason === "quality_escalation") {
    directive.urgency = "high";
    directive.complexity_override = "S";
    appendHint(
      directive,
      `Recover quality after ${forceContextTitle(signals)}${forceContextDomain(signals)}: ${forceContextRating(signals)}. Choose an S-tier proposal with a sharper premise, explicit craft constraint, and no scope expansion until the weakness is addressed.`,
    );
    addRule(directive, "quality_escalation");
  } else if (signals.force_reason === "failure_escalation") {
    directive.urgency = "high";
    directive.streak_instruction = "break";
    directive.complexity_override = "S";
    appendHint(
      directive,
      `Recover from killed artifact ${forceContextTitle(signals)}${forceContextDomain(signals)}: ${forceContextReason(signals)} Choose an S-tier proposal that avoids this failure mode and has a testable finish line.`,
    );
    addRule(directive, "failure_escalation");
  } else if (signals.force_reason === "dimension_repair") {
    directive.urgency = "high";
    appendHint(
      directive,
      `Repair the weakest Critic dimension from ${forceContextTitle(signals)}${forceContextDomain(signals)}: ${forceContextDimensionRepair(signals)}. Keep the next proposal ambitious enough to make that dimension visibly stronger, not merely acceptable.`,
    );
    addRule(directive, "dimension_repair");
  } else if (signals.force_reason === "human_redirect") {
    directive.urgency = "high";
    appendHint(
      directive,
      `Human redirect queued in ${forceContextRequestFile(signals)}: ${forceContextRequestPreview(signals)}. Treat this as the controlling brief for the next proposal unless it conflicts with safety or project invariants.`,
    );
    addRule(directive, "human_redirect");
  } else if (signals.force_reason === "success_amplification") {
    directive.urgency = "high";
    directive.streak_instruction = "amplify";
    appendHint(
      directive,
      `Amplify the successful pattern from ${forceContextTitle(signals)}${forceContextDomain(signals)}: ${forceContextSuccessRating(signals)}. Keep the winning constraint visible while making the next piece meaningfully different.`,
    );
    addRule(directive, "success_amplification");
  } else if (signals.force_reason === "monitor_warning") {
    directive.urgency = "high";
    appendHint(
      directive,
      `Anti-entropy monitor forced this handoff after ${formatMonitorWarningCount(signals)}: ${forceContextReason(signals)}. Choose a proposal that directly reduces this warning pressure before pursuing novelty.`,
    );
    addRule(directive, "monitor_warning");
  } else if (signals.force_reason === "underburn") {
    const previousComplexity = signals.force_context?.complexity;
    const nextComplexity = nextComplexityTier(previousComplexity);
    directive.urgency = "high";
    directive.complexity_override = nextComplexity;
    appendHint(
      directive,
      `Token underburn after ${forceContextTitle(signals)}${forceContextDomain(signals)}: ${formatUnderburnTokens(signals.force_context?.spent_tokens)} tokens against a ${formatUnderburnTokens(signals.force_context?.target_tokens)}-token floor. For the next loop, choose a deeper ${nextComplexity}-tier proposal with more deliberate ideation, richer artifact surface, and concrete evaluation hooks.`,
    );
    addRule(directive, "underburn");
  } else if (signals.force_reason === "startup_underburn") {
    directive.urgency = "high";
    directive.complexity_override = "M";
    appendHint(
      directive,
      `Startup token prime: persisted loop history averaged ${formatUnderburnTokens(signals.force_context?.spent_tokens)} tokens against a ${formatUnderburnTokens(signals.force_context?.target_tokens)}-token cold-start floor. Begin this run with a richer M-tier proposal, multiple concrete artifact surfaces, and explicit evaluation hooks instead of another tiny artifact.`,
    );
    addRule(directive, "startup_underburn");
  } else if (signals.force_reason === "domain_rut") {
    const domain = forceContextRutDomain(signals);
    const streakLength = forceContextRutLength(signals);
    directive.urgency = "high";
    directive.streak_instruction = "break";
    directive.domain_pressure = mergeDomainPressure(directive.domain_pressure, {
      away_from: [domain],
    });
    appendHint(
      directive,
      `Domain rut detected: ${streakLength} straight shipped artifacts in ${domain}. For the next proposal, pivot away from ${domain} and use a different domain or form that changes the artifact surface.`,
    );
    addRule(directive, "domain_rut");
  } else if (signals.force_reason === "token_heat") {
    directive.complexity_override = "S";
    const pressure = signals.force_context?.token_heat_pressure ?? tokenHeat.pressure;
    const percent = signals.force_context?.token_heat_threshold_percent ?? tokenHeat.thresholdPercent;
    appendHint(
      directive,
      `Token heat forced this handoff: recent spend is ${pressure} at ${percent}%. Keep the next proposal narrow, testable, and cheaper before expanding again.`,
    );
    addRule(directive, "token_heat");
  }

  if (directive.rules_fired.length === 0) {
    addRule(directive, "cruising");
  }

  return directive;
}
