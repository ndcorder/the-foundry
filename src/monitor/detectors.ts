import { MonitorConfig, MonitorWarning, DEFAULT_MONITOR_CONFIG } from "./types.js";
import { analyzeComplexityYield } from "../complexity/index.js";
import type { ComplexityAnalysisOptions, ComplexityTier } from "../complexity/index.js";
import type { JsonlLogHealth } from "../logging/index.js";

// Local interface for iteration log entries consumed by detectors.
// Kept separate from the main IterationResult type to avoid coupling
// the monitor module to agent-specific types (CriticRatings, etc.).
export interface IterationEntry {
  timestamp: string;
  iteration: number;
  outcome: "shipped" | "killed" | "skipped" | "halted";
  artifact_id?: string;
  title?: string;
  domain?: string;
  complexity?: ComplexityTier;
  ratings?: Record<string, number>;
  mean_rating?: string;
  review?: string;
  reason?: string;
  token_usage: { input: number; output: number };
  duration_ms: number;
}

// ── Helpers ──────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function trigrams(s: string): Set<string> {
  const lower = s.toLowerCase();
  const set = new Set<string>();
  for (let i = 0; i <= lower.length - 3; i++) {
    set.add(lower.slice(i, i + 3));
  }
  return set;
}

function trigramOverlap(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 && tb.size === 0) return 0;

  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) intersection++;
  }
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ── 1. Slop Detector ─────────────────────────────────────────────

export function detectSlop(
  iterations: IterationEntry[],
  currentIteration: number,
  config: MonitorConfig,
): MonitorWarning[] {
  const warnings: MonitorWarning[] = [];

  const shipped = iterations
    .filter((e) => e.outcome === "shipped" && e.mean_rating !== undefined)
    .slice(-config.slop_window);

  if (shipped.length < 3) return warnings;

  const scores = shipped.map((e) => parseFloat(e.mean_rating!));
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

  if (mean < config.slop_threshold) {
    warnings.push({
      detector: "slop",
      severity: "critical",
      message: `Quality crisis: mean rating ${mean.toFixed(2)} across last ${shipped.length} shipped artifacts (threshold ${config.slop_threshold})`,
      action: {
        type: "emergency_curator",
        reason: `Mean quality dropped to ${mean.toFixed(2)} — emergency Curator review needed`,
      },
      iteration: currentIteration,
      timestamp: now(),
    });
  }

  // Trend check: compare first half vs second half
  if (shipped.length >= 6) {
    const mid = Math.floor(scores.length / 2);
    const firstHalf = scores.slice(0, mid);
    const secondHalf = scores.slice(mid);
    const firstMean = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondMean = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    if (secondMean < firstMean && mean >= config.slop_threshold) {
      warnings.push({
        detector: "slop",
        severity: "warning",
        message: `Quality trending down: first-half mean ${firstMean.toFixed(2)} → second-half mean ${secondMean.toFixed(2)}`,
        iteration: currentIteration,
        timestamp: now(),
      });
    }
  }

  return warnings;
}

// ── 2. Repetition Detector ───────────────────────────────────────

export function detectRepetition(
  iterations: IterationEntry[],
  currentIteration: number,
  config: MonitorConfig,
): MonitorWarning[] {
  const warnings: MonitorWarning[] = [];

  const shipped = iterations
    .filter((e) => e.outcome === "shipped")
    .slice(-config.repetition_window);

  if (shipped.length < 2) return warnings;

  for (let i = 0; i < shipped.length; i++) {
    for (let j = i + 1; j < shipped.length; j++) {
      const a = shipped[i];
      const b = shipped[j];

      let similarity = 0;

      // Same domain contributes 0.3
      if (a.domain && b.domain && a.domain === b.domain) {
        similarity += 0.3;
      }

      // Title trigram overlap contributes up to 0.4
      if (a.title && b.title) {
        similarity += trigramOverlap(a.title, b.title) * 0.4;
      }

      // Review text trigram overlap (first 100 chars) contributes up to 0.3
      if (a.review && b.review) {
        similarity += trigramOverlap(
          a.review.slice(0, 100),
          b.review.slice(0, 100),
        ) * 0.3;
      }

      if (similarity >= config.repetition_threshold) {
        warnings.push({
          detector: "repetition",
          severity: "warning",
          message: `Artifacts too similar (${similarity.toFixed(2)}): "${a.title ?? a.artifact_id}" and "${b.title ?? b.artifact_id}"`,
          action: {
            type: "anti_repetition_pressure",
            context: `Iterations ${a.iteration} and ${b.iteration} produced similar artifacts (score ${similarity.toFixed(2)}). Domain: ${a.domain ?? "unknown"}/${b.domain ?? "unknown"}`,
          },
          iteration: currentIteration,
          timestamp: now(),
        });
      }
    }
  }

  return warnings;
}

// ── 3. Manifesto Drift Detector ──────────────────────────────────

export function detectManifestoDrift(
  journalContent: string,
  currentIteration: number,
  config: MonitorConfig,
): MonitorWarning[] {
  const warnings: MonitorWarning[] = [];

  // Parse journal lines for manifesto-related entries with iteration numbers.
  // Expected patterns: lines containing "manifesto" and an iteration number
  // e.g. "Iteration 42: Updated manifesto section..."
  const lines = journalContent.split("\n");
  const manifestoIterations: number[] = [];

  for (const line of lines) {
    if (!/manifesto/i.test(line)) continue;
    // Extract iteration numbers from the line
    const match = line.match(/iteration\s+(\d+)/i)
      ?? line.match(/iter\.?\s*(\d+)/i)
      ?? line.match(/#(\d+)/)
      ?? line.match(/\b(\d+)\b/);
    if (match) {
      const iter = parseInt(match[1], 10);
      if (!isNaN(iter)) {
        manifestoIterations.push(iter);
      }
    }
  }

  // Count changes in recent window
  const windowStart = currentIteration - config.manifesto_change_window;
  const recentChanges = manifestoIterations.filter((i) => i > windowStart);

  if (recentChanges.length > config.manifesto_max_changes) {
    warnings.push({
      detector: "manifesto_drift",
      severity: "warning",
      message: `Identity may be unstable — manifesto changed ${recentChanges.length} times in last ${config.manifesto_change_window} iterations`,
      action: {
        type: "manifesto_stability_warning",
        message: `${recentChanges.length} manifesto changes detected in window of ${config.manifesto_change_window} iterations (max ${config.manifesto_max_changes})`,
      },
      iteration: currentIteration,
      timestamp: now(),
    });
  }

  // Check for stagnation
  if (manifestoIterations.length === 0) {
    warnings.push({
      detector: "manifesto_drift",
      severity: "info",
      message: `Manifesto hasn't changed in recorded history — system may be stagnating`,
      iteration: currentIteration,
      timestamp: now(),
    });
  } else {
    const lastChange = Math.max(...manifestoIterations);
    const iterationsSinceChange = currentIteration - lastChange;
    if (iterationsSinceChange > config.manifesto_stagnation_threshold) {
      warnings.push({
        detector: "manifesto_drift",
        severity: "info",
        message: `Manifesto hasn't changed in ${iterationsSinceChange} iterations — system may be stagnating`,
        iteration: currentIteration,
        timestamp: now(),
      });
    }
  }

  return warnings;
}

// ── 4. Domain Collapse Detector ──────────────────────────────────

export function detectDomainCollapse(
  iterations: IterationEntry[],
  currentIteration: number,
  config: MonitorConfig,
): MonitorWarning[] {
  const warnings: MonitorWarning[] = [];

  const withDomain = iterations
    .filter((e) => e.domain !== undefined && e.domain !== "")
    .slice(-config.domain_collapse_window);

  if (withDomain.length < 3) return warnings;

  const counts: Record<string, number> = {};
  for (const entry of withDomain) {
    const d = entry.domain!;
    counts[d] = (counts[d] ?? 0) + 1;
  }

  const total = withDomain.length;
  for (const [domain, count] of Object.entries(counts)) {
    const ratio = count / total;
    if (ratio > config.domain_collapse_threshold) {
      warnings.push({
        detector: "domain_collapse",
        severity: "critical",
        message: `Domain collapse: "${domain}" is ${(ratio * 100).toFixed(0)}% of last ${total} iterations (threshold ${(config.domain_collapse_threshold * 100).toFixed(0)}%)`,
        action: {
          type: "domain_force_diversify",
          excluded_domain: domain,
          duration_iterations: config.domain_force_duration,
        },
        iteration: currentIteration,
        timestamp: now(),
      });
    }
  }

  return warnings;
}

// ── 5. Complexity Yield Detector ────────────────────────────────

export function detectComplexityYield(
  iterations: IterationEntry[],
  currentIteration: number,
  config: Partial<ComplexityAnalysisOptions> & Partial<Pick<MonitorConfig,
    "complexity_yield_window" | "complexity_min_samples_for_confidence" | "complexity_high_confidence_samples"
  >> = {},
): MonitorWarning[] {
  const bias = analyzeComplexityYield(iterations, currentIteration, {
    window: config.window ?? config.complexity_yield_window ?? DEFAULT_MONITOR_CONFIG.complexity_yield_window,
    min_samples_for_confidence: config.min_samples_for_confidence
      ?? config.complexity_min_samples_for_confidence
      ?? DEFAULT_MONITOR_CONFIG.complexity_min_samples_for_confidence,
    high_confidence_samples: config.high_confidence_samples
      ?? config.complexity_high_confidence_samples
      ?? DEFAULT_MONITOR_CONFIG.complexity_high_confidence_samples,
  });

  if (bias.recommendation.confidence === "low") return [];

  return [{
    detector: "complexity_yield",
    severity: "info",
    message: `Complexity yield updated: favor ${bias.recommendation.favor} (${bias.recommendation.confidence} confidence)`,
    action: {
      type: "complexity_bias_update",
      bias,
    },
    iteration: currentIteration,
    timestamp: now(),
  }];
}

// ── 6. JSONL Log Health Detector ────────────────────────────────

export function detectLogHealth(
  logHealth: JsonlLogHealth | null | undefined,
  currentIteration: number,
): MonitorWarning[] {
  if (!logHealth) return [];

  const warnings: MonitorWarning[] = [];

  if (logHealth.malformedActiveLines > 0) {
    const targets = logHealth.malformedActiveFileDetails.length > 0
      ? logHealth.malformedActiveFileDetails
        .map((detail) => `${detail.name} first line ${detail.firstMalformedLine}`)
        .join(", ")
      : logHealth.malformedActiveFiles.join(", ");
    warnings.push({
      detector: "log_health",
      severity: "critical",
      message: `JSONL log health critical: ${logHealth.malformedActiveLines} malformed active lines in ${targets}`,
      iteration: currentIteration,
      timestamp: now(),
    });
  }

  if (logHealth.rotationPressure === "rotate-soon" && logHealth.largestActive) {
    warnings.push({
      detector: "log_health",
      severity: "warning",
      message: `JSONL rotation pressure: ${logHealth.largestActive.name} is ${logHealth.largestActivePercent}% of rotation limit (${logHealth.largestActiveBytesRemaining} bytes remaining)`,
      iteration: currentIteration,
      timestamp: now(),
    });
  } else if (logHealth.rotationPressure === "watch" && logHealth.largestActive) {
    warnings.push({
      detector: "log_health",
      severity: "info",
      message: `JSONL rotation watch: ${logHealth.largestActive.name} is ${logHealth.largestActivePercent}% of rotation limit`,
      iteration: currentIteration,
      timestamp: now(),
    });
  }

  return warnings;
}

// ── Convenience: run all detectors ───────────────────────────────

export function runAllDetectors(
  iterations: IterationEntry[],
  journalContent: string,
  currentIteration: number,
  config: MonitorConfig = DEFAULT_MONITOR_CONFIG,
  logHealth?: JsonlLogHealth | null,
): MonitorWarning[] {
  return [
    ...detectSlop(iterations, currentIteration, config),
    ...detectRepetition(iterations, currentIteration, config),
    ...detectManifestoDrift(journalContent, currentIteration, config),
    ...detectDomainCollapse(iterations, currentIteration, config),
    ...detectComplexityYield(iterations, currentIteration, config),
    ...detectLogHealth(logHealth, currentIteration),
  ];
}
