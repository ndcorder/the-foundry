#!/usr/bin/env node

import path from "node:path";
import type {
  PromptContract,
  PromptContractFileStatus,
  PromptContractReport,
} from "./agents/prompt.js";
import { setRootDir } from "./root.js";

const LOG_DOCTOR_FAIL_STATES = ["healthy", "watch", "rotate-soon", "malformed"] as const;
type LogDoctorFailState = typeof LOG_DOCTOR_FAIL_STATES[number];
const STATUS_FAIL_LEVELS = ["warning", "critical"] as const;
type StatusFailLevel = typeof STATUS_FAIL_LEVELS[number];
type DoctorHealthLevel = "healthy" | StatusFailLevel;

interface DoctorHealthStatus {
  level: DoctorHealthLevel;
  reasons: string[];
  actions: string[];
}

interface StatusAlertSource {
  intervention?: InterventionStatusSource | null;
  furnace?: {
    health?: {
      level?: string;
      reasons?: unknown;
      actions?: unknown;
    };
    logs?: {
      healthState?: string;
      recommendedActions?: unknown;
    };
    monitor?: {
      counts?: {
        critical?: number;
        warning?: number;
      };
      activeCounts?: {
        critical?: number;
        warning?: number;
      };
    };
  };
}

interface InterventionStatusSource {
  stopFile?: string;
  stopPending?: boolean;
  stopPreview?: string | null;
  requestsFile?: string;
  requestPending?: boolean;
  requestPreview?: string | null;
}

interface DoctorLogSource {
  healthState?: string;
  recommendedActions?: unknown;
  activeFiles?: number;
  archiveCount?: number;
  totalActiveBytes?: number;
  totalArchiveBytes?: number;
  totalLogBytes?: number;
  largestActivePercent?: number;
  rotationPressure?: string;
  malformedActiveLines?: number;
  malformedActiveFiles?: string[];
  malformedActiveFileDetails?: Array<{ name: string; firstMalformedLine: number }>;
  largestActive?: { name: string; bytes: number } | null;
  largestArchive?: { name: string; bytes: number } | null;
}

interface DoctorMonitorSource {
  counts?: {
    critical?: number;
    warning?: number;
    info?: number;
  };
  activeCounts?: {
    critical?: number;
    warning?: number;
    info?: number;
  };
  activeWindow?: {
    currentIteration?: number;
    iterations?: number;
  } | null;
  latestWarning?: {
    severity?: string;
    detector?: string;
    iteration?: number | null;
    message?: string;
  } | null;
}

interface DoctorStatusSource extends StatusAlertSource {
  running?: boolean;
  iteration?: number;
  savedAt?: string | null;
  intervention?: InterventionStatusSource | null;
  furnace?: StatusAlertSource["furnace"] & {
    logs?: DoctorLogSource;
    monitor?: DoctorMonitorSource;
  };
}

interface ForecastSignalSource {
  name?: string;
  state?: string;
  detail?: string;
}

interface ForecastSource {
  nextIteration?: number;
  state?: string;
  summary?: string;
  actions?: unknown;
  signals?: unknown;
}

interface SparkSource {
  nextIteration?: number;
  domain?: string;
  domainReason?: string;
  title?: string;
  brief?: string;
  constraints?: unknown;
  signals?: unknown;
  requestText?: string;
}

interface SparkDeckSource {
  nextIteration?: number;
  count?: number;
  sparks?: unknown;
}

interface SparkStatsDomainSource {
  domain?: string;
  count?: number;
  replayed?: number;
  replayable?: number;
}

interface SparkStatsSource {
  filters?: {
    domain?: string | null;
    mode?: string | null;
    replayable?: boolean | null;
    since?: string | null;
    until?: string | null;
  };
  total?: number;
  original?: number;
  replayed?: number;
  replayable?: number;
  byMode?: {
    set?: number;
    append?: number;
  };
  byDomain?: unknown;
  lastEvent?: Record<string, unknown> | null;
  lastReplay?: Record<string, unknown> | null;
}

interface RequestStatsSource {
  filters?: {
    action?: string | null;
    source?: string | null;
    contains?: string | null;
    since?: string | null;
    until?: string | null;
  };
  total?: number;
  byAction?: {
    set?: number;
    append?: number;
    clear?: number;
  };
  withSource?: number;
  withRequestText?: number;
  lastEvent?: Record<string, unknown> | null;
  lastSet?: Record<string, unknown> | null;
  lastAppend?: Record<string, unknown> | null;
  lastClear?: Record<string, unknown> | null;
}

interface RequestSourceSummarySource {
  source?: string;
  total?: number;
  byAction?: {
    set?: number;
    append?: number;
    clear?: number;
  };
  withRequestText?: number;
  latestTimestamp?: string | null;
  lastEntry?: Record<string, unknown> | null;
}

interface RequestSourcesSource {
  filters?: {
    action?: string | null;
    source?: string | null;
    contains?: string | null;
    since?: string | null;
    until?: string | null;
  };
  limit?: number;
  totalSources?: number;
  sources?: RequestSourceSummarySource[];
}

interface RequestDiffLineSource {
  type?: string;
  line?: string;
}

interface RequestDiffSource {
  from?: string;
  sourceAction?: string | null;
  sourceRequestFile?: string | null;
  changed?: boolean;
  sameLines?: number;
  addedLines?: number;
  removedLines?: number;
  lines?: unknown;
}

interface ConfigDoctorFileStatus {
  name: string;
  kind: "config" | "prompt";
  ok: boolean;
  error?: string;
  errors?: string[];
  diagnostics?: unknown[];
}

interface ConfigDoctorSummary {
  total: number;
  ok: number;
  invalid: number;
  byKind: Record<ConfigDoctorFileStatus["kind"], number>;
  invalidByKind: Record<ConfigDoctorFileStatus["kind"], number>;
  ambiguousPromptSelectors: number;
}

interface ConfigDoctorReport {
  status: "healthy" | "invalid";
  summary: ConfigDoctorSummary;
  files: ConfigDoctorFileStatus[];
  ambiguousPromptSelectors: PromptContractAmbiguousSelector[];
}

interface PromptContractListSection {
  name: string;
  marker: string;
  position: "before" | "from";
  requiredPlaceholders: string[];
  optionalPlaceholders: string[];
}

interface PromptContractListEntry {
  name: string;
  relativePath: string;
  selectors: string[];
  requiredPlaceholders: string[];
  optionalPlaceholders: string[];
  sections: PromptContractListSection[];
}

interface PromptContractAmbiguousSelector {
  selector: string;
  matches: string[];
}

interface PromptContractListReport {
  summary: {
    total: number;
    withSections: number;
    ambiguousSelectors: number;
  };
  ambiguousSelectors: PromptContractAmbiguousSelector[];
  contracts: PromptContractListEntry[];
}

interface PromptContractShowReport {
  status: "healthy" | "invalid";
  contract: PromptContractListEntry;
  file: PromptContractFileStatus;
}

interface PromptDoctorReport {
  status: PromptContractReport["status"];
  summary: PromptContractReport["summary"] & {
    ambiguousSelectors: number;
  };
  ambiguousSelectors: PromptContractAmbiguousSelector[];
  files: PromptContractFileStatus[];
}

interface PromptContractShowErrorReport {
  status: "error";
  error: {
    code: "missing_prompt_template" | "unknown_prompt_template" | "ambiguous_prompt_template";
    message: string;
    selector: string | null;
    matches: string[];
  };
}

function parseLogDoctorFailOn(args: string[]): LogDoctorFailState {
  const explicit = args.find((arg) => arg.startsWith("--fail-on="));
  const positionalIndex = args.indexOf("--fail-on");
  const value = explicit?.slice("--fail-on=".length)
    ?? (positionalIndex >= 0 ? args[positionalIndex + 1] : undefined);
  if (value === undefined && positionalIndex < 0) return "malformed";
  if (LOG_DOCTOR_FAIL_STATES.includes(value as LogDoctorFailState)) {
    return value as LogDoctorFailState;
  }
  console.error("Usage: foundry logs doctor [--json] [--fail-on healthy|watch|rotate-soon|malformed]");
  process.exit(1);
}

function parseStatusFailOn(
  args: string[],
  usage = "Usage: foundry status [--json] [--fail-on warning|critical]",
  defaultLevel: StatusFailLevel | null = null,
): StatusFailLevel | null {
  const explicit = args.find((arg) => arg.startsWith("--fail-on="));
  const positionalIndex = args.indexOf("--fail-on");
  const value = explicit?.slice("--fail-on=".length)
    ?? (positionalIndex >= 0 ? args[positionalIndex + 1] : undefined);
  if (value === undefined && positionalIndex < 0) return defaultLevel;
  if (STATUS_FAIL_LEVELS.includes(value as StatusFailLevel)) {
    return value as StatusFailLevel;
  }
  console.error(usage);
  process.exit(1);
}

function maxStatusFailLevel(...levels: Array<StatusFailLevel | null>): StatusFailLevel | null {
  if (levels.includes("critical")) return "critical";
  if (levels.includes("warning")) return "warning";
  return null;
}

function statusAlertLevel(status: StatusAlertSource): StatusFailLevel | null {
  const healthLevel = status.furnace?.health?.level;
  let furnaceLevel: StatusFailLevel | null = null;
  if (healthLevel === "critical" || healthLevel === "warning") {
    furnaceLevel = healthLevel;
  } else if (healthLevel !== "healthy") {
    const monitorCounts = status.furnace?.monitor?.activeCounts ?? status.furnace?.monitor?.counts;
    const criticalMonitorWarnings = monitorCounts?.critical ?? 0;
    const warningMonitorWarnings = monitorCounts?.warning ?? 0;
    const logState = status.furnace?.logs?.healthState;

    if (criticalMonitorWarnings > 0 || logState === "malformed") {
      furnaceLevel = "critical";
    } else if (warningMonitorWarnings > 0 || logState === "watch" || logState === "rotate-soon") {
      furnaceLevel = "warning";
    }
  }

  return maxStatusFailLevel(
    furnaceLevel,
    status.intervention?.stopPending === true ? "warning" : null,
  );
}

function shouldFailStatus(status: StatusAlertSource, failOn: StatusFailLevel | null): boolean {
  if (!failOn) return false;
  const alertLevel = statusAlertLevel(status);
  if (!alertLevel) return false;
  if (failOn === "warning") return true;
  return alertLevel === "critical";
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function isDoctorHealthLevel(value: unknown): value is DoctorHealthLevel {
  return value === "healthy" || value === "warning" || value === "critical";
}

function doctorInterventionHealth(intervention: InterventionStatusSource | null | undefined): DoctorHealthStatus {
  if (intervention?.stopPending !== true) {
    return { level: "healthy", reasons: [], actions: [] };
  }
  const stopFile = intervention.stopFile ?? "STOP";
  return {
    level: "warning",
    reasons: [`STOP file is present: ${stopFile}.`],
    actions: [`Remove ${stopFile} to let the loop run.`],
  };
}

function doctorHealth(status: StatusAlertSource): DoctorHealthStatus {
  const existing = status.furnace?.health;
  if (existing && isDoctorHealthLevel(existing.level)) {
    return mergeDoctorHealth(
      {
        level: existing.level,
        reasons: asStringList(existing.reasons),
        actions: asStringList(existing.actions),
      },
      doctorInterventionHealth(status.intervention),
    );
  }

  const monitorCounts = status.furnace?.monitor?.activeCounts ?? status.furnace?.monitor?.counts;
  const criticalMonitorWarnings = monitorCounts?.critical ?? 0;
  const warningMonitorWarnings = monitorCounts?.warning ?? 0;
  const logState = status.furnace?.logs?.healthState;
  const reasons: string[] = [];
  const actions: string[] = asStringList(status.furnace?.logs?.recommendedActions);

  if (criticalMonitorWarnings > 0) {
    reasons.push(pluralize(criticalMonitorWarnings, "critical monitor warning"));
  }
  if (warningMonitorWarnings > 0) {
    reasons.push(pluralize(warningMonitorWarnings, "monitor warning"));
  }
  if (logState === "malformed") {
    reasons.push("JSONL logs are malformed");
  } else if (logState === "watch" || logState === "rotate-soon") {
    reasons.push(`JSONL log rotation pressure is ${logState}`);
  }

  if (criticalMonitorWarnings > 0 || warningMonitorWarnings > 0) {
    actions.push("Inspect logs/monitor.jsonl for recent monitor warnings.");
  }

  return mergeDoctorHealth(
    {
      level: statusAlertLevel(status) ?? "healthy",
      reasons,
      actions,
    },
    doctorInterventionHealth(status.intervention),
  );
}

function shouldFailDoctor(level: DoctorHealthLevel, failOn: StatusFailLevel): boolean {
  if (failOn === "warning") return level === "warning" || level === "critical";
  return level === "critical";
}

function maxDoctorHealthLevel(...levels: DoctorHealthLevel[]): DoctorHealthLevel {
  if (levels.includes("critical")) return "critical";
  if (levels.includes("warning")) return "warning";
  return "healthy";
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function doctorPreflightHealth(report: ConfigDoctorReport | null): DoctorHealthStatus {
  if (!report) {
    return { level: "healthy", reasons: [], actions: [] };
  }

  const reasons: string[] = [];
  const actions: string[] = [];
  const invalid = report.summary.invalid;
  const ambiguous = report.ambiguousPromptSelectors.length;

  if (invalid > 0) {
    reasons.push(`Config preflight has ${pluralize(invalid, "invalid file")}.`);
    actions.push("Run foundry config doctor --json for details.");
  }
  if (ambiguous > 0) {
    reasons.push(`Config preflight has ${pluralize(ambiguous, "ambiguous prompt selector")}.`);
    actions.push("Run foundry config doctor --fail-on-ambiguous for details.");
  }

  return {
    level: invalid > 0 ? "critical" : ambiguous > 0 ? "warning" : "healthy",
    reasons,
    actions,
  };
}

function mergeDoctorHealth(
  base: DoctorHealthStatus,
  preflight: DoctorHealthStatus,
): DoctorHealthStatus {
  return {
    level: maxDoctorHealthLevel(base.level, preflight.level),
    reasons: uniqueStrings([...base.reasons, ...preflight.reasons]),
    actions: uniqueStrings([...base.actions, ...preflight.actions]),
  };
}

function formatMonitorSummary(monitor: DoctorMonitorSource | null | undefined): string | null {
  const counts = monitor?.counts;
  if (!counts) return null;
  const activeCounts = monitor?.activeCounts;
  const displayCounts = activeCounts ?? counts;
  const activeWindow = activeCounts && typeof monitor?.activeWindow?.iterations === "number"
    ? ` over last ${monitor.activeWindow.iterations} ${monitor.activeWindow.iterations === 1 ? "iteration" : "iterations"}`
    : "";
  const total = activeCounts
    ? ` active${activeWindow} (${counts.critical ?? 0} total critical, ${counts.warning ?? 0} total warnings, ${counts.info ?? 0} total info)`
    : "";
  const latest = monitor?.latestWarning
    ? `, latest ${monitor.latestWarning.severity}/${monitor.latestWarning.detector}${monitor.latestWarning.iteration !== null && monitor.latestWarning.iteration !== undefined ? ` #${monitor.latestWarning.iteration}` : ""}: ${monitor.latestWarning.message}`
    : "";
  return `${displayCounts.critical ?? 0} critical, ${displayCounts.warning ?? 0} warnings, ${displayCounts.info ?? 0} info${total}${latest}`;
}

function formatLogSummary(logs: DoctorLogSource | null | undefined): string | null {
  if (!logs) return null;
  const health = logs.healthState ?? "healthy";
  const archiveBytes = logs.totalArchiveBytes ?? 0;
  const activeBytes = logs.totalActiveBytes ?? 0;
  const totalBytes = logs.totalLogBytes ?? activeBytes + archiveBytes;
  const malformedDetails = logs.malformedActiveFileDetails ?? [];
  const malformedFiles = logs.malformedActiveFiles ?? [];
  const malformedTargets = malformedDetails.length > 0
    ? malformedDetails
      .map((detail) => `${detail.name} (first line ${detail.firstMalformedLine})`)
      .join(", ")
    : malformedFiles.join(", ");
  const malformed = (logs.malformedActiveLines ?? 0) > 0
    ? `, ${logs.malformedActiveLines} malformed in ${malformedTargets}`
    : "";
  const largest = logs.largestActive
    ? `, largest ${logs.largestActive.name} ${logs.largestActive.bytes} bytes (${logs.largestActivePercent ?? 0}% of rotation limit, ${logs.rotationPressure ?? "clear"})`
    : "";
  const archiveLargest = logs.largestArchive
    ? `, largest archive ${logs.largestArchive.name} ${logs.largestArchive.bytes} bytes`
    : "";
  return `${health}, ${logs.activeFiles ?? 0} active, ${logs.archiveCount ?? 0} archives, ${activeBytes} active bytes, ${archiveBytes} archived bytes, ${totalBytes} total bytes${largest}${archiveLargest}${malformed}`;
}

function formatConfigPreflightSummary(report: ConfigDoctorReport): string {
  return `${report.status}, ${report.summary.total} total, ${report.summary.ok} ok, ${report.summary.invalid} invalid, ${report.summary.ambiguousPromptSelectors} ambiguous prompt selectors`;
}

function printConfigPreflightDetails(report: ConfigDoctorReport): void {
  const invalidFiles = report.files.filter((file) => !file.ok);
  if (invalidFiles.length > 0) {
    console.log(`  Preflight files:`);
    for (const file of invalidFiles) {
      console.log(`    ${file.name}: invalid - ${file.error ?? "unknown error"}`);
    }
  }
  if (report.ambiguousPromptSelectors.length > 0) {
    console.log(`  Preflight ambiguous selectors:`);
    for (const ambiguous of report.ambiguousPromptSelectors) {
      console.log(`    ${ambiguous.selector}: ${ambiguous.matches.join(", ")}`);
    }
  }
}

function printForecastText(report: ForecastSource): void {
  const nextIteration = typeof report.nextIteration === "number" ? `#${report.nextIteration}` : "#?";
  const state = typeof report.state === "string" && report.state.length > 0 ? report.state : "unknown";
  const summary = typeof report.summary === "string" && report.summary.length > 0 ? report.summary : "No forecast summary available.";
  const actions = Array.isArray(report.actions)
    ? report.actions.filter((action): action is string => typeof action === "string" && action.length > 0)
    : [];
  const signals = Array.isArray(report.signals)
    ? report.signals.filter((signal): signal is ForecastSignalSource => typeof signal === "object" && signal !== null)
    : [];

  console.log(`Forecast: ${state} for ${nextIteration}`);
  console.log(`Summary: ${summary}`);
  if (actions.length > 0) {
    console.log(`Actions:`);
    for (const action of actions) {
      console.log(`  - ${action}`);
    }
  }
  if (signals.length > 0) {
    console.log(`Signals:`);
    for (const signal of signals) {
      const signalState = typeof signal.state === "string" && signal.state.length > 0 ? signal.state : "info";
      const name = typeof signal.name === "string" && signal.name.length > 0 ? signal.name : "Signal";
      const detail = typeof signal.detail === "string" && signal.detail.length > 0 ? signal.detail : "No detail.";
      console.log(`  [${signalState}] ${name}: ${detail}`);
    }
  }
}

function printSparkText(report: SparkSource): void {
  const nextIteration = typeof report.nextIteration === "number" ? `#${report.nextIteration}` : "#?";
  const domain = typeof report.domain === "string" && report.domain.length > 0 ? report.domain : "unknown";
  const title = typeof report.title === "string" && report.title.length > 0 ? report.title : "Untitled spark";
  const reason = typeof report.domainReason === "string" && report.domainReason.length > 0 ? report.domainReason : "no selection reason";
  const brief = typeof report.brief === "string" && report.brief.length > 0 ? report.brief : "No brief available.";
  const constraints = Array.isArray(report.constraints)
    ? report.constraints.filter((constraint): constraint is string => typeof constraint === "string" && constraint.length > 0)
    : [];
  const signals = Array.isArray(report.signals)
    ? report.signals.filter((signal): signal is string => typeof signal === "string" && signal.length > 0)
    : [];

  console.log(`Spark: ${title} [${domain}] for ${nextIteration}`);
  console.log(`Why: ${reason}`);
  console.log(`Brief: ${brief}`);
  if (constraints.length > 0) {
    console.log(`Constraints:`);
    for (const constraint of constraints) {
      console.log(`  - ${constraint}`);
    }
  }
  if (signals.length > 0) {
    console.log(`Signals:`);
    for (const signal of signals) {
      console.log(`  - ${signal}`);
    }
  }
  if (typeof report.requestText === "string" && report.requestText.length > 0) {
    console.log(`Request text:`);
    console.log(report.requestText);
  }
}

function printSparkDeckText(report: SparkDeckSource): void {
  const sparks = Array.isArray(report.sparks)
    ? report.sparks.filter((spark): spark is SparkSource => typeof spark === "object" && spark !== null)
    : [];
  const nextIteration = typeof report.nextIteration === "number" ? `#${report.nextIteration}` : "#?";
  console.log(`Spark deck: ${sparks.length} ${sparks.length === 1 ? "card" : "cards"} for ${nextIteration}`);
  for (const [index, spark] of sparks.entries()) {
    const domain = typeof spark.domain === "string" && spark.domain.length > 0 ? spark.domain : "unknown";
    const title = typeof spark.title === "string" && spark.title.length > 0 ? spark.title : "Untitled spark";
    const reason = typeof spark.domainReason === "string" && spark.domainReason.length > 0 ? spark.domainReason : "no selection reason";
    const brief = typeof spark.brief === "string" && spark.brief.length > 0 ? spark.brief : "No brief available.";
    console.log(`${index + 1}. ${title} [${domain}]`);
    console.log(`   Why: ${reason}`);
    console.log(`   Brief: ${brief}`);
    if (typeof spark.requestText === "string" && spark.requestText.length > 0) {
      console.log(`   Request text:`);
      for (const line of spark.requestText.split("\n")) {
        console.log(`     ${line}`);
      }
    }
  }
}

function numericSparkStat(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatSparkStatsDomains(domains: unknown): string {
  if (!Array.isArray(domains) || domains.length === 0) return "none";
  return domains
    .filter((domain): domain is SparkStatsDomainSource => typeof domain === "object" && domain !== null)
    .map((domain) => {
      const name = typeof domain.domain === "string" && domain.domain.length > 0 ? domain.domain : "unknown-domain";
      return `${name} ${numericSparkStat(domain.count)}`;
    })
    .join(", ") || "none";
}

function printSparkStatsText(report: SparkStatsSource): void {
  const filters = formatHistoryFilters(
    report.filters?.domain,
    report.filters?.mode,
    report.filters?.replayable === true ? "replayable" : null,
    report.filters?.since ? `since ${report.filters.since}` : null,
    report.filters?.until ? `until ${report.filters.until}` : null,
  );
  const total = numericSparkStat(report.total);
  const original = numericSparkStat(report.original);
  const replayed = numericSparkStat(report.replayed);
  const replayable = numericSparkStat(report.replayable);
  const setCount = numericSparkStat(report.byMode?.set);
  const appendCount = numericSparkStat(report.byMode?.append);
  console.log(
    `Spark stats${filters ? ` for ${filters}` : ""}: ${pluralize(total, "audit event")} (` +
    `${original} original, ${replayed} replayed, ${replayable} replayable)`,
  );
  console.log(`Modes: set ${setCount}, append ${appendCount}`);
  console.log(`Domains: ${formatSparkStatsDomains(report.byDomain)}`);
  if (report.lastEvent) {
    const timestamp = formatSparkHistoryField(report.lastEvent, "timestamp", "unknown-time");
    console.log(`Last event: ${timestamp} ${formatSparkHistoryDetails(report.lastEvent)}`);
  }
  if (report.lastReplay) {
    const timestamp = formatSparkHistoryField(report.lastReplay, "timestamp", "unknown-time");
    console.log(`Last replay: ${timestamp} ${formatSparkHistoryDetails(report.lastReplay)}`);
  }
}

function printInterventionStatus(intervention: InterventionStatusSource, indent = "  "): void {
  const stopFile = intervention.stopFile ?? "STOP";
  const requestsFile = intervention.requestsFile ?? "requests.md";
  const stopState = intervention.stopPending ? "pending" : "clear";
  const stopPreview = intervention.stopPending && intervention.stopPreview
    ? ` - ${intervention.stopPreview}`
    : "";
  const requestState = intervention.requestPending ? "pending" : "clear";
  const requestPreview = intervention.requestPending && intervention.requestPreview
    ? ` - ${intervention.requestPreview}`
    : "";

  console.log(`${indent}Stop file: ${stopState} (${stopFile})${stopPreview}`);
  console.log(`${indent}Request:   ${requestState} (${requestsFile})${requestPreview}`);
}

const REQUEST_COMMAND_USAGE = "Usage: foundry request show|set <text>|set --file <path>|append <text>|append --file <path>|clear|history|stats|sources|restore (--from timestamp|--latest)|diff (--from timestamp|--latest) [--append] [--dry-run] [--json]";
const REQUEST_HISTORY_USAGE = "Usage: foundry request history [--action set|append|clear] [--restorable] [--source path] [--contains text] [--since timestamp] [--until timestamp] [--show-request] [--limit n] [--json]";
const REQUEST_STATS_USAGE = "Usage: foundry request stats [--action set|append|clear] [--source path] [--contains text] [--since timestamp] [--until timestamp] [--json]";
const REQUEST_SOURCES_USAGE = "Usage: foundry request sources [--action set|append|clear] [--source path] [--contains text] [--since timestamp] [--until timestamp] [--limit n] [--json]";
const REQUEST_RESTORE_USAGE = "Usage: foundry request restore (--from timestamp|--latest [--action set|append|clear] [--source path] [--contains text] [--since timestamp] [--until timestamp]) [--append] [--dry-run] [--json]";
const REQUEST_DIFF_USAGE = "Usage: foundry request diff (--from timestamp|--latest [--action set|append|clear] [--source path] [--contains text] [--since timestamp] [--until timestamp]) [--json]";
const REQUEST_HISTORY_ACTIONS = ["set", "append", "clear"] as const;
type RequestHistoryAction = typeof REQUEST_HISTORY_ACTIONS[number];
const STIMULI_COMMAND_USAGE = "Usage: foundry stimuli status [--json] [--fail-on warning|critical] | foundry stimuli history [source] [--action refresh|reset] [--status refreshed|refreshed_no_checkpoint|failed|reset|no_checkpoint] [--limit n] [--json] | foundry stimuli refresh <source> [--json] | foundry stimuli reset <source> [--json]";
const STIMULI_STATUS_USAGE = "Usage: foundry stimuli status [--json] [--fail-on warning|critical]";
const STIMULI_HISTORY_USAGE = "Usage: foundry stimuli history [source] [--action refresh|reset] [--status refreshed|refreshed_no_checkpoint|failed|reset|no_checkpoint] [--limit n] [--json]";
const STIMULI_AUDIT_ACTIONS = ["refresh", "reset"] as const;
type StimuliAuditAction = typeof STIMULI_AUDIT_ACTIONS[number];
const STIMULI_AUDIT_STATUSES = ["refreshed", "refreshed_no_checkpoint", "failed", "reset", "no_checkpoint"] as const;
type StimuliAuditStatus = typeof STIMULI_AUDIT_STATUSES[number];
const STIMULI_REFRESH_USAGE = "Usage: foundry stimuli refresh <source> [--json]";
const STIMULI_RESET_USAGE = "Usage: foundry stimuli reset <source> [--json]";
const STOKER_COMMAND_USAGE = "Usage: foundry stoker history [--urgency low|normal|high] [--rule name] [--iteration n] [--limit n] [--json]";
const STOKER_HISTORY_USAGE = "Usage: foundry stoker history [--urgency low|normal|high] [--rule name] [--iteration n] [--limit n] [--json]";
const STOKER_HISTORY_URGENCIES = ["low", "normal", "high"] as const;
type StokerHistoryUrgency = typeof STOKER_HISTORY_URGENCIES[number];
const SAFE_STOKER_HISTORY_RULE = /^[a-z0-9][a-z0-9_-]*$/i;
const REFINERY_COMMAND_USAGE = "Usage: foundry refinery history [--result shipped|killed|skipped] [--source-type dream|companion|low_rated] [--iteration n] [--limit n] [--json]";
const REFINERY_HISTORY_USAGE = "Usage: foundry refinery history [--result shipped|killed|skipped] [--source-type dream|companion|low_rated] [--iteration n] [--limit n] [--json]";
const REFINERY_HISTORY_RESULTS = ["shipped", "killed", "skipped"] as const;
type RefineryHistoryResult = typeof REFINERY_HISTORY_RESULTS[number];
const REFINERY_HISTORY_SOURCE_TYPES = ["dream", "companion", "low_rated"] as const;
type RefineryHistorySourceType = typeof REFINERY_HISTORY_SOURCE_TYPES[number];
const MONITOR_COMMAND_USAGE = "Usage: foundry monitor history [--severity critical|warning|info] [--detector name] [--iteration n] [--limit n] [--json]";
const MONITOR_HISTORY_USAGE = "Usage: foundry monitor history [--severity critical|warning|info] [--detector name] [--iteration n] [--limit n] [--json]";
const MONITOR_HISTORY_SEVERITIES = ["critical", "warning", "info"] as const;
type MonitorHistorySeverity = typeof MONITOR_HISTORY_SEVERITIES[number];
const SAFE_MONITOR_HISTORY_DETECTOR = /^[a-z0-9][a-z0-9_-]*$/i;
const DECISIONS_COMMAND_USAGE = "Usage: foundry decisions history [--gate gate1|gate2] [--decision approve|reject|revise|ship|kill] [--source ideator|human_redirect] [--iteration n] [--limit n] [--json]";
const DECISIONS_HISTORY_USAGE = "Usage: foundry decisions history [--gate gate1|gate2] [--decision approve|reject|revise|ship|kill] [--source ideator|human_redirect] [--iteration n] [--limit n] [--json]";
const DECISION_HISTORY_GATES = ["gate1", "gate2"] as const;
type DecisionHistoryGate = typeof DECISION_HISTORY_GATES[number];
const DECISION_HISTORY_DECISIONS = ["approve", "reject", "revise", "ship", "kill"] as const;
type DecisionHistoryDecision = typeof DECISION_HISTORY_DECISIONS[number];
const TESTER_COMMAND_USAGE = "Usage: foundry tester history [--outcome pass|fail_fixable|fail_catastrophic] [--artifact id] [--iteration n] [--limit n] [--json]";
const TESTER_HISTORY_USAGE = "Usage: foundry tester history [--outcome pass|fail_fixable|fail_catastrophic] [--artifact id] [--iteration n] [--limit n] [--json]";
const TEST_REPORT_HISTORY_OUTCOMES = ["pass", "fail_fixable", "fail_catastrophic"] as const;
type TestReportHistoryOutcome = typeof TEST_REPORT_HISTORY_OUTCOMES[number];
const SAFE_TEST_REPORT_HISTORY_ARTIFACT = /^[a-z0-9][a-z0-9_-]*$/i;
const TOKENS_COMMAND_USAGE = "Usage: foundry tokens history [--agent ideator|creator|tester|critic|curator] [--model name] [--iteration n] [--limit n] [--json]";
const TOKENS_HISTORY_USAGE = "Usage: foundry tokens history [--agent ideator|creator|tester|critic|curator] [--model name] [--iteration n] [--limit n] [--json]";
const TOKEN_USAGE_HISTORY_AGENTS = ["ideator", "creator", "tester", "critic", "curator"] as const;
type TokenUsageHistoryAgent = typeof TOKEN_USAGE_HISTORY_AGENTS[number];
const SAFE_TOKEN_USAGE_HISTORY_MODEL = /^[a-z0-9][a-z0-9._-]*$/i;
const SAFE_HISTORY_DOMAIN = /^[a-z0-9][a-z0-9_-]*$/i;
const ITERATIONS_COMMAND_USAGE = "Usage: foundry iterations history [--outcome shipped|killed|skipped|halted] [--source ideator|human_redirect] [--domain slug] [--limit n] [--json]";
const ITERATIONS_HISTORY_USAGE = "Usage: foundry iterations history [--outcome shipped|killed|skipped|halted] [--source ideator|human_redirect] [--domain slug] [--limit n] [--json]";
const ITERATION_HISTORY_OUTCOMES = ["shipped", "killed", "skipped", "halted"] as const;
type IterationHistoryOutcome = typeof ITERATION_HISTORY_OUTCOMES[number];
const TIMELINE_USAGE = "Usage: foundry timeline [--outcome shipped|killed|skipped|halted] [--source ideator|human_redirect] [--domain slug] [--iteration n] [--limit n] [--json]";
const SPARK_USAGE = "Usage: foundry spark [--domain slug] [--count n] [--apply|--append] [--json]";
const SPARK_HISTORY_USAGE = "Usage: foundry spark history [--domain slug] [--mode set|append] [--replayable] [--since timestamp] [--until timestamp] [--show-request] [--limit n] [--json]";
const SPARK_STATS_USAGE = "Usage: foundry spark stats [--domain slug] [--mode set|append] [--replayable] [--since timestamp] [--until timestamp] [--json]";
const SPARK_REPLAY_USAGE = "Usage: foundry spark replay [--domain slug] [--mode set|append] [--from timestamp] [--append] [--dry-run] [--json]";
const SPARK_REPLAY_HISTORY_LIMIT = 100;
const SPARK_HISTORY_MODES = ["set", "append"] as const;
type SparkHistoryMode = typeof SPARK_HISTORY_MODES[number];
const TIMELINE_SOURCES = ["ideator", "human_redirect"] as const;
type TimelineSource = typeof TIMELINE_SOURCES[number];
const REQUEST_PREVIEW_MAX = 160;

function requestPreview(content: string): string {
  const compact = content.trim().replace(/\s+/g, " ");
  return compact.length > REQUEST_PREVIEW_MAX
    ? `${compact.slice(0, REQUEST_PREVIEW_MAX - 3)}...`
    : compact;
}

function requestCommandError(): never {
  console.error(REQUEST_COMMAND_USAGE);
  process.exit(1);
}

function requestHistoryError(usage = REQUEST_HISTORY_USAGE): never {
  console.error(usage);
  process.exit(1);
}

function stimuliCommandError(usage = STIMULI_COMMAND_USAGE): never {
  console.error(usage);
  process.exit(1);
}

function stokerCommandError(usage = STOKER_COMMAND_USAGE): never {
  console.error(usage);
  process.exit(1);
}

function refineryCommandError(usage = REFINERY_COMMAND_USAGE): never {
  console.error(usage);
  process.exit(1);
}

function monitorCommandError(usage = MONITOR_COMMAND_USAGE): never {
  console.error(usage);
  process.exit(1);
}

function decisionsCommandError(usage = DECISIONS_COMMAND_USAGE): never {
  console.error(usage);
  process.exit(1);
}

function testerCommandError(usage = TESTER_COMMAND_USAGE): never {
  console.error(usage);
  process.exit(1);
}

function tokensCommandError(usage = TOKENS_COMMAND_USAGE): never {
  console.error(usage);
  process.exit(1);
}

function iterationsCommandError(usage = ITERATIONS_COMMAND_USAGE): never {
  console.error(usage);
  process.exit(1);
}

function timelineCommandError(usage = TIMELINE_USAGE): never {
  console.error(usage);
  process.exit(1);
}

function sparkCommandError(usage = SPARK_USAGE): never {
  console.error(usage);
  process.exit(1);
}

function sparkReplayError(message = SPARK_REPLAY_USAGE): never {
  console.error(message);
  process.exit(1);
}

function formatStimuliFailureCount(count: number): string {
  return count === 1 ? "1 failure" : `${count} failures`;
}

function formatStimuliEnabledState(disabled: boolean): string {
  return disabled ? "disabled" : "enabled";
}

function formatStimuliIterationCount(count: number): string {
  return count === 1 ? "1 iteration" : `${count} iterations`;
}

function parsePositiveIntegerOption(args: string[], option: string, usage: string): number | undefined {
  if (!hasOption(args, option)) return undefined;
  const value = parseOptionValue(args, option);
  const parsed = value === null ? Number.NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(usage);
    process.exit(1);
  }
  return parsed;
}

function parseRequestHistoryAction(args: string[], usage = REQUEST_HISTORY_USAGE): RequestHistoryAction | undefined {
  if (!hasOption(args, "--action")) return undefined;
  const value = parseOptionValue(args, "--action");
  if (value && REQUEST_HISTORY_ACTIONS.includes(value as RequestHistoryAction)) {
    return value as RequestHistoryAction;
  }
  requestHistoryError(usage);
}

function parseRequestHistoryTimestamp(args: string[], option: "--since" | "--until", usage = REQUEST_HISTORY_USAGE): string | undefined {
  if (!hasOption(args, option)) return undefined;
  const value = parseOptionValue(args, option);
  if (value && Number.isFinite(Date.parse(value))) {
    return value;
  }
  requestHistoryError(usage);
}

function parseRequestHistorySource(args: string[], usage = REQUEST_HISTORY_USAGE): string | undefined {
  if (!hasOption(args, "--source")) return undefined;
  const value = parseOptionValue(args, "--source");
  if (value && value.trim().length > 0) {
    return value;
  }
  requestHistoryError(usage);
}

function parseRequestHistoryContains(args: string[], usage = REQUEST_HISTORY_USAGE): string | undefined {
  if (!hasOption(args, "--contains")) return undefined;
  const value = parseOptionValue(args, "--contains");
  if (value && value.trim().length > 0) {
    return value;
  }
  requestHistoryError(usage);
}

function parseRequestRestoreTimestamp(args: string[], usage = REQUEST_RESTORE_USAGE): string {
  if (!hasOption(args, "--from")) requestHistoryError(usage);
  const value = parseOptionValue(args, "--from");
  if (value && Number.isFinite(Date.parse(value))) {
    return value;
  }
  requestHistoryError(usage);
}

function parseRequestRestoreSelector(args: string[]): {
  from?: string;
  latest?: boolean;
  action?: RequestHistoryAction;
  source?: string;
  contains?: string;
  since?: string;
  until?: string;
} {
  const hasFrom = hasOption(args, "--from");
  const latest = args.includes("--latest");
  if (hasFrom && latest) requestHistoryError(REQUEST_RESTORE_USAGE);
  if (!hasFrom && !latest) requestHistoryError(REQUEST_RESTORE_USAGE);
  if (latest) {
    return {
      latest: true,
      action: parseRequestHistoryAction(args, REQUEST_RESTORE_USAGE),
      source: parseRequestHistorySource(args, REQUEST_RESTORE_USAGE),
      contains: parseRequestHistoryContains(args, REQUEST_RESTORE_USAGE),
      since: parseRequestHistoryTimestamp(args, "--since", REQUEST_RESTORE_USAGE),
      until: parseRequestHistoryTimestamp(args, "--until", REQUEST_RESTORE_USAGE),
    };
  }
  return { from: parseRequestRestoreTimestamp(args, REQUEST_RESTORE_USAGE) };
}

function parseRequestDiffSelector(args: string[]): {
  from?: string;
  latest?: boolean;
  action?: RequestHistoryAction;
  source?: string;
  contains?: string;
  since?: string;
  until?: string;
} {
  const hasFrom = hasOption(args, "--from");
  const latest = args.includes("--latest");
  if (hasFrom && latest) requestHistoryError(REQUEST_DIFF_USAGE);
  if (!hasFrom && !latest) requestHistoryError(REQUEST_DIFF_USAGE);
  if (latest) {
    return {
      latest: true,
      action: parseRequestHistoryAction(args, REQUEST_DIFF_USAGE),
      source: parseRequestHistorySource(args, REQUEST_DIFF_USAGE),
      contains: parseRequestHistoryContains(args, REQUEST_DIFF_USAGE),
      since: parseRequestHistoryTimestamp(args, "--since", REQUEST_DIFF_USAGE),
      until: parseRequestHistoryTimestamp(args, "--until", REQUEST_DIFF_USAGE),
    };
  }
  return { from: parseRequestRestoreTimestamp(args, REQUEST_DIFF_USAGE) };
}

function parseStimuliAuditAction(args: string[]): StimuliAuditAction | undefined {
  if (!hasOption(args, "--action")) return undefined;
  const value = parseOptionValue(args, "--action");
  if (value && STIMULI_AUDIT_ACTIONS.includes(value as StimuliAuditAction)) {
    return value as StimuliAuditAction;
  }
  stimuliCommandError(STIMULI_HISTORY_USAGE);
}

function parseStimuliAuditStatus(args: string[]): StimuliAuditStatus | undefined {
  if (!hasOption(args, "--status")) return undefined;
  const value = parseOptionValue(args, "--status");
  if (value && STIMULI_AUDIT_STATUSES.includes(value as StimuliAuditStatus)) {
    return value as StimuliAuditStatus;
  }
  stimuliCommandError(STIMULI_HISTORY_USAGE);
}

function parseStokerHistoryUrgency(args: string[]): StokerHistoryUrgency | undefined {
  if (!hasOption(args, "--urgency")) return undefined;
  const value = parseOptionValue(args, "--urgency");
  if (value && STOKER_HISTORY_URGENCIES.includes(value as StokerHistoryUrgency)) {
    return value as StokerHistoryUrgency;
  }
  stokerCommandError(STOKER_HISTORY_USAGE);
}

function parseStokerHistoryRule(args: string[]): string | undefined {
  if (!hasOption(args, "--rule")) return undefined;
  const value = parseOptionValue(args, "--rule");
  if (value && SAFE_STOKER_HISTORY_RULE.test(value)) {
    return value;
  }
  stokerCommandError(STOKER_HISTORY_USAGE);
}

function parseRefineryHistoryResult(args: string[]): RefineryHistoryResult | undefined {
  if (!hasOption(args, "--result")) return undefined;
  const value = parseOptionValue(args, "--result");
  if (value && REFINERY_HISTORY_RESULTS.includes(value as RefineryHistoryResult)) {
    return value as RefineryHistoryResult;
  }
  refineryCommandError(REFINERY_HISTORY_USAGE);
}

function parseRefineryHistorySourceType(args: string[]): RefineryHistorySourceType | undefined {
  if (!hasOption(args, "--source-type")) return undefined;
  const value = parseOptionValue(args, "--source-type");
  if (value && REFINERY_HISTORY_SOURCE_TYPES.includes(value as RefineryHistorySourceType)) {
    return value as RefineryHistorySourceType;
  }
  refineryCommandError(REFINERY_HISTORY_USAGE);
}

function parseMonitorHistorySeverity(args: string[]): MonitorHistorySeverity | undefined {
  if (!hasOption(args, "--severity")) return undefined;
  const value = parseOptionValue(args, "--severity");
  if (value && MONITOR_HISTORY_SEVERITIES.includes(value as MonitorHistorySeverity)) {
    return value as MonitorHistorySeverity;
  }
  monitorCommandError(MONITOR_HISTORY_USAGE);
}

function parseMonitorHistoryDetector(args: string[]): string | undefined {
  if (!hasOption(args, "--detector")) return undefined;
  const value = parseOptionValue(args, "--detector");
  if (value && SAFE_MONITOR_HISTORY_DETECTOR.test(value)) {
    return value;
  }
  monitorCommandError(MONITOR_HISTORY_USAGE);
}

function parseDecisionHistoryGate(args: string[]): DecisionHistoryGate | undefined {
  if (!hasOption(args, "--gate")) return undefined;
  const value = parseOptionValue(args, "--gate");
  if (value && DECISION_HISTORY_GATES.includes(value as DecisionHistoryGate)) {
    return value as DecisionHistoryGate;
  }
  decisionsCommandError(DECISIONS_HISTORY_USAGE);
}

function parseDecisionHistoryDecision(args: string[]): DecisionHistoryDecision | undefined {
  if (!hasOption(args, "--decision")) return undefined;
  const value = parseOptionValue(args, "--decision");
  if (value && DECISION_HISTORY_DECISIONS.includes(value as DecisionHistoryDecision)) {
    return value as DecisionHistoryDecision;
  }
  decisionsCommandError(DECISIONS_HISTORY_USAGE);
}

function parseDecisionHistorySource(args: string[]): TimelineSource | undefined {
  if (!hasOption(args, "--source")) return undefined;
  const value = parseOptionValue(args, "--source");
  if (value && TIMELINE_SOURCES.includes(value as TimelineSource)) {
    return value as TimelineSource;
  }
  decisionsCommandError(DECISIONS_HISTORY_USAGE);
}

function parseTestReportHistoryOutcome(args: string[]): TestReportHistoryOutcome | undefined {
  if (!hasOption(args, "--outcome")) return undefined;
  const value = parseOptionValue(args, "--outcome");
  if (value && TEST_REPORT_HISTORY_OUTCOMES.includes(value as TestReportHistoryOutcome)) {
    return value as TestReportHistoryOutcome;
  }
  testerCommandError(TESTER_HISTORY_USAGE);
}

function parseTestReportHistoryArtifact(args: string[]): string | undefined {
  if (!hasOption(args, "--artifact")) return undefined;
  const value = parseOptionValue(args, "--artifact");
  if (value && SAFE_TEST_REPORT_HISTORY_ARTIFACT.test(value)) {
    return value;
  }
  testerCommandError(TESTER_HISTORY_USAGE);
}

function parseTokenUsageHistoryAgent(args: string[]): TokenUsageHistoryAgent | undefined {
  if (!hasOption(args, "--agent")) return undefined;
  const value = parseOptionValue(args, "--agent");
  if (value && TOKEN_USAGE_HISTORY_AGENTS.includes(value as TokenUsageHistoryAgent)) {
    return value as TokenUsageHistoryAgent;
  }
  tokensCommandError(TOKENS_HISTORY_USAGE);
}

function parseTokenUsageHistoryModel(args: string[]): string | undefined {
  if (!hasOption(args, "--model")) return undefined;
  const value = parseOptionValue(args, "--model");
  if (value && SAFE_TOKEN_USAGE_HISTORY_MODEL.test(value)) {
    return value;
  }
  tokensCommandError(TOKENS_HISTORY_USAGE);
}

function parseIterationHistoryOutcome(args: string[]): IterationHistoryOutcome | undefined {
  if (!hasOption(args, "--outcome")) return undefined;
  const value = parseOptionValue(args, "--outcome");
  if (value && ITERATION_HISTORY_OUTCOMES.includes(value as IterationHistoryOutcome)) {
    return value as IterationHistoryOutcome;
  }
  iterationsCommandError(ITERATIONS_HISTORY_USAGE);
}

function parseIterationHistorySource(args: string[]): TimelineSource | undefined {
  if (!hasOption(args, "--source")) return undefined;
  const value = parseOptionValue(args, "--source");
  if (value && TIMELINE_SOURCES.includes(value as TimelineSource)) {
    return value as TimelineSource;
  }
  iterationsCommandError(ITERATIONS_HISTORY_USAGE);
}

function parseIterationHistoryDomain(args: string[]): string | undefined {
  if (!hasOption(args, "--domain")) return undefined;
  const value = parseOptionValue(args, "--domain");
  if (value && SAFE_HISTORY_DOMAIN.test(value)) {
    return value;
  }
  iterationsCommandError(ITERATIONS_HISTORY_USAGE);
}

function parseTimelineOutcome(args: string[]): IterationHistoryOutcome | undefined {
  if (!hasOption(args, "--outcome")) return undefined;
  const value = parseOptionValue(args, "--outcome");
  if (value && ITERATION_HISTORY_OUTCOMES.includes(value as IterationHistoryOutcome)) {
    return value as IterationHistoryOutcome;
  }
  timelineCommandError(TIMELINE_USAGE);
}

function parseTimelineSource(args: string[]): TimelineSource | undefined {
  if (!hasOption(args, "--source")) return undefined;
  const value = parseOptionValue(args, "--source");
  if (value && TIMELINE_SOURCES.includes(value as TimelineSource)) {
    return value as TimelineSource;
  }
  timelineCommandError(TIMELINE_USAGE);
}

function parseTimelineDomain(args: string[]): string | undefined {
  if (!hasOption(args, "--domain")) return undefined;
  const value = parseOptionValue(args, "--domain");
  if (value && SAFE_HISTORY_DOMAIN.test(value)) {
    return value;
  }
  timelineCommandError(TIMELINE_USAGE);
}

function parseSparkDomain(args: string[]): string | undefined {
  if (!hasOption(args, "--domain")) return undefined;
  const value = parseOptionValue(args, "--domain");
  if (value && SAFE_HISTORY_DOMAIN.test(value)) {
    return value;
  }
  sparkCommandError(SPARK_USAGE);
}

function parseSparkCount(args: string[]): number {
  if (!hasOption(args, "--count")) return 1;
  const value = parseOptionValue(args, "--count");
  const parsed = value === null ? Number.NaN : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
    sparkCommandError(SPARK_USAGE);
  }
  return parsed;
}

function parseSparkHistoryDomain(args: string[], usage = SPARK_HISTORY_USAGE): string | undefined {
  if (!hasOption(args, "--domain")) return undefined;
  const value = parseOptionValue(args, "--domain");
  if (value && SAFE_HISTORY_DOMAIN.test(value)) {
    return value;
  }
  sparkCommandError(usage);
}

function parseSparkHistoryMode(args: string[], usage = SPARK_HISTORY_USAGE): SparkHistoryMode | undefined {
  if (!hasOption(args, "--mode")) return undefined;
  const value = parseOptionValue(args, "--mode");
  if (value && SPARK_HISTORY_MODES.includes(value as SparkHistoryMode)) {
    return value as SparkHistoryMode;
  }
  sparkCommandError(usage);
}

function parseSparkHistoryTimestamp(args: string[], option: "--since" | "--until", usage: string): string | undefined {
  if (!hasOption(args, option)) return undefined;
  const value = parseOptionValue(args, option);
  if (value && Number.isFinite(Date.parse(value))) {
    return value;
  }
  sparkCommandError(usage);
}

function parseSparkReplayTimestamp(args: string[]): string | undefined {
  if (!hasOption(args, "--from")) return undefined;
  const value = parseOptionValue(args, "--from");
  if (value) return value;
  sparkCommandError(SPARK_REPLAY_USAGE);
}

function getStimuliHistorySource(args: string[]): string | undefined {
  const positionals: string[] = [];
  for (let index = 2; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json") continue;
    if (arg === "--limit") {
      index++;
      continue;
    }
    if (arg === "--action" || arg === "--status") {
      index++;
      continue;
    }
    if (arg.startsWith("--limit=")) continue;
    if (arg.startsWith("--action=") || arg.startsWith("--status=")) continue;
    if (arg.startsWith("--")) continue;
    positionals.push(arg);
  }
  if (positionals.length > 1) stimuliCommandError(STIMULI_HISTORY_USAGE);
  return positionals[0];
}

function appendRequestContent(existing: string, addition: string): string {
  const current = existing.trim();
  const next = addition.trim();
  return current ? `${current}\n\n${next}` : next;
}

function hasOption(args: string[], option: string): boolean {
  return args.includes(option) || args.some((arg) => arg.startsWith(`${option}=`));
}

function parseOptionValue(args: string[], option: string): string | null {
  const explicit = args.find((arg) => arg.startsWith(`${option}=`));
  if (explicit) {
    const value = explicit.slice(option.length + 1).trim();
    return value.length > 0 ? value : null;
  }

  const optionIndex = args.indexOf(option);
  if (optionIndex < 0) return null;
  const value = args[optionIndex + 1]?.trim();
  return value && !value.startsWith("--") ? value : null;
}

function parseOptionText(args: string[], option: string): string | null {
  const explicit = args.find((arg) => arg.startsWith(`${option}=`));
  if (explicit) {
    const value = explicit.slice(option.length + 1).trim();
    return value.length > 0 ? value : null;
  }
  const optionIndex = args.indexOf(option);
  if (optionIndex < 0) return null;
  const value = args
    .slice(optionIndex + 1)
    .filter((arg) => !arg.startsWith("--"))
    .join(" ")
    .trim();
  return value.length > 0 ? value : null;
}

function printDoctorTextReport(
  report: ReturnType<typeof doctorReport>,
  label = "doctor",
): void {
  console.log(`Foundry ${label}: ${report.level}`);
  console.log(`  Running:    ${report.running ? "yes" : "no"}`);
  console.log(`  Iteration:  ${report.iteration}`);
  if (report.savedAt) console.log(`  Checkpoint: ${report.savedAt}`);
  if (report.health.reasons.length > 0) {
    console.log(`  Reasons:`);
    for (const reason of report.health.reasons) {
      console.log(`    - ${reason}`);
    }
  } else {
    console.log(`  Reasons:    none`);
  }
  if (report.health.actions.length > 0) {
    console.log(`  Actions:`);
    for (const action of report.health.actions) {
      console.log(`    - ${action}`);
    }
  } else {
    console.log(`  Actions:    none`);
  }
  const monitor = formatMonitorSummary(report.monitor);
  if (monitor) console.log(`  Monitor:    ${monitor}`);
  const logs = formatLogSummary(report.logs);
  if (logs) console.log(`  Logs:       ${logs}`);
  if (report.intervention) {
    console.log(`  Intervention:`);
    printInterventionStatus(report.intervention, "    ");
  }
  if (report.preflight) {
    console.log(`  Preflight:  ${formatConfigPreflightSummary(report.preflight)}`);
    printConfigPreflightDetails(report.preflight);
  }
}

function formatStimuliAuditField(entry: Record<string, unknown>, field: string, fallback: string): string {
  const value = entry[field];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function formatStimuliAuditIteration(entry: Record<string, unknown>): string {
  const iteration = entry.iteration;
  return typeof iteration === "number" ? `iteration ${iteration}` : "no checkpoint iteration";
}

function formatStimuliAuditCheckpoint(entry: Record<string, unknown>): string {
  return entry.checkpoint_updated === true ? "checkpoint updated" : "checkpoint unchanged";
}

function formatStimuliAuditDetails(entry: Record<string, unknown>): string {
  const details = [
    formatStimuliAuditIteration(entry),
    formatStimuliAuditCheckpoint(entry),
  ];
  if (typeof entry.content_length === "number") details.push(`${entry.content_length} bytes`);
  if (typeof entry.error === "string" && entry.error.length > 0) details.push(`error: ${entry.error}`);
  return details.join(", ");
}

function formatRequestHistoryField(entry: Record<string, unknown>, field: string, fallback: string): string {
  const value = entry[field];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function formatRequestHistoryDetails(entry: Record<string, unknown>): string {
  const action = formatRequestHistoryField(entry, "action", "unknown-action");
  const requestFile = formatRequestHistoryField(entry, "request_file", "unknown-request-file");
  const requestLength = typeof entry.request_length === "number" ? `${entry.request_length} bytes` : null;
  const previousLength = typeof entry.previous_request_length === "number" ? `previous ${entry.previous_request_length} bytes` : null;
  const source = typeof entry.source === "string" && entry.source.length > 0 ? `source ${entry.source}` : null;
  return [action, requestFile, requestLength, previousLength, source]
    .filter((part): part is string => part !== null)
    .join(", ");
}

function requestHistoryText(entry: Record<string, unknown>): string | null {
  const requestText = entry.request_text;
  return typeof requestText === "string" && requestText.trim().length > 0 ? requestText : null;
}

function formatRequestContainsFilter(contains: string | null | undefined): string | null {
  if (!contains) return null;
  return `contains "${contains.replace(/"/g, '\\"')}"`;
}

function numericRequestStat(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function printRequestStatsText(report: RequestStatsSource): void {
  const filters = formatHistoryFilters(
    report.filters?.action,
    report.filters?.source ? `source ${report.filters.source}` : null,
    formatRequestContainsFilter(report.filters?.contains),
    report.filters?.since ? `since ${report.filters.since}` : null,
    report.filters?.until ? `until ${report.filters.until}` : null,
  );
  const total = numericRequestStat(report.total);
  const setCount = numericRequestStat(report.byAction?.set);
  const appendCount = numericRequestStat(report.byAction?.append);
  const clearCount = numericRequestStat(report.byAction?.clear);
  const withSource = numericRequestStat(report.withSource);
  const withRequestText = numericRequestStat(report.withRequestText);
  console.log(
    `Request stats${filters ? ` for ${filters}` : ""}: ${pluralize(total, "audit event")} (` +
    `set ${setCount}, append ${appendCount}, clear ${clearCount}; ` +
    `${pluralize(withSource, "with source", "with source")}, ${pluralize(withRequestText, "with request text", "with request text")})`,
  );
  if (report.lastEvent) {
    const timestamp = formatRequestHistoryField(report.lastEvent, "timestamp", "unknown-time");
    console.log(`Last event: ${timestamp} ${formatRequestHistoryDetails(report.lastEvent)}`);
  }
  if (report.lastSet) {
    const timestamp = formatRequestHistoryField(report.lastSet, "timestamp", "unknown-time");
    console.log(`Last set: ${timestamp} ${formatRequestHistoryDetails(report.lastSet)}`);
  }
  if (report.lastAppend) {
    const timestamp = formatRequestHistoryField(report.lastAppend, "timestamp", "unknown-time");
    console.log(`Last append: ${timestamp} ${formatRequestHistoryDetails(report.lastAppend)}`);
  }
  if (report.lastClear) {
    const timestamp = formatRequestHistoryField(report.lastClear, "timestamp", "unknown-time");
    console.log(`Last clear: ${timestamp} ${formatRequestHistoryDetails(report.lastClear)}`);
  }
}

function printRequestSourcesText(report: RequestSourcesSource): void {
  const sources = Array.isArray(report.sources) ? report.sources : [];
  const totalSources = numericRequestStat(report.totalSources);
  const limit = numericRequestStat(report.limit);
  const filters = formatHistoryFilters(
    report.filters?.action,
    report.filters?.source ? `source ${report.filters.source}` : null,
    formatRequestContainsFilter(report.filters?.contains),
    report.filters?.since ? `since ${report.filters.since}` : null,
    report.filters?.until ? `until ${report.filters.until}` : null,
  );
  if (sources.length === 0) {
    console.log(`Request sources: no source-backed audit events${filters ? ` for ${filters}` : ""}.`);
    return;
  }
  console.log(
    `Request sources${filters ? ` for ${filters}` : ""}: ${pluralize(totalSources, "source file")} ` +
    `(showing ${sources.length}, limit ${limit})`,
  );
  for (const source of sources) {
    const sourceName = typeof source.source === "string" && source.source.length > 0 ? source.source : "unknown-source";
    const total = numericRequestStat(source.total);
    const setCount = numericRequestStat(source.byAction?.set);
    const appendCount = numericRequestStat(source.byAction?.append);
    const clearCount = numericRequestStat(source.byAction?.clear);
    const withRequestText = numericRequestStat(source.withRequestText);
    const latest = typeof source.latestTimestamp === "string" && source.latestTimestamp.length > 0
      ? source.latestTimestamp
      : "unknown-time";
    console.log(
      `  ${sourceName}: ${pluralize(total, "audit event")} ` +
      `(set ${setCount}, append ${appendCount}, clear ${clearCount}; ` +
      `${pluralize(withRequestText, "with request text", "with request text")}), latest ${latest}`,
    );
  }
}

function printRequestDiffText(report: RequestDiffSource, requestFile: string): void {
  const from = typeof report.from === "string" && report.from.length > 0 ? report.from : "unknown-time";
  const added = numericRequestStat(report.addedLines);
  const removed = numericRequestStat(report.removedLines);
  if (report.changed === false || (added === 0 && removed === 0)) {
    console.log(`Request diff for ${requestFile} against ${from}: no changes.`);
    return;
  }

  const sourceRequestFile = typeof report.sourceRequestFile === "string" && report.sourceRequestFile.length > 0
    ? report.sourceRequestFile
    : "unknown-request-file";
  const sourceAction = typeof report.sourceAction === "string" && report.sourceAction.length > 0
    ? ` ${report.sourceAction}`
    : "";
  console.log(`Request diff for ${requestFile} against ${from}: ${added} added, ${removed} removed`);
  console.log(`--- current ${requestFile}`);
  console.log(`+++ history ${sourceRequestFile}${sourceAction} ${from}`);
  const lines = Array.isArray(report.lines) ? report.lines : [];
  for (const line of lines) {
    if (typeof line !== "object" || line === null) continue;
    const entry = line as RequestDiffLineSource;
    const text = typeof entry.line === "string" ? entry.line : "";
    if (entry.type === "added") {
      console.log(`+ ${text}`);
    } else if (entry.type === "removed") {
      console.log(`- ${text}`);
    } else if (entry.type === "same") {
      console.log(`  ${text}`);
    }
  }
}

function formatSparkHistoryField(entry: Record<string, unknown>, field: string, fallback: string): string {
  const value = entry[field];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function formatSparkHistoryIteration(entry: Record<string, unknown>): string {
  const iteration = entry.next_iteration;
  return typeof iteration === "number" && Number.isFinite(iteration) ? `#${iteration}` : "#?";
}

function formatSparkHistoryDetails(entry: Record<string, unknown>): string {
  const mode = formatSparkHistoryField(entry, "mode", "unknown-mode");
  const domain = formatSparkHistoryField(entry, "domain", "unknown-domain");
  const title = formatSparkHistoryField(entry, "title", "Untitled spark");
  const requestFile = formatSparkHistoryField(entry, "request_file", "unknown-request-file");
  const replayable = replayableSparkRequestText(entry) === null ? "" : " [replayable]";
  return `${mode} ${domain} ${formatSparkHistoryIteration(entry)}: ${title} -> ${requestFile}${replayable}`;
}

function replayableSparkRequestText(entry: Record<string, unknown>): string | null {
  const requestText = entry.request_text;
  return typeof requestText === "string" && requestText.trim().length > 0 ? requestText : null;
}

function latestReplayableSparkEntry(entries: Record<string, unknown>[]): Record<string, unknown> | null {
  for (let index = entries.length - 1; index >= 0; index--) {
    if (replayableSparkRequestText(entries[index]) !== null) {
      return entries[index];
    }
  }
  return null;
}

function findReplayableSparkEntry(entries: Record<string, unknown>[], timestamp: string | undefined): Record<string, unknown> | null {
  if (!timestamp) return latestReplayableSparkEntry(entries);
  return entries.find((entry) =>
    formatSparkHistoryField(entry, "timestamp", "") === timestamp &&
    replayableSparkRequestText(entry) !== null
  ) ?? null;
}

function formatStokerHistoryTimestamp(entry: Record<string, unknown>): string {
  return typeof entry.generated_at === "string" && entry.generated_at.length > 0
    ? entry.generated_at
    : "unknown-time";
}

function formatStokerHistoryIteration(value: unknown): string {
  return typeof value === "number" ? `#${value}` : "#?";
}

function formatStokerHistoryRules(entry: Record<string, unknown>): string {
  const rules = Array.isArray(entry.rules_fired)
    ? entry.rules_fired.filter((rule): rule is string => typeof rule === "string" && rule.length > 0)
    : [];
  return rules.length > 0 ? `rules: ${rules.join(", ")}` : "rules: none";
}

function formatStokerHistoryDetails(entry: Record<string, unknown>): string {
  const urgency = typeof entry.urgency === "string" && entry.urgency.length > 0 ? entry.urgency : "unknown";
  const details = [
    `generated ${formatStokerHistoryIteration(entry.generated_iteration)} -> ${formatStokerHistoryIteration(entry.for_iteration)}`,
    urgency,
  ];
  if (typeof entry.refinery_queue === "number" && entry.refinery_queue > 0) {
    details.push(`refinery ${entry.refinery_queue}`);
  }
  details.push(formatStokerHistoryRules(entry));
  if (typeof entry.ideator_hint === "string" && entry.ideator_hint.length > 0) {
    details.push(`hint: ${entry.ideator_hint}`);
  }
  return details.join(", ");
}

function formatRefineryHistoryTimestamp(entry: Record<string, unknown>): string {
  return typeof entry.timestamp === "string" && entry.timestamp.length > 0
    ? entry.timestamp
    : "unknown-time";
}

function formatRefineryHistoryIteration(entry: Record<string, unknown>): string {
  return typeof entry.iteration === "number" ? `iteration ${entry.iteration}` : "unknown iteration";
}

function formatRefineryHistoryField(entry: Record<string, unknown>, field: string, fallback: string): string {
  const value = entry[field];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function formatRefineryHistoryDetails(entry: Record<string, unknown>): string {
  const lead = [
    formatRefineryHistoryIteration(entry),
    `${formatRefineryHistoryField(entry, "source_type", "unknown-source")} #${formatRefineryHistoryField(entry, "source_id", "?")}`,
    formatRefineryHistoryField(entry, "refinement_type", "unknown-refinement"),
    formatRefineryHistoryField(entry, "result", "unknown-result"),
  ].join(" ");
  const details = [lead];
  if (typeof entry.artifact_id === "string" && entry.artifact_id.length > 0) {
    details.push(`artifact ${entry.artifact_id}`);
  }
  if (typeof entry.mean_rating === "string" && entry.mean_rating.length > 0) {
    details.push(`rating ${entry.mean_rating}`);
  } else if (typeof entry.mean_rating === "number") {
    details.push(`rating ${entry.mean_rating}`);
  }
  if (typeof entry.reason === "string" && entry.reason.length > 0) {
    details.push(`reason: ${entry.reason}`);
  }
  if (typeof entry.title === "string" && entry.title.length > 0) {
    details.push(`title: ${entry.title}`);
  }
  return details.join(", ");
}

function formatMonitorHistoryTimestamp(entry: Record<string, unknown>): string {
  return typeof entry.timestamp === "string" && entry.timestamp.length > 0
    ? entry.timestamp
    : "unknown-time";
}

function formatMonitorHistoryIteration(entry: Record<string, unknown>): string {
  return typeof entry.iteration === "number" ? `#${entry.iteration}` : "#?";
}

function formatMonitorHistoryField(entry: Record<string, unknown>, field: string, fallback: string): string {
  const value = entry[field];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function formatMonitorHistoryAction(entry: Record<string, unknown>): string | null {
  const action = entry.action;
  if (action && typeof action === "object" && !Array.isArray(action)) {
    const type = (action as Record<string, unknown>).type;
    return typeof type === "string" && type.length > 0 ? `action: ${type}` : null;
  }
  return typeof action === "string" && action.length > 0 ? `action: ${action}` : null;
}

function formatMonitorHistoryDetails(entry: Record<string, unknown>): string {
  const lead = [
    formatMonitorHistoryIteration(entry),
    formatMonitorHistoryField(entry, "severity", "unknown-severity"),
    `${formatMonitorHistoryField(entry, "detector", "unknown-detector")}:`,
    formatMonitorHistoryField(entry, "message", "unknown-message"),
  ].join(" ");
  const action = formatMonitorHistoryAction(entry);
  return action ? `${lead}, ${action}` : lead;
}

function formatDecisionHistoryTimestamp(entry: Record<string, unknown>): string {
  return typeof entry.timestamp === "string" && entry.timestamp.length > 0
    ? entry.timestamp
    : "unknown-time";
}

function formatDecisionHistoryIteration(entry: Record<string, unknown>): string {
  return typeof entry.iteration === "number" ? `#${entry.iteration}` : "#?";
}

function formatDecisionHistoryField(entry: Record<string, unknown>, field: string, fallback: string): string {
  const value = entry[field];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function formatDecisionHistoryLabel(entry: Record<string, unknown>): string {
  return formatDecisionHistoryField(
    entry,
    "proposal_title",
    formatDecisionHistoryField(entry, "artifact_id", "unknown"),
  );
}

function formatDecisionHistoryRating(entry: Record<string, unknown>): string | null {
  const ratings = entry.ratings;
  if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)) return null;
  const values = Object.values(ratings).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return `rating ${mean.toFixed(1)}`;
}

function formatDecisionHistoryDetail(entry: Record<string, unknown>): string | null {
  const detail = ["review", "reasons", "sharpening_notes"]
    .map((field) => entry[field])
    .find((value) => typeof value === "string" && value.length > 0);
  return typeof detail === "string" ? detail : null;
}

function formatDecisionHistoryDetails(entry: Record<string, unknown>): string {
  const source = entry.source === "human_redirect" ? " [human redirect]" : "";
  const lead = [
    formatDecisionHistoryIteration(entry),
    formatDecisionHistoryField(entry, "gate", "unknown-gate"),
    formatDecisionHistoryField(entry, "decision", "unknown-decision"),
    `${formatDecisionHistoryLabel(entry)}${source}:`,
  ].join(" ");
  const details = [
    formatDecisionHistoryDetail(entry),
    formatDecisionHistoryRating(entry),
  ].filter((detail): detail is string => typeof detail === "string" && detail.length > 0);
  return details.length > 0 ? `${lead} ${details.join(", ")}` : lead.slice(0, -1);
}

function formatTestReportHistoryTimestamp(entry: Record<string, unknown>): string {
  return typeof entry.timestamp === "string" && entry.timestamp.length > 0
    ? entry.timestamp
    : "unknown-time";
}

function formatTestReportHistoryIteration(entry: Record<string, unknown>): string {
  return typeof entry.iteration === "number" ? `#${entry.iteration}` : "#?";
}

function formatTestReportHistoryField(entry: Record<string, unknown>, field: string, fallback: string): string {
  const value = entry[field];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function formatTestReportHistoryCounts(entry: Record<string, unknown>): string {
  const passed = typeof entry.tests_passed === "number" ? entry.tests_passed : 0;
  const run = typeof entry.tests_run === "number" ? entry.tests_run : 0;
  return `(${passed}/${run} passed)`;
}

function formatTestReportHistoryDetails(entry: Record<string, unknown>): string {
  const lead = [
    formatTestReportHistoryIteration(entry),
    "artifact",
    formatTestReportHistoryField(entry, "artifact_id", "unknown"),
    `${formatTestReportHistoryField(entry, "outcome", "unknown-outcome")}:`,
    formatTestReportHistoryField(entry, "summary", "no summary"),
    formatTestReportHistoryCounts(entry),
  ].join(" ");
  if (typeof entry.error_output === "string" && entry.error_output.length > 0) {
    return `${lead}, error: ${entry.error_output}`;
  }
  return lead;
}

function formatTokenUsageHistoryTimestamp(entry: Record<string, unknown>): string {
  return typeof entry.timestamp === "string" && entry.timestamp.length > 0
    ? entry.timestamp
    : "unknown-time";
}

function formatTokenUsageHistoryIteration(entry: Record<string, unknown>): string {
  return typeof entry.iteration === "number" ? `#${entry.iteration}` : "#?";
}

function formatTokenUsageHistoryField(entry: Record<string, unknown>, field: string, fallback: string): string {
  const value = entry[field];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function tokenUsageHistoryCount(entry: Record<string, unknown>, canonicalField: "input_tokens" | "output_tokens", legacyField: "input" | "output"): number {
  const canonical = entry[canonicalField];
  if (typeof canonical === "number" && Number.isFinite(canonical)) return canonical;
  const legacy = entry[legacyField];
  return typeof legacy === "number" && Number.isFinite(legacy) ? legacy : 0;
}

function formatTokenUsageHistoryDuration(entry: Record<string, unknown>): string | null {
  return typeof entry.duration_ms === "number" && Number.isFinite(entry.duration_ms)
    ? `${entry.duration_ms}ms`
    : null;
}

function formatTokenUsageHistoryDetails(entry: Record<string, unknown>): string {
  const input = tokenUsageHistoryCount(entry, "input_tokens", "input");
  const output = tokenUsageHistoryCount(entry, "output_tokens", "output");
  const details = [
    `${input} input`,
    `${output} output`,
    formatTokenUsageHistoryDuration(entry),
  ].filter((detail): detail is string => typeof detail === "string" && detail.length > 0);
  return [
    formatTokenUsageHistoryIteration(entry),
    formatTokenUsageHistoryField(entry, "agent", "unknown-agent"),
    `${formatTokenUsageHistoryField(entry, "model", "unknown-model")}:`,
    details.join(", "),
  ].join(" ");
}

function formatIterationHistoryTimestamp(entry: Record<string, unknown>): string {
  return typeof entry.timestamp === "string" && entry.timestamp.length > 0
    ? entry.timestamp
    : "unknown-time";
}

function formatIterationHistoryIteration(entry: Record<string, unknown>): string {
  return typeof entry.iteration === "number" ? `#${entry.iteration}` : "#?";
}

function formatIterationHistoryField(entry: Record<string, unknown>, field: string, fallback: string): string {
  const value = entry[field];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function formatIterationHistoryLead(entry: Record<string, unknown>): string {
  const parts = [
    formatIterationHistoryIteration(entry),
    formatIterationHistoryField(entry, "outcome", "unknown-outcome"),
  ];
  const domain = entry.domain;
  if (typeof domain === "string" && domain.length > 0) parts.push(domain);
  const label = typeof entry.title === "string" && entry.title.length > 0
    ? entry.title
    : typeof entry.artifact_id === "string" && entry.artifact_id.length > 0
      ? `artifact ${entry.artifact_id}`
      : "";
  if (label) parts.push(label);
  const source = entry.source === "human_redirect" ? " [human redirect]" : "";
  return `${parts.join(" ")}${source}`;
}

function formatIterationHistoryTokens(entry: Record<string, unknown>): string | null {
  const usage = entry.token_usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const input = (usage as Record<string, unknown>).input;
  const output = (usage as Record<string, unknown>).output;
  if (typeof input !== "number" || !Number.isFinite(input) || typeof output !== "number" || !Number.isFinite(output)) {
    return null;
  }
  return `tokens ${input} input/${output} output`;
}

function formatIterationHistoryRating(entry: Record<string, unknown>): string | null {
  const rating = entry.mean_rating;
  if (typeof rating === "string" && rating.length > 0) return `rating ${rating}`;
  if (typeof rating === "number" && Number.isFinite(rating)) return `rating ${rating.toFixed(1)}`;
  return null;
}

function formatIterationHistoryDuration(entry: Record<string, unknown>): string | null {
  return typeof entry.duration_ms === "number" && Number.isFinite(entry.duration_ms)
    ? `${entry.duration_ms}ms`
    : null;
}

function formatIterationHistoryDetails(entry: Record<string, unknown>): string {
  const details = [
    typeof entry.artifact_id === "string" && entry.artifact_id.length > 0 ? `artifact ${entry.artifact_id}` : null,
    formatIterationHistoryRating(entry),
    formatIterationHistoryTokens(entry),
    formatIterationHistoryDuration(entry),
    typeof entry.reason === "string" && entry.reason.length > 0 ? `reason: ${entry.reason}` : null,
  ].filter((detail): detail is string => typeof detail === "string" && detail.length > 0);
  const lead = formatIterationHistoryLead(entry);
  return details.length > 0 ? `${lead}, ${details.join(", ")}` : lead;
}

interface TimelineEntrySource {
  iteration?: number;
  timestamp?: string | null;
  outcome?: string | null;
  title?: string | null;
  domain?: string | null;
  source?: string | null;
  reason?: string | null;
  tokenUsage?: {
    input?: number;
    output?: number;
  };
  decisions?: {
    gate1?: number;
    gate2?: number;
  };
  tests?: {
    pass?: number;
    failFixable?: number;
    failCatastrophic?: number;
  };
  monitor?: {
    critical?: number;
    warning?: number;
    info?: number;
  };
}

function formatTimelineTimestamp(entry: TimelineEntrySource): string {
  return typeof entry.timestamp === "string" && entry.timestamp.length > 0
    ? entry.timestamp
    : "unknown-time";
}

function formatTimelineLead(entry: TimelineEntrySource): string {
  const parts = [
    typeof entry.iteration === "number" ? `#${entry.iteration}` : "#?",
    entry.outcome && entry.outcome.length > 0 ? entry.outcome : "unknown-outcome",
  ];
  if (entry.domain && entry.domain.length > 0) parts.push(entry.domain);
  if (entry.title && entry.title.length > 0) parts.push(entry.title);
  const source = entry.source === "human_redirect" ? " [human redirect]" : "";
  return `${parts.join(" ")}${source}`;
}

function formatTimelineDetails(entry: TimelineEntrySource): string {
  const tokenUsage = entry.tokenUsage ?? {};
  const decisions = entry.decisions ?? {};
  const tests = entry.tests ?? {};
  const monitor = entry.monitor ?? {};
  const details = [
    `decisions g1 ${decisions.gate1 ?? 0}/g2 ${decisions.gate2 ?? 0}`,
    `tests pass ${tests.pass ?? 0}/fixable ${tests.failFixable ?? 0}/catastrophic ${tests.failCatastrophic ?? 0}`,
    `monitor c${monitor.critical ?? 0}/w${monitor.warning ?? 0}/i${monitor.info ?? 0}`,
    `tokens ${tokenUsage.input ?? 0} input/${tokenUsage.output ?? 0} output`,
  ];
  if (entry.reason && entry.reason.length > 0) {
    details.push(`reason: ${entry.reason}`);
  }
  return `${formatTimelineLead(entry)}, ${details.join(", ")}`;
}

function formatHistoryFilters(...filters: Array<string | null | undefined>): string {
  return filters
    .filter((filter): filter is string => typeof filter === "string" && filter.length > 0)
    .join(" ");
}

function doctorReport(status: DoctorStatusSource, preflight: ConfigDoctorReport | null = null): {
  level: DoctorHealthLevel;
  running: boolean;
  iteration: number;
  savedAt: string | null;
  health: DoctorHealthStatus;
  logs: DoctorLogSource | null;
  monitor: DoctorMonitorSource | null;
  intervention: InterventionStatusSource | null;
  preflight?: ConfigDoctorReport;
} {
  const health = mergeDoctorHealth(doctorHealth(status), doctorPreflightHealth(preflight));
  return {
    level: health.level,
    running: status.running === true,
    iteration: typeof status.iteration === "number" ? status.iteration : 0,
    savedAt: status.savedAt ?? null,
    health,
    logs: status.furnace?.logs ?? null,
    monitor: status.furnace?.monitor ?? null,
    intervention: status.intervention ?? null,
    ...(preflight ? { preflight } : {}),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function summarizeConfigDoctorFiles(
  files: ConfigDoctorFileStatus[],
  ambiguousPromptSelectors = 0,
): ConfigDoctorSummary {
  const invalid = files.filter((file) => !file.ok).length;
  const configFiles = files.filter((file) => file.kind === "config");
  const promptFiles = files.filter((file) => file.kind === "prompt");
  return {
    total: files.length,
    ok: files.length - invalid,
    invalid,
    byKind: {
      config: configFiles.length,
      prompt: promptFiles.length,
    },
    invalidByKind: {
      config: configFiles.filter((file) => !file.ok).length,
      prompt: promptFiles.filter((file) => !file.ok).length,
    },
    ambiguousPromptSelectors,
  };
}

function promptContractListReport(contracts: readonly PromptContract[]): PromptContractListReport {
  const entries: PromptContractListEntry[] = contracts.map(promptContractListEntry);
  const ambiguousSelectors = findAmbiguousPromptSelectors(entries);
  return {
    summary: {
      total: entries.length,
      withSections: entries.filter((entry) => entry.sections.length > 0).length,
      ambiguousSelectors: ambiguousSelectors.length,
    },
    ambiguousSelectors,
    contracts: entries,
  };
}

function promptDoctorReport(
  report: PromptContractReport,
  contracts: readonly PromptContract[],
): PromptDoctorReport {
  const contractListReport = promptContractListReport(contracts);
  return {
    ...report,
    summary: {
      ...report.summary,
      ambiguousSelectors: contractListReport.summary.ambiguousSelectors,
    },
    ambiguousSelectors: contractListReport.ambiguousSelectors,
  };
}

function promptContractListEntry(contract: PromptContract): PromptContractListEntry {
  return {
    name: contract.name,
    relativePath: contract.relativePath,
    selectors: promptContractSelectors(contract),
    requiredPlaceholders: [...contract.requiredPlaceholders],
    optionalPlaceholders: [...(contract.optionalPlaceholders ?? [])],
    sections: (contract.sections ?? []).map((section) => ({
      name: section.name,
      marker: section.marker,
      position: section.position,
      requiredPlaceholders: [...section.requiredPlaceholders],
      optionalPlaceholders: [...(section.optionalPlaceholders ?? [])],
    })),
  };
}

function promptContractSelectors(contract: PromptContract): string[] {
  return Array.from(new Set([
    contract.name,
    contract.relativePath,
    path.basename(contract.relativePath),
    path.basename(contract.relativePath, path.extname(contract.relativePath)),
  ]));
}

function findAmbiguousPromptSelectors(
  entries: readonly PromptContractListEntry[],
): PromptContractAmbiguousSelector[] {
  const selectors = Array.from(new Set(entries.flatMap((entry) => entry.selectors)));
  const ambiguousSelectors: PromptContractAmbiguousSelector[] = [];
  for (const selector of selectors) {
    const exactMatches = entries.filter((entry) => (
      entry.name === selector || entry.relativePath === selector
    ));
    const matches = exactMatches.length > 0
      ? exactMatches
      : entries.filter((entry) => entry.selectors.includes(selector));
    if (matches.length > 1) {
      ambiguousSelectors.push({
        selector,
        matches: matches.map((match) => match.name),
      });
    }
  }
  return ambiguousSelectors;
}

function findPromptContracts(
  contracts: readonly PromptContract[],
  selector: string,
): PromptContract[] {
  const exactMatches = contracts.filter((contract) => (
    contract.name === selector || contract.relativePath === selector
  ));
  if (exactMatches.length > 0) return exactMatches;

  return contracts.filter((contract) => promptContractSelectors(contract).includes(selector));
}

function formatPromptPlaceholderList(placeholders: string[]): string {
  return placeholders.length > 0 ? placeholders.join(", ") : "none";
}

function printPromptContractDetails(contract: PromptContractListEntry): void {
  console.log(`Path: ${contract.relativePath}`);
  console.log(`Selectors: ${contract.selectors.join(", ")}`);
  console.log(`Required: ${formatPromptPlaceholderList(contract.requiredPlaceholders)}`);
  console.log(`Optional: ${formatPromptPlaceholderList(contract.optionalPlaceholders)}`);
  for (const section of contract.sections) {
    console.log(`Section ${section.name} ${section.position} "${section.marker}": ${formatPromptPlaceholderList(section.requiredPlaceholders)}`);
  }
}

function printPromptShowErrorJson(report: PromptContractShowErrorReport): void {
  console.log(JSON.stringify(report, null, 2));
}

async function configDoctorReport(): Promise<ConfigDoctorReport> {
  const { loadConfig, loadModelsConfig, loadDomainsConfig } = await import("./context/config.js");
  const { loadStimuliConfig } = await import("./stimuli/index.js");
  const { PROMPT_CONTRACTS, validatePromptContracts } = await import("./agents/prompt.js");
  const checks: Array<{ name: string; load: () => Promise<unknown> }> = [
    { name: "foundry.yml", load: loadConfig },
    { name: "models.yml", load: loadModelsConfig },
    { name: "domains.yml", load: loadDomainsConfig },
    { name: "stimuli.yml", load: loadStimuliConfig },
  ];
  const files: ConfigDoctorFileStatus[] = [];

  for (const check of checks) {
    try {
      await check.load();
      files.push({ name: check.name, kind: "config", ok: true });
    } catch (err) {
      files.push({ name: check.name, kind: "config", ok: false, error: errorMessage(err) });
    }
  }

  const promptReport = await validatePromptContracts();
  const promptListReport = promptContractListReport(PROMPT_CONTRACTS);
  for (const file of promptReport.files) {
    files.push({
      name: file.name,
      kind: "prompt",
      ok: file.ok,
      ...(file.ok ? {} : {
        error: file.errors?.join("; ") ?? "unknown prompt error",
        ...(file.errors ? { errors: file.errors } : {}),
        ...(file.diagnostics ? { diagnostics: file.diagnostics } : {}),
      }),
    });
  }

  const summary = summarizeConfigDoctorFiles(files, promptListReport.ambiguousSelectors.length);
  return {
    status: summary.invalid > 0 ? "invalid" : "healthy",
    summary,
    files,
    ambiguousPromptSelectors: promptListReport.ambiguousSelectors,
  };
}

/**
 * Parse --workdir <path> from argv. Returns the remaining args with --workdir stripped.
 */
export function parseWorkdir(argv: string[]): string[] {
  const args = argv.slice(2); // skip node + script
  const cleaned: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workdir" && i + 1 < args.length) {
      setRootDir(path.resolve(args[i + 1]));
      i++; // skip the value
    } else {
      cleaned.push(args[i]);
    }
  }
  return cleaned;
}

export async function initFoundry(name: string): Promise<void> {
  const { existsSync } = await import("node:fs");
  const { mkdir, cp, writeFile } = await import("node:fs/promises");
  const { execSync, execFileSync } = await import("node:child_process");

  const dest = path.resolve(name);

  // Fail if directory already exists with config/ — prevents overwriting
  if (existsSync(path.join(dest, "config"))) {
    console.error(`Error: ${dest}/config already exists. Refusing to overwrite an existing foundry directory.`);
    process.exit(1);
  }

  // Package root is one level up from dist/ (where this compiled file lives)
  const packageRoot = path.resolve(import.meta.dirname, "..");

  console.log(`Initializing Foundry portfolio: ${name}`);

  // ── Step 1: Create directory ──────────────────────────────
  await mkdir(dest, { recursive: true });

  // ── Step 2: git init ─────────────────────────────────────
  try {
    execFileSync("git", ["init"], { cwd: dest, stdio: "pipe" });
    console.log("  git init          ✓");
  } catch {
    console.warn("  git init          ✗ (git not available, continuing without)");
  }

  // ── Step 3: Copy from package root ───────────────────────
  await cp(path.join(packageRoot, "config"), path.join(dest, "config"), { recursive: true });
  await cp(path.join(packageRoot, "prompts"), path.join(dest, "prompts"), { recursive: true });
  await mkdir(path.join(dest, "identity"), { recursive: true });
  await cp(path.join(packageRoot, "identity", "manifesto.md"), path.join(dest, "identity", "manifesto.md"));

  // stimuli/ — pipeline config and skill files
  await mkdir(path.join(dest, "stimuli"), { recursive: true });
  const stimuliSkillsSrc = path.join(packageRoot, "stimuli", "skills");
  if (existsSync(stimuliSkillsSrc)) {
    await cp(stimuliSkillsSrc, path.join(dest, "stimuli", "skills"), { recursive: true });
  }
  const stimuliYmlSrc = path.join(packageRoot, "stimuli", "stimuli.yml");
  if (existsSync(stimuliYmlSrc)) {
    await cp(stimuliYmlSrc, path.join(dest, "stimuli", "stimuli.yml"));
  } else {
    /* v8 ignore next */
    console.warn("  stimuli.yml       ✗ (not found in package)");
  }

  // site/ — entire Astro project
  const siteSrc = path.join(packageRoot, "site");
  if (existsSync(siteSrc)) {
    const ignoredSiteRoots = new Set(["node_modules", "dist", ".astro"]);
    await cp(siteSrc, path.join(dest, "site"), {
      recursive: true,
      filter: (source) => {
        const relative = path.relative(siteSrc, source);
        if (!relative) return true;
        const parts = relative.split(path.sep);
        if (ignoredSiteRoots.has(parts[0])) return false;
        return !(parts[0] === "public" && parts[1] === "artifacts");
      },
    });
    console.log("  site/             ✓");
  } else {
    /* v8 ignore next */
    console.warn("  site/             ✗ (not found in package)");
  }

  // .github/ — CI and Pages workflows for generated portfolio repos
  const githubSrc = path.join(packageRoot, ".github");
  if (existsSync(githubSrc)) {
    await cp(githubSrc, path.join(dest, ".github"), { recursive: true });
    console.log("  .github/          ✓");
  } else {
    /* v8 ignore next */
    console.warn("  .github/          ✗ (not found in package)");
  }

  console.log("  config/           ✓");
  console.log("  prompts/          ✓");
  console.log("  identity/         ✓");
  if (existsSync(path.join(dest, "stimuli", "stimuli.yml"))) {
    console.log("  stimuli/          ✓");
  } else {
    /* v8 ignore next */
    console.warn("  stimuli/          ✗ (stimuli.yml missing)");
  }

  // ── Step 4: Create empty directories ─────────────────────
  const emptyDirs = [
    "portfolio",
    "portfolio/killed",
    "portfolio/projects",
    "logs",
    "workspace/current",
    "workspace/sandbox",
    "stimuli/live",
  ];
  for (const dir of emptyDirs) {
    await mkdir(path.join(dest, dir), { recursive: true });
  }
  console.log("  portfolio/        ✓");
  console.log("  workspace/        ✓");
  console.log("  logs/             ✓");

  // ── Step 5: Create seed files ────────────────────────────
  await writeFile(
    path.join(dest, "portfolio", "index.md"),
    `# Portfolio Index\n\n| ID | Title | Domain | Rating | Date | Project |\n|---|---|---|---|---|---|\n`,
    "utf-8",
  );
  await writeFile(
    path.join(dest, "portfolio", "projects", "index.md"),
    `# Projects Index\n\nNo active projects.\n`,
    "utf-8",
  );
  await writeFile(
    path.join(dest, "identity", "journal.md"),
    `# The Foundry — Journal\n\n*Chronological record of iterations, decisions, and reflections.*\n\n---\n`,
    "utf-8",
  );
  await writeFile(
    path.join(dest, "identity", "journal-compressed.md"),
    `# The Foundry — Compressed Journal\n\n*Curator-compressed summaries of iteration history.*\n\n---\n`,
    "utf-8",
  );

  // ── Step 6: Create .gitignore ────────────────────────────
  await writeFile(
    path.join(dest, ".gitignore"),
    `node_modules/\ndist/\n.astro/\nsite/dist/\nsite/node_modules/\nsite/public/artifacts/\nworkspace/\ncheckpoint.json\nSTOP\n*.tsbuildinfo\n.DS_Store\n.env\n.env.*\n`,
    "utf-8",
  );

  // ── Step 7: Create README.md ─────────────────────────────
  await writeFile(
    path.join(dest, "README.md"),
    `# ${name}\n\nA Foundry portfolio. Artifacts are produced autonomously and deployed to GitHub Pages.\n`,
    "utf-8",
  );

  // ── Step 8: npm install in site/ ─────────────────────────
  if (existsSync(path.join(dest, "site", "package.json"))) {
    try {
      console.log("\nInstalling site dependencies...");
      execSync("npm install", { cwd: path.join(dest, "site"), stdio: "inherit" });
      console.log("  npm install       ✓");
    } catch {
      console.warn("  npm install       ✗ (failed, run manually: cd site && npm install)");
    }
  }

  // ── Step 9: git add + commit ─────────────────────────────
  try {
    execFileSync("git", ["add", "-A"], { cwd: dest, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "Initialize Foundry portfolio"], { cwd: dest, stdio: "pipe" });
    console.log("  git commit        ✓");
  } catch {
    console.warn("  git commit        ✗ (failed or nothing to commit)");
  }

  // ── Step 10: Create GitHub repo ──────────────────────────
  let ghUser = "";
  try {
    ghUser = execFileSync("gh", ["api", "user", "--jq", ".login"], { stdio: "pipe" }).toString().trim();
  } catch {
    // gh not authenticated
  }

  try {
    execFileSync("gh", ["repo", "create", name, "--public", "--source", ".", "--push"], { cwd: dest, stdio: "pipe" });
    console.log("  GitHub repo       ✓");
  } catch {
    console.warn("  GitHub repo       ✗ (create manually: gh repo create)");
    if (ghUser) {
      console.log(`  Manual steps:`);
      console.log(`    gh repo create ${ghUser}/${name} --public --source ${JSON.stringify(dest)} --push`);
    }
  }

  // ── Step 11: Enable GitHub Pages ─────────────────────────
  if (ghUser) {
    try {
      execFileSync(
        "gh", ["api", `repos/${ghUser}/${name}/pages`, "-X", "POST", "-f", "build_type=workflow"],
        { cwd: dest, stdio: "pipe" },
      );
      let deployBranch = "";
      try {
        deployBranch = execFileSync("git", ["branch", "--show-current"], { cwd: dest, stdio: "pipe" })
          .toString()
          .trim();
      } catch {
        // If git cannot report a branch, Pages is still enabled; the workflow can be dispatched manually.
      }
      if (deployBranch && deployBranch !== "main") {
        try {
          execFileSync(
            "gh",
            [
              "api",
              `repos/${ghUser}/${name}/environments/github-pages/deployment-branch-policies`,
              "-X",
              "POST",
              "-f",
              `name=${deployBranch}`,
              "-f",
              "type=branch",
            ],
            { cwd: dest, stdio: "pipe" },
          );
        } catch {
          console.warn(`  GitHub Pages branch policy ✗ (allow ${deployBranch} manually if deployments are blocked)`);
        }
      }
      console.log("  GitHub Pages      ✓");
    } catch {
      console.warn("  GitHub Pages      ✗ (enable manually in repo Settings > Pages)");
    }
  }

  // ── Step 12: Success ─────────────────────────────────────
  console.log(`\n✨ Foundry portfolio initialized: ${dest}`);
  if (ghUser) {
    console.log(`  Repository:  https://github.com/${ghUser}/${name}`);
    console.log(`  Site:        https://${ghUser}.github.io/${name}/`);
  }
  console.log(`\nRun \`foundry start --workdir ${dest}\` to begin.`);
}

export async function run(): Promise<void> {
  const args = parseWorkdir(process.argv);
  const command = args[0];

  switch (command) {
    case "version":
    case "--version":
    case "-v": {
      const { readFileSync } = await import("node:fs");
      const pkg = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf-8"));
      console.log(`the-foundry v${pkg.version}`);
      break;
    }

    case "init": {
      const target = args[1];
      if (!target) {
        console.error("Usage: foundry init <name>");
        process.exit(1);
      }
      await initFoundry(target);
      break;
    }

    case "start": {
      const { startFoundry } = await import("./index.js");
      await startFoundry();
      break;
    }

    case "stop": {
      const jsonOutput = args.includes("--json");
      const reason = parseOptionText(args, "--reason");
      const { loadConfig } = await import("./context/config.js");
      const { stopFoundry } = await import("./index.js");
      const config = await loadConfig();
      const stopFile = config.intervention.stop_file;
      if (reason) {
        await stopFoundry(stopFile, { reason });
      } else {
        await stopFoundry(stopFile);
      }
      if (jsonOutput) {
        console.log(JSON.stringify({
          status: "stopping",
          file: stopFile,
          ...(reason ? { reason } : {}),
        }, null, 2));
        break;
      }
      console.log(`Stop file created at ${stopFile}. The Foundry will halt after the current iteration.`);
      break;
    }

    case "resume": {
      const jsonOutput = args.includes("--json");
      const { loadConfig } = await import("./context/config.js");
      const { resumeFoundry } = await import("./index.js");
      const config = await loadConfig();
      const stopFile = config.intervention.stop_file;
      await resumeFoundry(stopFile);
      if (jsonOutput) {
        console.log(JSON.stringify({
          status: "resumed",
          file: stopFile,
        }, null, 2));
        break;
      }
      console.log(`Stop file removed from ${stopFile}. The Foundry can resume on next start.`);
      break;
    }

    case "timeline": {
      const jsonOutput = args.includes("--json");
      const subcommand = args[1];
      if (subcommand && !subcommand.startsWith("--")) timelineCommandError();

      const outcome = parseTimelineOutcome(args);
      const source = parseTimelineSource(args);
      const domain = parseTimelineDomain(args);
      const iteration = parsePositiveIntegerOption(args, "--iteration", TIMELINE_USAGE);
      const limit = parsePositiveIntegerOption(args, "--limit", TIMELINE_USAGE);
      const { getTimeline } = await import("./index.js");
      const result = await getTimeline({ outcome, source, domain, iteration, limit });
      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      const filters = formatHistoryFilters(
        result.outcome,
        result.source,
        result.domain,
        typeof result.iteration === "number" ? `#${result.iteration}` : null,
      );
      if (result.entries.length === 0) {
        console.log(`Timeline: no iterations${filters ? ` for ${filters}` : ""}.`);
        break;
      }

      console.log(
        `Timeline: ${result.total} ${result.total === 1 ? "iteration" : "iterations"}${filters ? ` for ${filters}` : ""} ` +
        `(showing ${result.entries.length}, limit ${result.limit})`,
      );
      for (const entry of result.entries) {
        console.log(`  ${formatTimelineTimestamp(entry)} ${formatTimelineDetails(entry)}`);
      }
      break;
    }

    case "tokens": {
      const subcommand = args[1] ?? "history";
      const jsonOutput = args.includes("--json");
      if (subcommand !== "history") tokensCommandError();

      const agent = parseTokenUsageHistoryAgent(args);
      const model = parseTokenUsageHistoryModel(args);
      const iteration = parsePositiveIntegerOption(args, "--iteration", TOKENS_HISTORY_USAGE);
      const limit = parsePositiveIntegerOption(args, "--limit", TOKENS_HISTORY_USAGE);
      const { getTokenUsageHistory } = await import("./index.js");
      const result = await getTokenUsageHistory({ agent, model, iteration, limit });
      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      const filters = formatHistoryFilters(
        result.agent,
        result.model,
        typeof result.iteration === "number" ? `#${result.iteration}` : null,
      );
      if (result.entries.length === 0) {
        console.log(`Token usage history: no calls${filters ? ` for ${filters}` : ""}.`);
        break;
      }

      console.log(
        `Token usage history: ${result.total} ${result.total === 1 ? "call" : "calls"}${filters ? ` for ${filters}` : ""} ` +
        `(showing ${result.entries.length}, limit ${result.limit}, ${result.inputTokens} input, ${result.outputTokens} output)`,
      );
      for (const entry of result.entries) {
        console.log(`  ${formatTokenUsageHistoryTimestamp(entry)} ${formatTokenUsageHistoryDetails(entry)}`);
      }
      break;
    }

    case "iterations": {
      const subcommand = args[1] ?? "history";
      const jsonOutput = args.includes("--json");
      if (subcommand !== "history") iterationsCommandError();

      const outcome = parseIterationHistoryOutcome(args);
      const source = parseIterationHistorySource(args);
      const domain = parseIterationHistoryDomain(args);
      const limit = parsePositiveIntegerOption(args, "--limit", ITERATIONS_HISTORY_USAGE);
      const { getIterationHistory } = await import("./index.js");
      const result = await getIterationHistory({ outcome, source, domain, limit });
      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      const filters = formatHistoryFilters(result.outcome, result.source, result.domain);
      if (result.entries.length === 0) {
        console.log(`Iteration history: no iterations${filters ? ` for ${filters}` : ""}.`);
        break;
      }

      console.log(
        `Iteration history: ${result.total} ${result.total === 1 ? "iteration" : "iterations"}${filters ? ` for ${filters}` : ""} ` +
        `(showing ${result.entries.length}, limit ${result.limit}; ` +
        `shipped ${result.counts.shipped}, killed ${result.counts.killed}, skipped ${result.counts.skipped}, halted ${result.counts.halted})`,
      );
      for (const entry of result.entries) {
        console.log(`  ${formatIterationHistoryTimestamp(entry)} ${formatIterationHistoryDetails(entry)}`);
      }
      break;
    }

    case "decisions": {
      const subcommand = args[1] ?? "history";
      const jsonOutput = args.includes("--json");
      if (subcommand !== "history") decisionsCommandError();

      const gate = parseDecisionHistoryGate(args);
      const decision = parseDecisionHistoryDecision(args);
      const source = parseDecisionHistorySource(args);
      const iteration = parsePositiveIntegerOption(args, "--iteration", DECISIONS_HISTORY_USAGE);
      const limit = parsePositiveIntegerOption(args, "--limit", DECISIONS_HISTORY_USAGE);
      const { getDecisionHistory } = await import("./index.js");
      const result = await getDecisionHistory({ gate, decision, source, iteration, limit });
      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      const filters = formatHistoryFilters(
        result.gate,
        result.decision,
        result.source,
        typeof result.iteration === "number" ? `#${result.iteration}` : null,
      );
      if (result.entries.length === 0) {
        console.log(`Decision history: no decisions${filters ? ` for ${filters}` : ""}.`);
        break;
      }

      console.log(
        `Decision history: ${result.total} ${result.total === 1 ? "decision" : "decisions"}${filters ? ` for ${filters}` : ""} ` +
        `(showing ${result.entries.length}, limit ${result.limit})`,
      );
      for (const entry of result.entries) {
        console.log(`  ${formatDecisionHistoryTimestamp(entry)} ${formatDecisionHistoryDetails(entry)}`);
      }
      break;
    }

    case "tester": {
      const subcommand = args[1] ?? "history";
      const jsonOutput = args.includes("--json");
      if (subcommand !== "history") testerCommandError();

      const outcome = parseTestReportHistoryOutcome(args);
      const artifact = parseTestReportHistoryArtifact(args);
      const iteration = parsePositiveIntegerOption(args, "--iteration", TESTER_HISTORY_USAGE);
      const limit = parsePositiveIntegerOption(args, "--limit", TESTER_HISTORY_USAGE);
      const { getTestReportHistory } = await import("./index.js");
      const result = await getTestReportHistory({ outcome, artifact, iteration, limit });
      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      const filters = formatHistoryFilters(
        result.outcome,
        result.artifact,
        typeof result.iteration === "number" ? `#${result.iteration}` : null,
      );
      if (result.entries.length === 0) {
        console.log(`Tester history: no reports${filters ? ` for ${filters}` : ""}.`);
        break;
      }

      console.log(
        `Tester history: ${result.total} ${result.total === 1 ? "report" : "reports"}${filters ? ` for ${filters}` : ""} ` +
        `(showing ${result.entries.length}, limit ${result.limit})`,
      );
      for (const entry of result.entries) {
        console.log(`  ${formatTestReportHistoryTimestamp(entry)} ${formatTestReportHistoryDetails(entry)}`);
      }
      break;
    }

    case "monitor": {
      const subcommand = args[1] ?? "history";
      const jsonOutput = args.includes("--json");
      if (subcommand !== "history") monitorCommandError();

      const severity = parseMonitorHistorySeverity(args);
      const detector = parseMonitorHistoryDetector(args);
      const iteration = parsePositiveIntegerOption(args, "--iteration", MONITOR_HISTORY_USAGE);
      const limit = parsePositiveIntegerOption(args, "--limit", MONITOR_HISTORY_USAGE);
      const { getMonitorHistory } = await import("./index.js");
      const result = await getMonitorHistory({ severity, detector, iteration, limit });
      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      const filters = formatHistoryFilters(
        result.severity,
        result.detector,
        typeof result.iteration === "number" ? `#${result.iteration}` : null,
      );
      if (result.entries.length === 0) {
        console.log(`Monitor history: no warnings${filters ? ` for ${filters}` : ""}.`);
        break;
      }

      console.log(
        `Monitor history: ${result.total} ${result.total === 1 ? "warning" : "warnings"}${filters ? ` for ${filters}` : ""} ` +
        `(showing ${result.entries.length}, limit ${result.limit})`,
      );
      for (const entry of result.entries) {
        console.log(`  ${formatMonitorHistoryTimestamp(entry)} ${formatMonitorHistoryDetails(entry)}`);
      }
      break;
    }

    case "refinery": {
      const subcommand = args[1] ?? "history";
      const jsonOutput = args.includes("--json");
      if (subcommand !== "history") refineryCommandError();

      const resultFilter = parseRefineryHistoryResult(args);
      const sourceType = parseRefineryHistorySourceType(args);
      const iteration = parsePositiveIntegerOption(args, "--iteration", REFINERY_HISTORY_USAGE);
      const limit = parsePositiveIntegerOption(args, "--limit", REFINERY_HISTORY_USAGE);
      const { getRefineryHistory } = await import("./index.js");
      const result = await getRefineryHistory({ result: resultFilter, sourceType, iteration, limit });
      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      const filters = formatHistoryFilters(
        result.result,
        result.sourceType,
        typeof result.iteration === "number" ? `#${result.iteration}` : null,
      );
      if (result.entries.length === 0) {
        console.log(`Refinery history: no attempts${filters ? ` for ${filters}` : ""}.`);
        break;
      }

      console.log(
        `Refinery history: ${result.total} ${result.total === 1 ? "attempt" : "attempts"}${filters ? ` for ${filters}` : ""} ` +
        `(showing ${result.entries.length}, limit ${result.limit})`,
      );
      for (const entry of result.entries) {
        console.log(`  ${formatRefineryHistoryTimestamp(entry)} ${formatRefineryHistoryDetails(entry)}`);
      }
      break;
    }

    case "stoker": {
      const subcommand = args[1] ?? "history";
      const jsonOutput = args.includes("--json");
      if (subcommand !== "history") stokerCommandError();

      const urgency = parseStokerHistoryUrgency(args);
      const rule = parseStokerHistoryRule(args);
      const iteration = parsePositiveIntegerOption(args, "--iteration", STOKER_HISTORY_USAGE);
      const limit = parsePositiveIntegerOption(args, "--limit", STOKER_HISTORY_USAGE);
      const { getStokerHistory } = await import("./index.js");
      const result = await getStokerHistory({ urgency, rule, iteration, limit });
      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      const filters = formatHistoryFilters(
        result.urgency,
        result.rule,
        typeof result.iteration === "number" ? `#${result.iteration}` : null,
      );
      if (result.entries.length === 0) {
        console.log(`Stoker history: no directives${filters ? ` for ${filters}` : ""}.`);
        break;
      }

      console.log(
        `Stoker history: ${result.total} ${result.total === 1 ? "directive" : "directives"}${filters ? ` for ${filters}` : ""} ` +
        `(showing ${result.entries.length}, limit ${result.limit})`,
      );
      for (const entry of result.entries) {
        console.log(`  ${formatStokerHistoryTimestamp(entry)} ${formatStokerHistoryDetails(entry)}`);
      }
      break;
    }

    case "stimuli": {
      const subcommand = args[1] ?? "status";
      const jsonOutput = args.includes("--json");
      if (subcommand !== "status" && subcommand !== "history" && subcommand !== "refresh" && subcommand !== "reset") stimuliCommandError();
      if (subcommand === "status") {
        const failOn = parseStatusFailOn(args, STIMULI_STATUS_USAGE);
        const { getStimuliStatus } = await import("./index.js");
        const result = await getStimuliStatus();
        const shouldFail = failOn === "warning" && result.health.level === "warning";

        if (jsonOutput) {
          console.log(JSON.stringify(result, null, 2));
          if (shouldFail) {
            process.exit(1);
          }
          break;
        }

        const stimuli = result.stimuli;
        console.log(`Stimuli status: ${result.health.level}`);
        console.log(`  Iteration:  ${result.iteration}`);
        if (result.savedAt) console.log(`  Checkpoint: ${result.savedAt}`);
        console.log(`  Sources:    ${stimuli.sources} (${stimuli.healthy} healthy, ${stimuli.failing} failing, ${stimuli.disabled} disabled, ${stimuli.due} due)`);
        if (result.attention.length > 0) {
          console.log(`  Attention:`);
          for (const entry of result.attention) {
            const due = entry.due ? ", due" : "";
            console.log(
              `    ${entry.source}: ${entry.state}, ${entry.server}, last #${entry.lastRefreshIteration}, ` +
              `${formatStimuliIterationCount(entry.iterationsSinceRefresh)} ago, every ${entry.refreshInterval}, ` +
              `${formatStimuliFailureCount(entry.consecutiveFailures)}${due}`,
            );
          }
        }
        if (result.health.reasons.length > 0) {
          console.log(`  Reasons:`);
          for (const reason of result.health.reasons) {
            console.log(`    - ${reason}`);
          }
        }
        if (result.health.actions.length > 0) {
          console.log(`  Actions:`);
          for (const action of result.health.actions) {
            console.log(`    - ${action}`);
          }
        }
        if (shouldFail) {
          process.exit(1);
        }
        break;
      }

      if (subcommand === "history") {
        const source = getStimuliHistorySource(args);
        const action = parseStimuliAuditAction(args);
        const status = parseStimuliAuditStatus(args);
        const limit = parsePositiveIntegerOption(args, "--limit", STIMULI_HISTORY_USAGE);
        const { getStimuliAuditHistory } = await import("./index.js");
        const result = await getStimuliAuditHistory({ source, action, status, limit });
        if (jsonOutput) {
          console.log(JSON.stringify(result, null, 2));
          break;
        }

        const filters = [result.source, result.action, result.status]
          .filter((filter) => typeof filter === "string" && filter.length > 0)
          .join(" ");
        if (result.entries.length === 0) {
          console.log(`Stimuli history: no audit entries${filters ? ` for ${filters}` : ""}.`);
          break;
        }

        console.log(
          `Stimuli history: ${result.total} ${result.total === 1 ? "entry" : "entries"}${filters ? ` for ${filters}` : ""} ` +
          `(showing ${result.entries.length}, limit ${result.limit})`,
        );
        for (const entry of result.entries) {
          const timestamp = formatStimuliAuditField(entry, "timestamp", "unknown-time");
          const entrySource = formatStimuliAuditField(entry, "source", "unknown-source");
          const action = formatStimuliAuditField(entry, "action", "unknown-action");
          const status = formatStimuliAuditField(entry, "status", "unknown-status");
          console.log(
            `  ${timestamp} ${entrySource}: ${action} ${status}, ${formatStimuliAuditDetails(entry)}`,
          );
        }
        break;
      }

      if (subcommand === "refresh") {
        const source = args.slice(2).find((arg) => !arg.startsWith("--"));
        if (!source) stimuliCommandError(STIMULI_REFRESH_USAGE);

        const { refreshStimuliSource } = await import("./index.js");
        const result = await refreshStimuliSource(source);
        if (jsonOutput) {
          console.log(JSON.stringify(result, null, 2));
          break;
        }

        if (!result.checkpointUpdated || !result.previous || !result.current) {
          console.log(`Stimuli source ${result.source} refreshed (${result.contentLength} bytes). No checkpoint state was available to update.`);
          break;
        }

        console.log(
          `Stimuli source ${result.source} refreshed at iteration ${result.iteration}: ` +
          `last #${result.previous.last_refresh_iteration}, ${formatStimuliFailureCount(result.previous.consecutive_failures)}, ${formatStimuliEnabledState(result.previous.disabled)} -> ` +
          `last #${result.current.last_refresh_iteration}, ${formatStimuliFailureCount(result.current.consecutive_failures)}, ${formatStimuliEnabledState(result.current.disabled)} ` +
          `(${result.contentLength} bytes).`,
        );
        break;
      }

      const source = args.slice(2).find((arg) => !arg.startsWith("--"));
      if (!source) stimuliCommandError(STIMULI_RESET_USAGE);

      const { resetStimuliSourceState } = await import("./index.js");
      const result = await resetStimuliSourceState(source);
      if (jsonOutput) {
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      if (result.status === "no_checkpoint") {
        console.log(`No checkpoint found; no stimuli state reset for ${result.source}.`);
        break;
      }

      const previous = result.previous;
      const current = result.current;
      if (!previous || !current) {
        console.log(`No checkpointed stimuli state reset for ${result.source}.`);
        break;
      }

      console.log(
        `Stimuli source ${result.source} reset: ` +
        `last #${previous.last_refresh_iteration}, ${formatStimuliFailureCount(previous.consecutive_failures)}, ${formatStimuliEnabledState(previous.disabled)} -> ` +
        `last #${current.last_refresh_iteration}, ${formatStimuliFailureCount(current.consecutive_failures)}, ${formatStimuliEnabledState(current.disabled)}.`,
      );
      break;
    }

    case "request":
    case "requests": {
      const subcommand = args[1] ?? "show";
      const jsonOutput = args.includes("--json");
      if (subcommand !== "show" && subcommand !== "set" && subcommand !== "append" && subcommand !== "clear" && subcommand !== "history" && subcommand !== "stats" && subcommand !== "sources" && subcommand !== "restore" && subcommand !== "diff") {
        requestCommandError();
      }

      if (subcommand === "history") {
        const showRequest = args.includes("--show-request");
        const restorable = args.includes("--restorable") ? true : undefined;
        const action = parseRequestHistoryAction(args);
        const source = parseRequestHistorySource(args);
        const contains = parseRequestHistoryContains(args);
        const since = parseRequestHistoryTimestamp(args, "--since");
        const until = parseRequestHistoryTimestamp(args, "--until");
        const limit = parsePositiveIntegerOption(args, "--limit", REQUEST_HISTORY_USAGE);
        const { getRequestHistory } = await import("./index.js");
        const history = await getRequestHistory({ action, restorable, source, contains, since, until, limit });
        if (jsonOutput) {
          console.log(JSON.stringify(history, null, 2));
          break;
        }

        const filters = formatHistoryFilters(
          history.action,
          history.restorable === true ? "restorable" : null,
          history.source ? `source ${history.source}` : null,
          formatRequestContainsFilter(history.contains),
          history.since ? `since ${history.since}` : null,
          history.until ? `until ${history.until}` : null,
        );
        if (history.entries.length === 0) {
          console.log(`Request history: no events${filters ? ` for ${filters}` : ""}.`);
          break;
        }

        console.log(
          `Request history: ${history.total} ${history.total === 1 ? "event" : "events"}${filters ? ` for ${filters}` : ""} ` +
          `(showing ${history.entries.length}, limit ${history.limit})`,
        );
        for (const entry of history.entries) {
          const timestamp = formatRequestHistoryField(entry, "timestamp", "unknown-time");
          console.log(`  ${timestamp} ${formatRequestHistoryDetails(entry)}`);
          const requestText = showRequest ? requestHistoryText(entry) : null;
          if (requestText !== null) {
            console.log("    Request text:");
            for (const line of requestText.split("\n")) {
              console.log(`      ${line}`);
            }
          }
        }
        break;
      }

      if (subcommand === "stats") {
        const action = parseRequestHistoryAction(args, REQUEST_STATS_USAGE);
        const source = parseRequestHistorySource(args, REQUEST_STATS_USAGE);
        const contains = parseRequestHistoryContains(args, REQUEST_STATS_USAGE);
        const since = parseRequestHistoryTimestamp(args, "--since", REQUEST_STATS_USAGE);
        const until = parseRequestHistoryTimestamp(args, "--until", REQUEST_STATS_USAGE);
        const { getRequestStats } = await import("./index.js");
        const stats = await getRequestStats({ action, source, contains, since, until });
        if (jsonOutput) {
          console.log(JSON.stringify(stats, null, 2));
          break;
        }
        printRequestStatsText(stats);
        break;
      }

      if (subcommand === "sources") {
        const action = parseRequestHistoryAction(args, REQUEST_SOURCES_USAGE);
        const source = parseRequestHistorySource(args, REQUEST_SOURCES_USAGE);
        const contains = parseRequestHistoryContains(args, REQUEST_SOURCES_USAGE);
        const since = parseRequestHistoryTimestamp(args, "--since", REQUEST_SOURCES_USAGE);
        const until = parseRequestHistoryTimestamp(args, "--until", REQUEST_SOURCES_USAGE);
        const limit = parsePositiveIntegerOption(args, "--limit", REQUEST_SOURCES_USAGE);
        const { getRequestSources } = await import("./index.js");
        const sources = await getRequestSources({ action, source, contains, since, until, limit });
        if (jsonOutput) {
          console.log(JSON.stringify(sources, null, 2));
          break;
        }
        printRequestSourcesText(sources);
        break;
      }

      if (subcommand === "restore") {
        const restoreSelector = parseRequestRestoreSelector(args);
        const append = args.includes("--append");
        const dryRun = args.includes("--dry-run");
        const { getRequestRestore } = await import("./index.js");
        const { loadConfig } = await import("./context/config.js");
        const { readRequests, writeRequests } = await import("./files/intervention.js");
        const restore = await getRequestRestore(restoreSelector);
        const config = await loadConfig();
        const requestFile = config.intervention.requests_file;
        const mode = append ? "append" : "set";
        const previousRequest = append ? await readRequests(config) : "";
        const requestContent = append
          ? appendRequestContent(previousRequest, restore.requestText)
          : restore.requestText;
        const preview = requestPreview(requestContent);
        const response = {
          status: dryRun ? "dry-run" : "restored",
          mode,
          from: restore.from,
          file: requestFile,
          content: requestContent,
          restoredContent: restore.requestText,
          preview,
          sourceAction: restore.sourceAction,
          sourceRequestFile: restore.sourceRequestFile,
        };

        if (dryRun) {
          if (jsonOutput) {
            console.log(JSON.stringify(response, null, 2));
            break;
          }
          console.log(`Request restore dry run from ${restore.from}: would ${append ? "append to" : "write to"} ${requestFile}.`);
          console.log("Request content:");
          console.log(requestContent);
          break;
        }

        await writeRequests(config, requestContent);
        const { logRequest } = await import("./logging/index.js");
        const writtenContent = requestContent.trim();
        await logRequest({
          timestamp: new Date().toISOString(),
          action: mode,
          request_file: requestFile,
          request_text: writtenContent,
          preview,
          request_length: writtenContent.length,
          previous_request_length: previousRequest.length,
          restored_from_timestamp: restore.from,
          ...(restore.sourceAction ? { restored_from_action: restore.sourceAction } : {}),
          ...(restore.sourceRequestFile ? { restored_from_request_file: restore.sourceRequestFile } : {}),
        });
        if (jsonOutput) {
          console.log(JSON.stringify(response, null, 2));
          break;
        }
        console.log(`Request restored from ${restore.from} ${append ? "into" : "to"} ${requestFile}.`);
        break;
      }

      if (subcommand === "diff") {
        const diffSelector = parseRequestDiffSelector(args);
        const { getRequestDiff } = await import("./index.js");
        const { loadConfig } = await import("./context/config.js");
        const { readRequests } = await import("./files/intervention.js");
        const config = await loadConfig();
        const requestFile = config.intervention.requests_file;
        const currentText = await readRequests(config);
        const diff = await getRequestDiff({ ...diffSelector, currentText });
        const response = {
          ...diff,
          requestFile,
        };
        if (jsonOutput) {
          console.log(JSON.stringify(response, null, 2));
          break;
        }
        printRequestDiffText(diff, requestFile);
        break;
      }

      let requestContent = "";
      let requestSource: string | null = null;
      if (subcommand === "set" || subcommand === "append") {
        const contentArgs = args.slice(2);
        const hasFileSource = hasOption(contentArgs, "--file");
        requestSource = parseOptionValue(contentArgs, "--file");
        if (hasFileSource && !requestSource) requestCommandError();
        if (requestSource) {
          const { readFile } = await import("node:fs/promises");
          requestContent = await readFile(requestSource, "utf-8");
        } else {
          requestContent = contentArgs.filter((arg) => arg !== "--json").join(" ").trim();
        }
        if (!requestContent.trim()) requestCommandError();
      }

      const { loadConfig } = await import("./context/config.js");
      const { readRequests, writeRequests, clearRequests } = await import("./files/intervention.js");
      const config = await loadConfig();
      const requestFile = config.intervention.requests_file;

      if (subcommand === "show") {
        const content = await readRequests(config);
        const preview = requestPreview(content);
        const status = content ? "pending" : "empty";
        if (jsonOutput) {
          console.log(JSON.stringify({
            status,
            file: requestFile,
            content: content || null,
            preview: preview || null,
          }, null, 2));
          break;
        }
        console.log(`Request: ${status} (${requestFile})`);
        if (content) console.log(content);
        break;
      }

      if (subcommand === "set") {
        const previousContent = (await readRequests(config)) || "";
        await writeRequests(config, requestContent);
        const { logRequest } = await import("./logging/index.js");
        const writtenContent = requestContent.trim();
        const preview = requestPreview(requestContent);
        await logRequest({
          timestamp: new Date().toISOString(),
          action: "set",
          request_file: requestFile,
          ...(requestSource ? { source: requestSource } : {}),
          request_text: writtenContent,
          preview,
          request_length: writtenContent.length,
          previous_request_length: previousContent.length,
        });
        if (jsonOutput) {
          console.log(JSON.stringify({
            status: "written",
            file: requestFile,
            ...(requestSource ? { source: requestSource } : {}),
            content: requestContent,
            preview,
          }, null, 2));
          break;
        }
        console.log(`Request written to ${requestFile}.`);
        break;
      }

      if (subcommand === "append") {
        const currentContent = (await readRequests(config)) || "";
        const combinedContent = appendRequestContent(currentContent, requestContent);
        await writeRequests(config, combinedContent);
        const { logRequest } = await import("./logging/index.js");
        const preview = requestPreview(combinedContent);
        await logRequest({
          timestamp: new Date().toISOString(),
          action: "append",
          request_file: requestFile,
          ...(requestSource ? { source: requestSource } : {}),
          request_text: combinedContent,
          preview,
          request_length: combinedContent.length,
          previous_request_length: currentContent.length,
        });
        if (jsonOutput) {
          console.log(JSON.stringify({
            status: "appended",
            file: requestFile,
            ...(requestSource ? { source: requestSource } : {}),
            content: combinedContent,
            preview,
          }, null, 2));
          break;
        }
        console.log(`Request appended to ${requestFile}.`);
        break;
      }

      if (subcommand === "clear") {
        const previousContent = (await readRequests(config)) || "";
        await clearRequests(config);
        const { logRequest } = await import("./logging/index.js");
        await logRequest({
          timestamp: new Date().toISOString(),
          action: "clear",
          request_file: requestFile,
          previous_preview: requestPreview(previousContent) || null,
          previous_request_length: previousContent.length,
        });
        if (jsonOutput) {
          console.log(JSON.stringify({
            status: "cleared",
            file: requestFile,
          }, null, 2));
          break;
        }
        console.log(`Request cleared from ${requestFile}.`);
        break;
      }

      requestCommandError();
    }

    case "doctor": {
      const jsonOutput = args.includes("--json");
      const includePreflight = args.includes("--preflight") || args.includes("--include-preflight");
      const failOn = parseStatusFailOn(
        args,
        "Usage: foundry doctor [--json] [--preflight] [--fail-on warning|critical]",
        "critical",
      ) ?? "critical";
      const { getStatus } = await import("./index.js");
      const preflight = includePreflight ? await configDoctorReport() : null;
      const report = doctorReport(await getStatus(), preflight);
      const shouldFail = shouldFailDoctor(report.level, failOn);

      if (jsonOutput) {
        console.log(JSON.stringify(report, null, 2));
        if (shouldFail) {
          process.exit(1);
        }
        break;
      }

      printDoctorTextReport(report);
      if (shouldFail) {
        process.exit(1);
      }
      break;
    }

    case "forecast": {
      const jsonOutput = args.includes("--json");
      const { getForecast } = await import("./index.js");
      const forecast = await getForecast();
      if (jsonOutput) {
        console.log(JSON.stringify(forecast, null, 2));
        break;
      }

      printForecastText(forecast);
      break;
    }

    case "spark": {
      const subcommand = args[1];
      if (subcommand === "history") {
        const jsonOutput = args.includes("--json");
        const showRequest = args.includes("--show-request");
        const domain = parseSparkHistoryDomain(args);
        const mode = parseSparkHistoryMode(args);
        const replayable = args.includes("--replayable");
        const since = parseSparkHistoryTimestamp(args, "--since", SPARK_HISTORY_USAGE);
        const until = parseSparkHistoryTimestamp(args, "--until", SPARK_HISTORY_USAGE);
        const limit = parsePositiveIntegerOption(args, "--limit", SPARK_HISTORY_USAGE);
        const { getSparkHistory } = await import("./index.js");
        const result = await getSparkHistory({ domain, mode, replayable, since, until, limit });
        if (jsonOutput) {
          console.log(JSON.stringify(result, null, 2));
          break;
        }

        const filters = formatHistoryFilters(
          result.domain,
          result.mode,
          result.replayable === true ? "replayable" : null,
          result.since ? `since ${result.since}` : null,
          result.until ? `until ${result.until}` : null,
        );
        if (result.entries.length === 0) {
          console.log(`Spark history: no applications${filters ? ` for ${filters}` : ""}.`);
          break;
        }

        console.log(
          `Spark history: ${result.total} ${result.total === 1 ? "application" : "applications"}${filters ? ` for ${filters}` : ""} ` +
          `(showing ${result.entries.length}, limit ${result.limit})`,
        );
        for (const entry of result.entries) {
          const timestamp = formatSparkHistoryField(entry, "timestamp", "unknown-time");
          console.log(`  ${timestamp} ${formatSparkHistoryDetails(entry)}`);
          const requestText = showRequest ? replayableSparkRequestText(entry) : null;
          if (requestText !== null) {
            console.log("    Request text:");
            for (const line of requestText.split("\n")) {
              console.log(`      ${line}`);
            }
          }
        }
        break;
      }
      if (subcommand === "stats") {
        const jsonOutput = args.includes("--json");
        const domain = parseSparkHistoryDomain(args, SPARK_STATS_USAGE);
        const mode = parseSparkHistoryMode(args, SPARK_STATS_USAGE);
        const replayable = args.includes("--replayable");
        const since = parseSparkHistoryTimestamp(args, "--since", SPARK_STATS_USAGE);
        const until = parseSparkHistoryTimestamp(args, "--until", SPARK_STATS_USAGE);
        const { getSparkStats } = await import("./index.js");
        const stats = await getSparkStats({ domain, mode, replayable, since, until });
        if (jsonOutput) {
          console.log(JSON.stringify(stats, null, 2));
          break;
        }
        printSparkStatsText(stats);
        break;
      }
      if (subcommand === "replay") {
        const jsonOutput = args.includes("--json");
        const append = args.includes("--append");
        const dryRun = args.includes("--dry-run");
        const domain = parseSparkHistoryDomain(args);
        const mode = parseSparkHistoryMode(args);
        const fromTimestamp = parseSparkReplayTimestamp(args);
        const { getSparkHistory } = await import("./index.js");
        const historyLimit = fromTimestamp ? Number.MAX_SAFE_INTEGER : SPARK_REPLAY_HISTORY_LIMIT;
        const history = await getSparkHistory({ domain, mode, limit: historyLimit });
        const source = findReplayableSparkEntry(history.entries, fromTimestamp);
        const requestText = source ? replayableSparkRequestText(source) : null;
        if (!source || requestText === null) {
          sparkReplayError(fromTimestamp
            ? `No replayable spark history entry found for timestamp ${fromTimestamp}. Use foundry spark history --replayable --show-request to inspect available entries.`
            : "No replayable spark history entries found. Apply a new spark first so request text is present in logs/spark.jsonl.");
        }

        const { loadConfig } = await import("./context/config.js");
        const { readRequests, writeRequests } = await import("./files/intervention.js");
        const config = await loadConfig();
        const requestFile = config.intervention.requests_file;
        const requestMode = append ? "append" : "set";
        const previousRequest = append ? await readRequests(config) : "";
        const requestContent = append
          ? appendRequestContent(previousRequest, requestText)
          : requestText;
        const sourceTimestamp = formatSparkHistoryField(source, "timestamp", "unknown-time");

        if (dryRun) {
          if (jsonOutput) {
            console.log(JSON.stringify({
              replayed: false,
              dryRun: true,
              requestFile,
              requestMode,
              requestContent,
              source,
            }, null, 2));
            break;
          }

          console.log(`Spark replay dry run from ${sourceTimestamp}: would ${append ? "append to" : "write to"} ${requestFile}.`);
          console.log("Request content:");
          console.log(requestContent);
          break;
        }

        const { logSpark } = await import("./logging/index.js");
        await writeRequests(config, requestContent);
        await logSpark({
          timestamp: new Date().toISOString(),
          replayed: true,
          replayed_from_timestamp: formatSparkHistoryField(source, "timestamp", "unknown-time"),
          mode: requestMode,
          original_mode: formatSparkHistoryField(source, "mode", "unknown-mode"),
          domain: formatSparkHistoryField(source, "domain", "unknown-domain"),
          title: formatSparkHistoryField(source, "title", "Untitled spark"),
          next_iteration: typeof source.next_iteration === "number" ? source.next_iteration : undefined,
          request_file: requestFile,
          request_text: requestText,
          request_length: requestContent.length,
          previous_request_length: previousRequest.length,
        });

        if (jsonOutput) {
          console.log(JSON.stringify({
            replayed: true,
            requestFile,
            requestMode,
            requestContent,
            source,
          }, null, 2));
          break;
        }

        console.log(`Spark request replayed from ${sourceTimestamp} and ${append ? "appended to" : "written to"} ${requestFile}.`);
        break;
      }
      if (subcommand && !subcommand.startsWith("--")) sparkCommandError();

      const jsonOutput = args.includes("--json");
      const append = args.includes("--append");
      const apply = args.includes("--apply") || append;
      const domain = parseSparkDomain(args);
      const count = parseSparkCount(args);
      if (apply && count > 1) sparkCommandError();

      if (count > 1) {
        const { getSparkDeck } = await import("./index.js");
        const deck = await getSparkDeck({ domain, count });
        if (jsonOutput) {
          console.log(JSON.stringify(deck, null, 2));
          break;
        }
        printSparkDeckText(deck);
        break;
      }

      const { getSpark } = await import("./index.js");
      const spark = await getSpark({ domain });

      if (apply) {
        const { loadConfig } = await import("./context/config.js");
        const { readRequests, writeRequests } = await import("./files/intervention.js");
        const { logSpark } = await import("./logging/index.js");
        const config = await loadConfig();
        const requestFile = config.intervention.requests_file;
        const requestMode = append ? "append" : "set";
        const previousRequest = append ? await readRequests(config) : "";
        const requestContent = append
          ? appendRequestContent(previousRequest, spark.requestText)
          : spark.requestText;
        await writeRequests(config, requestContent);
        await logSpark({
          timestamp: new Date().toISOString(),
          mode: requestMode,
          domain: spark.domain,
          title: spark.title,
          next_iteration: spark.nextIteration,
          request_file: requestFile,
          request_text: spark.requestText,
          request_length: requestContent.length,
          previous_request_length: previousRequest.length,
        });

        if (jsonOutput) {
          console.log(JSON.stringify({
            ...spark,
            applied: true,
            requestFile,
            requestMode,
            requestContent,
          }, null, 2));
          break;
        }

        printSparkText(spark);
        console.log(`Spark request ${append ? "appended to" : "written to"} ${requestFile}.`);
        break;
      }

      if (jsonOutput) {
        console.log(JSON.stringify(spark, null, 2));
        break;
      }

      printSparkText(spark);
      break;
    }

    case "preflight": {
      const jsonOutput = args.includes("--json");
      const failOn = parseStatusFailOn(
        args,
        "Usage: foundry preflight [--json] [--fail-on warning|critical]",
        "warning",
      ) ?? "warning";
      const { getStatus } = await import("./index.js");
      const report = doctorReport(await getStatus(), await configDoctorReport());
      const shouldFail = shouldFailDoctor(report.level, failOn);

      if (jsonOutput) {
        console.log(JSON.stringify(report, null, 2));
        if (shouldFail) {
          process.exit(1);
        }
        break;
      }

      printDoctorTextReport(report, "preflight");
      if (shouldFail) {
        process.exit(1);
      }
      break;
    }

    case "status": {
      const jsonOutput = args.includes("--json");
      const failOn = parseStatusFailOn(args);
      const { getStatus } = await import("./index.js");
      const s = await getStatus();
      const shouldFail = shouldFailStatus(s, failOn);
      if (jsonOutput) {
        console.log(JSON.stringify(s, null, 2));
        if (shouldFail) {
          process.exit(1);
        }
        break;
      }

      console.log(`The Foundry — ${s.running ? "running" : "stopped"}`);
      console.log(`  Iteration:  ${s.iteration}`);
      console.log(`  Shipped:    ${s.shipped}`);
      console.log(`  Killed:     ${s.killed}`);
      console.log(`  Skipped:    ${s.skipped}`);
      if (s.lastArtifact) console.log(`  Last ship:  ${s.lastArtifact}`);
      if (s.savedAt) console.log(`  Checkpoint: ${s.savedAt}`);
      if (s.critic?.artifactRejection && s.critic.artifactRejection.samples > 0) {
        const critic = s.critic.artifactRejection;
        const percent = Math.round(critic.rejectionRate * 100);
        console.log(`  Critic:     ${percent}% rejected (${critic.killed} killed / ${critic.shipped} shipped, ${critic.pressure})`);
      }
      if (s.intervention) {
        console.log(`\n  Intervention:`);
        printInterventionStatus(s.intervention, "    ");
      }
      if (s.furnace) {
        console.log(`\n  Furnace:`);
        if (s.furnace.stoker) {
          const refinery = s.furnace.stoker.refineryQueue > 0
            ? `, refinery ${s.furnace.stoker.refineryQueue}`
            : "";
          console.log(`    Stoker:     ${s.furnace.stoker.urgency} for #${s.furnace.stoker.forIteration}${refinery}`);
        }
        if (s.furnace.stokerCadence) {
          if (s.furnace.stokerCadence.enabled && s.furnace.stokerCadence.nextRunIteration !== null) {
            const count = s.furnace.stokerCadence.iterationsUntilRun ?? 0;
            const noun = count === 1 ? "iteration" : "iterations";
            console.log(`    Next stoke: #${s.furnace.stokerCadence.nextRunIteration} (${count} ${noun})`);
          } else {
            console.log(`    Next stoke: disabled`);
          }
        }
        if (s.furnace.stokerHeat) {
          const state = s.furnace.stokerHeat.pressure ?? (s.furnace.stokerHeat.hot ? "hot" : "cool");
          const sampleNoun = s.furnace.stokerHeat.samples === 1 ? "sample" : "samples";
          const percent = typeof s.furnace.stokerHeat.thresholdPercent === "number"
            ? `, ${s.furnace.stokerHeat.thresholdPercent}%`
            : "";
          const peak = typeof s.furnace.stokerHeat.peakTokens === "number"
            ? `, peak ${Math.round(s.furnace.stokerHeat.peakTokens)}`
            : "";
          console.log(`    Token heat: ${Math.round(s.furnace.stokerHeat.averageTokens)} avg / ${s.furnace.stokerHeat.threshold} threshold (${s.furnace.stokerHeat.samples} ${sampleNoun}, ${state}${percent}${peak})`);
        }
        if (s.furnace.complexity) {
          const avoid = s.furnace.complexity.avoid.length > 0
            ? `, avoid ${s.furnace.complexity.avoid.join(", ")}`
            : "";
          console.log(`    Complexity: favor ${s.furnace.complexity.favor} (${s.furnace.complexity.confidence})${avoid}`);
        }
        if (s.furnace.streak) {
          if (s.furnace.streak.active && s.furnace.streak.domain && s.furnace.streak.length) {
            console.log(`    Streak:     ${s.furnace.streak.domain} x${s.furnace.streak.length} (${s.furnace.streak.avgRating?.toFixed(1) ?? "N/A"})`);
          } else if (s.furnace.streak.cooldownDomains.length > 0) {
            console.log(`    Streak:     cooldown ${s.furnace.streak.cooldownDomains.join(", ")} (${s.furnace.streak.cooldownRemaining} left)`);
          }
        }
        if (s.furnace.speculative && s.furnace.speculative.count > 0) {
          const noun = s.furnace.speculative.count === 1 ? "idea" : "ideas";
          console.log(`    Speculative:${s.furnace.speculative.count.toString().padStart(4)} warmed ${noun}`);
        }
        if (s.furnace.speculative && s.furnace.speculative.staleCount > 0) {
          console.log(`    Speculative:${s.furnace.speculative.staleCount.toString().padStart(4)} stale ignored`);
        }
        if (s.furnace.refinery.lastIteration !== null) {
          const eligibility = s.furnace.refinery.enabled && s.furnace.refinery.nextEligibleIteration !== null
            ? `, eligible #${s.furnace.refinery.nextEligibleIteration} (${s.furnace.refinery.iterationsUntilEligible} ${s.furnace.refinery.iterationsUntilEligible === 1 ? "iteration" : "iterations"})`
            : "";
          console.log(`    Refinery:   last run #${s.furnace.refinery.lastIteration}${eligibility}`);
        } else if (s.furnace.refinery.enabled && s.furnace.refinery.nextEligibleIteration !== null) {
          console.log(`    Refinery:   eligible now`);
        } else {
          console.log(`    Refinery:   disabled`);
        }
        if (s.furnace.refineryFuel) {
          const fuel = s.furnace.refineryFuel;
          const next = fuel.topTargets[0] ? `, next ${fuel.topTargets[0].title}` : "";
          console.log(`    Refinery fuel: ${fuel.available} available (dream ${fuel.byType.dream}, companion ${fuel.byType.companion}, low ${fuel.byType.lowRated}), queue ${fuel.queueLimit}${next}`);
        }
        if (s.furnace.refineryReadiness) {
          const ready = s.furnace.refineryReadiness.canQueue ? "ready" : s.furnace.refineryReadiness.state;
          console.log(`    Refinery ready: ${ready} — ${s.furnace.refineryReadiness.reason}`);
        }
        if (s.furnace.stimuli && s.furnace.stimuli.sources > 0) {
          const stimuli = s.furnace.stimuli;
          console.log(`    Stimuli:    ${stimuli.sources} sources (${stimuli.healthy} healthy, ${stimuli.failing} failing, ${stimuli.disabled} disabled, ${stimuli.due} due)`);
          const attention = stimuli.entries
            .filter((entry) => entry.disabled || entry.consecutiveFailures > 0 || entry.due)
            .slice(0, 3);
          for (const entry of attention) {
            const failureText = entry.consecutiveFailures === 1
              ? "1 failure"
              : `${entry.consecutiveFailures} failures`;
            console.log(`      ${entry.source} ${entry.state} (${failureText}, last #${entry.lastRefreshIteration}, every ${entry.refreshInterval})`);
          }
        }
        if (s.furnace.health) {
          const reasons = s.furnace.health.reasons.length > 0
            ? ` — ${s.furnace.health.reasons.join("; ")}`
            : "";
          console.log(`    Health:     ${s.furnace.health.level}${reasons}`);
        }
        if (s.furnace.monitor) {
          const monitor = formatMonitorSummary(s.furnace.monitor);
          if (monitor) console.log(`    Monitor:    ${monitor}`);
        }
        if (s.furnace.logs) {
          const health = s.furnace.logs.healthState ?? "healthy";
          const archiveBytes = s.furnace.logs.totalArchiveBytes ?? 0;
          const totalBytes = s.furnace.logs.totalLogBytes ?? s.furnace.logs.totalActiveBytes + archiveBytes;
          const malformedTargets = s.furnace.logs.malformedActiveFileDetails?.length
            ? s.furnace.logs.malformedActiveFileDetails
              .map((detail) => `${detail.name} (first line ${detail.firstMalformedLine})`)
              .join(", ")
            : s.furnace.logs.malformedActiveFiles.join(", ");
          const malformed = s.furnace.logs.malformedActiveLines > 0
            ? `, ${s.furnace.logs.malformedActiveLines} malformed in ${malformedTargets}`
            : ", 0 malformed";
          const largest = s.furnace.logs.largestActive
            ? `, largest ${s.furnace.logs.largestActive.name} ${s.furnace.logs.largestActive.bytes} bytes (${s.furnace.logs.largestActivePercent}% of rotation limit, ${s.furnace.logs.rotationPressure})`
            : "";
          const archiveLargest = s.furnace.logs.largestArchive
            ? `, largest archive ${s.furnace.logs.largestArchive.name} ${s.furnace.logs.largestArchive.bytes} bytes`
            : "";
          console.log(`    Logs:       ${health}, ${s.furnace.logs.activeFiles} active, ${s.furnace.logs.archiveCount} archives, ${s.furnace.logs.totalActiveBytes} active bytes, ${archiveBytes} archived bytes, ${totalBytes} total bytes${largest}${archiveLargest}${malformed}`);
        }
      }
      if (s.recentOutcomes.length > 0) {
        console.log(`\n  Recent:`);
        for (const o of s.recentOutcomes.slice(-5)) {
          const source = o.source === "human_redirect" ? " [human redirect]" : "";
          console.log(`    #${o.iteration} ${o.outcome}${o.domain ? " (" + o.domain + ")" : ""}${source}`);
        }
      }
      if (shouldFail) {
        process.exit(1);
      }
      break;
    }

    case "logs": {
      const subcommand = args[1];
      if (subcommand !== "doctor") {
        console.error("Usage: foundry logs doctor [--json] [--fail-on healthy|watch|rotate-soon|malformed]");
        process.exit(1);
      }
      const jsonOutput = args.includes("--json");
      const failOn = parseLogDoctorFailOn(args);

      const { readJsonlLogHealth } = await import("./logging/index.js");
      const health = await readJsonlLogHealth();
      const healthRank = LOG_DOCTOR_FAIL_STATES.indexOf(health.healthState);
      const failRank = LOG_DOCTOR_FAIL_STATES.indexOf(failOn);
      const shouldFail = healthRank >= failRank;

      if (jsonOutput) {
        console.log(JSON.stringify(health, null, 2));
        if (shouldFail) {
          process.exit(1);
        }
        break;
      }

      const largest = health.largestActive
        ? `${health.largestActive.name} ${health.largestActive.bytes} bytes (${health.largestActivePercent}% of rotation limit)`
        : "none";
      const largestArchive = health.largestArchive
        ? `${health.largestArchive.name} ${health.largestArchive.bytes} bytes`
        : "none";

      console.log(`Log doctor: ${health.healthState}`);
      console.log(`  Files:      ${health.activeFiles} active, ${health.archiveCount} archives`);
      console.log(`  Size:       ${health.totalActiveBytes} active bytes, ${health.totalArchiveBytes} archived bytes, ${health.totalLogBytes} total bytes`);
      console.log(`  Rotation:   ${health.rotationPressure}, largest active ${largest}, largest archive ${largestArchive}`);
      if (health.recommendedActions.length > 0) {
        console.log(`  Actions:`);
        for (const action of health.recommendedActions) {
          console.log(`    - ${action}`);
        }
      }

      if (health.malformedActiveLines > 0) {
        console.log(`  Malformed:  ${health.malformedActiveLines} malformed active lines`);
        for (const detail of health.malformedActiveFileDetails) {
          console.log(`    ${detail.name}: ${detail.malformedLines} malformed, first line ${detail.firstMalformedLine}`);
        }
        process.exit(1);
      }

      console.log("  Malformed:  0 malformed");
      if (shouldFail) {
        process.exit(1);
      }
      break;
    }

    case "config": {
      const subcommand = args[1];
      if (subcommand !== "doctor") {
        console.error("Usage: foundry config doctor [--json] [--fail-on-ambiguous]");
        process.exit(1);
      }
      const jsonOutput = args.includes("--json");
      const failOnAmbiguous = args.includes("--fail-on-ambiguous");
      const report = await configDoctorReport();
      const shouldFail = report.status === "invalid"
        || (failOnAmbiguous && report.ambiguousPromptSelectors.length > 0);

      if (jsonOutput) {
        console.log(JSON.stringify(report, null, 2));
        if (shouldFail) {
          process.exit(1);
        }
        break;
      }

      console.log(`Config doctor: ${report.status}`);
      console.log(`Files: ${report.summary.total} total, ${report.summary.ok} ok, ${report.summary.invalid} invalid (${report.summary.byKind.config} config, ${report.summary.byKind.prompt} prompt; ${report.summary.invalidByKind.config} invalid config, ${report.summary.invalidByKind.prompt} invalid prompt)`);
      for (const file of report.files) {
        console.log(`  ${file.name}: ${file.ok ? "ok" : `invalid - ${file.error ?? "unknown error"}`}`);
      }
      if (report.ambiguousPromptSelectors.length > 0) {
        console.log(`Ambiguous prompt selectors:`);
        for (const ambiguous of report.ambiguousPromptSelectors) {
          console.log(`  ${ambiguous.selector}: ${ambiguous.matches.join(", ")}`);
        }
      }
      if (shouldFail) {
        process.exit(1);
      }
      break;
    }

    case "prompts": {
      const subcommand = args[1];
      if (subcommand !== "doctor" && subcommand !== "list" && subcommand !== "show") {
        console.error("Usage: foundry prompts doctor|list|show [template] [--json]");
        process.exit(1);
      }
      const jsonOutput = args.includes("--json");
      if (subcommand === "list" || subcommand === "show") {
        const { PROMPT_CONTRACTS } = await import("./agents/prompt.js");
        if (subcommand === "show") {
          const selector = args.slice(2).find((arg) => !arg.startsWith("--"));
          if (!selector) {
            if (jsonOutput) {
              printPromptShowErrorJson({
                status: "error",
                error: {
                  code: "missing_prompt_template",
                  message: "Missing prompt template selector",
                  selector: null,
                  matches: [],
                },
              });
              process.exit(1);
            }
            console.error("Usage: foundry prompts show <template> [--json]");
            process.exit(1);
          }
          const matches = findPromptContracts(PROMPT_CONTRACTS, selector);
          if (matches.length === 0) {
            if (jsonOutput) {
              printPromptShowErrorJson({
                status: "error",
                error: {
                  code: "unknown_prompt_template",
                  message: `Unknown prompt template: ${selector}`,
                  selector,
                  matches: [],
                },
              });
              process.exit(1);
            }
            console.error(`Unknown prompt template: ${selector}`);
            process.exit(1);
          }
          if (matches.length > 1) {
            const matchNames = matches.map((match) => match.name);
            if (jsonOutput) {
              printPromptShowErrorJson({
                status: "error",
                error: {
                  code: "ambiguous_prompt_template",
                  message: `Ambiguous prompt template: ${selector}`,
                  selector,
                  matches: matchNames,
                },
              });
              process.exit(1);
            }
            console.error(`Ambiguous prompt template: ${selector}`);
            console.error(`Matches: ${matchNames.join(", ")}`);
            console.error("Use a full contract name or relative path.");
            process.exit(1);
          }
          const contract = matches[0];
          const { validatePromptContracts } = await import("./agents/prompt.js");
          const validationReport = await validatePromptContracts([contract]);
          const file = validationReport.files[0];
          const report: PromptContractShowReport = {
            status: validationReport.status,
            contract: promptContractListEntry(contract),
            file,
          };

          if (jsonOutput) {
            console.log(JSON.stringify(report, null, 2));
            if (!report.file.ok) {
              process.exit(1);
            }
            break;
          }

          console.log(`Prompt contract: ${report.contract.name}`);
          console.log(`Status: ${report.status}`);
          printPromptContractDetails(report.contract);
          console.log(`File: ${report.file.path}`);
          if (!report.file.ok) {
            console.log(`Errors: ${report.file.errors?.join("; ") ?? "unknown prompt error"}`);
            process.exit(1);
          }
          break;
        }

        const report = promptContractListReport(PROMPT_CONTRACTS);
        const failOnAmbiguous = args.includes("--fail-on-ambiguous");
        const shouldFail = failOnAmbiguous && report.ambiguousSelectors.length > 0;

        if (jsonOutput) {
          console.log(JSON.stringify(report, null, 2));
          if (shouldFail) {
            process.exit(1);
          }
          break;
        }

        console.log(`Prompt contracts: ${report.summary.total}`);
        if (report.ambiguousSelectors.length > 0) {
          console.log(`Ambiguous selectors:`);
          for (const ambiguous of report.ambiguousSelectors) {
            console.log(`  ${ambiguous.selector}: ${ambiguous.matches.join(", ")}`);
          }
        }
        for (const contract of report.contracts) {
          console.log(`  ${contract.name}`);
          console.log(`    path: ${contract.relativePath}`);
          console.log(`    selectors: ${contract.selectors.join(", ")}`);
          console.log(`    required: ${formatPromptPlaceholderList(contract.requiredPlaceholders)}`);
          console.log(`    optional: ${formatPromptPlaceholderList(contract.optionalPlaceholders)}`);
          for (const section of contract.sections) {
            console.log(`    section ${section.name} ${section.position} "${section.marker}": ${formatPromptPlaceholderList(section.requiredPlaceholders)}`);
          }
        }
        if (shouldFail) {
          process.exit(1);
        }
        break;
      }

      const { PROMPT_CONTRACTS, validatePromptContracts } = await import("./agents/prompt.js");
      const report = promptDoctorReport(await validatePromptContracts(), PROMPT_CONTRACTS);
      const failOnAmbiguous = args.includes("--fail-on-ambiguous");
      const shouldFail = report.status === "invalid"
        || (failOnAmbiguous && report.ambiguousSelectors.length > 0);

      if (jsonOutput) {
        console.log(JSON.stringify(report, null, 2));
        if (shouldFail) {
          process.exit(1);
        }
        break;
      }

      console.log(`Prompt doctor: ${report.status}`);
      console.log(`Files: ${report.summary.total} total, ${report.summary.ok} ok, ${report.summary.invalid} invalid`);
      for (const file of report.files) {
        console.log(`  ${file.name}: ${file.ok ? "ok" : `invalid - ${file.errors?.join("; ") ?? "unknown prompt error"}`}`);
      }
      if (report.ambiguousSelectors.length > 0) {
        console.log(`Ambiguous selectors:`);
        for (const ambiguous of report.ambiguousSelectors) {
          console.log(`  ${ambiguous.selector}: ${ambiguous.matches.join(", ")}`);
        }
      }
      if (shouldFail) {
        process.exit(1);
      }
      break;
    }

    case "upgrade": {
      const { upgradeProject } = await import("./upgrade.js");
      await upgradeProject();
      break;
    }

    case "dashboard": {
      // Dashboard server lives in the package, not the workdir
      const serverPath = path.join(import.meta.dirname, "..", "dashboard", "server.ts");
      const { execSync } = await import("node:child_process");
      execSync(`npx tsx ${serverPath}`, { stdio: "inherit" });
      break;
    }

    default:
      console.log(`Usage: foundry [--workdir <path>] <command>\n`);
      console.log(`Commands:`);
      console.log(`  init <name>   Create a new Foundry portfolio repo in ./<name>/`);
      console.log(`  start         Run the iteration loop`);
      console.log(`  stop          Create the configured stop file to halt after current iteration`);
      console.log(`  resume        Remove the configured stop file`);
      console.log(`  doctor        Run a compact furnace health check (--json, --preflight, --fail-on for automation)`);
      console.log(`  preflight     Run strict readiness preflight (--json, --fail-on for automation)`);
      console.log(`  status        Show current state (iteration, stats, checkpoint; --json, --fail-on for automation)`);
      console.log(`  forecast      Show next-run blockers, actions, and furnace signals (--json for automation)`);
      console.log(`  spark         Suggest/apply sparks or print a spark deck (--domain, --count, --apply, --append, --json)`);
      console.log(`  spark history Show applied spark audit events (--domain, --mode, --replayable, --since, --until, --show-request, --limit, --json)`);
      console.log(`  spark stats  Summarize applied spark audit usage (--domain, --mode, --replayable, --since, --until, --json)`);
      console.log(`  spark replay  Replay an applied spark into requests.md (--domain, --mode, --from, --append, --dry-run, --json)`);
      console.log(`  timeline      Show recent iteration-centered audit timeline (--domain, --iteration, --limit, --json for automation)`);
      console.log(`  request       Manage/audit the human redirect file (show, set, append, clear, history, stats, sources, restore, diff; --json for automation)`);
      console.log(`  iterations history Show recent iteration outcomes (--outcome, --domain, --limit, --json for automation)`);
      console.log(`  tokens history Show recent token usage calls (--agent, --model, --iteration, --limit, --json for automation)`);
      console.log(`  decisions history Show recent Critic gate decisions (--gate, --decision, --iteration, --limit, --json for automation)`);
      console.log(`  tester history Show recent Tester reports (--outcome, --iteration, --limit, --json for automation)`);
      console.log(`  monitor history Show recent monitor warnings (--severity, --iteration, --limit, --json for automation)`);
      console.log(`  refinery history Show recent Background Refinery attempts (--result, --source-type, --iteration, --limit, --json for automation)`);
      console.log(`  stoker history Show recent Stoker directive history (--urgency, --rule, --iteration, --limit, --json for automation)`);
      console.log(`  stimuli status Show focused Stimuli source health (--json, --fail-on for automation)`);
      console.log(`  stimuli history Show recent Stimuli repair audit events (--action, --status, --limit, --json for automation)`);
      console.log(`  stimuli refresh Refresh one configured Stimuli source now (--json for automation)`);
      console.log(`  stimuli reset Reset checkpointed health for one stimuli source (--json for automation)`);
      console.log(`  version       Show installed version`);
      console.log(`  upgrade       Sync managed files from CLI to project directory`);
      console.log(`  config doctor Validate config files and prompt templates (--json, --fail-on-ambiguous for automation)`);
      console.log(`  prompts doctor Validate prompt-template contracts (--json, --fail-on-ambiguous for automation)`);
      console.log(`  prompts list   List prompt-template contracts (--json for automation)`);
      console.log(`  prompts show   Show one prompt-template contract and status (--json for automation)`);
      console.log(`  logs doctor   Scan active JSONL logs and report malformed lines (--json, --fail-on for automation)`);
      console.log(`  dashboard     Start the dashboard server`);
      console.log(`\nOptions:`);
      console.log(`  --workdir <path>   Set the foundry data directory (default: cwd)`);
      process.exit(command ? 1 : 0);
  }
}

/* v8 ignore start */
import { realpathSync } from "node:fs";
let isDirectRun = false;
try {
  isDirectRun = process.argv[1] != null && import.meta.url === `file://${realpathSync(path.resolve(process.argv[1]))}`;
} catch {}
if (isDirectRun) {
  run().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
/* v8 ignore stop */
