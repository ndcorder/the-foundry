import type { JsonlLogHealth } from "../logging/index.js";
import {
  DEFAULT_MONITOR_CONFIG,
  type FurnaceHealthLevel,
  type FurnaceHealthStatus,
  type MonitorSeverity,
  type MonitorWarning,
  type MonitorWarningSnapshot,
  type MonitorWarningStatus,
} from "./types.js";

const MONITOR_SEVERITIES: MonitorSeverity[] = ["critical", "warning", "info"];
const DEFAULT_ACTIVE_MONITOR_WARNING_WINDOW = DEFAULT_MONITOR_CONFIG.active_warning_window;

interface MonitorWarningSummaryOptions {
  limit?: number;
  currentIteration?: number;
  activeIterationWindow?: number;
}

interface FurnaceStimuliHealthInput {
  failing?: number;
  disabled?: number;
}

function isMonitorSeverity(value: unknown): value is MonitorSeverity {
  return typeof value === "string" && MONITOR_SEVERITIES.includes(value as MonitorSeverity);
}

function normalizeMonitorWarning(entry: Partial<MonitorWarning>): MonitorWarningSnapshot | null {
  if (
    typeof entry.detector !== "string"
    || !isMonitorSeverity(entry.severity)
    || typeof entry.message !== "string"
  ) {
    return null;
  }

  return {
    detector: entry.detector,
    severity: entry.severity,
    message: entry.message,
    iteration: typeof entry.iteration === "number" ? entry.iteration : null,
    timestamp: typeof entry.timestamp === "string" ? entry.timestamp : null,
  };
}

export function summarizeMonitorWarnings(
  entries: Array<Partial<MonitorWarning>>,
  optionsOrLimit: MonitorWarningSummaryOptions | number = 5,
): MonitorWarningStatus {
  const options: MonitorWarningSummaryOptions = typeof optionsOrLimit === "number"
    ? { limit: optionsOrLimit }
    : optionsOrLimit;
  const limit = Math.max(1, Math.floor(options.limit ?? 5));
  const activeIterationWindow = Math.max(
    0,
    Math.floor(options.activeIterationWindow ?? DEFAULT_ACTIVE_MONITOR_WARNING_WINDOW),
  );
  const currentIteration = typeof options.currentIteration === "number" && Number.isFinite(options.currentIteration)
    ? Math.floor(options.currentIteration)
    : null;
  const counts: Record<MonitorSeverity, number> = {
    critical: 0,
    warning: 0,
    info: 0,
  };
  const activeCounts: Record<MonitorSeverity, number> = {
    critical: 0,
    warning: 0,
    info: 0,
  };
  const normalized = entries
    .map(normalizeMonitorWarning)
    .filter((entry): entry is MonitorWarningSnapshot => entry !== null);

  for (const entry of normalized) {
    counts[entry.severity]++;
  }

  const recentWarnings = normalized.slice(-limit);
  const activeWarningsAll = currentIteration === null
    ? recentWarnings
    : normalized.filter((entry) => (
      typeof entry.iteration === "number"
      && entry.iteration <= currentIteration
      && currentIteration - entry.iteration <= activeIterationWindow
    ));
  for (const entry of activeWarningsAll) {
    activeCounts[entry.severity]++;
  }

  return {
    counts,
    activeCounts,
    activeWarnings: activeWarningsAll.slice(-limit),
    activeWindow: currentIteration === null
      ? null
      : { currentIteration, iterations: activeIterationWindow },
    recentWarnings,
    latestWarning: recentWarnings.at(-1) ?? null,
  };
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function summarizeFurnaceHealth(
  logs: JsonlLogHealth,
  monitor: MonitorWarningStatus,
  stimuli?: FurnaceStimuliHealthInput,
): FurnaceHealthStatus {
  const activeCounts = monitor.activeCounts ?? monitor.counts;
  const criticalMonitorWarnings = activeCounts.critical ?? 0;
  const warningMonitorWarnings = activeCounts.warning ?? 0;
  const failingStimuliSources = Math.max(0, Math.floor(stimuli?.failing ?? 0));
  const disabledStimuliSources = Math.max(0, Math.floor(stimuli?.disabled ?? 0));
  const reasons: string[] = [];
  const actions: string[] = [...logs.recommendedActions];

  if (criticalMonitorWarnings > 0) {
    reasons.push(pluralize(criticalMonitorWarnings, "critical monitor warning"));
  }
  if (warningMonitorWarnings > 0) {
    reasons.push(pluralize(warningMonitorWarnings, "monitor warning"));
  }
  if (logs.healthState === "malformed") {
    reasons.push("JSONL logs are malformed");
  } else if (logs.healthState === "watch" || logs.healthState === "rotate-soon") {
    reasons.push(`JSONL log rotation pressure is ${logs.healthState}`);
  }
  if (failingStimuliSources > 0) {
    reasons.push(pluralize(failingStimuliSources, "stimuli source failing", "stimuli sources failing"));
  }
  if (disabledStimuliSources > 0) {
    reasons.push(pluralize(disabledStimuliSources, "stimuli source disabled", "stimuli sources disabled"));
  }

  if (criticalMonitorWarnings > 0 || warningMonitorWarnings > 0) {
    actions.push("Inspect logs/monitor.jsonl for recent monitor warnings.");
  }
  if (failingStimuliSources > 0 || disabledStimuliSources > 0) {
    actions.push("Inspect stimuli source health and recover disabled or failing feeds.");
  }

  let level: FurnaceHealthLevel = "healthy";
  if (criticalMonitorWarnings > 0 || logs.healthState === "malformed") {
    level = "critical";
  } else if (
    warningMonitorWarnings > 0
    || logs.healthState === "watch"
    || logs.healthState === "rotate-soon"
    || failingStimuliSources > 0
    || disabledStimuliSources > 0
  ) {
    level = "warning";
  }

  return {
    level,
    reasons,
    actions,
  };
}
