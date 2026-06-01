#!/usr/bin/env node

import { loadConfig, loadDomainsConfig, loadModelsConfig } from "./context/config.js";
import { setModelOverrides, validateProvider } from "./model/index.js";
import { runIteration } from "./iteration/index.js";
import { checkStopFile, readRequests } from "./files/intervention.js";
import { appendJournal } from "./files/journal.js";
import { saveCheckpoint, loadCheckpoint } from "./checkpoint/index.js";
import { StatsTracker } from "./stats/index.js";
import { dispatchCuratorFull, applyCuratorCycle, shouldRunCurator } from "./curator/index.js";
import {
  loadStimuliConfig,
  refreshSource,
  refreshAllStale,
  initRefreshStates,
  recordToRefreshStates,
  refreshStatesToRecord,
  summarizeStimuliRefreshHealth,
  type StimuliRefreshHealth,
} from "./stimuli/index.js";

import {
  DEFAULT_MONITOR_CONFIG,
  runAllDetectors,
  summarizeFurnaceHealth,
  summarizeMonitorWarnings,
  type FurnaceHealthStatus,
  type MonitorSeverity,
  type MonitorWarning,
  type MonitorWarningStatus,
} from "./monitor/index.js";
import { loadComplexityBias, saveComplexityBias, type ComplexityTier } from "./complexity/index.js";
import { loadStreakHistory, saveStreakHistory } from "./streaks/index.js";
import { loadMood } from "./mood/index.js";
import { loadDreamJournal } from "./dreams/index.js";
import {
  DEFAULT_STOKER_CONFIG,
  generateStokerDirective,
  getStokerCadenceStatus,
  getStokerRefineryReadinessStatus,
  getStokerTokenHeatStatus,
  isStokerDirectiveCurrent,
  loadStokerDirective,
  saveStokerDirective,
  shouldRunStoker,
  type StokerDirective,
  type StokerForceContext,
  type StokerIterationEntry,
  type StokerRefineryReadinessStatus,
  type StokerTokenHeatStatus,
  type StokerUrgency,
} from "./stoker/index.js";
import { filterCurrentSpeculativeIdeas, loadSpeculativeIdeas } from "./speculative/index.js";
import {
  DEFAULT_REFINERY_CONFIG,
  getRefineryCadenceStatus,
  getRefineryFuelStatus,
  getLastRefineryIteration,
  selectRefineryTargets,
  type RefineryAttempt,
  type RefineryFuelStatus,
  type RefinerySourceType,
} from "./refinery/index.js";
import { readJsonlEntries } from "./context/index.js";
import { logEvent, logIteration, logMonitor, logStimuli, logStoker, readJsonlLogHealth, type JsonlLogHealth } from "./logging/index.js";
import type { AgentRole, CheckpointState, DecisionLogEntry, StimuliRefreshState, TestReportEntry } from "./types/index.js";
import type { FoundryConfig, ModelsConfig, AgentModelConfig, DomainEntry, DomainsConfig, IterationResult } from "./types/index.js";
import { CRITIC_RATING_DIMENSIONS, meanCriticRating, type CriticRatingDimension } from "./critic/ratings.js";
import { execSync, execFileSync } from "node:child_process";
import { access, readFile, statfs } from "node:fs/promises";
import path from "node:path";
import { resolve, getRootDir, setRootDir } from "./root.js";

export {
  CRITIC_RATING_DIMENSIONS,
  assertShippableCriticRatings,
  criticRatingValues,
  formatMeanCriticRating,
  isCriticRatingValue,
  meanCriticRating,
  meetsCriticShipThreshold,
  validateCriticRatings,
  type CriticRatingDimension,
} from "./critic/index.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BYTES_PER_GIB = 1024 ** 3;
const SEQUENTIAL_COOLDOWN_POLL_MS = 50;
const SEQUENTIAL_FAILURE_BREAKER_THRESHOLD = 3;
const SEQUENTIAL_FAILURE_BACKOFF_MS = 1000;
const SEQUENTIAL_FAILURE_BACKOFF_MAX_MS = 5000;

function statfsNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

function formatGiB(bytes: number): string {
  return (bytes / BYTES_PER_GIB).toFixed(2);
}

function activeProviderNames(models: ModelsConfig): string[] {
  const agentEntries = Object.values(models.agents) as AgentModelConfig[];
  return [...new Set(agentEntries.map((agent) => agent.provider ?? "zai"))];
}

type StartLifecycleMode = "sequential" | "parallel";

type StopFileAudit = {
  stop_file: string;
  stop_file_preview?: string;
};

type RequestStartupAudit = {
  request_file: string;
  request_pending_at_startup: boolean;
  request_preview_at_startup?: string;
};

type SequentialRequestHandoff = {
  request_file: string;
  request_pending: boolean;
  request_preview?: string;
  request_check_failed?: boolean;
  request_check_detail?: string;
};

type SequentialCooldownWake =
  | { reason: "signal" }
  | { reason: "STOP file" }
  | { reason: "request file"; request_file: string; request_preview: string };
type SequentialCooldownRequestPollFailure = {
  request_file: string;
  count: number;
  detail: string;
  first_elapsed_ms: number;
  last_elapsed_ms: number;
};
type SequentialCooldownStopPollFailure = {
  stop_file: string;
  count: number;
  detail: string;
  first_elapsed_ms: number;
  last_elapsed_ms: number;
};
type SequentialCooldownResult = {
  wake: SequentialCooldownWake | null;
  stopPollFailure: SequentialCooldownStopPollFailure | null;
  requestPollFailure: SequentialCooldownRequestPollFailure | null;
};

type ParallelIterationHalt = {
  iteration: number;
  reason?: string;
};

type StartRuntimeLifecycleOptions = {
  mode: StartLifecycleMode;
  concurrency: number;
  startIteration: number;
};
type StokerForceReason = "token_heat" | "quality_escalation" | "failure_escalation" | "dimension_repair" | "human_redirect" | "success_amplification" | "monitor_warning" | "underburn" | "domain_rut" | "startup_underburn";
type CuratorCycleTrigger =
  | "scheduled"
  | "project_milestone"
  | "quality_escalation"
  | "failure_escalation"
  | "success_amplification"
  | "underburn_escalation";
type AutoCommitResult = {
  status: "committed" | "failed";
  commit_message: string;
  pushed: boolean;
  duration_ms: number;
  detail?: string;
};

type StimuliRefreshStateSnapshot = Pick<StimuliRefreshState, "last_refresh_iteration" | "consecutive_failures" | "disabled">;
type AntiEntropyMonitorResult = {
  failed: boolean;
  warningCount: number;
  pressureWarningCount: number;
  criticalWarningCount: number;
  warningSummary?: string;
  emergencyCuratorTriggered: boolean;
  durationMs: number;
  detail?: string;
};
type StokerCheckResult = {
  due: boolean;
  cadenceDue: boolean;
  forceDue: boolean;
  enabled: boolean;
  runInterval: number | null;
  nextRunIteration: number | null;
  iterationsUntilRun: number | null;
  directiveWritten: boolean;
  failed: boolean;
  durationMs: number;
  forceReason?: StokerForceReason;
  forIteration?: number;
  urgency?: string;
  streakInstruction?: string;
  rulesFired?: string[];
  refineryQueue?: number;
  detail?: string;
};

async function logFoundryStartLifecycle(
  event:
    | "foundry_start"
    | "foundry_stop"
    | "foundry_start_failed"
    | "foundry_iteration_start"
    | "foundry_iteration_complete"
    | "foundry_token_heat_snapshot"
    | "foundry_sequential_failure_breaker"
    | "foundry_sequential_failure_warning"
    | "foundry_sequential_failure_recovered"
    | "foundry_sequential_maintenance_start"
    | "foundry_sequential_maintenance_complete"
    | "foundry_git_commit_start"
    | "foundry_git_commit_complete"
    | "foundry_git_commit_failed"
    | "foundry_checkpoint_saved"
    | "foundry_next_iteration_ready"
    | "foundry_cooldown_start"
    | "foundry_cooldown_complete"
    | "foundry_cooldown_skipped"
    | "foundry_cooldown_interrupted"
    | "foundry_parallel_request_guard"
    | "foundry_parallel_request_guard_released"
    | "foundry_curator_cycle_start"
    | "foundry_curator_cycle_complete"
    | "foundry_curator_cycle_failed"
    | "foundry_monitor_start"
    | "foundry_monitor_complete"
    | "foundry_monitor_failed"
    | "foundry_stoker_check_start"
    | "foundry_stoker_check_complete"
    | "foundry_stoker_check_failed"
    | "foundry_stimuli_refresh_start"
    | "foundry_stimuli_refresh_complete"
    | "foundry_stimuli_refresh_failed"
    | "foundry_checkpoint_failed",
  data: Record<string, unknown>,
): Promise<void> {
  await logEvent({
    ts: new Date().toISOString(),
    phase: "lifecycle",
    event,
    data,
  });
}

function autoCommitAndPush(
  iteration: number,
  outcome: string,
  artifactId: string | null,
  title: string,
  domain: string,
  rating: number | null,
  autoGitPush: boolean,
): AutoCommitResult {
  const rootDir = getRootDir();
  const startedAtMs = Date.now();
  const ratingStr = rating !== null ? ` ★${rating.toFixed(1)}` : "";
  let msg: string;
  if (outcome === "shipped") {
    msg = `feat: ship #${artifactId} — ${title} [${domain}]${ratingStr}`;
  } else if (outcome === "killed") {
    msg = `chore: kill #${artifactId} — ${title} [${domain}]`;
  } else {
    /* v8 ignore next */
    msg = `chore: iteration ${iteration} failed`;
  }

  try {
    execFileSync(
      "git",
      [
        "add",
        "portfolio/",
        "identity/",
        "logs/",
      ],
      { cwd: rootDir, stdio: "pipe" },
    );
    execFileSync("git", ["commit", "-m", msg], { cwd: rootDir, stdio: "pipe" });
    if (autoGitPush) {
      /* v8 ignore next */
      execFileSync("git", ["push", "origin", "HEAD"], { cwd: rootDir, stdio: "pipe", timeout: 30000 });
    }
    return {
      status: "committed",
      commit_message: msg,
      pushed: autoGitPush,
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn("[git] auto-commit/push failed, will retry next iteration");
    return {
      status: "failed",
      commit_message: msg,
      pushed: false,
      detail,
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    };
  }
}

async function runStokerIfDue(
  config: FoundryConfig,
  iteration: number,
  iterEntries: StokerIterationEntry[],
  lifecycle: StartRuntimeLifecycleOptions,
  options?: {
    forceReason?: StokerForceReason;
    forceContext?: StokerForceContext;
    tokenHeat?: StokerTokenHeatStatus;
  },
): Promise<StokerCheckResult> {
  const startedAtMs = Date.now();
  const cadence = getStokerCadenceStatus(iteration, config.stoker);
  const cadenceDue = shouldRunStoker(iteration, config.stoker);
  const forceDue = cadence.enabled && options?.forceReason !== undefined;
  const due = cadenceDue || forceDue;
  const resultBase = {
    due,
    cadenceDue,
    forceDue,
    enabled: cadence.enabled,
    runInterval: cadence.runInterval,
    nextRunIteration: cadence.nextRunIteration,
    iterationsUntilRun: cadence.iterationsUntilRun,
    ...(forceDue && options?.forceReason ? { forceReason: options.forceReason } : {}),
  };
  const baseData: Record<string, unknown> = {
    mode: lifecycle.mode,
    concurrency: lifecycle.concurrency,
    start_iteration: lifecycle.startIteration,
    iteration,
    due,
    cadence_due: cadenceDue,
    ...(forceDue && options?.forceReason ? { force_reason: options.forceReason } : {}),
    ...(forceDue && options?.forceContext?.title ? { force_title: options.forceContext.title } : {}),
    ...(forceDue && options?.forceContext?.domain ? { force_domain: options.forceContext.domain } : {}),
    ...(forceDue && options?.forceContext?.dimension ? { force_dimension: options.forceContext.dimension } : {}),
    ...(forceDue && options?.forceContext?.complexity ? { force_complexity: options.forceContext.complexity } : {}),
      ...(forceDue && typeof options?.forceContext?.spent_tokens === "number" ? { force_spent_tokens: options.forceContext.spent_tokens } : {}),
      ...(forceDue && typeof options?.forceContext?.target_tokens === "number" ? { force_target_tokens: options.forceContext.target_tokens } : {}),
      ...(forceDue && typeof options?.forceContext?.streak_length === "number" ? { force_streak_length: options.forceContext.streak_length } : {}),
      ...(forceDue && options?.forceReason === "startup_underburn" && typeof options?.forceContext?.spent_tokens === "number" ? { startup_prime_average_tokens: options.forceContext.spent_tokens } : {}),
      ...(forceDue && options?.forceReason === "startup_underburn" && typeof options?.forceContext?.target_tokens === "number" ? { startup_prime_target_tokens: options.forceContext.target_tokens } : {}),
      ...(forceDue && options?.forceContext?.request_file ? { force_request_file: options.forceContext.request_file } : {}),
    ...(forceDue && options?.forceContext?.request_preview ? { force_request_preview: options.forceContext.request_preview } : {}),
    ...(forceDue && typeof options?.forceContext?.rating === "number" ? { force_rating: options.forceContext.rating } : {}),
    ...(forceDue && typeof options?.forceContext?.threshold === "number" ? { force_threshold: options.forceContext.threshold } : {}),
    ...(forceDue && options?.forceContext?.reason ? { force_detail: options.forceContext.reason } : {}),
    ...(options?.tokenHeat ? {
      token_heat_pressure: options.tokenHeat.pressure,
      token_heat_threshold_percent: options.tokenHeat.thresholdPercent,
      token_heat_hot: options.tokenHeat.hot,
    } : {}),
    stoker_enabled: cadence.enabled,
    run_interval: cadence.runInterval,
    next_run_iteration: cadence.nextRunIteration,
    iterations_until_run: cadence.iterationsUntilRun,
  };

  await logFoundryStartLifecycle("foundry_stoker_check_start", baseData);

  if (!due) {
    const durationMs = Math.max(0, Date.now() - startedAtMs);
    await logFoundryStartLifecycle("foundry_stoker_check_complete", {
      ...baseData,
      directive_written: false,
      duration_ms: durationMs,
    });
    return {
      ...resultBase,
      directiveWritten: false,
      failed: false,
      durationMs,
    };
  }

  try {
    const [streak, complexityBias, mood, dreams, refineryTargets, lastRefineryIteration] = await Promise.all([
      loadStreakHistory(),
      loadComplexityBias(),
      loadMood(),
      loadDreamJournal(),
      selectRefineryTargets(iteration, config.refinery),
      getLastRefineryIteration(),
    ]);

    const directive = generateStokerDirective({
      current_iteration: iteration,
      for_iteration: iteration + 1,
      recent_iterations: iterEntries,
      ...(forceDue && options?.forceReason ? { force_reason: options.forceReason } : {}),
      ...(forceDue && options?.forceContext ? { force_context: options.forceContext } : {}),
      streak,
      complexity_bias: complexityBias,
      mood,
      dream_count: dreams.dreams.length,
      refinery_target_count: refineryTargets.length,
      last_refinery_iteration: lastRefineryIteration,
      refinery_min_iterations_between_runs: config.refinery?.min_iterations_between_runs
        ?? DEFAULT_REFINERY_CONFIG.min_iterations_between_runs,
      refinery_token_heat_window: config.stoker?.refinery_token_heat_window
        ?? DEFAULT_STOKER_CONFIG.refinery_token_heat_window,
      refinery_token_heat_threshold: config.stoker?.refinery_token_heat_threshold
        ?? DEFAULT_STOKER_CONFIG.refinery_token_heat_threshold,
    });

    await saveStokerDirective(directive);
    await logStoker({ ...directive });
    console.log(`  [stoker] ${directive.urgency}: ${directive.ideator_hint ?? "directive updated"}`);
    const durationMs = Math.max(0, Date.now() - startedAtMs);
    await logFoundryStartLifecycle("foundry_stoker_check_complete", {
      ...baseData,
      directive_written: true,
      for_iteration: directive.for_iteration,
      urgency: directive.urgency,
      streak_instruction: directive.streak_instruction,
      rules_fired: directive.rules_fired,
      refinery_queue: directive.refinery_queue ?? 0,
      duration_ms: durationMs,
    });
    return {
      ...resultBase,
      directiveWritten: true,
      failed: false,
      durationMs,
      forIteration: directive.for_iteration,
      urgency: directive.urgency,
      streakInstruction: directive.streak_instruction,
      rulesFired: directive.rules_fired,
      refineryQueue: directive.refinery_queue ?? 0,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const durationMs = Math.max(0, Date.now() - startedAtMs);
    console.warn(`  ⚠ Stoker failed: ${msg}`);
    await logFoundryStartLifecycle("foundry_stoker_check_failed", {
      ...baseData,
      detail: msg,
      duration_ms: durationMs,
    });
    return {
      ...resultBase,
      directiveWritten: false,
      failed: true,
      durationMs,
      detail: msg,
    };
  }
}

async function assertPromptPreflightHealthy(): Promise<void> {
  const { validatePromptContracts } = await import("./agents/prompt.js");
  const report = await validatePromptContracts();
  if (report.status === "healthy") return;

  const failures = report.files
    .filter((file) => !file.ok)
    .map((file) => `${file.name}: ${file.errors?.join("; ") ?? "invalid prompt contract"}`);
  throw new Error(`Prompt preflight failed before start: ${failures.join(" | ") || "invalid prompt contract"}`);
}

async function assertDiskPreflightHealthy(config: FoundryConfig): Promise<void> {
  const minGb = config.loop?.disk_space_min_gb ?? 0;
  if (minGb <= 0) return;

  const rootDir = getRootDir();
  const stats = await statfs(rootDir);
  const availableBytes = statfsNumber(stats.bavail) * statfsNumber(stats.bsize);
  const requiredBytes = minGb * BYTES_PER_GIB;

  if (availableBytes >= requiredBytes) return;

  throw new Error(
    `Disk preflight failed before start: ${formatGiB(availableBytes)} GiB available at ${rootDir}, requires ${minGb.toFixed(2)} GiB`,
  );
}

async function checkStartupStopFile(config: FoundryConfig): Promise<boolean> {
  try {
    await access(resolve(config.intervention.stop_file));
    return true;
  } catch {
    return false;
  }
}

function compactSingleLinePreview(raw: string, maxLength = 160): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

async function readStopFileAudit(config: FoundryConfig): Promise<StopFileAudit> {
  const stopFile = config.intervention.stop_file;
  try {
    const raw = await readFile(resolve(stopFile), "utf-8");
    const preview = compactSingleLinePreview(raw);
    return preview.length > 0
      ? { stop_file: stopFile, stop_file_preview: preview }
      : { stop_file: stopFile };
  } catch {
    return { stop_file: stopFile };
  }
}

async function readRequestStartupAudit(config: FoundryConfig): Promise<RequestStartupAudit> {
  const requestFile = config.intervention.requests_file;
  try {
    const raw = await readFile(resolve(requestFile), "utf-8");
    const preview = compactSingleLinePreview(raw);
    return preview.length > 0
      ? {
          request_file: requestFile,
          request_pending_at_startup: true,
          request_preview_at_startup: preview,
        }
      : {
          request_file: requestFile,
          request_pending_at_startup: false,
        };
  } catch {
    return {
      request_file: requestFile,
      request_pending_at_startup: false,
    };
  }
}

async function readSequentialRequestHandoff(config: FoundryConfig): Promise<SequentialRequestHandoff> {
  const requestFile = config.intervention.requests_file;
  try {
    const request = await readRequests(config);
    const preview = compactSingleLinePreview(request);
    return preview.length > 0
      ? { request_file: requestFile, request_pending: true, request_preview: preview }
      : { request_file: requestFile, request_pending: false };
  } catch (err) {
    return {
      request_file: requestFile,
      request_pending: false,
      request_check_failed: true,
      request_check_detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function formatStopFileJournalSuffix(audit: StopFileAudit): string {
  return audit.stop_file_preview
    ? ` ${audit.stop_file}: ${audit.stop_file_preview}`
    : ` ${audit.stop_file}`;
}

async function appendCriticalHandoffJournalNote(
  iteration: number,
  nextIteration: number,
  attention: SequentialHandoffAttention,
  checkpointReason: string | null,
): Promise<void> {
  const reasons = attention.consoleReasons.length > 0
    ? attention.consoleReasons.join(", ")
    : "critical maintenance pressure";
  const checkpoint = checkpointReason
    ? `Checkpoint saved for ${checkpointReason} before iteration ${nextIteration}.`
    : `No checkpoint coverage was available before iteration ${nextIteration}.`;
  try {
    await appendJournal(`**System:** Critical handoff attention after iteration ${iteration}: ${reasons}. ${checkpoint}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠ Critical handoff journal note failed: ${msg}`);
  }
}

async function appendQueuedRequestCooldownJournalNote(
  iteration: number,
  nextIteration: number,
  handoff: SequentialRequestHandoff,
): Promise<void> {
  const request = handoff.request_preview
    ? `${handoff.request_file}: ${handoff.request_preview}`
    : handoff.request_file;
  try {
    await appendJournal(
      `**System:** Human redirect queued before cooldown after iteration ${iteration}: ${request}. Starting iteration ${nextIteration} early.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠ Request handoff journal note failed: ${msg}`);
  }
}

async function appendUrgentStokerCooldownJournalNote(
  iteration: number,
  nextIteration: number,
  result: StokerCheckResult,
  checkpointSaved: boolean,
  checkpointReason: string | null,
): Promise<void> {
  const directiveTarget = typeof result.forIteration === "number"
    ? `directive for iteration ${result.forIteration}`
    : `directive for iteration ${nextIteration}`;
  const rules = result.rulesFired && result.rulesFired.length > 0
    ? ` Rules: ${result.rulesFired.join(", ")}.`
    : "";
  const checkpoint = checkpointSaved && checkpointReason
    ? ` Checkpoint saved for ${checkpointReason}.`
    : "";
  try {
    await appendJournal(
      `**System:** High-urgency Stoker handoff after iteration ${iteration}: ${directiveTarget}.${rules}${checkpoint} Starting iteration ${nextIteration} early.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠ Stoker handoff journal note failed: ${msg}`);
  }
}

async function appendDetectedRequestCooldownJournalNote(
  iteration: number,
  nextIteration: number,
  wake: Extract<SequentialCooldownWake, { reason: "request file" }>,
): Promise<void> {
  const request = wake.request_preview
    ? `${wake.request_file}: ${wake.request_preview}`
    : wake.request_file;
  try {
    await appendJournal(
      `**System:** Human redirect detected during cooldown after iteration ${iteration}: ${request}. Starting iteration ${nextIteration} early.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠ Cooldown request journal note failed: ${msg}`);
  }
}

async function appendRecoveredCooldownPollJournalNote(
  iteration: number,
  nextIteration: number,
  stopFailure: SequentialCooldownStopPollFailure | null,
  requestFailure: SequentialCooldownRequestPollFailure | null,
): Promise<void> {
  const details: string[] = [];
  if (stopFailure) {
    const label = stopFailure.count === 1 ? "time" : "times";
    details.push(`STOP file ${stopFailure.stop_file} failed ${stopFailure.count} ${label}; latest: ${stopFailure.detail}`);
  }
  if (requestFailure) {
    const label = requestFailure.count === 1 ? "time" : "times";
    details.push(`request file ${requestFailure.request_file} failed ${requestFailure.count} ${label}; latest: ${requestFailure.detail}`);
  }
  if (details.length === 0) return;
  try {
    await appendJournal(
      `**System:** Cooldown polling recovered after iteration ${iteration}: ${details.join("; ")}. Continuing to iteration ${nextIteration}.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠ Cooldown polling recovery journal note failed: ${msg}`);
  }
}

function formatRecoveredCooldownPollConsole(
  iteration: number,
  nextIteration: number,
  stopFailure: SequentialCooldownStopPollFailure | null,
  requestFailure: SequentialCooldownRequestPollFailure | null,
): string | null {
  const details: string[] = [];
  if (stopFailure) {
    const label = stopFailure.count === 1 ? "time" : "times";
    details.push(`STOP file ${stopFailure.stop_file} failed ${stopFailure.count} ${label}`);
  }
  if (requestFailure) {
    const label = requestFailure.count === 1 ? "time" : "times";
    details.push(`request file ${requestFailure.request_file} failed ${requestFailure.count} ${label}`);
  }
  if (details.length === 0) return null;
  return `Cooldown polling recovered after iteration ${iteration}: ${details.join("; ")}. Continuing to iteration ${nextIteration}.`;
}

function formatSequentialCooldownCompleteConsole(
  iteration: number,
  nextIteration: number,
  elapsedMs: number,
): string {
  return `Cooldown complete after ${formatConsoleDuration(elapsedMs)} following iteration ${iteration}; starting iteration ${nextIteration}.`;
}

interface QualityEscalationDecision {
  rating: number;
  threshold: number;
}

interface FailureEscalationDecision {
  reason: string | null;
}

interface DimensionRepairDecision {
  dimension: CriticRatingDimension | "technical_quality";
  rating: number;
  threshold: number;
}

interface SuccessAmplificationDecision {
  rating: number;
  threshold: number;
}

interface TokenUnderburnDecision {
  complexity: ComplexityTier;
  spentTokens: number;
  targetTokens: number;
  budgetWarningThreshold: number;
}

interface StartupTokenPrimeDecision {
  averageTokens: number;
  targetTokens: number;
  samples: number;
  thresholdPercent: number;
}

interface DomainRutDecision {
  domain: string;
  streakLength: number;
  threshold: number;
}

const TOKEN_UNDERBURN_FLOOR_RATIO = 0.25;
const STARTUP_TOKEN_PRIME_FLOOR_RATIO = 0.25;
const STARTUP_TOKEN_PRIME_MIN_SAMPLES = 2;
const DOMAIN_RUT_STREAK_THRESHOLD = 3;

function getQualityEscalationThreshold(config: FoundryConfig): number {
  const threshold = config.streaks?.high_rating_threshold;
  return typeof threshold === "number" && Number.isFinite(threshold) && threshold > 0
    ? threshold
    : 3.5;
}

function getSuccessAmplificationThreshold(config: FoundryConfig): number {
  return Math.min(5, getQualityEscalationThreshold(config) + 0.5);
}

function parseIterationMeanRating(result: IterationResult | null): number | null {
  if (!result) return null;
  const rawRating = result.mean_rating;
  const rating = typeof rawRating === "number"
    ? rawRating
    : typeof rawRating === "string"
      ? Number.parseFloat(rawRating)
      : NaN;
  return Number.isFinite(rating) ? rating : null;
}

function getSequentialQualityEscalation(
  result: IterationResult | null,
  config: FoundryConfig,
): QualityEscalationDecision | null {
  if (!result || result.outcome !== "shipped") return null;
  const rating = parseIterationMeanRating(result);
  if (rating == null) return null;
  const threshold = getQualityEscalationThreshold(config);
  return rating < threshold ? { rating, threshold } : null;
}

function getSequentialSuccessAmplification(
  result: IterationResult | null,
  config: FoundryConfig,
): SuccessAmplificationDecision | null {
  if (!result || result.outcome !== "shipped") return null;
  const rating = parseIterationMeanRating(result);
  if (rating == null) return null;
  const threshold = getSuccessAmplificationThreshold(config);
  return rating >= threshold ? { rating, threshold } : null;
}

function getSequentialTokenUnderburn(
  result: IterationResult | null,
  config: FoundryConfig,
): TokenUnderburnDecision | null {
  if (!result || result.outcome !== "shipped" || !result.complexity) return null;
  const profile = config.iteration.complexity_profiles?.[result.complexity];
  if (!profile) return null;
  const budgetWarningThreshold = profile.budget_warning_threshold;
  if (!Number.isFinite(budgetWarningThreshold) || budgetWarningThreshold <= 0) return null;
  const spentTokens = result.token_usage.input + result.token_usage.output;
  if (!Number.isFinite(spentTokens) || spentTokens <= 0) return null;
  const targetTokens = Math.max(1, Math.round(budgetWarningThreshold * TOKEN_UNDERBURN_FLOOR_RATIO));
  return spentTokens < targetTokens
    ? {
        complexity: result.complexity,
        spentTokens,
        targetTokens,
        budgetWarningThreshold,
      }
    : null;
}

function getStartupTokenPrime(
  heat: StokerTokenHeatStatus | null,
): StartupTokenPrimeDecision | null {
  if (!heat || heat.samples < STARTUP_TOKEN_PRIME_MIN_SAMPLES || heat.hot) return null;
  const targetTokens = Math.max(1, Math.round(heat.threshold * STARTUP_TOKEN_PRIME_FLOOR_RATIO));
  const averageTokens = Math.round(heat.averageTokens);
  if (averageTokens >= targetTokens) return null;
  return {
    averageTokens,
    targetTokens,
    samples: heat.samples,
    thresholdPercent: heat.thresholdPercent,
  };
}

function getSequentialDomainRut(
  entries: StokerIterationEntry[],
  threshold: number = DOMAIN_RUT_STREAK_THRESHOLD,
): DomainRutDecision | null {
  const sorted = entries
    .filter((entry) => Number.isFinite(entry.iteration))
    .sort((a, b) => a.iteration - b.iteration);
  const latest = sorted.at(-1);
  if (!latest || latest.outcome !== "shipped" || !latest.domain) return null;

  let streakLength = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const entry = sorted[i];
    if (entry.outcome !== "shipped" || entry.domain !== latest.domain) break;
    streakLength++;
  }

  return streakLength >= threshold
    ? { domain: latest.domain, streakLength, threshold }
    : null;
}

function getSequentialFailureEscalation(result: IterationResult | null): FailureEscalationDecision | null {
  if (!result || result.outcome !== "killed") return null;
  return {
    reason: result.reason ? compactSingleLinePreview(result.reason, 180) : null,
  };
}

function getSequentialDimensionRepair(result: IterationResult | null): DimensionRepairDecision | null {
  if (!result || result.outcome !== "shipped" || !result.ratings) return null;
  const threshold = 4;
  const dimensions: Array<{ dimension: CriticRatingDimension | "technical_quality"; rating: number }> = [
    ...CRITIC_RATING_DIMENSIONS.map((dimension) => ({
      dimension,
      rating: result.ratings![dimension],
    })),
    ...(typeof result.ratings.technical_quality === "number"
      ? [{ dimension: "technical_quality" as const, rating: result.ratings.technical_quality }]
      : []),
  ];
  const weakest = dimensions
    .filter((entry) => Number.isFinite(entry.rating) && entry.rating < threshold)
    .sort((a, b) => a.rating - b.rating)[0];
  return weakest ? { ...weakest, threshold } : null;
}

function createStokerForceContext(
  result: IterationResult | null,
  qualityEscalation: QualityEscalationDecision | null,
  failureEscalation: FailureEscalationDecision | null,
  dimensionRepair: DimensionRepairDecision | null,
  requestHandoff: SequentialRequestHandoff | null,
  successAmplification: SuccessAmplificationDecision | null,
  tokenUnderburn: TokenUnderburnDecision | null,
  domainRut: DomainRutDecision | null,
  monitorResult: AntiEntropyMonitorResult | null,
  tokenHeat: StokerTokenHeatStatus | null,
): StokerForceContext | undefined {
  if (qualityEscalation) {
    return {
      ...(result?.title ? { title: result.title } : {}),
      ...(result?.domain ? { domain: result.domain } : {}),
      rating: Number(qualityEscalation.rating.toFixed(1)),
      threshold: Number(qualityEscalation.threshold.toFixed(1)),
    };
  }
  if (failureEscalation) {
    return {
      ...(result?.title ? { title: result.title } : {}),
      ...(result?.domain ? { domain: result.domain } : {}),
      ...(failureEscalation.reason ? { reason: failureEscalation.reason } : {}),
    };
  }
  if (dimensionRepair) {
    return {
      ...(result?.title ? { title: result.title } : {}),
      ...(result?.domain ? { domain: result.domain } : {}),
      dimension: dimensionRepair.dimension,
      rating: Number(dimensionRepair.rating.toFixed(1)),
      threshold: Number(dimensionRepair.threshold.toFixed(1)),
    };
  }
  if (requestHandoff?.request_pending) {
    return {
      ...(result?.title ? { title: result.title } : {}),
      ...(result?.domain ? { domain: result.domain } : {}),
      request_file: requestHandoff.request_file,
      ...(requestHandoff.request_preview ? { request_preview: requestHandoff.request_preview } : {}),
    };
  }
  if (monitorResult && monitorResult.pressureWarningCount > 0) {
    return {
      ...(result?.title ? { title: result.title } : {}),
      ...(result?.domain ? { domain: result.domain } : {}),
      warning_count: monitorResult.pressureWarningCount,
      critical_warning_count: monitorResult.criticalWarningCount,
      ...(monitorResult.warningSummary ? { reason: monitorResult.warningSummary } : {}),
    };
  }
  if (tokenHeat?.hot) {
    return {
      ...(result?.title ? { title: result.title } : {}),
      ...(result?.domain ? { domain: result.domain } : {}),
      token_heat_pressure: tokenHeat.pressure,
      token_heat_threshold_percent: tokenHeat.thresholdPercent,
    };
  }
  if (tokenUnderburn) {
    return {
      ...(result?.title ? { title: result.title } : {}),
      ...(result?.domain ? { domain: result.domain } : {}),
      complexity: tokenUnderburn.complexity,
      spent_tokens: tokenUnderburn.spentTokens,
      target_tokens: tokenUnderburn.targetTokens,
    };
  }
  if (domainRut) {
    return {
      domain: domainRut.domain,
      streak_length: domainRut.streakLength,
    };
  }
  if (successAmplification) {
    return {
      ...(result?.title ? { title: result.title } : {}),
      ...(result?.domain ? { domain: result.domain } : {}),
      rating: Number(successAmplification.rating.toFixed(1)),
      threshold: Number(successAmplification.threshold.toFixed(1)),
    };
  }
  return undefined;
}

async function appendQualityEscalationJournalNote(
  iteration: number,
  result: IterationResult,
  escalation: QualityEscalationDecision,
): Promise<void> {
  const title = result.title ? `"${result.title}"` : "untitled artifact";
  const domain = result.domain ? ` in ${result.domain}` : "";
  try {
    await appendJournal(
      `**Iteration ${iteration}:** Quality escalation after shipped artifact ${title}${domain}: mean rating ${escalation.rating.toFixed(1)} below high-quality threshold ${escalation.threshold.toFixed(1)}. Running an immediate Curator cycle before the next iteration.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠ Quality escalation journal note failed: ${msg}`);
  }
}

async function appendFailureEscalationJournalNote(
  iteration: number,
  result: IterationResult,
  escalation: FailureEscalationDecision,
): Promise<void> {
  const title = result.title ? `"${result.title}"` : "untitled artifact";
  const domain = result.domain ? ` in ${result.domain}` : "";
  const reason = escalation.reason ? ` Reason: ${escalation.reason}` : "";
  try {
    await appendJournal(
      `**Iteration ${iteration}:** Failure escalation after killed artifact ${title}${domain}.${reason} Running an immediate Curator cycle before the next iteration.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠ Failure escalation journal note failed: ${msg}`);
  }
}

async function appendSuccessAmplificationJournalNote(
  iteration: number,
  result: IterationResult,
  amplification: SuccessAmplificationDecision,
): Promise<void> {
  const title = result.title ? `"${result.title}"` : "untitled artifact";
  const domain = result.domain ? ` in ${result.domain}` : "";
  try {
    await appendJournal(
      `**Iteration ${iteration}:** Success amplification after shipped artifact ${title}${domain}: mean rating ${amplification.rating.toFixed(1)} met amplification threshold ${amplification.threshold.toFixed(1)}. Running an immediate Curator cycle before the next iteration to preserve what worked.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠ Success amplification journal note failed: ${msg}`);
  }
}

async function appendDimensionRepairJournalNote(
  iteration: number,
  result: IterationResult,
  repair: DimensionRepairDecision,
): Promise<void> {
  const title = result.title ? `"${result.title}"` : "untitled artifact";
  const domain = result.domain ? ` in ${result.domain}` : "";
  try {
    await appendJournal(
      `**Iteration ${iteration}:** Dimension repair after shipped artifact ${title}${domain}: ${repair.dimension} rated ${repair.rating.toFixed(1)} below ${repair.threshold.toFixed(1)}. Steering the next Stoker directive toward making that Critic dimension visibly stronger.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠ Dimension repair journal note failed: ${msg}`);
  }
}

async function appendTokenUnderburnJournalNote(
  iteration: number,
  result: IterationResult,
  underburn: TokenUnderburnDecision,
): Promise<void> {
  const title = result.title ? `"${result.title}"` : "untitled artifact";
  const domain = result.domain ? ` in ${result.domain}` : "";
  try {
    await appendJournal(
      `**Iteration ${iteration}:** Token underburn after shipped ${underburn.complexity}-tier artifact ${title}${domain}: ${underburn.spentTokens} tokens below the ${underburn.targetTokens}-token floor. Forcing the next Stoker handoff to spend more deliberate effort.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠ Token underburn journal note failed: ${msg}`);
  }
}

async function appendStartupTokenPrimeJournalNote(
  nextIteration: number,
  prime: StartupTokenPrimeDecision,
): Promise<void> {
  try {
    await appendJournal(
      `**System:** Startup token prime before iteration ${nextIteration}: persisted loop history shows a ${prime.averageTokens}-token average below the ${prime.targetTokens}-token floor across ${prime.samples} samples. Queuing a high-urgency Stoker directive before the first iteration of this run.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠ Startup token prime journal note failed: ${msg}`);
  }
}

function formatStopFileConsoleSuffix(audit: StopFileAudit | null): string {
  if (!audit) return "";
  return audit.stop_file_preview
    ? ` (${audit.stop_file}: ${audit.stop_file_preview})`
    : ` (${audit.stop_file})`;
}

function formatSignalConsoleSuffix(signal: NodeJS.Signals | null): string {
  return signal ? ` (${signal})` : "";
}

function snapshotStimuliRefreshStates(
  states: Map<string, StimuliRefreshState>,
): Map<string, StimuliRefreshStateSnapshot> {
  const snapshot = new Map<string, StimuliRefreshStateSnapshot>();
  for (const [source, state] of states) {
    snapshot.set(source, {
      last_refresh_iteration: state.last_refresh_iteration,
      consecutive_failures: state.consecutive_failures,
      disabled: state.disabled,
    });
  }
  return snapshot;
}

function summarizeStimuliRefreshTransition(
  before: Map<string, StimuliRefreshStateSnapshot>,
  after: Map<string, StimuliRefreshState>,
  iteration: number,
): Record<string, number> {
  let refreshedSources = 0;
  let failingSources = 0;
  let disabledSources = 0;
  let newlyDisabledSources = 0;

  for (const [source, state] of after) {
    const previous = before.get(source);
    const previousRefreshIteration = previous?.last_refresh_iteration ?? 0;
    const previousFailures = previous?.consecutive_failures ?? 0;
    const previouslyDisabled = previous?.disabled === true;

    if (
      state.last_refresh_iteration === iteration
      && previousRefreshIteration !== iteration
      && state.consecutive_failures === 0
    ) {
      refreshedSources++;
    }
    if (state.consecutive_failures > previousFailures) {
      failingSources++;
    }
    if (state.disabled) {
      disabledSources++;
    }
    if (state.disabled && !previouslyDisabled) {
      newlyDisabledSources++;
    }
  }

  return {
    tracked_sources: after.size,
    refreshed_sources: refreshedSources,
    failing_sources: failingSources,
    disabled_sources: disabledSources,
    newly_disabled_sources: newlyDisabledSources,
  };
}

async function refreshStimuliForIteration(
  config: FoundryConfig,
  iteration: number,
  states: Map<string, StimuliRefreshState>,
  lifecycle?: StartRuntimeLifecycleOptions,
): Promise<Map<string, StimuliRefreshState>> {
  if (!config.stimuli.enabled) return states;

  const startedAtMs = Date.now();
  const before = snapshotStimuliRefreshStates(states);
  const baseData = lifecycle ? {
    mode: lifecycle.mode,
    concurrency: lifecycle.concurrency,
    start_iteration: lifecycle.startIteration,
    iteration,
    tracked_sources: states.size,
  } : null;

  if (baseData) {
    await logFoundryStartLifecycle("foundry_stimuli_refresh_start", baseData);
  }

  try {
    const nextStates = await refreshAllStale(iteration, states);
    if (baseData) {
      await logFoundryStartLifecycle("foundry_stimuli_refresh_complete", {
        ...baseData,
        ...summarizeStimuliRefreshTransition(before, nextStates, iteration),
        duration_ms: Math.max(0, Date.now() - startedAtMs),
      });
    }
    return nextStates;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[stimuli] Refresh error (non-fatal):", err);
    if (baseData) {
      await logFoundryStartLifecycle("foundry_stimuli_refresh_failed", {
        ...baseData,
        detail: msg,
        duration_ms: Math.max(0, Date.now() - startedAtMs),
      });
    }
    return states;
  }
}

async function runAntiEntropyMonitor(
  config: FoundryConfig,
  models: ModelsConfig,
  iteration: number,
  stats: StatsTracker,
  stimuliRefreshStates: Map<string, StimuliRefreshState>,
  opts: {
    mode: StartLifecycleMode;
    concurrency: number;
    startIteration: number;
    runEmergencyCurator: boolean;
    onEmergencyCuratorComplete?: () => void | Promise<void>;
  },
): Promise<AntiEntropyMonitorResult> {
  const monitorStartedAtMs = Date.now();
  await logFoundryStartLifecycle("foundry_monitor_start", {
    mode: opts.mode,
    concurrency: opts.concurrency,
    start_iteration: opts.startIteration,
    iteration,
    emergency_curator_enabled: opts.runEmergencyCurator,
  });

  try {
    const iterEntries = await readJsonlEntries<any>(
      resolve("logs", "iterations.jsonl"),
    );
    /* v8 ignore next 3 */
    const journal = await readFile(
      resolve("identity", "journal.md"), "utf-8",
    ).catch(() => "");
    const logHealth = await readJsonlLogHealth().catch(() => null);

    const warnings = runAllDetectors(iterEntries, journal, iteration, {
      ...DEFAULT_MONITOR_CONFIG,
      complexity_yield_window: config.complexity?.yield_window ?? DEFAULT_MONITOR_CONFIG.complexity_yield_window,
      complexity_min_samples_for_confidence: config.complexity?.min_samples_for_confidence ?? DEFAULT_MONITOR_CONFIG.complexity_min_samples_for_confidence,
      complexity_high_confidence_samples: config.complexity?.high_confidence_samples ?? DEFAULT_MONITOR_CONFIG.complexity_high_confidence_samples,
    }, logHealth);
    for (const w of warnings) {
      console.log(`  [${w.severity}] ${w.detector}: ${w.message}`);
      if (w.action?.type === "complexity_bias_update") {
        await saveComplexityBias(w.action.bias);
      }
      await logMonitor({ ...w });
    }

    const pressureWarnings = warnings.filter((w) => w.severity === "warning" || w.severity === "critical");
    const critical = warnings.filter((w) => w.severity === "critical");
    const warningSummary = pressureWarnings.length > 0
      ? compactSingleLinePreview(
        [
          ...pressureWarnings.slice(0, 3).map((w) => `${w.detector}: ${w.message}`),
          ...(pressureWarnings.length > 3 ? [`+${pressureWarnings.length - 3} more`] : []),
        ].join(" | "),
        300,
      )
      : undefined;
    let emergencyCuratorTriggered = false;
    const emergencyCuratorWarning = critical.find((w) => w.action?.type === "emergency_curator") ?? critical[0];
    if (opts.runEmergencyCurator && emergencyCuratorWarning) {
      emergencyCuratorTriggered = true;
      const trigger = emergencyCuratorWarning.action?.type === "emergency_curator"
        ? "quality crisis"
        : "critical monitor pressure";
      console.log(`  ▶ Emergency Curator triggered by ${trigger}`);
      try {
        const curatorResponse = await dispatchCuratorFull(config, models, iteration, stats, stimuliRefreshStates);
        await applyCuratorCycle(curatorResponse, iteration, stimuliRefreshStates);
        await opts.onEmergencyCuratorComplete?.();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Emergency Curator failed: ${msg}`);
      }
    }
    const durationMs = Math.max(0, Date.now() - monitorStartedAtMs);
    await logFoundryStartLifecycle("foundry_monitor_complete", {
      mode: opts.mode,
      concurrency: opts.concurrency,
      start_iteration: opts.startIteration,
      iteration,
      emergency_curator_enabled: opts.runEmergencyCurator,
      emergency_curator_triggered: emergencyCuratorTriggered,
      warning_count: warnings.length,
      pressure_warning_count: pressureWarnings.length,
      critical_warning_count: critical.length,
      duration_ms: durationMs,
    });
    return {
      failed: false,
      warningCount: warnings.length,
      pressureWarningCount: pressureWarnings.length,
      criticalWarningCount: critical.length,
      ...(warningSummary ? { warningSummary } : {}),
      emergencyCuratorTriggered,
      durationMs,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const durationMs = Math.max(0, Date.now() - monitorStartedAtMs);
    await logFoundryStartLifecycle("foundry_monitor_failed", {
      mode: opts.mode,
      concurrency: opts.concurrency,
      start_iteration: opts.startIteration,
      iteration,
      emergency_curator_enabled: opts.runEmergencyCurator,
      detail: msg,
      duration_ms: durationMs,
    });
    // monitor is non-fatal
    return {
      failed: true,
      warningCount: 0,
      pressureWarningCount: 0,
      criticalWarningCount: 0,
      emergencyCuratorTriggered: false,
      durationMs,
      detail: msg,
    };
  }
}

async function logSkippedIterationFailure(
  iteration: number,
  reason: string,
  startedAtMs: number,
): Promise<void> {
  await logSkippedIterationFailureEntry(iteration, reason, Date.now() - startedAtMs);
}

async function logSkippedIterationFailureEntry(
  iteration: number,
  reason: string,
  durationMs: number,
): Promise<void> {
  try {
    await logIteration({
      timestamp: new Date().toISOString(),
      iteration,
      outcome: "skipped",
      reason,
      failure_stage: "run_iteration",
      token_usage: { input: 0, output: 0 },
      duration_ms: durationMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  ⚠ Failed iteration log write failed: ${msg}`);
  }
}

function isWorkerPoolFailureResult(result: IterationResult): boolean {
  return result.outcome === "skipped"
    && typeof result.reason === "string"
    && result.reason.startsWith("Iteration failed in worker pool:");
}

function formatConsoleDuration(durationMs: number): string {
  const safeDurationMs = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
  return safeDurationMs < 1000
    ? `${Math.round(safeDurationMs)}ms`
    : `${(safeDurationMs / 1000).toFixed(1)}s`;
}

function formatConsoleCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

type IterationConsoleHeat = Pick<StokerTokenHeatStatus, "pressure" | "thresholdPercent">;

interface SequentialCooldownPlan {
  baseMs: number;
  cooldownMs: number;
  heatAdjusted: boolean;
  heatMultiplier: number;
  failureBackoffMs: number;
  failureBackoffApplied: boolean;
  failureStreak: number;
}

type SequentialHandoffHealth = "clear" | "warning" | "critical";

interface SequentialHandoffAttention {
  health: SequentialHandoffHealth;
  reasons: string[];
  consoleReasons: string[];
}

function formatStartupTokenHeatConsole(heat: StokerTokenHeatStatus | null): string | null {
  if (!heat || heat.samples <= 0) return null;
  const sampleLabel = heat.samples === 1 ? "sample" : "samples";
  return `Startup token heat: ${heat.pressure} ${heat.thresholdPercent}% (${heat.samples} ${sampleLabel}, peak ${heat.peakTokens})`;
}

function getSequentialFailureBackoffMs(failureStreak: number): number {
  const safeFailureStreak = Number.isFinite(failureStreak) && failureStreak > 0
    ? Math.floor(failureStreak)
    : 0;
  return safeFailureStreak > 0
    ? Math.min(SEQUENTIAL_FAILURE_BACKOFF_MAX_MS, SEQUENTIAL_FAILURE_BACKOFF_MS * safeFailureStreak)
    : 0;
}

function formatSequentialFailureWarningConsole(failureStreak: number, failureThreshold: number): string {
  return `Skipped iteration streak ${failureStreak}/${failureThreshold} - ${failureThreshold - failureStreak} before automatic halt; retry backoff ${formatConsoleDuration(getSequentialFailureBackoffMs(failureStreak))}.`;
}

function planSequentialCooldown(
  baseCooldownMs: number,
  heat: StokerTokenHeatStatus | null,
  failureStreak = 0,
): SequentialCooldownPlan {
  const baseMs = Number.isFinite(baseCooldownMs) && baseCooldownMs > 0 ? baseCooldownMs : 0;
  const safeFailureStreak = Number.isFinite(failureStreak) && failureStreak > 0
    ? Math.floor(failureStreak)
    : 0;
  const failureBackoffMs = getSequentialFailureBackoffMs(safeFailureStreak);
  const baseWithFailureBackoffMs = Math.max(baseMs, failureBackoffMs);

  if (baseWithFailureBackoffMs <= 0 || !heat?.hot) {
    return {
      baseMs,
      cooldownMs: baseWithFailureBackoffMs,
      heatAdjusted: false,
      heatMultiplier: 1,
      failureBackoffMs,
      failureBackoffApplied: failureBackoffMs > baseMs,
      failureStreak: safeFailureStreak,
    };
  }

  const heatMultiplier = Number(Math.min(3, Math.max(1, heat.thresholdPercent / 100)).toFixed(2));
  return {
    baseMs,
    cooldownMs: Math.max(baseWithFailureBackoffMs, Math.ceil(baseWithFailureBackoffMs * heatMultiplier)),
    heatAdjusted: true,
    heatMultiplier,
    failureBackoffMs,
    failureBackoffApplied: failureBackoffMs > baseMs,
    failureStreak: safeFailureStreak,
  };
}

function formatCooldownTokenHeatConsole(
  heat: StokerTokenHeatStatus | null,
  cooldownMs: number,
  baseMs = cooldownMs,
): string | null {
  if (!heat?.hot || cooldownMs <= 0) return null;
  const baseSuffix = baseMs !== cooldownMs ? ` (base ${formatConsoleDuration(baseMs)})` : "";
  return `Token heat ${heat.pressure} ${heat.thresholdPercent}% - cooling for ${formatConsoleDuration(cooldownMs)} before next iteration${baseSuffix}.`;
}

function formatSequentialCooldownWatchConsole(
  iteration: number,
  nextIteration: number,
  cooldownMs: number,
  stopFile: string,
  requestFile: string,
): string {
  return `Cooldown active after iteration ${iteration}: sleeping ${formatConsoleDuration(cooldownMs)} before iteration ${nextIteration}; watching ${stopFile} and ${requestFile}.`;
}

interface SequentialMaintenanceConsoleInput {
  durationMs: number;
  periodicCheckpointSaved: boolean;
  monitorFailed: boolean;
  monitorWarningCount: number;
  monitorCriticalWarningCount: number;
  monitorEmergencyCuratorTriggered: boolean;
  stokerFailed: boolean;
  stokerDue: boolean;
  stokerDirectiveWritten: boolean;
  stokerForIteration?: number;
  stokerUrgency?: string;
  stokerIterationsUntilRun: number | null;
  tokenHeat: IterationConsoleHeat | null;
}

function formatSequentialMaintenanceConsole(data: SequentialMaintenanceConsoleInput): string {
  const checkpoint = data.periodicCheckpointSaved ? "checkpoint saved" : "checkpoint deferred";
  const monitor = data.monitorFailed
    ? "monitor failed"
    : `monitor ${formatConsoleCount(data.monitorWarningCount, "warning")}`;
  const critical = !data.monitorFailed && data.monitorCriticalWarningCount > 0
    ? `, ${formatConsoleCount(data.monitorCriticalWarningCount, "critical warning")}`
    : "";
  const emergency = data.monitorEmergencyCuratorTriggered ? ", emergency Curator ran" : "";

  let stoker = "Stoker idle";
  if (data.stokerFailed) {
    stoker = "Stoker failed";
  } else if (data.stokerDirectiveWritten) {
    const urgency = data.stokerUrgency ? `${data.stokerUrgency} ` : "";
    const target = typeof data.stokerForIteration === "number"
      ? ` for iteration ${data.stokerForIteration}`
      : "";
    stoker = `Stoker wrote ${urgency}directive${target}`;
  } else if (data.stokerDue) {
    stoker = "Stoker ran without directive";
  } else if (typeof data.stokerIterationsUntilRun === "number") {
    stoker = `Stoker idle (${formatConsoleCount(data.stokerIterationsUntilRun, "iteration")} until due)`;
  }

  const heat = data.tokenHeat
    ? `; heat ${data.tokenHeat.pressure} ${data.tokenHeat.thresholdPercent}%`
    : "";
  return `Maintenance: ${formatConsoleDuration(data.durationMs)}; ${checkpoint}; ${monitor}${critical}${emergency}; ${stoker}${heat}.`;
}

function createSequentialHandoffAttention(
  monitorResult: AntiEntropyMonitorResult,
  stokerResult: StokerCheckResult,
): SequentialHandoffAttention {
  const reasons: string[] = [];
  const consoleReasons: string[] = [];

  if (monitorResult.failed) {
    reasons.push("monitor_failed");
    consoleReasons.push("monitor failed");
  }
  if (stokerResult.failed) {
    reasons.push("stoker_failed");
    consoleReasons.push("Stoker failed");
  }
  if (monitorResult.criticalWarningCount > 0) {
    reasons.push("monitor_critical_warning");
    consoleReasons.push(`monitor ${formatConsoleCount(monitorResult.criticalWarningCount, "critical warning")}`);
  }
  if (monitorResult.warningCount > 0) {
    reasons.push("monitor_warning");
    consoleReasons.push(`monitor ${formatConsoleCount(monitorResult.warningCount, "warning")}`);
  }
  if (monitorResult.emergencyCuratorTriggered) {
    reasons.push("emergency_curator");
    consoleReasons.push("emergency Curator ran");
  }

  const health: SequentialHandoffHealth =
    monitorResult.failed || stokerResult.failed || monitorResult.criticalWarningCount > 0
      ? "critical"
      : reasons.length > 0
        ? "warning"
        : "clear";

  return { health, reasons, consoleReasons };
}

interface SequentialNextIterationConsoleInput {
  nextIteration: number;
  cooldownMs: number;
  failureBackoffMs: number;
  tokenHeat: IterationConsoleHeat | null;
  runSummary: Record<string, unknown>;
  stokerDirectiveWritten: boolean;
  stokerForIteration?: number;
  stokerUrgency?: string;
  requestHandoff: SequentialRequestHandoff;
  handoffAttention: SequentialHandoffAttention;
  handoffCheckpointSaved: boolean;
  handoffCheckpointReason: string | null;
  requestCheckpointSaved: boolean;
  requestCheckpointReason: string | null;
  stokerCheckpointSaved: boolean;
  stokerCheckpointReason: string | null;
}

function formatSequentialNextIterationConsole(data: SequentialNextIterationConsoleInput): string {
  const runIterations = typeof data.runSummary.run_iterations === "number"
    ? data.runSummary.run_iterations
    : 0;
  const tokenUsage = data.runSummary.run_token_usage as { total?: unknown } | undefined;
  const runHeat = data.runSummary.run_token_heat as { pressure?: unknown; threshold_percent?: unknown } | undefined;
  const heatPressure = data.tokenHeat?.pressure
    ?? (typeof runHeat?.pressure === "string" ? runHeat.pressure : "cool");
  const heatPercent = data.tokenHeat?.thresholdPercent
    ?? (typeof runHeat?.threshold_percent === "number" ? runHeat.threshold_percent : 0);
  const totalTokens = typeof tokenUsage?.total === "number" ? tokenUsage.total : 0;
  const iterationLabel = runIterations === 1 ? "iteration" : "iterations";
  const backoff = data.failureBackoffMs > 0
    ? `; skipped backoff ${formatConsoleDuration(data.failureBackoffMs)}`
    : "";
  const directive = data.stokerDirectiveWritten
    ? `; Stoker ${data.stokerUrgency ? `${data.stokerUrgency} ` : ""}directive${typeof data.stokerForIteration === "number" ? ` for iteration ${data.stokerForIteration}` : ""}`
    : "";
  const request = data.requestHandoff.request_check_failed
    ? `; request check failed (${data.requestHandoff.request_file})`
    : data.requestHandoff.request_pending
      ? `; redirect queued ${data.requestHandoff.request_file}${data.requestHandoff.request_preview ? `: ${data.requestHandoff.request_preview}` : ""}`
      : "";
  const attention = data.handoffAttention.health === "clear"
    ? ""
    : `; attention ${data.handoffAttention.health} (${data.handoffAttention.consoleReasons.join(", ")})`;
  const checkpointReason = data.handoffCheckpointSaved && data.handoffCheckpointReason
    ? data.handoffCheckpointReason
    : data.requestCheckpointSaved && data.requestCheckpointReason
      ? data.requestCheckpointReason
      : data.stokerCheckpointSaved && data.stokerCheckpointReason
        ? data.stokerCheckpointReason
        : null;
  const checkpoint = checkpointReason ? ` checkpoint saved for ${checkpointReason}.` : "";
  return `Next iteration ${data.nextIteration} ready: cooldown ${formatConsoleDuration(data.cooldownMs)}${backoff}; heat ${heatPressure} ${heatPercent}%; run ${runIterations} ${iterationLabel}, ${totalTokens} tokens${directive}${request}${attention}.${checkpoint}`;
}

function formatTokenHeatLifecycleData(heat: StokerTokenHeatStatus): Record<string, unknown> {
  return {
    window: heat.window,
    threshold: heat.threshold,
    samples: heat.samples,
    average_tokens: heat.averageTokens,
    total_tokens: heat.totalTokens,
    peak_tokens: heat.peakTokens,
    threshold_percent: heat.thresholdPercent,
    remaining_tokens_to_threshold: heat.remainingTokensToThreshold,
    pressure: heat.pressure,
    hot: heat.hot,
  };
}

function formatCooldownTokenHeatLifecycleData(
  heat: StokerTokenHeatStatus | null,
): Record<string, unknown> {
  if (!heat) return {};
  return {
    token_heat_pressure: heat.pressure,
    token_heat_threshold_percent: heat.thresholdPercent,
    token_heat_hot: heat.hot,
    token_heat_samples: heat.samples,
    token_heat_peak_tokens: heat.peakTokens,
  };
}

function formatSequentialCooldownPlanLifecycleData(plan: SequentialCooldownPlan): Record<string, unknown> {
  return {
    cooldown_base_ms: plan.baseMs,
    cooldown_heat_adjusted: plan.heatAdjusted,
    cooldown_heat_multiplier: plan.heatMultiplier,
    cooldown_failure_backoff_ms: plan.failureBackoffMs,
    cooldown_failure_backoff_applied: plan.failureBackoffApplied,
    cooldown_failure_streak: plan.failureStreak,
  };
}

function formatSequentialCooldownRequestPollFailureLifecycleData(
  failure: SequentialCooldownRequestPollFailure | null,
): Record<string, unknown> {
  if (!failure) return {};
  return {
    cooldown_request_poll_failed: true,
    cooldown_request_poll_failure_count: failure.count,
    cooldown_request_poll_failure_detail: failure.detail,
    cooldown_request_poll_failure_first_elapsed_ms: failure.first_elapsed_ms,
    cooldown_request_poll_failure_last_elapsed_ms: failure.last_elapsed_ms,
    cooldown_request_file: failure.request_file,
  };
}

function formatSequentialCooldownStopPollFailureLifecycleData(
  failure: SequentialCooldownStopPollFailure | null,
): Record<string, unknown> {
  if (!failure) return {};
  return {
    cooldown_stop_poll_failed: true,
    cooldown_stop_poll_failure_count: failure.count,
    cooldown_stop_poll_failure_detail: failure.detail,
    cooldown_stop_poll_failure_first_elapsed_ms: failure.first_elapsed_ms,
    cooldown_stop_poll_failure_last_elapsed_ms: failure.last_elapsed_ms,
    cooldown_stop_file: failure.stop_file,
  };
}

function formatRunSummaryConsole(data: Record<string, unknown>): string | null {
  const runIterations = typeof data.run_iterations === "number" ? data.run_iterations : 0;
  if (runIterations <= 0) return null;
  const outcomes = data.run_outcomes as Partial<Record<IterationResult["outcome"], unknown>> | undefined;
  const tokenUsage = data.run_token_usage as { total?: unknown } | undefined;
  const heat = data.run_token_heat as { pressure?: unknown; threshold_percent?: unknown } | undefined;
  const iterationLabel = runIterations === 1 ? "iteration" : "iterations";
  const totalTokens = typeof tokenUsage?.total === "number" ? tokenUsage.total : 0;
  const heatPressure = typeof heat?.pressure === "string" ? heat.pressure : "cool";
  const heatPercent = typeof heat?.threshold_percent === "number" ? heat.threshold_percent : 0;
  const count = (outcome: IterationResult["outcome"]): number => (
    typeof outcomes?.[outcome] === "number" ? outcomes[outcome] : 0
  );
  return `Run summary: ${runIterations} ${iterationLabel}, shipped ${count("shipped")}, killed ${count("killed")}, skipped ${count("skipped")}, halted ${count("halted")}, ${totalTokens} tokens, heat ${heatPressure} ${heatPercent}%.`;
}

function formatIterationConsoleSummary(
  result: IterationResult,
  slot?: number | null,
  heatStatus?: IterationConsoleHeat,
): string {
  const artifact = result.artifact_id ? ` #${result.artifact_id}` : "";
  const title = result.title ? ` — ${result.title}` : "";
  const workerSlot = typeof slot === "number" ? ` [slot ${slot}]` : "";
  const source = result.source === "human_redirect" ? " [human redirect]" : "";
  const reasonPreview = result.reason ? compactSingleLinePreview(result.reason, 96) : "";
  const reason = reasonPreview ? ` [reason: ${reasonPreview}]` : "";
  const metrics = ` [${formatConsoleDuration(result.duration_ms)}, ${result.token_usage.input}in/${result.token_usage.output}out]`;
  const heat = heatStatus ? ` [heat ${heatStatus.pressure} ${heatStatus.thresholdPercent}%]` : "";
  const projectProgress = typeof result.project_completed_iterations === "number"
    && typeof result.project_estimated_iterations === "number"
    ? ` ${result.project_completed_iterations}/${result.project_estimated_iterations}`
    : "";
  const projectMilestone = result.project_milestone_reached ? ", milestone" : "";
  const project = result.project_id
    ? ` [project ${result.project_id}${projectProgress}${projectMilestone}]`
    : "";

  return `  Iteration ${result.iteration}: ${result.outcome}${artifact}${title}${workerSlot}${source}${project}${reason}${metrics}${heat}`;
}

export async function startFoundry(opts?: { rootDir?: string }): Promise<void> {
  if (opts?.rootDir) setRootDir(opts.rootDir);

  // ── Auto-upgrade if CLI is newer than project ────────────
  const { upgradeProject } = await import("./upgrade.js");
  const upgraded = await upgradeProject({ silent: false });
  if (upgraded) console.log();

  const config = await loadConfig();
  const models = await loadModelsConfig();
  try {
    await assertPromptPreflightHealthy();
    await assertDiskPreflightHealthy(config);
  } catch (err) {
    const concurrency = config.loop?.concurrency ?? 1;
    await logFoundryStartLifecycle("foundry_start_failed", {
      mode: concurrency > 1 ? "parallel" : "sequential",
      concurrency,
      providers: activeProviderNames(models),
      reason: "startup preflight",
      detail: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const autoGitCommit = config.git?.auto_commit !== false;
  const autoGitPush = config.git?.auto_push !== false;
  const stopFilePresentAtStartup = await checkStartupStopFile(config);
  const providerValidationSkipped = stopFilePresentAtStartup;
  const startupConcurrency = config.loop?.concurrency ?? 1;

  // ── Provider health check ────────────────────────────────
  const agentEntries = Object.entries(models.agents) as [string, AgentModelConfig][];
  const providers = activeProviderNames(models);
  const providerFallbacks: Array<{
    provider: string;
    fallback_provider: "zai";
    fallback_model: string;
    agents: string[];
  }> = [];

  try {
    if (!stopFilePresentAtStartup) {
      for (const provider of providers) {
        const agentsUsingProvider = agentEntries.filter(([, a]) => (a.provider ?? "zai") === provider);
        if (agentsUsingProvider.length > 0) {
          const valid = await validateProvider(provider, agentsUsingProvider[0][1].model);
          if (!valid) {
            console.warn(`  ⚠ Provider "${provider}" unreachable — falling back to "zai" for affected agents`);
            if (provider !== "zai") {
              providerFallbacks.push({
                provider,
                fallback_provider: "zai",
                fallback_model: models.agents.ideator.model,
                agents: agentsUsingProvider.map(([agent]) => agent),
              });
            }
            for (const [, agent] of agentsUsingProvider) {
              if (provider !== "zai") {
                agent.provider = "zai";
                agent.model = models.agents.ideator.model;
              }
            }
          }
        }
      }
    }
  } catch (err) {
    await logFoundryStartLifecycle("foundry_start_failed", {
      mode: startupConcurrency > 1 ? "parallel" : "sequential",
      concurrency: startupConcurrency,
      providers,
      reason: "provider validation",
      detail: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const concurrencyDisplay = startupConcurrency;
  const activeProviders = activeProviderNames(models);
  console.log(`The Foundry v${config.foundry.version}`);
  console.log(`Mode: ${concurrencyDisplay} parallel iteration${concurrencyDisplay > 1 ? "s" : ""} (${activeProviders.join(" + ")})`);
  if (autoGitCommit) console.log(`Git: auto-commit${autoGitPush ? " + push" : ""} enabled`);
  console.log();

  const modelOverrideAudit = (models.overrides ?? []).map((override) => ({
    agent: override.agent,
    model: override.model,
    start_iteration: override.start_iteration,
    end_iteration: override.end_iteration,
    label: override.label,
  }));
  let modelOverridesApplied = false;

  // Load model tier overrides for A/B testing only when this start can dispatch agents.
  if (!stopFilePresentAtStartup && models.overrides && models.overrides.length > 0) {
    setModelOverrides(models.overrides);
    modelOverridesApplied = true;
    console.log(`Model overrides active: ${models.overrides.map((o) => `${o.agent}→${o.model} (${o.label})`).join(", ")}`);
  }

  // ── Restore or initialize state ──────────────────────────────
  const checkpoint = await loadCheckpoint();
  let stats: StatsTracker;
  let iteration: number;
  let lastCuratorRun: number;
  let stimuliRefreshStates: Map<string, StimuliRefreshState>;
  let lifecycleStateSource: "checkpoint" | "iteration_log";
  let lifecycleCheckpointIteration: number | null = null;
  let lifecycleLastLoggedIteration: number | null = null;
  let startupTokenHeat: StokerTokenHeatStatus | null = null;

  if (checkpoint) {
    iteration = checkpoint.iteration + 1;
    lastCuratorRun = checkpoint.last_curator_run;
    lifecycleStateSource = "checkpoint";
    lifecycleCheckpointIteration = checkpoint.iteration;
    stats = StatsTracker.fromSnapshot(checkpoint.stats);
    if (checkpoint.streak_state) {
      try {
        await saveStreakHistory(checkpoint.streak_state);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ⚠ Streak checkpoint restore failed: ${msg}`);
      }
    }
    try {
      const stimuliConfig = await loadStimuliConfig();
      stimuliRefreshStates = recordToRefreshStates(checkpoint.last_stimuli_refresh, stimuliConfig);
    } catch {
      stimuliRefreshStates = new Map();
    }
    console.log(`Resumed from checkpoint at iteration ${checkpoint.iteration}.`);
    await appendJournal(
      `**Iteration ${iteration}:** Resumed from checkpoint at iteration ${checkpoint.iteration} after interruption.`,
    );
  } else {
    const logSummary = await readIterationStatusLogSummary();
    const lastLogged = logSummary.latestLoggedIteration ?? 0;
    startupTokenHeat = getStokerTokenHeatStatus(logSummary.stokerEntries, config.stoker);
    iteration = lastLogged + 1;
    lastCuratorRun = 0;
    lifecycleStateSource = "iteration_log";
    lifecycleLastLoggedIteration = lastLogged;
    stats = StatsTracker.fromSnapshot({
      iteration: lastLogged,
      shipped: logSummary.shipped,
      killed: logSummary.killed,
      skipped: logSummary.skipped,
      domain_counts: logSummary.domainCounts,
      recent_outcomes: logSummary.recentOutcomes,
      critic_rejection_window: logSummary.criticWindow,
      total_tokens: logSummary.totalTokens,
    });
    try {
      const stimuliConfig = await loadStimuliConfig();
      stimuliRefreshStates = initRefreshStates(stimuliConfig);
    } catch {
      stimuliRefreshStates = new Map();
    }
    console.log(`Fresh start — no checkpoint found. Continuing from iteration ${iteration} (per log).`);
    const startupHeatConsole = formatStartupTokenHeatConsole(startupTokenHeat);
    if (startupHeatConsole) console.log(startupHeatConsole);
  }

  // Graceful shutdown on signals
  let shutdownRequested = false;
  let shutdownSignal: "SIGINT" | "SIGTERM" | null = null;
  const formatSignalReason = (): string => shutdownSignal ? `signal (${shutdownSignal})` : "signal";
  const createSignalHandler = (signal: "SIGINT" | "SIGTERM") => () => {
    if (shutdownRequested) {
      console.log("\nForce shutdown.");
      process.exit(1);
    }
    shutdownRequested = true;
    shutdownSignal = signal;
    console.log("\nShutdown requested — will stop after current iteration...");
  };
  const onSigint = createSignalHandler("SIGINT");
  const onSigterm = createSignalHandler("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  // ── Main loop ────────────────────────────────────────────────
  const concurrency = config.loop?.concurrency ?? 1;
  const lifecycleMode: StartLifecycleMode = concurrency > 1 ? "parallel" : "sequential";
  const lifecycleStartIteration = iteration;
  const requestStartupAudit = await readRequestStartupAudit(config);
  if (requestStartupAudit.request_pending_at_startup) {
    const preview = requestStartupAudit.request_preview_at_startup
      ? ` - ${requestStartupAudit.request_preview_at_startup}`
      : "";
    console.log(`Human redirect queued: ${requestStartupAudit.request_file}${preview}`);
  }
  await logFoundryStartLifecycle("foundry_start", {
    mode: lifecycleMode,
    concurrency,
    start_iteration: lifecycleStartIteration,
    ...requestStartupAudit,
    state_source: lifecycleStateSource,
    ...(lifecycleCheckpointIteration !== null ? { checkpoint_iteration: lifecycleCheckpointIteration } : {}),
    ...(lifecycleLastLoggedIteration !== null ? { last_logged_iteration: lifecycleLastLoggedIteration } : {}),
    model_override_count: modelOverrideAudit.length,
    model_overrides_applied: modelOverridesApplied,
    ...(modelOverrideAudit.length > 0 ? { model_overrides: modelOverrideAudit } : {}),
    provider_validation_skipped: providerValidationSkipped,
    ...(providerValidationSkipped ? { provider_validation_skipped_reason: "STOP file present at startup" } : {}),
    git_auto_commit: autoGitCommit,
    git_auto_push: autoGitCommit && autoGitPush,
    provider_fallback_count: providerFallbacks.length,
    ...(providerFallbacks.length > 0 ? { provider_fallbacks: providerFallbacks } : {}),
    providers: activeProviders,
    ...(startupTokenHeat ? { startup_token_heat: formatTokenHeatLifecycleData(startupTokenHeat) } : {}),
  });

  let lifecycleStopLogged = false;
  const lifecycleStartedAtMs = Date.now();
  let lifecycleLastCompletedIteration = lifecycleStartIteration - 1;
  let lifecycleNextIteration = lifecycleStartIteration;
  const runtimeTokenHeatEntries: StokerIterationEntry[] = [];
  const createRuntimeRunSummary = (): Record<string, unknown> => {
    const runOutcomes: Record<IterationResult["outcome"], number> = {
      shipped: 0,
      killed: 0,
      skipped: 0,
      halted: 0,
    };
    let inputTokens = 0;
    let outputTokens = 0;
    for (const entry of runtimeTokenHeatEntries) {
      runOutcomes[entry.outcome]++;
      inputTokens += entry.token_usage?.input ?? 0;
      outputTokens += entry.token_usage?.output ?? 0;
    }
    const heat = getStokerTokenHeatStatus(
      [...runtimeTokenHeatEntries].sort((a, b) => a.iteration - b.iteration),
      config.stoker,
    );
    return {
      run_iterations: runtimeTokenHeatEntries.length,
      run_outcomes: runOutcomes,
      run_token_usage: {
        input: inputTokens,
        output: outputTokens,
        total: inputTokens + outputTokens,
      },
      run_token_heat: formatTokenHeatLifecycleData(heat),
    };
  };
  const mergeRuntimeStokerEntries = (entries: StokerIterationEntry[]): StokerIterationEntry[] => {
    const byIteration = new Map<number, StokerIterationEntry>();
    for (const entry of entries) byIteration.set(entry.iteration, entry);
    for (const entry of runtimeTokenHeatEntries) {
      byIteration.set(entry.iteration, {
        ...(byIteration.get(entry.iteration) ?? {}),
        ...entry,
      });
    }
    return [...byIteration.values()].sort((a, b) => a.iteration - b.iteration);
  };
  const logFoundryStopLifecycle = async (data: Record<string, unknown>): Promise<void> => {
    const stopData: Record<string, unknown> = {
      ...data,
      ...createRuntimeRunSummary(),
      duration_ms: Math.max(0, Date.now() - lifecycleStartedAtMs),
    };
    if (
      typeof stopData.start_iteration === "number"
      && typeof stopData.last_completed_iteration === "number"
    ) {
      stopData.iterations_completed = Math.max(
        0,
        stopData.last_completed_iteration - stopData.start_iteration + 1,
      );
    }
    await logFoundryStartLifecycle("foundry_stop", stopData);
    lifecycleStopLogged = true;
    if (typeof stopData.last_completed_iteration === "number") {
      lifecycleLastCompletedIteration = stopData.last_completed_iteration;
    }
    if (typeof stopData.next_iteration === "number") {
      lifecycleNextIteration = stopData.next_iteration;
    }
    const runSummaryConsole = formatRunSummaryConsole(stopData);
    if (runSummaryConsole) console.log(runSummaryConsole);
  };
  const saveLifecycleState = async (
    checkpointIteration: number,
    reason: string,
  ): Promise<void> => {
    try {
      await saveState(config, checkpointIteration, lastCuratorRun, stats, stimuliRefreshStates);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await logFoundryStartLifecycle("foundry_checkpoint_failed", {
          mode: lifecycleMode,
          concurrency,
          start_iteration: lifecycleStartIteration,
          checkpoint_iteration: checkpointIteration,
          last_curator_run: lastCuratorRun,
          reason,
          detail: msg,
        });
      } catch (logErr) {
        console.warn(
          "  ⚠ Checkpoint failure lifecycle event failed:",
          logErr instanceof Error ? logErr.message : String(logErr),
        );
      }
      throw err;
    }
    await logFoundryStartLifecycle("foundry_checkpoint_saved", {
      mode: lifecycleMode,
      concurrency,
      start_iteration: lifecycleStartIteration,
      checkpoint_iteration: checkpointIteration,
      last_curator_run: lastCuratorRun,
      reason,
      ...createRuntimeRunSummary(),
    });
  };
  const logFoundryIterationComplete = async (
    result: IterationResult,
    slot: number | null,
  ): Promise<void> => {
    await logFoundryStartLifecycle("foundry_iteration_complete", {
      mode: lifecycleMode,
      concurrency,
      start_iteration: lifecycleStartIteration,
      iteration: result.iteration,
      slot,
      outcome: result.outcome,
      duration_ms: result.duration_ms,
      token_usage: result.token_usage,
      ...(result.title ? { title: result.title } : {}),
      ...(result.domain ? { domain: result.domain } : {}),
      ...(result.source ? { source: result.source } : {}),
      ...(result.artifact_id ? { artifact_id: result.artifact_id } : {}),
      ...(result.project_id !== undefined ? { project_id: result.project_id } : {}),
      ...(result.project_completed_iterations !== undefined ? { project_completed_iterations: result.project_completed_iterations } : {}),
      ...(result.project_estimated_iterations !== undefined ? { project_estimated_iterations: result.project_estimated_iterations } : {}),
      ...(result.project_milestone_reached !== undefined ? { project_milestone_reached: result.project_milestone_reached } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.mean_rating ? { mean_rating: result.mean_rating } : {}),
    });
  };
  const logTokenHeatSnapshot = async (
    result: IterationResult,
    slot: number | null,
  ): Promise<StokerTokenHeatStatus> => {
    runtimeTokenHeatEntries.push({
      iteration: result.iteration,
      outcome: result.outcome,
      ...(result.domain ? { domain: result.domain } : {}),
      ...(result.mean_rating ? { mean_rating: result.mean_rating } : {}),
      token_usage: result.token_usage,
      duration_ms: result.duration_ms,
    });
    const heat = getStokerTokenHeatStatus(
      [...runtimeTokenHeatEntries].sort((a, b) => a.iteration - b.iteration),
      config.stoker,
    );
    await logFoundryStartLifecycle("foundry_token_heat_snapshot", {
      mode: lifecycleMode,
      concurrency,
      start_iteration: lifecycleStartIteration,
      iteration: result.iteration,
      slot,
      scope: "current_run",
      iteration_tokens: result.token_usage.input + result.token_usage.output,
      ...formatTokenHeatLifecycleData(heat),
    });
    return heat;
  };
  const runAutoCommitAndLog = async (input: {
    iteration: number;
    outcome: string;
    artifactId: string | null;
    title: string;
    domain: string;
    rating: number | null;
  }): Promise<void> => {
    const gitLifecycleData = {
      mode: lifecycleMode,
      concurrency,
      start_iteration: lifecycleStartIteration,
      iteration: input.iteration,
      outcome: input.outcome,
      artifact_id: input.artifactId,
      title: input.title,
      domain: input.domain,
      auto_push: autoGitPush,
    };
    await logFoundryStartLifecycle("foundry_git_commit_start", gitLifecycleData);
    const gitResult = autoCommitAndPush(
      input.iteration,
      input.outcome,
      input.artifactId,
      input.title,
      input.domain,
      input.rating,
      autoGitPush,
    );
    await logFoundryStartLifecycle(
      gitResult.status === "committed" ? "foundry_git_commit_complete" : "foundry_git_commit_failed",
      {
        ...gitLifecycleData,
        commit_message: gitResult.commit_message,
        pushed: gitResult.pushed,
        duration_ms: gitResult.duration_ms,
        ...(gitResult.detail ? { detail: gitResult.detail } : {}),
      },
    );
    if (gitResult.status === "failed") {
      const artifactContext = input.artifactId
        ? `${input.outcome} artifact ${input.artifactId}`
        : `${input.outcome} iteration`;
      const titleContext = input.title ? ` "${input.title}"` : "";
      try {
        await appendJournal(
          `**Iteration ${input.iteration}:** Git auto-commit failed after ${artifactContext}${titleContext}: ${gitResult.detail ?? "unknown error"}`,
        );
      } catch (err) {
        console.warn(
          "  ⚠ Git auto-commit failure journal write failed:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  };
  const curatorTriggerLifecycleData = (
    trigger: CuratorCycleTrigger,
    result?: IterationResult | null,
  ): Record<string, unknown> => {
    if (trigger === "quality_escalation" && result) {
      const escalation = getSequentialQualityEscalation(result, config);
      return {
        trigger,
        ...(escalation ? {
          mean_rating: Number(escalation.rating.toFixed(1)),
          quality_threshold: Number(escalation.threshold.toFixed(1)),
        } : {}),
        ...(result.title ? { title: result.title } : {}),
        ...(result.domain ? { domain: result.domain } : {}),
        ...(result.source ? { source: result.source } : {}),
      };
    }
    if (trigger === "failure_escalation" && result) {
      const escalation = getSequentialFailureEscalation(result);
      return {
        trigger,
        outcome: result.outcome,
        ...(result.title ? { title: result.title } : {}),
        ...(result.domain ? { domain: result.domain } : {}),
        ...(result.source ? { source: result.source } : {}),
        ...(escalation?.reason ? { reason: escalation.reason } : {}),
      };
    }
    if (trigger === "success_amplification" && result) {
      const amplification = getSequentialSuccessAmplification(result, config);
      return {
        trigger,
        ...(amplification ? {
          mean_rating: Number(amplification.rating.toFixed(1)),
          success_threshold: Number(amplification.threshold.toFixed(1)),
        } : {}),
        ...(result.title ? { title: result.title } : {}),
        ...(result.domain ? { domain: result.domain } : {}),
        ...(result.source ? { source: result.source } : {}),
      };
    }
    if (trigger === "underburn_escalation" && result) {
      const underburn = getSequentialTokenUnderburn(result, config);
      return {
        trigger,
        ...(result.title ? { title: result.title } : {}),
        ...(result.domain ? { domain: result.domain } : {}),
        ...(result.source ? { source: result.source } : {}),
        ...(underburn ? {
          complexity: underburn.complexity,
          spent_tokens: underburn.spentTokens,
          target_tokens: underburn.targetTokens,
          budget_warning_threshold: underburn.budgetWarningThreshold,
        } : {}),
      };
    }
    if (trigger !== "project_milestone" || !result) {
      return { trigger };
    }

    return {
      trigger,
      ...(result.project_id !== undefined ? { project_id: result.project_id } : {}),
      ...(result.project_completed_iterations !== undefined ? { project_completed_iterations: result.project_completed_iterations } : {}),
      ...(result.project_estimated_iterations !== undefined ? { project_estimated_iterations: result.project_estimated_iterations } : {}),
      ...(result.title ? { title: result.title } : {}),
      ...(result.domain ? { domain: result.domain } : {}),
    };
  };
  const runCuratorFullCycle = async (
    curatorIteration: number,
    trigger: CuratorCycleTrigger,
    result?: IterationResult | null,
  ): Promise<void> => {
    const triggerData = curatorTriggerLifecycleData(trigger, result);
    const triggerLabel = trigger === "project_milestone"
      ? " — project milestone"
      : trigger === "quality_escalation"
        ? " — quality escalation"
        : trigger === "failure_escalation"
          ? " — failure escalation"
          : trigger === "success_amplification"
            ? " — success amplification"
            : trigger === "underburn_escalation"
              ? " — token underburn"
              : "";
    console.log(`\n▶ Curator full cycle (iteration ${curatorIteration})${triggerLabel}`);
    const previousLastCuratorRun = lastCuratorRun;
    const curatorStartedAtMs = Date.now();
    await logFoundryStartLifecycle("foundry_curator_cycle_start", {
      mode: lifecycleMode,
      concurrency,
      start_iteration: lifecycleStartIteration,
      iteration: curatorIteration,
      previous_last_curator_run: previousLastCuratorRun,
      ...triggerData,
    });
    try {
      const escalation = trigger === "quality_escalation" && result
        ? getSequentialQualityEscalation(result, config)
        : null;
      if (escalation && result) {
        await appendQualityEscalationJournalNote(curatorIteration, result, escalation);
      }
      const failureEscalation = trigger === "failure_escalation" && result
        ? getSequentialFailureEscalation(result)
        : null;
      if (failureEscalation && result) {
        await appendFailureEscalationJournalNote(curatorIteration, result, failureEscalation);
      }
      const successAmplification = trigger === "success_amplification" && result
        ? getSequentialSuccessAmplification(result, config)
        : null;
      if (successAmplification && result) {
        await appendSuccessAmplificationJournalNote(curatorIteration, result, successAmplification);
      }
      const tokenUnderburn = trigger === "underburn_escalation" && result
        ? getSequentialTokenUnderburn(result, config)
        : null;
      if (tokenUnderburn && result) {
        await appendTokenUnderburnJournalNote(curatorIteration, result, tokenUnderburn);
      }
      const curatorResponse = await dispatchCuratorFull(config, models, curatorIteration, stats, stimuliRefreshStates);
      await applyCuratorCycle(curatorResponse, curatorIteration, stimuliRefreshStates);
      lastCuratorRun = curatorIteration;
      stats.recordTokens(0, 0); // token usage already logged inside dispatch
      await saveLifecycleState(
        curatorIteration,
        trigger === "project_milestone"
          ? "project milestone curator"
          : trigger === "quality_escalation"
            ? "quality escalation curator"
            : trigger === "failure_escalation"
              ? "failure escalation curator"
              : trigger === "success_amplification"
                ? "success amplification curator"
                : trigger === "underburn_escalation"
                  ? "underburn escalation curator"
                  : "curator",
      );
      await logFoundryStartLifecycle("foundry_curator_cycle_complete", {
        mode: lifecycleMode,
        concurrency,
        start_iteration: lifecycleStartIteration,
        iteration: curatorIteration,
        previous_last_curator_run: previousLastCuratorRun,
        last_curator_run: lastCuratorRun,
        duration_ms: Math.max(0, Date.now() - curatorStartedAtMs),
        ...triggerData,
      });
      console.log("  Curator cycle complete.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Curator cycle failed (non-fatal): ${msg}`);
      await appendJournal(`**Iteration ${curatorIteration}:** Curator cycle failed: ${msg}`);
      await logFoundryStartLifecycle("foundry_curator_cycle_failed", {
        mode: lifecycleMode,
        concurrency,
        start_iteration: lifecycleStartIteration,
        iteration: curatorIteration,
        previous_last_curator_run: previousLastCuratorRun,
        detail: msg,
        duration_ms: Math.max(0, Date.now() - curatorStartedAtMs),
        ...triggerData,
      });
    }
  };
  const waitForSequentialCooldown = async (cooldownMs: number): Promise<SequentialCooldownResult> => {
    const startedAtMs = Date.now();
    let remainingMs = Math.max(0, cooldownMs);
    let stopPollFailure: SequentialCooldownStopPollFailure | null = null;
    let requestPollFailure: SequentialCooldownRequestPollFailure | null = null;
    while (remainingMs > 0) {
      if (shutdownRequested) return { wake: { reason: "signal" }, stopPollFailure, requestPollFailure };
      const sliceMs = Math.min(SEQUENTIAL_COOLDOWN_POLL_MS, remainingMs);
      await sleep(sliceMs);
      remainingMs -= sliceMs;
      if (shutdownRequested) return { wake: { reason: "signal" }, stopPollFailure, requestPollFailure };
      try {
        if (await checkStopFile(config)) return { wake: { reason: "STOP file" }, stopPollFailure, requestPollFailure };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const elapsedMs = Math.max(0, Date.now() - startedAtMs);
        if (stopPollFailure) {
          stopPollFailure = {
            stop_file: stopPollFailure.stop_file,
            count: stopPollFailure.count + 1,
            detail,
            first_elapsed_ms: stopPollFailure.first_elapsed_ms,
            last_elapsed_ms: elapsedMs,
          };
        } else {
          stopPollFailure = {
            stop_file: config.intervention.stop_file,
            count: 1,
            detail,
            first_elapsed_ms: elapsedMs,
            last_elapsed_ms: elapsedMs,
          };
          console.warn(`  ⚠ Cooldown STOP poll failed (${config.intervention.stop_file}): ${detail}`);
        }
      }
      try {
        const request = await readRequests(config);
        if (request) {
          return {
            wake: {
              reason: "request file",
              request_file: config.intervention.requests_file,
              request_preview: compactSingleLinePreview(request),
            },
            stopPollFailure,
            requestPollFailure,
          };
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const elapsedMs = Math.max(0, Date.now() - startedAtMs);
        if (requestPollFailure) {
          requestPollFailure = {
            request_file: requestPollFailure.request_file,
            count: requestPollFailure.count + 1,
            detail,
            first_elapsed_ms: requestPollFailure.first_elapsed_ms,
            last_elapsed_ms: elapsedMs,
          };
        } else {
          requestPollFailure = {
            request_file: config.intervention.requests_file,
            count: 1,
            detail,
            first_elapsed_ms: elapsedMs,
            last_elapsed_ms: elapsedMs,
          };
          console.warn(`  ⚠ Cooldown request poll failed (${config.intervention.requests_file}): ${detail}`);
        }
      }
    }
    return { wake: null, stopPollFailure, requestPollFailure };
  };

  if (
    lifecycleMode === "sequential"
    && !stopFilePresentAtStartup
    && requestStartupAudit.request_pending_at_startup
  ) {
    try {
      const iterEntries = await readJsonlEntries<StokerIterationEntry>(
        resolve("logs", "iterations.jsonl"),
      );
      await runStokerIfDue(config, iteration - 1, mergeRuntimeStokerEntries(iterEntries), {
        mode: lifecycleMode,
        concurrency,
        startIteration: lifecycleStartIteration,
      }, {
        forceReason: "human_redirect",
        forceContext: {
          request_file: requestStartupAudit.request_file,
          ...(requestStartupAudit.request_preview_at_startup
            ? { request_preview: requestStartupAudit.request_preview_at_startup }
            : {}),
        },
        ...(startupTokenHeat ? { tokenHeat: startupTokenHeat } : {}),
      });
    } catch (err) {
      // Startup stoking is non-fatal; runIteration will still consume the request directly.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  ⚠ Startup request Stoker preflight failed: ${msg}`);
    }
  }

  if (
    lifecycleMode === "sequential"
    && !stopFilePresentAtStartup
    && !requestStartupAudit.request_pending_at_startup
  ) {
    const startupPrime = getStartupTokenPrime(startupTokenHeat);
    if (startupPrime) {
      try {
        const currentDirective = await loadStokerDirective();
        if (!isStokerDirectiveCurrent(currentDirective, iteration)) {
          const iterEntries = await readJsonlEntries<StokerIterationEntry>(
            resolve("logs", "iterations.jsonl"),
          );
          await appendStartupTokenPrimeJournalNote(iteration, startupPrime);
          console.log(
            `Startup token prime: ${startupPrime.averageTokens}-token average below ${startupPrime.targetTokens}; queuing Stoker directive for iteration ${iteration}.`,
          );
          await runStokerIfDue(config, iteration - 1, mergeRuntimeStokerEntries(iterEntries), {
            mode: lifecycleMode,
            concurrency,
            startIteration: lifecycleStartIteration,
          }, {
            forceReason: "startup_underburn",
            forceContext: {
              spent_tokens: startupPrime.averageTokens,
              target_tokens: startupPrime.targetTokens,
              reason: `Persisted startup token average is ${startupPrime.averageTokens} below the ${startupPrime.targetTokens}-token cold-start floor.`,
            },
            ...(startupTokenHeat ? { tokenHeat: startupTokenHeat } : {}),
          });
        }
      } catch (err) {
        // Startup priming is non-fatal; the loop can still run normally.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`  ⚠ Startup token prime Stoker preflight failed: ${msg}`);
      }
    }
  }

  try {
  if (concurrency > 1) {
    // ── Parallel mode using IterationPool ────────────────────
    const { IterationPool, FoundryEventBus, ConsoleRenderer, Mutex } = await import("./pool/index.js");
    const bus = new FoundryEventBus();
    const renderer = new ConsoleRenderer();
    renderer.attach(bus);

    const pool = new IterationPool(concurrency, iteration, bus);
    const stimuliRefreshMutex = new Mutex();
    let diskHaltMessage: string | null = null;
    let parallelHaltReason: "signal" | "STOP file" | null = null;
    const parallelIterationHalt: { current: ParallelIterationHalt | null } = { current: null };

    // Override signal handler for pool mode
    const createPoolSignalHandler = (signal: "SIGINT" | "SIGTERM") => () => {
      if (shutdownRequested) { console.log("\nForce shutdown."); process.exit(1); }
      shutdownRequested = true;
      shutdownSignal = signal;
      parallelHaltReason = "signal";
      pool.requestShutdown();
      console.log("\nShutdown requested — draining in-flight iterations...");
    };
    const onSigintPool = createPoolSignalHandler("SIGINT");
    const onSigtermPool = createPoolSignalHandler("SIGTERM");
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    process.on("SIGINT", onSigintPool);
    process.on("SIGTERM", onSigtermPool);

    try {
      console.log(`Mode: ${concurrency} parallel iterations`);
      let parallelRequestGuardActive = false;
      let parallelRequestGuardStartedAtMs: number | null = null;

      const lastIteration = await pool.run(config, models, {
        maxConcurrentIterations: async () => {
          const request = await readRequests(config);
          if (!request) {
            if (parallelRequestGuardActive) {
              await logFoundryStartLifecycle("foundry_parallel_request_guard_released", {
                mode: lifecycleMode,
                concurrency,
                start_iteration: lifecycleStartIteration,
                configured_concurrency: concurrency,
                restored_concurrency: concurrency,
                request_file: config.intervention.requests_file,
                elapsed_ms: parallelRequestGuardStartedAtMs === null
                  ? 0
                  : Math.max(0, Date.now() - parallelRequestGuardStartedAtMs),
              });
            }
            parallelRequestGuardActive = false;
            parallelRequestGuardStartedAtMs = null;
            return concurrency;
          }

          if (!parallelRequestGuardActive) {
            parallelRequestGuardActive = true;
            parallelRequestGuardStartedAtMs = Date.now();
            await logFoundryStartLifecycle("foundry_parallel_request_guard", {
              mode: lifecycleMode,
              concurrency,
              start_iteration: lifecycleStartIteration,
              configured_concurrency: concurrency,
              active_limit: 1,
              request_file: config.intervention.requests_file,
              request_preview: compactSingleLinePreview(request),
            });
          }
          return 1;
        },
        runIteration: async (cfg, mdls, iter, slot) => {
          await logFoundryStartLifecycle("foundry_iteration_start", {
            mode: lifecycleMode,
            concurrency,
            start_iteration: lifecycleStartIteration,
            iteration: iter,
            slot,
          });
          const releaseStimuliRefresh = await stimuliRefreshMutex.acquire();
          try {
            stimuliRefreshStates = await refreshStimuliForIteration(cfg, iter, stimuliRefreshStates, {
              mode: lifecycleMode,
              concurrency,
              startIteration: lifecycleStartIteration,
            });
          } finally {
            releaseStimuliRefresh();
          }
          stats.setIteration(iter);
          return runIteration(cfg, mdls, iter, slot, {
            lifecycle: {
              mode: lifecycleMode,
              concurrency,
              startIteration: lifecycleStartIteration,
            },
          });
        },
        onIterationComplete: async (result, slot) => {
          // Record stats
          if (result.outcome === "shipped" || result.outcome === "killed" || result.outcome === "skipped") {
            stats.recordOutcome(result.iteration, result.outcome, result.domain, result.source);
            recordCriticArtifactDecision(stats, result.iteration, result.outcome);
          }
          stats.recordTokens(result.token_usage.input, result.token_usage.output);
          lifecycleLastCompletedIteration = Math.max(lifecycleLastCompletedIteration, result.iteration);
          lifecycleNextIteration = lifecycleLastCompletedIteration + 1;
          await logFoundryIterationComplete(result, slot);
          const heatStatus = await logTokenHeatSnapshot(result, slot);

          if (result.outcome === "halted" && !parallelIterationHalt.current) {
            parallelIterationHalt.current = {
              iteration: result.iteration,
              ...(result.reason ? { reason: result.reason } : {}),
            };
            pool.requestShutdown();
          }

          if (isWorkerPoolFailureResult(result)) {
            await logSkippedIterationFailureEntry(
              result.iteration,
              result.reason ?? "Iteration failed in worker pool",
              result.duration_ms,
            );
          }

          console.log(`\n${"━".repeat(60)}`);
          console.log(formatIterationConsoleSummary(result, slot, heatStatus));
          console.log(`${"━".repeat(60)}\n`);

          if (result.outcome === "halted") return;

          // Git commit (serialized via mutex)
          if (autoGitCommit && (result.outcome === "shipped" || result.outcome === "killed")) {
            const release = await pool.gitLock.acquire();
            try {
              const meanRating = result.ratings ? meanCriticRating(result.ratings) : null;
              await runAutoCommitAndLog({
                iteration: result.iteration,
                outcome: result.outcome,
                artifactId: result.artifact_id ?? null,
                title: result.title ?? "untitled",
                domain: result.domain ?? "unknown",
                rating: meanRating,
              });
            } finally {
              release();
            }
          }

          // Checkpoint periodically
          if (result.iteration % config.recovery.checkpoint_every === 0) {
            await saveLifecycleState(result.iteration, "periodic");
          }

          await runAntiEntropyMonitor(config, models, result.iteration, stats, stimuliRefreshStates, {
            mode: lifecycleMode,
            concurrency,
            startIteration: lifecycleStartIteration,
            runEmergencyCurator: false,
          });

          try {
            const iterEntries = await readJsonlEntries<StokerIterationEntry>(
              resolve("logs", "iterations.jsonl"),
            );
            await runStokerIfDue(config, result.iteration, mergeRuntimeStokerEntries(iterEntries), {
              mode: lifecycleMode,
              concurrency,
              startIteration: lifecycleStartIteration,
            }, {
              ...(heatStatus.hot ? { forceReason: "token_heat" } : {}),
              tokenHeat: heatStatus,
            });
          } catch {
            // stoker is non-fatal
          }
        },
        shouldStop: async () => {
          if (stopFilePresentAtStartup) {
            parallelHaltReason = "STOP file";
            return true;
          }
          if (shutdownRequested) {
            parallelHaltReason = "signal";
            return true;
          }
          if (await checkStopFile(config)) {
            parallelHaltReason = "STOP file";
            return true;
          }
          try {
            await assertDiskPreflightHealthy(config);
            return false;
          } catch (err) {
            diskHaltMessage = err instanceof Error ? err.message : String(err);
            console.error(`\n${diskHaltMessage} — draining parallel workers before halt.`);
            return true;
          }
        },
        shouldRunCurator: (iter, result) => Boolean(result.project_milestone_reached) || shouldRunCurator(iter, lastCuratorRun, config),
        runCurator: async (iter, result) => {
          const trigger: CuratorCycleTrigger = result.project_milestone_reached ? "project_milestone" : "scheduled";
          await runCuratorFullCycle(iter, trigger, result);
        },
      });

      iteration = lastIteration + 1;
      const haltedResult = parallelIterationHalt.current;
      await saveLifecycleState(lastIteration, haltedResult ? "iteration halted" : "final");
      if (diskHaltMessage) {
        await appendJournal(`**System:** Halted by disk preflight after parallel iteration ${lastIteration}: ${diskHaltMessage}`);
        await logFoundryStopLifecycle({
          mode: lifecycleMode,
          concurrency,
          reason: "disk preflight",
          detail: diskHaltMessage,
          start_iteration: lifecycleStartIteration,
          last_completed_iteration: lastIteration,
          next_iteration: iteration,
        });
      } else if (haltedResult) {
        const detailSuffix = haltedResult.reason ? `: ${haltedResult.reason}` : ".";
        await appendJournal(
          `**System:** Halted by iteration result from iteration ${haltedResult.iteration} after parallel iteration ${lastIteration}${detailSuffix}`,
        );
        await logFoundryStopLifecycle({
          mode: lifecycleMode,
          concurrency,
          reason: "iteration halted",
          ...(haltedResult.reason ? { detail: haltedResult.reason } : {}),
          halted_iteration: haltedResult.iteration,
          start_iteration: lifecycleStartIteration,
          last_completed_iteration: lastIteration,
          next_iteration: iteration,
        });
      } else if (parallelHaltReason) {
        const signalSuffix = parallelHaltReason === "signal" && shutdownSignal ? ` (${shutdownSignal})` : "";
        const stopFileAudit = parallelHaltReason === "STOP file" ? await readStopFileAudit(config) : null;
        const consoleSuffix = parallelHaltReason === "STOP file"
          ? formatStopFileConsoleSuffix(stopFileAudit)
          : signalSuffix;
        console.log(`\n${parallelHaltReason === "signal" ? "Signal" : "STOP file"} detected${consoleSuffix} — halting after draining parallel workers.`);
        const stopFileSuffix = stopFileAudit ? formatStopFileJournalSuffix(stopFileAudit) : "";
        await appendJournal(`**System:** Halted by ${parallelHaltReason} after parallel iteration ${lastIteration}${signalSuffix}.${stopFileSuffix}`);
        await logFoundryStopLifecycle({
          mode: lifecycleMode,
          concurrency,
          reason: parallelHaltReason,
          ...(parallelHaltReason === "signal" && shutdownSignal ? { signal: shutdownSignal } : {}),
          ...(stopFilePresentAtStartup && parallelHaltReason === "STOP file" ? { stop_file_present_at_startup: true } : {}),
          ...(stopFileAudit ?? {}),
          start_iteration: lifecycleStartIteration,
          last_completed_iteration: lastIteration,
          next_iteration: iteration,
        });
      }
    } finally {
      renderer.detach();
      process.removeListener("SIGINT", onSigintPool);
      process.removeListener("SIGTERM", onSigtermPool);
    }
  } else {
  // ── Sequential mode (original loop) ─────────────────────────
  let sequentialConsecutiveFailures = 0;
  while (true) {
    // Check STOP file or shutdown signal
    if (shutdownRequested || stopFilePresentAtStartup || await checkStopFile(config)) {
      const reason = shutdownRequested ? "signal" : "STOP file";
      const stopFileAudit = reason === "STOP file" ? await readStopFileAudit(config) : null;
      const consoleSuffix = reason === "STOP file"
        ? formatStopFileConsoleSuffix(stopFileAudit)
        : formatSignalConsoleSuffix(shutdownSignal);
      console.log(`\n${shutdownRequested ? "Signal" : "STOP file"} detected${consoleSuffix} — halting after saving checkpoint.`);
      await saveLifecycleState(iteration - 1, "halt");
      const stopFileSuffix = stopFileAudit ? formatStopFileJournalSuffix(stopFileAudit) : "";
      await appendJournal(`**System:** Halted by ${reason === "signal" ? formatSignalReason() : reason} at iteration ${iteration}.${stopFileSuffix}`);
      await logFoundryStopLifecycle({
        mode: lifecycleMode,
        concurrency,
        reason,
        ...(reason === "signal" && shutdownSignal ? { signal: shutdownSignal } : {}),
        ...(stopFilePresentAtStartup && reason === "STOP file" ? { stop_file_present_at_startup: true } : {}),
        ...(stopFileAudit ?? {}),
        start_iteration: lifecycleStartIteration,
        last_completed_iteration: iteration - 1,
        next_iteration: iteration,
      });
      break;
    }

    try {
      await assertDiskPreflightHealthy(config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n${msg} — halting after saving checkpoint.`);
      await saveLifecycleState(iteration - 1, "disk preflight");
      await appendJournal(`**System:** Halted by disk preflight at iteration ${iteration}: ${msg}`);
      await logFoundryStopLifecycle({
        mode: lifecycleMode,
        concurrency,
        reason: "disk preflight",
        detail: msg,
        start_iteration: lifecycleStartIteration,
        last_completed_iteration: iteration - 1,
        next_iteration: iteration,
      });
      break;
    }

    // ── Stimuli refresh (if enabled) ───────────────────────────
    stimuliRefreshStates = await refreshStimuliForIteration(config, iteration, stimuliRefreshStates, {
      mode: lifecycleMode,
      concurrency,
      startIteration: lifecycleStartIteration,
    });

    // ── Run iteration ──────────────────────────────────────────
    stats.setIteration(iteration);
    const iterationStartMs = Date.now();
    let iterationResult: IterationResult | null = null;
    let iterationHeatStatus: StokerTokenHeatStatus | null = null;

    try {
      await logFoundryStartLifecycle("foundry_iteration_start", {
        mode: lifecycleMode,
        concurrency,
        start_iteration: lifecycleStartIteration,
        iteration,
        slot: null,
      });
      const result = await runIteration(config, models, iteration, undefined, {
        lifecycle: {
          mode: lifecycleMode,
          concurrency,
          startIteration: lifecycleStartIteration,
        },
      });
      iterationResult = result;

      // Record stats
      if (result.outcome === "shipped" || result.outcome === "killed" || result.outcome === "skipped") {
        stats.recordOutcome(iteration, result.outcome, result.domain, result.source);
        recordCriticArtifactDecision(stats, iteration, result.outcome);
      }
      stats.recordTokens(result.token_usage.input, result.token_usage.output);
      lifecycleLastCompletedIteration = Math.max(lifecycleLastCompletedIteration, iteration);
      lifecycleNextIteration = iteration + 1;
      await logFoundryIterationComplete(result, null);
      iterationHeatStatus = await logTokenHeatSnapshot(result, null);

      console.log(`\n${"━".repeat(60)}`);
      console.log(formatIterationConsoleSummary(result, null, iterationHeatStatus));
      console.log(`${"━".repeat(60)}\n`);

      if (result.outcome === "halted") {
        await saveLifecycleState(iteration, "iteration halted");
        await logFoundryStopLifecycle({
          mode: lifecycleMode,
          concurrency,
          reason: "iteration halted",
          ...(result.reason ? { detail: result.reason } : {}),
          start_iteration: lifecycleStartIteration,
          last_completed_iteration: iteration,
          next_iteration: iteration + 1,
        });
        break;
      }

      // ── Auto-commit after successful iteration ──────────────
      if (autoGitCommit && (result.outcome === "shipped" || result.outcome === "killed")) {
        const meanRating = result.ratings ? meanCriticRating(result.ratings) : null;
        await runAutoCommitAndLog({
          iteration,
          outcome: result.outcome,
          artifactId: result.artifact_id ?? null,
          title: result.title ?? "untitled",
          domain: result.domain ?? "unknown",
          rating: meanRating,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n  ✘ Iteration ${iteration} failed: ${msg}`);
      await appendJournal(`**Iteration ${iteration}:** Failed: ${msg}`);
      stats.recordOutcome(iteration, "skipped");
      await logSkippedIterationFailure(iteration, msg, iterationStartMs);
      const skippedResult: IterationResult = {
        iteration,
        outcome: "skipped",
        reason: msg,
        token_usage: { input: 0, output: 0 },
        duration_ms: Date.now() - iterationStartMs,
      };
      iterationResult = skippedResult;
      await logFoundryIterationComplete(skippedResult, null);
      iterationHeatStatus = await logTokenHeatSnapshot(skippedResult, null);

      // Auto-commit failed iterations too
      if (autoGitCommit) {
        /* v8 ignore next */
        await runAutoCommitAndLog({
          iteration,
          outcome: "skipped",
          artifactId: null,
          title: "",
          domain: "",
          rating: null,
        });
      }
    }

    if (shutdownRequested) {
      console.log(`\nSignal detected${formatSignalConsoleSuffix(shutdownSignal)} — halting after saving checkpoint.`);
      await saveLifecycleState(iteration, "signal");
      await appendJournal(`**System:** Halted by ${formatSignalReason()} at iteration ${iteration}.`);
      await logFoundryStopLifecycle({
        mode: lifecycleMode,
        concurrency,
        reason: "signal",
        ...(shutdownSignal ? { signal: shutdownSignal } : {}),
        start_iteration: lifecycleStartIteration,
        last_completed_iteration: iteration,
        next_iteration: iteration + 1,
      });
      break;
    }

    if (iterationResult?.outcome === "skipped") {
      sequentialConsecutiveFailures++;
      if (sequentialConsecutiveFailures < SEQUENTIAL_FAILURE_BREAKER_THRESHOLD) {
        const detail = iterationResult.reason ?? `Reached ${sequentialConsecutiveFailures} consecutive skipped iterations`;
        console.log(formatSequentialFailureWarningConsole(
          sequentialConsecutiveFailures,
          SEQUENTIAL_FAILURE_BREAKER_THRESHOLD,
        ));
        await logFoundryStartLifecycle("foundry_sequential_failure_warning", {
          mode: lifecycleMode,
          concurrency,
          start_iteration: lifecycleStartIteration,
          iteration,
          next_iteration: iteration + 1,
          consecutive_failures: sequentialConsecutiveFailures,
          failure_threshold: SEQUENTIAL_FAILURE_BREAKER_THRESHOLD,
          failures_remaining: SEQUENTIAL_FAILURE_BREAKER_THRESHOLD - sequentialConsecutiveFailures,
          cooldown_failure_backoff_ms: getSequentialFailureBackoffMs(sequentialConsecutiveFailures),
          detail,
        });
      }
    } else if (iterationResult) {
      if (sequentialConsecutiveFailures > 0) {
        await logFoundryStartLifecycle("foundry_sequential_failure_recovered", {
          mode: lifecycleMode,
          concurrency,
          start_iteration: lifecycleStartIteration,
          iteration,
          next_iteration: iteration + 1,
          previous_failure_streak: sequentialConsecutiveFailures,
          recovery_outcome: iterationResult.outcome,
          duration_ms: iterationResult.duration_ms,
          token_usage: iterationResult.token_usage,
          ...(iterationResult.title ? { title: iterationResult.title } : {}),
          ...(iterationResult.domain ? { domain: iterationResult.domain } : {}),
          ...(iterationResult.source ? { source: iterationResult.source } : {}),
          ...(iterationResult.reason ? { reason: iterationResult.reason } : {}),
        });
      }
      sequentialConsecutiveFailures = 0;
    }

    if (sequentialConsecutiveFailures >= SEQUENTIAL_FAILURE_BREAKER_THRESHOLD) {
      const detail = iterationResult?.reason ?? `Reached ${sequentialConsecutiveFailures} consecutive skipped iterations`;
      console.log(`\n${sequentialConsecutiveFailures} consecutive skipped iterations — halting after saving checkpoint.`);
      await logFoundryStartLifecycle("foundry_sequential_failure_breaker", {
        mode: lifecycleMode,
        concurrency,
        start_iteration: lifecycleStartIteration,
        iteration,
        next_iteration: iteration + 1,
        consecutive_failures: sequentialConsecutiveFailures,
        failure_threshold: SEQUENTIAL_FAILURE_BREAKER_THRESHOLD,
        detail,
      });
      await saveLifecycleState(iteration, "consecutive failures");
      await appendJournal(`**System:** Halted after ${sequentialConsecutiveFailures} consecutive skipped iterations at iteration ${iteration}: ${detail}`);
      await logFoundryStopLifecycle({
        mode: lifecycleMode,
        concurrency,
        reason: "consecutive failures",
        detail,
        consecutive_failures: sequentialConsecutiveFailures,
        failure_threshold: SEQUENTIAL_FAILURE_BREAKER_THRESHOLD,
        start_iteration: lifecycleStartIteration,
        last_completed_iteration: iteration,
        next_iteration: iteration + 1,
      });
      break;
    }

    // ── Curator full cycle ──────────────────────────────────────
    const qualityEscalation = getSequentialQualityEscalation(iterationResult, config);
    const failureEscalation = getSequentialFailureEscalation(iterationResult);
    const dimensionRepair = getSequentialDimensionRepair(iterationResult);
    const successAmplification = getSequentialSuccessAmplification(iterationResult, config);
    const tokenUnderburn = getSequentialTokenUnderburn(iterationResult, config);
    const curatorTrigger: CuratorCycleTrigger | null = iterationResult?.project_milestone_reached
      ? "project_milestone"
      : qualityEscalation
        ? "quality_escalation"
        : failureEscalation
          ? "failure_escalation"
          : successAmplification
            ? "success_amplification"
            : tokenUnderburn
              ? "underburn_escalation"
              : shouldRunCurator(iteration, lastCuratorRun, config)
                ? "scheduled"
                : null;
    const periodicCheckpointDue = iteration % config.recovery.checkpoint_every === 0;
    const sequentialMaintenanceStartedAtMs = Date.now();
    const sequentialMaintenanceData: Record<string, unknown> = {
      mode: lifecycleMode,
      concurrency,
      start_iteration: lifecycleStartIteration,
      iteration,
      next_iteration: iteration + 1,
      ...(iterationResult ? { outcome: iterationResult.outcome } : {}),
      ...(iterationResult?.title ? { title: iterationResult.title } : {}),
      ...(iterationResult?.domain ? { domain: iterationResult.domain } : {}),
      ...(iterationResult?.source ? { source: iterationResult.source } : {}),
      ...(iterationResult?.reason ? { reason: iterationResult.reason } : {}),
      curator_trigger: curatorTrigger ?? "none",
      ...(qualityEscalation ? {
        quality_escalation_rating: Number(qualityEscalation.rating.toFixed(1)),
        quality_escalation_threshold: Number(qualityEscalation.threshold.toFixed(1)),
      } : {}),
      ...(failureEscalation?.reason ? {
        failure_escalation_reason: failureEscalation.reason,
      } : {}),
      ...(dimensionRepair ? {
        dimension_repair_dimension: dimensionRepair.dimension,
        dimension_repair_rating: Number(dimensionRepair.rating.toFixed(1)),
        dimension_repair_threshold: Number(dimensionRepair.threshold.toFixed(1)),
      } : {}),
      ...(successAmplification ? {
        success_amplification_rating: Number(successAmplification.rating.toFixed(1)),
        success_amplification_threshold: Number(successAmplification.threshold.toFixed(1)),
      } : {}),
      ...(tokenUnderburn ? {
        token_underburn_complexity: tokenUnderburn.complexity,
        token_underburn_spent_tokens: tokenUnderburn.spentTokens,
        token_underburn_target_tokens: tokenUnderburn.targetTokens,
        token_underburn_budget_warning_threshold: tokenUnderburn.budgetWarningThreshold,
      } : {}),
      periodic_checkpoint_due: periodicCheckpointDue,
      failure_streak: sequentialConsecutiveFailures,
      ...formatCooldownTokenHeatLifecycleData(iterationHeatStatus),
      ...createRuntimeRunSummary(),
    };
    await logFoundryStartLifecycle("foundry_sequential_maintenance_start", sequentialMaintenanceData);
    if (curatorTrigger) {
      await runCuratorFullCycle(iteration, curatorTrigger, iterationResult);
    }
    if (dimensionRepair && !qualityEscalation && !failureEscalation && iterationResult) {
      await appendDimensionRepairJournalNote(iteration, iterationResult, dimensionRepair);
    }

    // ── Checkpoint ──────────────────────────────────────────────
    let periodicCheckpointSaved = false;
    let maintenanceCheckpointSaved = false;
    let maintenanceCheckpointReason: string | null = null;
    if (periodicCheckpointDue) {
      await saveLifecycleState(iteration, "periodic");
      periodicCheckpointSaved = true;
      maintenanceCheckpointSaved = true;
      maintenanceCheckpointReason = "periodic";
      console.log(`  Checkpoint saved at iteration ${iteration}.`);
    }

    // ── Anti-entropy monitoring ─────────────────────────────────
    const monitorResult = await runAntiEntropyMonitor(config, models, iteration, stats, stimuliRefreshStates, {
      mode: lifecycleMode,
      concurrency,
      startIteration: lifecycleStartIteration,
      runEmergencyCurator: true,
      onEmergencyCuratorComplete: async () => {
        lastCuratorRun = iteration;
        await saveLifecycleState(iteration, "emergency curator");
        maintenanceCheckpointSaved = true;
        maintenanceCheckpointReason = "emergency curator";
      },
    });
    const nextRequestHandoff = await readSequentialRequestHandoff(config);
    if (
      tokenUnderburn
      && !qualityEscalation
      && !failureEscalation
      && !dimensionRepair
      && !nextRequestHandoff.request_pending
      && !iterationHeatStatus?.hot
      && curatorTrigger !== "underburn_escalation"
      && iterationResult
    ) {
      await appendTokenUnderburnJournalNote(iteration, iterationResult, tokenUnderburn);
    }

    let stokerResult: StokerCheckResult = {
      due: false,
      cadenceDue: false,
      forceDue: false,
      enabled: false,
      runInterval: null,
      nextRunIteration: null,
      iterationsUntilRun: null,
      directiveWritten: false,
      failed: false,
      durationMs: 0,
    };
    try {
      const iterEntries = await readJsonlEntries<any>(
        resolve("logs", "iterations.jsonl"),
      );
      const mergedIterEntries = mergeRuntimeStokerEntries(iterEntries);
      const domainRut = getSequentialDomainRut(mergedIterEntries);
      const stokerForceReason: StokerForceReason | undefined = qualityEscalation
        ? "quality_escalation"
        : failureEscalation
          ? "failure_escalation"
          : dimensionRepair
            ? "dimension_repair"
            : nextRequestHandoff.request_pending
              ? "human_redirect"
              : monitorResult.pressureWarningCount > 0
                ? "monitor_warning"
                : iterationHeatStatus?.hot
                  ? "token_heat"
                  : tokenUnderburn
                    ? "underburn"
                    : domainRut
                      ? "domain_rut"
                      : successAmplification
                        ? "success_amplification"
                        : undefined;
      const stokerForceContext = createStokerForceContext(
        iterationResult,
        qualityEscalation,
        failureEscalation,
        dimensionRepair,
        nextRequestHandoff,
        successAmplification,
        tokenUnderburn,
        domainRut,
        monitorResult,
        iterationHeatStatus,
      );
      stokerResult = await runStokerIfDue(config, iteration, mergedIterEntries, {
        mode: lifecycleMode,
        concurrency,
        startIteration: lifecycleStartIteration,
      }, {
        ...(stokerForceReason ? { forceReason: stokerForceReason } : {}),
        ...(stokerForceContext ? { forceContext: stokerForceContext } : {}),
        ...(iterationHeatStatus ? { tokenHeat: iterationHeatStatus } : {}),
      });
    } catch (err) {
      // stoker is non-fatal
      stokerResult = {
        ...stokerResult,
        failed: true,
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    const sequentialMaintenanceDurationMs = Math.max(0, Date.now() - sequentialMaintenanceStartedAtMs);
    await logFoundryStartLifecycle("foundry_sequential_maintenance_complete", {
      ...sequentialMaintenanceData,
      duration_ms: sequentialMaintenanceDurationMs,
      periodic_checkpoint_saved: periodicCheckpointSaved,
      monitor_checked: true,
      monitor_failed: monitorResult.failed,
      monitor_warning_count: monitorResult.warningCount,
      monitor_critical_warning_count: monitorResult.criticalWarningCount,
      monitor_emergency_curator_triggered: monitorResult.emergencyCuratorTriggered,
      monitor_duration_ms: monitorResult.durationMs,
      ...(monitorResult.detail ? { monitor_detail: monitorResult.detail } : {}),
      stoker_checked: true,
      stoker_failed: stokerResult.failed,
      stoker_due: stokerResult.due,
      stoker_cadence_due: stokerResult.cadenceDue,
      stoker_force_due: stokerResult.forceDue,
      stoker_enabled: stokerResult.enabled,
      stoker_run_interval: stokerResult.runInterval,
      stoker_next_run_iteration: stokerResult.nextRunIteration,
      stoker_iterations_until_run: stokerResult.iterationsUntilRun,
      stoker_directive_written: stokerResult.directiveWritten,
      stoker_duration_ms: stokerResult.durationMs,
      ...(stokerResult.forceReason ? { stoker_force_reason: stokerResult.forceReason } : {}),
      ...(stokerResult.forIteration !== undefined ? { stoker_for_iteration: stokerResult.forIteration } : {}),
      ...(stokerResult.urgency ? { stoker_urgency: stokerResult.urgency } : {}),
      ...(stokerResult.streakInstruction ? { stoker_streak_instruction: stokerResult.streakInstruction } : {}),
      ...(stokerResult.rulesFired ? { stoker_rules_fired: stokerResult.rulesFired } : {}),
      ...(stokerResult.refineryQueue !== undefined ? { stoker_refinery_queue: stokerResult.refineryQueue } : {}),
      ...(stokerResult.detail ? { stoker_detail: stokerResult.detail } : {}),
      last_curator_run: lastCuratorRun,
    });
    console.log(formatSequentialMaintenanceConsole({
      durationMs: sequentialMaintenanceDurationMs,
      periodicCheckpointSaved,
      monitorFailed: monitorResult.failed,
      monitorWarningCount: monitorResult.warningCount,
      monitorCriticalWarningCount: monitorResult.criticalWarningCount,
      monitorEmergencyCuratorTriggered: monitorResult.emergencyCuratorTriggered,
      stokerFailed: stokerResult.failed,
      stokerDue: stokerResult.due,
      stokerDirectiveWritten: stokerResult.directiveWritten,
      stokerForIteration: stokerResult.forIteration,
      stokerUrgency: stokerResult.urgency,
      stokerIterationsUntilRun: stokerResult.iterationsUntilRun,
      tokenHeat: iterationHeatStatus
        ? {
            pressure: iterationHeatStatus.pressure,
            thresholdPercent: iterationHeatStatus.thresholdPercent,
          }
        : null,
    }));

    if (await checkStopFile(config)) {
      const stopFileAudit = await readStopFileAudit(config);
      console.log(`\nSTOP file detected${formatStopFileConsoleSuffix(stopFileAudit)} — halting before cooldown after saving checkpoint.`);
      await saveLifecycleState(iteration, "halt");
      await appendJournal(`**System:** Halted by STOP file after iteration ${iteration}.${formatStopFileJournalSuffix(stopFileAudit)}`);
      await logFoundryStopLifecycle({
        mode: lifecycleMode,
        concurrency,
        reason: "STOP file",
        ...stopFileAudit,
        start_iteration: lifecycleStartIteration,
        last_completed_iteration: iteration,
        next_iteration: iteration + 1,
      });
      break;
    }

    const cooldownPlan = planSequentialCooldown(
      (config.loop?.cooldown_seconds ?? 2) * 1000,
      iterationHeatStatus,
      sequentialConsecutiveFailures,
    );
    const cooldownMs = cooldownPlan.cooldownMs;
    const nextIterationRunSummary = createRuntimeRunSummary();
    const handoffAttention = createSequentialHandoffAttention(monitorResult, stokerResult);
    const stokerUrgentHandoff = Boolean(
      cooldownMs > 0
      && stokerResult.directiveWritten
      && stokerResult.urgency === "high"
      && stokerResult.forIteration === iteration + 1
      && !nextRequestHandoff.request_pending
      && !iterationHeatStatus?.hot,
    );
    const handoffCheckpointRequired = handoffAttention.health === "critical";
    if (handoffCheckpointRequired && !maintenanceCheckpointSaved) {
      await saveLifecycleState(iteration, "handoff attention");
      maintenanceCheckpointSaved = true;
      maintenanceCheckpointReason = "handoff attention";
    }
    if (cooldownPlan.failureBackoffApplied && maintenanceCheckpointReason !== "failure backoff") {
      await saveLifecycleState(iteration, "failure backoff");
      if (!maintenanceCheckpointSaved) {
        maintenanceCheckpointSaved = true;
        maintenanceCheckpointReason = "failure backoff";
      }
    }
    const requestCheckpointRequired = nextRequestHandoff.request_pending && cooldownMs > 0;
    if (requestCheckpointRequired && !maintenanceCheckpointSaved) {
      await saveLifecycleState(iteration, "request handoff");
      maintenanceCheckpointSaved = true;
      maintenanceCheckpointReason = "request handoff";
    }
    const stokerCheckpointRequired = stokerUrgentHandoff;
    if (stokerCheckpointRequired && !maintenanceCheckpointSaved) {
      await saveLifecycleState(iteration, "stoker urgent handoff");
      maintenanceCheckpointSaved = true;
      maintenanceCheckpointReason = "stoker urgent handoff";
    }
    const handoffCheckpointSaved = handoffCheckpointRequired && maintenanceCheckpointSaved;
    const requestCheckpointSaved = requestCheckpointRequired && maintenanceCheckpointSaved;
    const requestCheckpointReason = requestCheckpointSaved ? maintenanceCheckpointReason : null;
    const stokerCheckpointSaved = stokerCheckpointRequired && maintenanceCheckpointSaved;
    const stokerCheckpointReason = stokerCheckpointSaved ? maintenanceCheckpointReason : null;
    if (handoffCheckpointSaved && handoffAttention.health === "critical") {
      await appendCriticalHandoffJournalNote(
        iteration,
        iteration + 1,
        handoffAttention,
        maintenanceCheckpointReason,
      );
    }
    await logFoundryStartLifecycle("foundry_next_iteration_ready", {
      mode: lifecycleMode,
      concurrency,
      start_iteration: lifecycleStartIteration,
      iteration,
      next_iteration: iteration + 1,
      cooldown_ms: cooldownMs,
      ...formatSequentialCooldownPlanLifecycleData(cooldownPlan),
      ...formatCooldownTokenHeatLifecycleData(iterationHeatStatus),
      ...nextIterationRunSummary,
      next_stoker_directive_written: stokerResult.directiveWritten,
      ...(stokerResult.forIteration !== undefined ? { next_stoker_for_iteration: stokerResult.forIteration } : {}),
      ...(stokerResult.urgency ? { next_stoker_urgency: stokerResult.urgency } : {}),
      ...(stokerResult.rulesFired ? { next_stoker_rules_fired: stokerResult.rulesFired } : {}),
      ...(stokerResult.refineryQueue !== undefined ? { next_stoker_refinery_queue: stokerResult.refineryQueue } : {}),
      next_stoker_urgent_handoff: stokerUrgentHandoff,
      next_stoker_checkpoint_required: stokerCheckpointRequired,
      next_stoker_checkpoint_saved: stokerCheckpointSaved,
      ...(stokerCheckpointReason ? { next_stoker_checkpoint_reason: stokerCheckpointReason } : {}),
      next_request_file: nextRequestHandoff.request_file,
      next_request_pending: nextRequestHandoff.request_pending,
      ...(nextRequestHandoff.request_preview ? { next_request_preview: nextRequestHandoff.request_preview } : {}),
      ...(nextRequestHandoff.request_check_failed ? { next_request_check_failed: true } : {}),
      ...(nextRequestHandoff.request_check_detail ? { next_request_check_detail: nextRequestHandoff.request_check_detail } : {}),
      next_request_checkpoint_required: requestCheckpointRequired,
      next_request_checkpoint_saved: requestCheckpointSaved,
      ...(requestCheckpointReason ? { next_request_checkpoint_reason: requestCheckpointReason } : {}),
      handoff_health: handoffAttention.health,
      handoff_attention_reasons: handoffAttention.reasons,
      handoff_monitor_warning_count: monitorResult.warningCount,
      handoff_monitor_critical_warning_count: monitorResult.criticalWarningCount,
      handoff_monitor_failed: monitorResult.failed,
      handoff_monitor_emergency_curator_triggered: monitorResult.emergencyCuratorTriggered,
      handoff_stoker_failed: stokerResult.failed,
      handoff_checkpoint_required: handoffCheckpointRequired,
      handoff_checkpoint_saved: handoffCheckpointSaved,
      ...(handoffCheckpointSaved && maintenanceCheckpointReason ? { handoff_checkpoint_reason: maintenanceCheckpointReason } : {}),
    });
    console.log(formatSequentialNextIterationConsole({
      nextIteration: iteration + 1,
      cooldownMs,
      failureBackoffMs: cooldownPlan.failureBackoffMs,
      tokenHeat: iterationHeatStatus
        ? {
            pressure: iterationHeatStatus.pressure,
            thresholdPercent: iterationHeatStatus.thresholdPercent,
          }
        : null,
      runSummary: nextIterationRunSummary,
      stokerDirectiveWritten: stokerResult.directiveWritten,
      stokerForIteration: stokerResult.forIteration,
      stokerUrgency: stokerResult.urgency,
      requestHandoff: nextRequestHandoff,
      handoffAttention,
      handoffCheckpointSaved,
      handoffCheckpointReason: handoffCheckpointSaved ? maintenanceCheckpointReason : null,
      requestCheckpointSaved,
      requestCheckpointReason,
      stokerCheckpointSaved,
      stokerCheckpointReason,
    }));

    // ── Cooldown ────────────────────────────────────────────────
    const cooldownStartedAtMs = Date.now();
    if (cooldownMs > 0) {
      const cooldownHeatConsole = formatCooldownTokenHeatConsole(iterationHeatStatus, cooldownMs, cooldownPlan.baseMs);
      if (cooldownHeatConsole) console.log(cooldownHeatConsole);
      console.log(formatSequentialCooldownWatchConsole(
        iteration,
        iteration + 1,
        cooldownMs,
        config.intervention.stop_file,
        config.intervention.requests_file,
      ));
      await logFoundryStartLifecycle("foundry_cooldown_start", {
        mode: lifecycleMode,
        concurrency,
        start_iteration: lifecycleStartIteration,
        iteration,
        next_iteration: iteration + 1,
        cooldown_ms: cooldownMs,
        cooldown_stop_file: config.intervention.stop_file,
        cooldown_request_file: config.intervention.requests_file,
        cooldown_interrupts_enabled: true,
        cooldown_signal_watch: true,
        ...formatSequentialCooldownPlanLifecycleData(cooldownPlan),
        ...formatCooldownTokenHeatLifecycleData(iterationHeatStatus),
      });
      if (nextRequestHandoff.request_pending) {
        const requestPreview = nextRequestHandoff.request_preview ?? "";
        await appendQueuedRequestCooldownJournalNote(iteration, iteration + 1, nextRequestHandoff);
        await logFoundryStartLifecycle("foundry_cooldown_interrupted", {
          mode: lifecycleMode,
          concurrency,
          start_iteration: lifecycleStartIteration,
          iteration,
          cooldown_ms: cooldownMs,
          ...formatSequentialCooldownPlanLifecycleData(cooldownPlan),
          elapsed_ms: 0,
          ...formatCooldownTokenHeatLifecycleData(iterationHeatStatus),
          reason: "request file",
          request_file: nextRequestHandoff.request_file,
          request_preview: requestPreview,
          request_checkpoint_saved: requestCheckpointSaved,
          ...(requestCheckpointReason ? { request_checkpoint_reason: requestCheckpointReason } : {}),
        });
        console.log(`\nHuman redirect already queued before cooldown — starting iteration ${iteration + 1} early.`);
        iteration++;
        continue;
      }
      if (stokerUrgentHandoff) {
        await appendUrgentStokerCooldownJournalNote(
          iteration,
          iteration + 1,
          stokerResult,
          stokerCheckpointSaved,
          stokerCheckpointReason,
        );
        await logFoundryStartLifecycle("foundry_cooldown_interrupted", {
          mode: lifecycleMode,
          concurrency,
          start_iteration: lifecycleStartIteration,
          iteration,
          cooldown_ms: cooldownMs,
          ...formatSequentialCooldownPlanLifecycleData(cooldownPlan),
          elapsed_ms: 0,
          ...formatCooldownTokenHeatLifecycleData(iterationHeatStatus),
          reason: "stoker urgent handoff",
          ...(stokerResult.forIteration !== undefined ? { stoker_for_iteration: stokerResult.forIteration } : {}),
          ...(stokerResult.urgency ? { stoker_urgency: stokerResult.urgency } : {}),
          ...(stokerResult.forceReason ? { stoker_force_reason: stokerResult.forceReason } : {}),
          ...(stokerResult.rulesFired ? { stoker_rules_fired: stokerResult.rulesFired } : {}),
          stoker_checkpoint_saved: stokerCheckpointSaved,
          ...(stokerCheckpointReason ? { stoker_checkpoint_reason: stokerCheckpointReason } : {}),
        });
        console.log(`\nHigh-urgency Stoker handoff — starting iteration ${iteration + 1} early.`);
        iteration++;
        continue;
      }
    }
    const cooldownResult = await waitForSequentialCooldown(cooldownMs);
    const cooldownWake = cooldownResult.wake;
    const cooldownStopPollFailureData = formatSequentialCooldownStopPollFailureLifecycleData(
      cooldownResult.stopPollFailure,
    );
    const cooldownRequestPollFailureData = formatSequentialCooldownRequestPollFailureLifecycleData(
      cooldownResult.requestPollFailure,
    );
    const cooldownContinuesToNextIteration = !cooldownWake || cooldownWake.reason === "request file";
    if (cooldownContinuesToNextIteration) {
      await appendRecoveredCooldownPollJournalNote(
        iteration,
        iteration + 1,
        cooldownResult.stopPollFailure,
        cooldownResult.requestPollFailure,
      );
      const recoveredPollingConsole = formatRecoveredCooldownPollConsole(
        iteration,
        iteration + 1,
        cooldownResult.stopPollFailure,
        cooldownResult.requestPollFailure,
      );
      if (recoveredPollingConsole) console.log(recoveredPollingConsole);
    }
    if (cooldownWake) {
      const elapsedMs = Math.max(0, Date.now() - cooldownStartedAtMs);
      if (cooldownWake.reason === "request file") {
        const checkpointReason = "cooldown request handoff";
        await saveLifecycleState(iteration, checkpointReason);
        await appendDetectedRequestCooldownJournalNote(iteration, iteration + 1, cooldownWake);
        await logFoundryStartLifecycle("foundry_cooldown_interrupted", {
          mode: lifecycleMode,
          concurrency,
          start_iteration: lifecycleStartIteration,
          iteration,
          cooldown_ms: cooldownMs,
          ...formatSequentialCooldownPlanLifecycleData(cooldownPlan),
          elapsed_ms: elapsedMs,
          ...formatCooldownTokenHeatLifecycleData(iterationHeatStatus),
          ...cooldownStopPollFailureData,
          ...cooldownRequestPollFailureData,
          ...cooldownWake,
          request_checkpoint_saved: true,
          request_checkpoint_reason: checkpointReason,
        });
        console.log(`\nHuman redirect detected during cooldown — starting iteration ${iteration + 1} early.`);
        iteration++;
        continue;
      }
      await logFoundryStartLifecycle("foundry_cooldown_interrupted", {
        mode: lifecycleMode,
        concurrency,
        start_iteration: lifecycleStartIteration,
        iteration,
        cooldown_ms: cooldownMs,
        ...formatSequentialCooldownPlanLifecycleData(cooldownPlan),
        elapsed_ms: elapsedMs,
        ...formatCooldownTokenHeatLifecycleData(iterationHeatStatus),
        ...cooldownStopPollFailureData,
        ...cooldownRequestPollFailureData,
        ...cooldownWake,
      });

      const stopFileAudit = cooldownWake.reason === "STOP file" ? await readStopFileAudit(config) : null;
      const consoleSuffix = cooldownWake.reason === "STOP file"
        ? formatStopFileConsoleSuffix(stopFileAudit)
        : formatSignalConsoleSuffix(shutdownSignal);
      console.log(`\n${cooldownWake.reason === "signal" ? "Signal" : "STOP file"} detected${consoleSuffix} during cooldown — halting after saving checkpoint.`);
      await saveLifecycleState(iteration, cooldownWake.reason === "signal" ? "cooldown signal" : "cooldown halt");
      const stopFileSuffix = stopFileAudit ? formatStopFileJournalSuffix(stopFileAudit) : "";
      await appendJournal(
        `**System:** Halted by ${cooldownWake.reason === "signal" ? formatSignalReason() : cooldownWake.reason} during cooldown after iteration ${iteration}.${stopFileSuffix}`,
      );
      await logFoundryStopLifecycle({
        mode: lifecycleMode,
        concurrency,
        reason: cooldownWake.reason,
        ...(cooldownWake.reason === "signal" && shutdownSignal ? { signal: shutdownSignal } : {}),
        ...(stopFileAudit ?? {}),
        cooldown_interrupted: true,
        start_iteration: lifecycleStartIteration,
        last_completed_iteration: iteration,
        next_iteration: iteration + 1,
      });
      break;
    }
    if (cooldownMs > 0) {
      const cooldownElapsedMs = Math.max(0, Date.now() - cooldownStartedAtMs);
      await logFoundryStartLifecycle("foundry_cooldown_complete", {
        mode: lifecycleMode,
        concurrency,
        start_iteration: lifecycleStartIteration,
        iteration,
        next_iteration: iteration + 1,
        cooldown_ms: cooldownMs,
        cooldown_completed: true,
        cooldown_stop_file: config.intervention.stop_file,
        cooldown_request_file: config.intervention.requests_file,
        cooldown_interrupts_enabled: true,
        cooldown_signal_watch: true,
        ...formatSequentialCooldownPlanLifecycleData(cooldownPlan),
        elapsed_ms: cooldownElapsedMs,
        ...formatCooldownTokenHeatLifecycleData(iterationHeatStatus),
        ...nextIterationRunSummary,
        ...cooldownStopPollFailureData,
        ...cooldownRequestPollFailureData,
      });
      console.log(formatSequentialCooldownCompleteConsole(iteration, iteration + 1, cooldownElapsedMs));
    } else {
      await logFoundryStartLifecycle("foundry_cooldown_skipped", {
        mode: lifecycleMode,
        concurrency,
        start_iteration: lifecycleStartIteration,
        iteration,
        next_iteration: iteration + 1,
        cooldown_ms: cooldownMs,
        ...formatSequentialCooldownPlanLifecycleData(cooldownPlan),
        ...formatCooldownTokenHeatLifecycleData(iterationHeatStatus),
        ...nextIterationRunSummary,
        reason: "no configured cooldown",
      });
    }

    iteration++;
  }

  process.removeListener("SIGINT", onSigint);
  process.removeListener("SIGTERM", onSigterm);
  } // end sequential mode
  } catch (err) {
    if (!lifecycleStopLogged) {
      const detail = err instanceof Error ? err.message : String(err);
      try {
        await appendJournal(`**System:** Fatal foundry start error at iteration ${lifecycleNextIteration}: ${detail}`);
      } catch (journalErr) {
        const msg = journalErr instanceof Error ? journalErr.message : String(journalErr);
        console.warn(`  ⚠ Fatal error journal write failed: ${msg}`);
      }
      try {
        await logFoundryStopLifecycle({
          mode: lifecycleMode,
          concurrency,
          reason: "error",
          detail,
          start_iteration: lifecycleStartIteration,
          last_completed_iteration: Math.max(0, lifecycleLastCompletedIteration),
          next_iteration: lifecycleNextIteration,
        });
      } catch (logErr) {
        const msg = logErr instanceof Error ? logErr.message : String(logErr);
        console.warn(`  ⚠ Lifecycle error audit write failed: ${msg}`);
      }
    }
    throw err;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }

  console.log("\nThe Foundry has stopped.");
}

async function saveState(
  config: FoundryConfig,
  iteration: number,
  lastCuratorRun: number,
  stats: StatsTracker,
  stimuliRefreshStates: Map<string, StimuliRefreshState>,
): Promise<void> {
  const snapshot = stats.getSnapshot();
  const streakState = await loadStreakHistory().catch(() => undefined);
  const state: CheckpointState = {
    iteration,
    active_project_ids: [],
    domain_counts: snapshot.domain_counts,
    last_stimuli_refresh: refreshStatesToRecord(stimuliRefreshStates),
    last_curator_run: lastCuratorRun,
    stats: snapshot,
    ...(streakState ? { streak_state: streakState } : {}),
    saved_at: new Date().toISOString(),
  };
  await saveCheckpoint(state);
}

export async function stopFoundry(
  stopFile = "STOP",
  opts?: { rootDir?: string; reason?: string },
): Promise<void> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const { mkdir, writeFile } = await import("node:fs/promises");
  const stopPath = resolve(stopFile);
  const reason = opts?.reason?.trim();
  const content = [
    `Stopped at ${new Date().toISOString()}`,
    ...(reason ? [`Reason: ${reason}`] : []),
  ].join("\n");
  await mkdir(path.dirname(stopPath), { recursive: true });
  await writeFile(stopPath, `${content}\n`, "utf-8");
}

export async function resumeFoundry(stopFile = "STOP", opts?: { rootDir?: string }): Promise<void> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const { unlink } = await import("node:fs/promises");
  const stopPath = resolve(stopFile);
  await unlink(stopPath).catch((err: unknown) => {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") return;
    throw err;
  });
}

export interface StimuliSourceResetResult {
  status: "reset" | "no_checkpoint";
  source: string;
  previous: StimuliRefreshState | null;
  current: StimuliRefreshState | null;
}

export interface StimuliSourceRefreshResult {
  status: "refreshed" | "refreshed_no_checkpoint";
  source: string;
  iteration: number | null;
  checkpointUpdated: boolean;
  contentLength: number;
  previous: StimuliRefreshState | null;
  current: StimuliRefreshState | null;
}

export interface FoundryStimuliStatus {
  iteration: number;
  savedAt: string | null;
  health: {
    level: "healthy" | "warning";
    reasons: string[];
    actions: string[];
  };
  stimuli: StimuliRefreshHealth;
  attention: StimuliRefreshHealth["entries"];
}

export interface StimuliAuditEntry extends Record<string, unknown> {
  timestamp?: string;
  action?: string;
  source?: string;
  status?: string;
  checkpoint_updated?: boolean;
  iteration?: number | null;
  content_length?: number;
  error?: string;
  previous?: StimuliRefreshState | null;
  current?: StimuliRefreshState | null;
}

export type StimuliAuditAction = "refresh" | "reset";
export type StimuliAuditStatus = "refreshed" | "refreshed_no_checkpoint" | "failed" | "reset" | "no_checkpoint";

export interface FoundryStimuliAuditHistory {
  source: string | null;
  action: StimuliAuditAction | null;
  status: StimuliAuditStatus | null;
  limit: number;
  total: number;
  entries: StimuliAuditEntry[];
}

export type StokerHistoryEntry = Partial<StokerDirective> & Record<string, unknown>;

export interface FoundryStokerHistory {
  urgency: StokerUrgency | null;
  rule: string | null;
  iteration: number | null;
  limit: number;
  total: number;
  entries: StokerHistoryEntry[];
}

export type RefineryHistoryEntry = Partial<RefineryAttempt> & Record<string, unknown>;
export type RefineryHistoryResult = NonNullable<RefineryAttempt["result"]>;

export interface FoundryRefineryHistory {
  result: RefineryHistoryResult | null;
  sourceType: RefinerySourceType | null;
  iteration: number | null;
  limit: number;
  total: number;
  entries: RefineryHistoryEntry[];
}

export type MonitorHistoryEntry = Partial<MonitorWarning> & Record<string, unknown>;

export interface FoundryMonitorHistory {
  severity: MonitorSeverity | null;
  detector: string | null;
  iteration: number | null;
  limit: number;
  total: number;
  entries: MonitorHistoryEntry[];
}

export type DecisionHistoryGate = DecisionLogEntry["gate"];
export type DecisionHistoryDecision = DecisionLogEntry["decision"];
export type DecisionHistorySource = NonNullable<DecisionLogEntry["source"]>;
export type DecisionHistoryEntry = Partial<DecisionLogEntry> & Record<string, unknown>;

export interface FoundryDecisionHistory {
  gate: DecisionHistoryGate | null;
  decision: DecisionHistoryDecision | null;
  source: DecisionHistorySource | null;
  iteration: number | null;
  limit: number;
  total: number;
  entries: DecisionHistoryEntry[];
}

export type TestReportHistoryOutcome = TestReportEntry["outcome"];
export type TestReportHistoryEntry = Partial<TestReportEntry> & Record<string, unknown>;

export interface FoundryTestReportHistory {
  outcome: TestReportHistoryOutcome | null;
  artifact: string | null;
  iteration: number | null;
  limit: number;
  total: number;
  entries: TestReportHistoryEntry[];
}

export type TokenUsageHistoryAgent = AgentRole;
export interface TokenUsageHistoryEntry extends Record<string, unknown> {
  timestamp?: string;
  iteration?: number;
  agent?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  duration_ms?: number;
}

export interface FoundryTokenUsageHistory {
  agent: TokenUsageHistoryAgent | null;
  model: string | null;
  iteration: number | null;
  limit: number;
  total: number;
  inputTokens: number;
  outputTokens: number;
  entries: TokenUsageHistoryEntry[];
}

export type IterationHistoryOutcome = "shipped" | "killed" | "skipped" | "halted";
export type IterationHistorySource = "ideator" | "human_redirect";
export interface IterationHistoryEntry extends Record<string, unknown> {
  timestamp?: string;
  iteration?: number;
  outcome?: string;
  source?: string;
  artifact_id?: string;
  title?: string;
  domain?: string;
  reason?: string;
  mean_rating?: string | number;
  token_usage?: {
    input?: number;
    output?: number;
  };
  duration_ms?: number;
}

export interface FoundryIterationHistory {
  outcome: IterationHistoryOutcome | null;
  source: IterationHistorySource | null;
  domain: string | null;
  limit: number;
  total: number;
  counts: Record<IterationHistoryOutcome, number>;
  entries: IterationHistoryEntry[];
}

export type TimelineOutcome = IterationHistoryOutcome;
export type TimelineSource = IterationHistorySource;

export interface FoundryTimelineEntry {
  iteration: number;
  timestamp: string | null;
  outcome: string | null;
  title: string | null;
  domain: string | null;
  source: string | null;
  artifactId: string | null;
  reason: string | null;
  tokenUsage: {
    input: number;
    output: number;
  };
  decisions: {
    gate1: number;
    gate2: number;
  };
  tests: {
    pass: number;
    failFixable: number;
    failCatastrophic: number;
  };
  monitor: Record<MonitorSeverity, number>;
}

export interface FoundryTimeline {
  outcome: TimelineOutcome | null;
  source: TimelineSource | null;
  domain: string | null;
  iteration: number | null;
  limit: number;
  total: number;
  entries: FoundryTimelineEntry[];
}

const SAFE_STIMULI_SOURCE = /^[a-z0-9][a-z0-9_-]*$/i;
const SAFE_STOKER_RULE = /^[a-z0-9][a-z0-9_-]*$/i;
const SAFE_MONITOR_DETECTOR = /^[a-z0-9][a-z0-9_-]*$/i;
const SAFE_TEST_REPORT_ARTIFACT = /^[a-z0-9][a-z0-9_-]*$/i;
const SAFE_TOKEN_USAGE_MODEL = /^[a-z0-9][a-z0-9._-]*$/i;
const SAFE_HISTORY_DOMAIN = /^[a-z0-9][a-z0-9_-]*$/i;
const DEFAULT_STIMULI_HISTORY_LIMIT = 20;
const DEFAULT_STOKER_HISTORY_LIMIT = 20;
const DEFAULT_REFINERY_HISTORY_LIMIT = 20;
const DEFAULT_MONITOR_HISTORY_LIMIT = 20;
const DEFAULT_DECISION_HISTORY_LIMIT = 20;
const DEFAULT_TEST_REPORT_HISTORY_LIMIT = 20;
const DEFAULT_TOKEN_USAGE_HISTORY_LIMIT = 20;
const DEFAULT_ITERATION_HISTORY_LIMIT = 20;
const DEFAULT_TIMELINE_LIMIT = 10;
const DEFAULT_REQUEST_HISTORY_LIMIT = 20;
const DEFAULT_SPARK_HISTORY_LIMIT = 20;
const STIMULI_AUDIT_ACTIONS: StimuliAuditAction[] = ["refresh", "reset"];
const STIMULI_AUDIT_STATUSES: StimuliAuditStatus[] = ["refreshed", "refreshed_no_checkpoint", "failed", "reset", "no_checkpoint"];
const REQUEST_HISTORY_ACTIONS: RequestHistoryAction[] = ["set", "append", "clear"];
const SPARK_HISTORY_MODES: SparkHistoryMode[] = ["set", "append"];
const STOKER_HISTORY_URGENCIES: StokerUrgency[] = ["low", "normal", "high"];
const REFINERY_HISTORY_RESULTS: RefineryHistoryResult[] = ["shipped", "killed", "skipped"];
const REFINERY_HISTORY_SOURCE_TYPES: RefinerySourceType[] = ["dream", "companion", "low_rated"];
const MONITOR_HISTORY_SEVERITIES: MonitorSeverity[] = ["critical", "warning", "info"];
const DECISION_HISTORY_GATES: DecisionHistoryGate[] = ["gate1", "gate2"];
const DECISION_HISTORY_DECISIONS: DecisionHistoryDecision[] = ["approve", "reject", "revise", "ship", "kill"];
const TEST_REPORT_HISTORY_OUTCOMES: TestReportHistoryOutcome[] = ["pass", "fail_fixable", "fail_catastrophic"];
const TOKEN_USAGE_HISTORY_AGENTS: TokenUsageHistoryAgent[] = ["ideator", "creator", "tester", "critic", "curator"];
const ITERATION_HISTORY_OUTCOMES: IterationHistoryOutcome[] = ["shipped", "killed", "skipped", "halted"];
const TIMELINE_SOURCES: TimelineSource[] = ["ideator", "human_redirect"];

function normalizeStimuliSourceName(source: string): string {
  const normalizedSource = source.trim();
  if (!SAFE_STIMULI_SOURCE.test(normalizedSource)) {
    throw new Error(`Invalid stimuli source "${source}"`);
  }
  return normalizedSource;
}

function requireStimuliSourceConfig(
  stimuliConfig: Awaited<ReturnType<typeof loadStimuliConfig>>,
  source: string,
) {
  const sourceConfig = stimuliConfig.mcp[source];
  if (!sourceConfig) {
    const configured = Object.keys(stimuliConfig.mcp).sort().join(", ") || "none";
    throw new Error(`Unknown stimuli source "${source}". Configured sources: ${configured}`);
  }
  return sourceConfig;
}

function defaultStimuliRefreshState(source: string): StimuliRefreshState {
  return {
    source,
    last_refresh_iteration: 0,
    consecutive_failures: 0,
    disabled: false,
  };
}

async function writeStimuliAudit(entry: Record<string, unknown>): Promise<void> {
  try {
    await logStimuli({
      timestamp: new Date().toISOString(),
      ...entry,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[stimuli] failed to write audit log: ${msg}`);
  }
}

function normalizeStimuliHistoryLimit(limit: number | undefined): number {
  if (limit == null) return DEFAULT_STIMULI_HISTORY_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid stimuli history limit "${limit}"`);
  }
  return limit;
}

function normalizeStimuliAuditAction(action: unknown): StimuliAuditAction | null {
  if (action == null) return null;
  if (typeof action === "string" && STIMULI_AUDIT_ACTIONS.includes(action as StimuliAuditAction)) {
    return action as StimuliAuditAction;
  }
  throw new Error(`Invalid stimuli audit action "${String(action)}"`);
}

function normalizeStimuliAuditStatus(status: unknown): StimuliAuditStatus | null {
  if (status == null) return null;
  if (typeof status === "string" && STIMULI_AUDIT_STATUSES.includes(status as StimuliAuditStatus)) {
    return status as StimuliAuditStatus;
  }
  throw new Error(`Invalid stimuli audit status "${String(status)}"`);
}

function isStimuliAuditEntry(entry: StimuliAuditEntry): boolean {
  return typeof entry === "object" && entry !== null;
}

function normalizeStokerHistoryLimit(limit: number | undefined): number {
  if (limit == null) return DEFAULT_STOKER_HISTORY_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid stoker history limit "${limit}"`);
  }
  return limit;
}

function normalizeStokerHistoryUrgency(urgency: unknown): StokerUrgency | null {
  if (urgency == null) return null;
  if (typeof urgency === "string" && STOKER_HISTORY_URGENCIES.includes(urgency as StokerUrgency)) {
    return urgency as StokerUrgency;
  }
  throw new Error(`Invalid stoker urgency "${String(urgency)}"`);
}

function normalizeStokerHistoryRule(rule: unknown): string | null {
  if (rule == null) return null;
  if (typeof rule === "string" && SAFE_STOKER_RULE.test(rule)) {
    return rule;
  }
  throw new Error(`Invalid stoker rule "${String(rule)}"`);
}

function normalizeStokerHistoryIteration(iteration: number | undefined): number | null {
  if (iteration == null) return null;
  if (!Number.isFinite(iteration) || !Number.isInteger(iteration) || iteration < 1) {
    throw new Error(`Invalid stoker iteration "${iteration}"`);
  }
  return iteration;
}

function isStokerHistoryEntry(entry: StokerHistoryEntry): boolean {
  return typeof entry === "object" && entry !== null;
}

function stokerHistoryHasRule(entry: StokerHistoryEntry, rule: string): boolean {
  return Array.isArray(entry.rules_fired) && entry.rules_fired.includes(rule);
}

function stokerHistoryTargetIteration(entry: StokerHistoryEntry): number | null {
  return typeof entry.for_iteration === "number" && Number.isFinite(entry.for_iteration)
    ? entry.for_iteration
    : null;
}

function normalizeRefineryHistoryLimit(limit: number | undefined): number {
  if (limit == null) return DEFAULT_REFINERY_HISTORY_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid refinery history limit "${limit}"`);
  }
  return limit;
}

function normalizeRefineryHistoryResult(result: unknown): RefineryHistoryResult | null {
  if (result == null) return null;
  if (typeof result === "string" && REFINERY_HISTORY_RESULTS.includes(result as RefineryHistoryResult)) {
    return result as RefineryHistoryResult;
  }
  throw new Error(`Invalid refinery result "${String(result)}"`);
}

function normalizeRefineryHistorySourceType(sourceType: unknown): RefinerySourceType | null {
  if (sourceType == null) return null;
  if (typeof sourceType === "string" && REFINERY_HISTORY_SOURCE_TYPES.includes(sourceType as RefinerySourceType)) {
    return sourceType as RefinerySourceType;
  }
  throw new Error(`Invalid refinery source type "${String(sourceType)}"`);
}

function normalizeRefineryHistoryIteration(iteration: number | undefined): number | null {
  if (iteration == null) return null;
  if (!Number.isFinite(iteration) || !Number.isInteger(iteration) || iteration < 1) {
    throw new Error(`Invalid refinery iteration "${iteration}"`);
  }
  return iteration;
}

function isRefineryHistoryEntry(entry: RefineryHistoryEntry): boolean {
  return typeof entry === "object" && entry !== null;
}

function normalizeMonitorHistoryLimit(limit: number | undefined): number {
  if (limit == null) return DEFAULT_MONITOR_HISTORY_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid monitor history limit "${limit}"`);
  }
  return limit;
}

function normalizeMonitorHistorySeverity(severity: unknown): MonitorSeverity | null {
  if (severity == null) return null;
  if (typeof severity === "string" && MONITOR_HISTORY_SEVERITIES.includes(severity as MonitorSeverity)) {
    return severity as MonitorSeverity;
  }
  throw new Error(`Invalid monitor severity "${String(severity)}"`);
}

function normalizeMonitorHistoryDetector(detector: unknown): string | null {
  if (detector == null) return null;
  if (typeof detector === "string" && SAFE_MONITOR_DETECTOR.test(detector)) {
    return detector;
  }
  throw new Error(`Invalid monitor detector "${String(detector)}"`);
}

function normalizeMonitorHistoryIteration(iteration: number | undefined): number | null {
  if (iteration == null) return null;
  if (!Number.isFinite(iteration) || !Number.isInteger(iteration) || iteration < 1) {
    throw new Error(`Invalid monitor iteration "${iteration}"`);
  }
  return iteration;
}

function isMonitorHistoryEntry(entry: MonitorHistoryEntry): boolean {
  return typeof entry === "object" && entry !== null;
}

function normalizeDecisionHistoryLimit(limit: number | undefined): number {
  if (limit == null) return DEFAULT_DECISION_HISTORY_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid decision history limit "${limit}"`);
  }
  return limit;
}

function normalizeDecisionHistoryGate(gate: unknown): DecisionHistoryGate | null {
  if (gate == null) return null;
  if (typeof gate === "string" && DECISION_HISTORY_GATES.includes(gate as DecisionHistoryGate)) {
    return gate as DecisionHistoryGate;
  }
  throw new Error(`Invalid decision history gate "${String(gate)}"`);
}

function normalizeDecisionHistoryDecision(decision: unknown): DecisionHistoryDecision | null {
  if (decision == null) return null;
  if (typeof decision === "string" && DECISION_HISTORY_DECISIONS.includes(decision as DecisionHistoryDecision)) {
    return decision as DecisionHistoryDecision;
  }
  throw new Error(`Invalid decision history decision "${String(decision)}"`);
}

function normalizeDecisionHistorySource(source: unknown): DecisionHistorySource | null {
  if (source == null) return null;
  if (typeof source === "string" && TIMELINE_SOURCES.includes(source as DecisionHistorySource)) {
    return source as DecisionHistorySource;
  }
  throw new Error(`Invalid decision history source "${String(source)}"`);
}

function normalizeDecisionHistoryIteration(iteration: number | undefined): number | null {
  if (iteration == null) return null;
  if (!Number.isFinite(iteration) || !Number.isInteger(iteration) || iteration < 1) {
    throw new Error(`Invalid decision history iteration "${iteration}"`);
  }
  return iteration;
}

function isDecisionHistoryEntry(entry: DecisionHistoryEntry): boolean {
  return typeof entry === "object" && entry !== null;
}

function normalizeTestReportHistoryLimit(limit: number | undefined): number {
  if (limit == null) return DEFAULT_TEST_REPORT_HISTORY_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid test report history limit "${limit}"`);
  }
  return limit;
}

function normalizeTestReportHistoryOutcome(outcome: unknown): TestReportHistoryOutcome | null {
  if (outcome == null) return null;
  if (typeof outcome === "string" && TEST_REPORT_HISTORY_OUTCOMES.includes(outcome as TestReportHistoryOutcome)) {
    return outcome as TestReportHistoryOutcome;
  }
  throw new Error(`Invalid test report outcome "${String(outcome)}"`);
}

function normalizeTestReportHistoryArtifact(artifact: unknown): string | null {
  if (artifact == null) return null;
  if (typeof artifact === "string" && SAFE_TEST_REPORT_ARTIFACT.test(artifact)) {
    return artifact;
  }
  throw new Error(`Invalid test report artifact "${String(artifact)}"`);
}

function normalizeTestReportHistoryIteration(iteration: number | undefined): number | null {
  if (iteration == null) return null;
  if (!Number.isFinite(iteration) || !Number.isInteger(iteration) || iteration < 1) {
    throw new Error(`Invalid test report iteration "${iteration}"`);
  }
  return iteration;
}

function isTestReportHistoryEntry(entry: TestReportHistoryEntry): boolean {
  return typeof entry === "object" && entry !== null;
}

function normalizeTokenUsageHistoryLimit(limit: number | undefined): number {
  if (limit == null) return DEFAULT_TOKEN_USAGE_HISTORY_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid token usage history limit "${limit}"`);
  }
  return limit;
}

function normalizeTokenUsageHistoryAgent(agent: unknown): TokenUsageHistoryAgent | null {
  if (agent == null) return null;
  if (typeof agent === "string" && TOKEN_USAGE_HISTORY_AGENTS.includes(agent as TokenUsageHistoryAgent)) {
    return agent as TokenUsageHistoryAgent;
  }
  throw new Error(`Invalid token usage agent "${String(agent)}"`);
}

function normalizeTokenUsageHistoryModel(model: unknown): string | null {
  if (model == null) return null;
  if (typeof model === "string" && SAFE_TOKEN_USAGE_MODEL.test(model)) {
    return model;
  }
  throw new Error(`Invalid token usage model "${String(model)}"`);
}

function normalizeTokenUsageHistoryIteration(iteration: number | undefined): number | null {
  if (iteration == null) return null;
  if (!Number.isFinite(iteration) || !Number.isInteger(iteration) || iteration < 1) {
    throw new Error(`Invalid token usage iteration "${iteration}"`);
  }
  return iteration;
}

function isTokenUsageHistoryEntry(entry: TokenUsageHistoryEntry): boolean {
  return typeof entry === "object" && entry !== null;
}

function tokenUsageCount(entry: TokenUsageHistoryEntry, canonicalField: "input_tokens" | "output_tokens", legacyField: "input" | "output"): number {
  const canonical = entry[canonicalField];
  if (typeof canonical === "number" && Number.isFinite(canonical)) return canonical;
  const legacy = entry[legacyField];
  return typeof legacy === "number" && Number.isFinite(legacy) ? legacy : 0;
}

function normalizeIterationHistoryLimit(limit: number | undefined): number {
  if (limit == null) return DEFAULT_ITERATION_HISTORY_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid iteration history limit "${limit}"`);
  }
  return limit;
}

function normalizeIterationHistoryOutcome(outcome: unknown): IterationHistoryOutcome | null {
  if (outcome == null) return null;
  if (typeof outcome === "string" && ITERATION_HISTORY_OUTCOMES.includes(outcome as IterationHistoryOutcome)) {
    return outcome as IterationHistoryOutcome;
  }
  throw new Error(`Invalid iteration outcome "${String(outcome)}"`);
}

function normalizeIterationHistorySource(source: unknown): IterationHistorySource | null {
  if (source == null) return null;
  if (typeof source === "string" && TIMELINE_SOURCES.includes(source as IterationHistorySource)) {
    return source as IterationHistorySource;
  }
  throw new Error(`Invalid iteration source "${String(source)}"`);
}

function normalizeIterationHistoryDomain(domain: unknown): string | null {
  if (domain == null) return null;
  if (typeof domain === "string" && SAFE_HISTORY_DOMAIN.test(domain)) {
    return domain;
  }
  throw new Error(`Invalid iteration domain "${String(domain)}"`);
}

function isIterationHistoryEntry(entry: IterationHistoryEntry): boolean {
  return typeof entry === "object" && entry !== null;
}

function normalizeRequestHistoryLimit(limit: number | undefined): number {
  if (limit == null) return DEFAULT_REQUEST_HISTORY_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid request history limit "${limit}"`);
  }
  return limit;
}

function normalizeRequestSourceLimit(limit: number | undefined): number {
  if (limit == null) return DEFAULT_REQUEST_HISTORY_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid request source limit "${limit}"`);
  }
  return limit;
}

function normalizeRequestHistoryAction(action: unknown): RequestHistoryAction | null {
  if (action == null) return null;
  if (typeof action === "string" && REQUEST_HISTORY_ACTIONS.includes(action as RequestHistoryAction)) {
    return action as RequestHistoryAction;
  }
  throw new Error(`Invalid request history action "${String(action)}"`);
}

function normalizeRequestHistoryTimestamp(timestamp: unknown): string | null {
  if (timestamp == null) return null;
  if (typeof timestamp === "string" && timestamp.trim().length > 0 && Number.isFinite(Date.parse(timestamp))) {
    return timestamp;
  }
  throw new Error(`Invalid request history timestamp "${String(timestamp)}"`);
}

function normalizeRequestHistorySource(source: unknown): string | null {
  if (source == null) return null;
  if (typeof source === "string" && source.trim().length > 0) {
    return source;
  }
  throw new Error(`Invalid request history source "${String(source)}"`);
}

function normalizeRequestHistoryContains(contains: unknown): string | null {
  if (contains == null) return null;
  if (typeof contains === "string" && contains.trim().length > 0) {
    return contains;
  }
  throw new Error(`Invalid request history contains "${String(contains)}"`);
}

function normalizeRequestRestoreTimestamp(timestamp: unknown): string {
  if (typeof timestamp === "string" && timestamp.trim().length > 0 && Number.isFinite(Date.parse(timestamp))) {
    return timestamp;
  }
  throw new Error(`Invalid request restore timestamp "${String(timestamp)}"`);
}

function requestHistoryTimestampMs(timestamp: string | null): number | null {
  if (timestamp === null) return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRequestHistoryEntryInWindow(entry: RequestHistoryEntry, sinceMs: number | null, untilMs: number | null): boolean {
  if (sinceMs === null && untilMs === null) return true;
  const timestamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
  if (!Number.isFinite(timestamp)) return false;
  return (sinceMs === null || timestamp >= sinceMs) && (untilMs === null || timestamp <= untilMs);
}

function isRequestHistoryEntry(entry: RequestHistoryEntry): boolean {
  return typeof entry === "object" && entry !== null;
}

function requestHistoryEntryContains(entry: RequestHistoryEntry, contains: string | null): boolean {
  if (contains === null) return true;
  return typeof entry.request_text === "string" && entry.request_text.includes(contains);
}

function requestSourceTimestampMs(summary: FoundryRequestSourceSummary): number {
  const parsed = typeof summary.latestTimestamp === "string" ? Date.parse(summary.latestTimestamp) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function isRestorableRequestHistoryEntry(entry: RequestHistoryEntry): boolean {
  return typeof entry.request_text === "string" && entry.request_text.trim().length > 0;
}

function requestDiffInputLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

function buildRequestDiffLines(currentText: string, historyText: string): RequestDiffLine[] {
  const currentLines = requestDiffInputLines(currentText);
  const historyLines = requestDiffInputLines(historyText);
  const table = Array.from({ length: currentLines.length + 1 }, () => (
    Array.from({ length: historyLines.length + 1 }, () => 0)
  ));

  for (let currentIndex = currentLines.length - 1; currentIndex >= 0; currentIndex--) {
    for (let historyIndex = historyLines.length - 1; historyIndex >= 0; historyIndex--) {
      table[currentIndex][historyIndex] = currentLines[currentIndex] === historyLines[historyIndex]
        ? table[currentIndex + 1][historyIndex + 1] + 1
        : Math.max(table[currentIndex + 1][historyIndex], table[currentIndex][historyIndex + 1]);
    }
  }

  const diff: RequestDiffLine[] = [];
  let currentIndex = 0;
  let historyIndex = 0;
  while (currentIndex < currentLines.length || historyIndex < historyLines.length) {
    if (
      currentIndex < currentLines.length &&
      historyIndex < historyLines.length &&
      currentLines[currentIndex] === historyLines[historyIndex]
    ) {
      diff.push({ type: "same", line: currentLines[currentIndex] });
      currentIndex++;
      historyIndex++;
      continue;
    }
    if (
      currentIndex < currentLines.length &&
      (historyIndex >= historyLines.length || table[currentIndex + 1][historyIndex] >= table[currentIndex][historyIndex + 1])
    ) {
      diff.push({ type: "removed", line: currentLines[currentIndex] });
      currentIndex++;
      continue;
    }
    if (historyIndex < historyLines.length) {
      diff.push({ type: "added", line: historyLines[historyIndex] });
      historyIndex++;
    }
  }

  return diff;
}

function emptyIterationOutcomeCounts(): Record<IterationHistoryOutcome, number> {
  return {
    shipped: 0,
    killed: 0,
    skipped: 0,
    halted: 0,
  };
}

function normalizeTimelineLimit(limit: number | undefined): number {
  if (limit == null) return DEFAULT_TIMELINE_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid timeline limit "${limit}"`);
  }
  return limit;
}

function normalizeTimelineIteration(iteration: number | undefined): number | null {
  if (iteration == null) return null;
  if (!Number.isFinite(iteration) || !Number.isInteger(iteration) || iteration < 1) {
    throw new Error(`Invalid timeline iteration "${iteration}"`);
  }
  return iteration;
}

function normalizeTimelineOutcome(outcome: unknown): TimelineOutcome | null {
  if (outcome == null) return null;
  if (typeof outcome === "string" && ITERATION_HISTORY_OUTCOMES.includes(outcome as TimelineOutcome)) {
    return outcome as TimelineOutcome;
  }
  throw new Error(`Invalid timeline outcome "${String(outcome)}"`);
}

function normalizeTimelineSource(source: unknown): TimelineSource | null {
  if (source == null) return null;
  if (typeof source === "string" && TIMELINE_SOURCES.includes(source as TimelineSource)) {
    return source as TimelineSource;
  }
  throw new Error(`Invalid timeline source "${String(source)}"`);
}

function normalizeTimelineDomain(domain: unknown): string | null {
  if (domain == null) return null;
  if (typeof domain === "string" && SAFE_HISTORY_DOMAIN.test(domain)) {
    return domain;
  }
  throw new Error(`Invalid timeline domain "${String(domain)}"`);
}

function normalizeSparkHistoryLimit(limit: number | undefined): number {
  if (limit == null) return DEFAULT_SPARK_HISTORY_LIMIT;
  if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`Invalid spark history limit "${limit}"`);
  }
  return limit;
}

function normalizeSparkHistoryDomain(domain: unknown): string | null {
  if (domain == null) return null;
  if (typeof domain === "string" && SAFE_HISTORY_DOMAIN.test(domain)) {
    return domain;
  }
  throw new Error(`Invalid spark history domain "${String(domain)}"`);
}

function normalizeSparkHistoryMode(mode: unknown): SparkHistoryMode | null {
  if (mode == null) return null;
  if (typeof mode === "string" && SPARK_HISTORY_MODES.includes(mode as SparkHistoryMode)) {
    return mode as SparkHistoryMode;
  }
  throw new Error(`Invalid spark history mode "${String(mode)}"`);
}

function normalizeSparkHistoryTimestamp(timestamp: unknown): string | null {
  if (timestamp == null) return null;
  if (typeof timestamp === "string" && timestamp.trim().length > 0 && Number.isFinite(Date.parse(timestamp))) {
    return timestamp;
  }
  throw new Error(`Invalid spark history timestamp "${String(timestamp)}"`);
}

function sparkHistoryTimestampMs(timestamp: string | null): number | null {
  if (timestamp === null) return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function isSparkHistoryEntryInWindow(entry: SparkHistoryEntry, sinceMs: number | null, untilMs: number | null): boolean {
  if (sinceMs === null && untilMs === null) return true;
  const timestamp = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
  if (!Number.isFinite(timestamp)) return false;
  return (sinceMs === null || timestamp >= sinceMs) && (untilMs === null || timestamp <= untilMs);
}

function isSparkHistoryEntry(entry: SparkHistoryEntry): boolean {
  return typeof entry === "object" && entry !== null;
}

function isReplayableSparkHistoryEntry(entry: SparkHistoryEntry): boolean {
  return typeof entry.request_text === "string" && entry.request_text.trim().length > 0;
}

function sortSparkDomainStats(stats: SparkDomainStats[]): SparkDomainStats[] {
  return stats.sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}

function numericIteration(entry: Record<string, unknown>): number | null {
  return typeof entry.iteration === "number" && Number.isFinite(entry.iteration)
    ? entry.iteration
    : null;
}

function stringField(entry: Record<string, unknown>, field: string): string | null {
  const value = entry[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function timelineTokenUsageFromIteration(entry: IterationHistoryEntry): { input: number; output: number } | null {
  const usage = entry.token_usage;
  if (!usage || typeof usage !== "object") return null;
  const input = usage.input;
  const output = usage.output;
  if (typeof input !== "number" || !Number.isFinite(input) || typeof output !== "number" || !Number.isFinite(output)) {
    return null;
  }
  return { input, output };
}

function sumTimelineTokenUsage(entries: TokenUsageHistoryEntry[], iteration: number): { input: number; output: number } {
  return entries.reduce<{ input: number; output: number }>((sum, entry) => {
    if (numericIteration(entry) !== iteration) return sum;
    return {
      input: sum.input + tokenUsageCount(entry, "input_tokens", "input"),
      output: sum.output + tokenUsageCount(entry, "output_tokens", "output"),
    };
  }, { input: 0, output: 0 });
}

export async function getStimuliAuditHistory(opts?: {
  rootDir?: string;
  source?: string;
  action?: StimuliAuditAction;
  status?: StimuliAuditStatus;
  limit?: number;
}): Promise<FoundryStimuliAuditHistory> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const source = opts?.source ? normalizeStimuliSourceName(opts.source) : null;
  const action = normalizeStimuliAuditAction(opts?.action);
  const status = normalizeStimuliAuditStatus(opts?.status);
  const limit = normalizeStimuliHistoryLimit(opts?.limit);
  const entries = (await readJsonlEntries<StimuliAuditEntry>(resolve("logs", "stimuli.jsonl")))
    .filter(isStimuliAuditEntry)
    .filter((entry) => source === null || entry.source === source)
    .filter((entry) => action === null || entry.action === action)
    .filter((entry) => status === null || entry.status === status);

  return {
    source,
    action,
    status,
    limit,
    total: entries.length,
    entries: entries.slice(-limit),
  };
}

export async function getTimeline(opts?: {
  rootDir?: string;
  outcome?: TimelineOutcome;
  source?: TimelineSource;
  domain?: string;
  iteration?: number;
  limit?: number;
}): Promise<FoundryTimeline> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const outcome = normalizeTimelineOutcome(opts?.outcome);
  const source = normalizeTimelineSource(opts?.source);
  const domain = normalizeTimelineDomain(opts?.domain);
  const iterationFilter = normalizeTimelineIteration(opts?.iteration);
  const limit = normalizeTimelineLimit(opts?.limit);
  const [
    iterationEntries,
    decisionEntries,
    testReportEntries,
    monitorEntries,
    tokenUsageEntries,
  ] = await Promise.all([
    readJsonlEntries<IterationHistoryEntry>(resolve("logs", "iterations.jsonl")),
    readJsonlEntries<DecisionHistoryEntry>(resolve("logs", "decisions.jsonl")),
    readJsonlEntries<TestReportHistoryEntry>(resolve("logs", "test-reports.jsonl")),
    readJsonlEntries<MonitorHistoryEntry>(resolve("logs", "monitor.jsonl")),
    readJsonlEntries<TokenUsageHistoryEntry>(resolve("logs", "token-usage.jsonl")),
  ]);
  const entries = iterationEntries
    .filter(isIterationHistoryEntry)
    .filter((entry) => numericIteration(entry) !== null)
    .filter((entry) => outcome === null || entry.outcome === outcome)
    .filter((entry) => source === null || entry.source === source)
    .filter((entry) => domain === null || entry.domain === domain)
    .filter((entry) => iterationFilter === null || numericIteration(entry) === iterationFilter);
  const recent = entries.slice(-limit);

  return {
    outcome,
    source,
    domain,
    iteration: iterationFilter,
    limit,
    total: entries.length,
    entries: recent.map((entry) => {
      const iteration = numericIteration(entry) ?? 0;
      const tokenUsage = timelineTokenUsageFromIteration(entry)
        ?? sumTimelineTokenUsage(tokenUsageEntries.filter(isTokenUsageHistoryEntry), iteration);
      return {
        iteration,
        timestamp: stringField(entry, "timestamp"),
        outcome: stringField(entry, "outcome"),
        title: stringField(entry, "title"),
        domain: stringField(entry, "domain"),
        source: stringField(entry, "source"),
        artifactId: stringField(entry, "artifact_id"),
        reason: stringField(entry, "reason"),
        tokenUsage,
        decisions: {
          gate1: decisionEntries.filter((decision) => numericIteration(decision) === iteration && decision.gate === "gate1").length,
          gate2: decisionEntries.filter((decision) => numericIteration(decision) === iteration && decision.gate === "gate2").length,
        },
        tests: {
          pass: testReportEntries.filter((report) => numericIteration(report) === iteration && report.outcome === "pass").length,
          failFixable: testReportEntries.filter((report) => numericIteration(report) === iteration && report.outcome === "fail_fixable").length,
          failCatastrophic: testReportEntries.filter((report) => numericIteration(report) === iteration && report.outcome === "fail_catastrophic").length,
        },
        monitor: {
          critical: monitorEntries.filter((warning) => numericIteration(warning) === iteration && warning.severity === "critical").length,
          warning: monitorEntries.filter((warning) => numericIteration(warning) === iteration && warning.severity === "warning").length,
          info: monitorEntries.filter((warning) => numericIteration(warning) === iteration && warning.severity === "info").length,
        },
      };
    }),
  };
}

export async function getIterationHistory(opts?: {
  rootDir?: string;
  outcome?: IterationHistoryOutcome;
  source?: IterationHistorySource;
  domain?: string;
  limit?: number;
}): Promise<FoundryIterationHistory> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const outcome = normalizeIterationHistoryOutcome(opts?.outcome);
  const source = normalizeIterationHistorySource(opts?.source);
  const domain = normalizeIterationHistoryDomain(opts?.domain);
  const limit = normalizeIterationHistoryLimit(opts?.limit);
  const entries = (await readJsonlEntries<IterationHistoryEntry>(resolve("logs", "iterations.jsonl")))
    .filter(isIterationHistoryEntry)
    .filter((entry) => outcome === null || entry.outcome === outcome)
    .filter((entry) => source === null || entry.source === source)
    .filter((entry) => domain === null || entry.domain === domain);
  const counts = emptyIterationOutcomeCounts();
  for (const entry of entries) {
    if (ITERATION_HISTORY_OUTCOMES.includes(entry.outcome as IterationHistoryOutcome)) {
      counts[entry.outcome as IterationHistoryOutcome]++;
    }
  }

  return {
    outcome,
    source,
    domain,
    limit,
    total: entries.length,
    counts,
    entries: entries.slice(-limit),
  };
}

export async function getTokenUsageHistory(opts?: {
  rootDir?: string;
  agent?: TokenUsageHistoryAgent;
  model?: string;
  iteration?: number;
  limit?: number;
}): Promise<FoundryTokenUsageHistory> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const agent = normalizeTokenUsageHistoryAgent(opts?.agent);
  const model = normalizeTokenUsageHistoryModel(opts?.model);
  const iteration = normalizeTokenUsageHistoryIteration(opts?.iteration);
  const limit = normalizeTokenUsageHistoryLimit(opts?.limit);
  const entries = (await readJsonlEntries<TokenUsageHistoryEntry>(resolve("logs", "token-usage.jsonl")))
    .filter(isTokenUsageHistoryEntry)
    .filter((entry) => agent === null || entry.agent === agent)
    .filter((entry) => model === null || entry.model === model)
    .filter((entry) => iteration === null || numericIteration(entry) === iteration);

  return {
    agent,
    model,
    iteration,
    limit,
    total: entries.length,
    inputTokens: entries.reduce((sum, entry) => sum + tokenUsageCount(entry, "input_tokens", "input"), 0),
    outputTokens: entries.reduce((sum, entry) => sum + tokenUsageCount(entry, "output_tokens", "output"), 0),
    entries: entries.slice(-limit),
  };
}

export async function getTestReportHistory(opts?: {
  rootDir?: string;
  outcome?: TestReportHistoryOutcome;
  artifact?: string;
  iteration?: number;
  limit?: number;
}): Promise<FoundryTestReportHistory> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const outcome = normalizeTestReportHistoryOutcome(opts?.outcome);
  const artifact = normalizeTestReportHistoryArtifact(opts?.artifact);
  const iteration = normalizeTestReportHistoryIteration(opts?.iteration);
  const limit = normalizeTestReportHistoryLimit(opts?.limit);
  const entries = (await readJsonlEntries<TestReportHistoryEntry>(resolve("logs", "test-reports.jsonl")))
    .filter(isTestReportHistoryEntry)
    .filter((entry) => outcome === null || entry.outcome === outcome)
    .filter((entry) => artifact === null || entry.artifact_id === artifact)
    .filter((entry) => iteration === null || numericIteration(entry) === iteration);

  return {
    outcome,
    artifact,
    iteration,
    limit,
    total: entries.length,
    entries: entries.slice(-limit),
  };
}

export async function getDecisionHistory(opts?: {
  rootDir?: string;
  gate?: DecisionHistoryGate;
  decision?: DecisionHistoryDecision;
  source?: DecisionHistorySource;
  iteration?: number;
  limit?: number;
}): Promise<FoundryDecisionHistory> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const gate = normalizeDecisionHistoryGate(opts?.gate);
  const decision = normalizeDecisionHistoryDecision(opts?.decision);
  const source = normalizeDecisionHistorySource(opts?.source);
  const iteration = normalizeDecisionHistoryIteration(opts?.iteration);
  const limit = normalizeDecisionHistoryLimit(opts?.limit);
  const entries = (await readJsonlEntries<DecisionHistoryEntry>(resolve("logs", "decisions.jsonl")))
    .filter(isDecisionHistoryEntry)
    .filter((entry) => gate === null || entry.gate === gate)
    .filter((entry) => decision === null || entry.decision === decision)
    .filter((entry) => source === null || entry.source === source)
    .filter((entry) => iteration === null || numericIteration(entry) === iteration);

  return {
    gate,
    decision,
    source,
    iteration,
    limit,
    total: entries.length,
    entries: entries.slice(-limit),
  };
}

export async function getMonitorHistory(opts?: {
  rootDir?: string;
  severity?: MonitorSeverity;
  detector?: string;
  iteration?: number;
  limit?: number;
}): Promise<FoundryMonitorHistory> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const severity = normalizeMonitorHistorySeverity(opts?.severity);
  const detector = normalizeMonitorHistoryDetector(opts?.detector);
  const iteration = normalizeMonitorHistoryIteration(opts?.iteration);
  const limit = normalizeMonitorHistoryLimit(opts?.limit);
  const entries = (await readJsonlEntries<MonitorHistoryEntry>(resolve("logs", "monitor.jsonl")))
    .filter(isMonitorHistoryEntry)
    .filter((entry) => severity === null || entry.severity === severity)
    .filter((entry) => detector === null || entry.detector === detector)
    .filter((entry) => iteration === null || numericIteration(entry) === iteration);

  return {
    severity,
    detector,
    iteration,
    limit,
    total: entries.length,
    entries: entries.slice(-limit),
  };
}

export async function getRefineryHistory(opts?: {
  rootDir?: string;
  result?: RefineryHistoryResult;
  sourceType?: RefinerySourceType;
  iteration?: number;
  limit?: number;
}): Promise<FoundryRefineryHistory> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const result = normalizeRefineryHistoryResult(opts?.result);
  const sourceType = normalizeRefineryHistorySourceType(opts?.sourceType);
  const iteration = normalizeRefineryHistoryIteration(opts?.iteration);
  const limit = normalizeRefineryHistoryLimit(opts?.limit);
  const entries = (await readJsonlEntries<RefineryHistoryEntry>(resolve("logs", "refinery.jsonl")))
    .filter(isRefineryHistoryEntry)
    .filter((entry) => result === null || entry.result === result)
    .filter((entry) => sourceType === null || entry.source_type === sourceType)
    .filter((entry) => iteration === null || numericIteration(entry) === iteration);

  return {
    result,
    sourceType,
    iteration,
    limit,
    total: entries.length,
    entries: entries.slice(-limit),
  };
}

export async function getStokerHistory(opts?: {
  rootDir?: string;
  urgency?: StokerUrgency;
  rule?: string;
  iteration?: number;
  limit?: number;
}): Promise<FoundryStokerHistory> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const urgency = normalizeStokerHistoryUrgency(opts?.urgency);
  const rule = normalizeStokerHistoryRule(opts?.rule);
  const iteration = normalizeStokerHistoryIteration(opts?.iteration);
  const limit = normalizeStokerHistoryLimit(opts?.limit);
  const entries = (await readJsonlEntries<StokerHistoryEntry>(resolve("logs", "stoker.jsonl")))
    .filter(isStokerHistoryEntry)
    .filter((entry) => urgency === null || entry.urgency === urgency)
    .filter((entry) => rule === null || stokerHistoryHasRule(entry, rule))
    .filter((entry) => iteration === null || stokerHistoryTargetIteration(entry) === iteration);

  return {
    urgency,
    rule,
    iteration,
    limit,
    total: entries.length,
    entries: entries.slice(-limit),
  };
}

export async function resetStimuliSourceState(
  source: string,
  opts?: { rootDir?: string },
): Promise<StimuliSourceResetResult> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const normalizedSource = normalizeStimuliSourceName(source);

  const stimuliConfig = await loadStimuliConfig();
  requireStimuliSourceConfig(stimuliConfig, normalizedSource);

  const checkpoint = await loadCheckpoint();
  if (!checkpoint) {
    await writeStimuliAudit({
      action: "reset",
      source: normalizedSource,
      status: "no_checkpoint",
      checkpoint_updated: false,
      iteration: null,
      previous: null,
      current: null,
    });
    return {
      status: "no_checkpoint",
      source: normalizedSource,
      previous: null,
      current: null,
    };
  }

  const states = recordToRefreshStates(checkpoint.last_stimuli_refresh ?? {}, stimuliConfig);
  const previous = { ...(states.get(normalizedSource) ?? defaultStimuliRefreshState(normalizedSource)) };
  const current = defaultStimuliRefreshState(normalizedSource);
  states.set(normalizedSource, current);

  await saveCheckpoint({
    ...checkpoint,
    last_stimuli_refresh: refreshStatesToRecord(states),
    saved_at: new Date().toISOString(),
  });

  await writeStimuliAudit({
    action: "reset",
    source: normalizedSource,
    status: "reset",
    checkpoint_updated: true,
    iteration: checkpoint.iteration,
    previous,
    current,
  });

  return {
    status: "reset",
    source: normalizedSource,
    previous,
    current,
  };
}

export async function refreshStimuliSource(
  source: string,
  opts?: { rootDir?: string },
): Promise<StimuliSourceRefreshResult> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const normalizedSource = normalizeStimuliSourceName(source);
  const stimuliConfig = await loadStimuliConfig();
  const sourceConfig = requireStimuliSourceConfig(stimuliConfig, normalizedSource);
  const checkpoint = await loadCheckpoint();
  const states = checkpoint
    ? recordToRefreshStates(checkpoint.last_stimuli_refresh ?? {}, stimuliConfig)
    : null;
  const previous = states
    ? { ...(states.get(normalizedSource) ?? defaultStimuliRefreshState(normalizedSource)) }
    : null;

  try {
    const content = await refreshSource(normalizedSource, sourceConfig);
    let current: StimuliRefreshState | null = null;
    if (checkpoint && states && previous) {
      current = {
        ...previous,
        last_refresh_iteration: checkpoint.iteration,
        consecutive_failures: 0,
        disabled: false,
      };
      states.set(normalizedSource, current);
      await saveCheckpoint({
        ...checkpoint,
        last_stimuli_refresh: refreshStatesToRecord(states),
        saved_at: new Date().toISOString(),
      });
    }

    await writeStimuliAudit({
      action: "refresh",
      source: normalizedSource,
      status: checkpoint ? "refreshed" : "refreshed_no_checkpoint",
      checkpoint_updated: checkpoint !== null,
      iteration: checkpoint?.iteration ?? null,
      content_length: content.length,
      previous,
      current,
    });

    return {
      status: checkpoint ? "refreshed" : "refreshed_no_checkpoint",
      source: normalizedSource,
      iteration: checkpoint?.iteration ?? null,
      checkpointUpdated: checkpoint !== null,
      contentLength: content.length,
      previous,
      current,
    };
  } catch (err) {
    let current: StimuliRefreshState | null = null;
    if (checkpoint && states && previous) {
      const consecutiveFailures = previous.consecutive_failures + 1;
      current = {
        ...previous,
        consecutive_failures: consecutiveFailures,
        disabled: previous.disabled || consecutiveFailures >= 3,
      };
      states.set(normalizedSource, current);
      await saveCheckpoint({
        ...checkpoint,
        last_stimuli_refresh: refreshStatesToRecord(states),
        saved_at: new Date().toISOString(),
      });
    }
    await writeStimuliAudit({
      action: "refresh",
      source: normalizedSource,
      status: "failed",
      checkpoint_updated: checkpoint !== null,
      iteration: checkpoint?.iteration ?? null,
      error: err instanceof Error ? err.message : String(err),
      previous,
      current,
    });
    throw err;
  }
}

function formatStimuliStatusCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function stimuliRecoveryAction(source: string): string {
  return `Inspect source ${source}, then run foundry stimuli reset ${source} after the backend or config is fixed.`;
}

export async function getStimuliStatus(opts?: { rootDir?: string }): Promise<FoundryStimuliStatus> {
  const status = await getStatus(opts);
  const stimuli = status.furnace.stimuli;
  const attention = stimuli.entries.filter((entry) => (
    entry.disabled || entry.consecutiveFailures > 0 || entry.due
  ));
  const failing = stimuli.entries.filter((entry) => entry.consecutiveFailures > 0 && !entry.disabled);
  const disabled = stimuli.entries.filter((entry) => entry.disabled);
  const reasons: string[] = [];
  if (failing.length > 0) {
    reasons.push(formatStimuliStatusCount(failing.length, "stimuli source failing", "stimuli sources failing"));
  }
  if (disabled.length > 0) {
    reasons.push(formatStimuliStatusCount(disabled.length, "stimuli source disabled", "stimuli sources disabled"));
  }

  const recoverySources = new Set([
    ...failing.map((entry) => entry.source),
    ...disabled.map((entry) => entry.source),
  ]);

  return {
    iteration: status.iteration,
    savedAt: status.savedAt,
    health: {
      level: recoverySources.size > 0 ? "warning" : "healthy",
      reasons,
      actions: [...recoverySources].map(stimuliRecoveryAction),
    },
    stimuli,
    attention,
  };
}

export interface FoundryStatus {
  running: boolean;
  iteration: number;
  savedAt: string | null;
  shipped: number;
  killed: number;
  skipped: number;
  critic: FoundryCriticStatus;
  recentOutcomes: Array<{
    iteration: number;
    outcome: string;
    domain?: string;
    source?: "ideator" | "human_redirect";
  }>;
  lastArtifact: string | null;
  intervention: FoundryInterventionStatus;
  furnace: FoundryFurnaceStatus;
}

export interface FoundryCriticStatus {
  artifactRejection: {
    samples: number;
    killed: number;
    shipped: number;
    rejectionRate: number;
    threshold: number;
    pressure: "normal" | "high";
  };
}

export interface FoundryInterventionStatus {
  stopFile: string;
  stopPending: boolean;
  stopPreview: string | null;
  requestsFile: string;
  requestPending: boolean;
  requestPreview: string | null;
}

export interface FoundryFurnaceStatus {
  stoker: {
    forIteration: number;
    urgency: string;
    refineryQueue: number;
    rules: string[];
    hint: string | null;
  } | null;
  stokerCadence: {
    enabled: boolean;
    runInterval: number;
    nextRunIteration: number | null;
    iterationsUntilRun: number | null;
  };
  stokerHeat: StokerTokenHeatStatus;
  complexity: {
    favor: string;
    avoid: string[];
    confidence: string;
    reason: string;
  } | null;
  streak: {
    active: boolean;
    domain?: string;
    length?: number;
    avgRating?: number;
    cooldownDomains: string[];
    cooldownRemaining: number;
  } | null;
  speculative: {
    count: number;
    staleCount: number;
    ideas: Array<{
      title: string;
      domain: string;
      complexity: string;
      decision: string;
      iteration: number;
    }>;
  };
  refinery: {
    enabled: boolean;
    minIterationsBetweenRuns: number;
    lastIteration: number | null;
    nextEligibleIteration: number | null;
    iterationsUntilEligible: number | null;
  };
  refineryFuel: RefineryFuelStatus;
  refineryReadiness: StokerRefineryReadinessStatus;
  stimuli: StimuliRefreshHealth;
  logs: JsonlLogHealth;
  monitor: MonitorWarningStatus;
  health: FurnaceHealthStatus;
}

export type FoundryForecastState = "ready" | "attention" | "blocked";
export type FoundryForecastSignalState = "ready" | "info" | "warning" | "blocked";

export interface FoundryForecastSignal {
  name: string;
  state: FoundryForecastSignalState;
  detail: string;
}

export interface FoundryForecast {
  iteration: number;
  nextIteration: number;
  state: FoundryForecastState;
  summary: string;
  actions: string[];
  signals: FoundryForecastSignal[];
}

export interface FoundrySpark {
  iteration: number;
  nextIteration: number;
  domain: string;
  domainReason: string;
  title: string;
  brief: string;
  constraints: string[];
  signals: string[];
  requestText: string;
}

export interface FoundrySparkDeck {
  iteration: number;
  nextIteration: number;
  count: number;
  sparks: FoundrySpark[];
}

export type SparkHistoryMode = "set" | "append";

export type RequestHistoryAction = "set" | "append" | "clear";

export interface RequestHistoryEntry extends Record<string, unknown> {
  timestamp?: string;
  action?: RequestHistoryAction | string;
  request_file?: string;
  source?: string;
  request_text?: string;
  preview?: string;
  request_length?: number;
  previous_request_length?: number;
}

export interface FoundryRequestHistory {
  action: RequestHistoryAction | null;
  restorable: boolean | null;
  source: string | null;
  contains: string | null;
  since: string | null;
  until: string | null;
  limit: number;
  total: number;
  entries: RequestHistoryEntry[];
}

export interface FoundryRequestStats {
  filters: {
    action: RequestHistoryAction | null;
    source: string | null;
    contains: string | null;
    since: string | null;
    until: string | null;
  };
  total: number;
  byAction: Record<RequestHistoryAction, number>;
  withSource: number;
  withRequestText: number;
  lastEvent: RequestHistoryEntry | null;
  lastSet: RequestHistoryEntry | null;
  lastAppend: RequestHistoryEntry | null;
  lastClear: RequestHistoryEntry | null;
}

export interface FoundryRequestSourceSummary {
  source: string;
  total: number;
  byAction: Record<RequestHistoryAction, number>;
  withRequestText: number;
  latestTimestamp: string | null;
  lastEntry: RequestHistoryEntry | null;
}

export interface FoundryRequestSources {
  filters: {
    action: RequestHistoryAction | null;
    source: string | null;
    contains: string | null;
    since: string | null;
    until: string | null;
  };
  limit: number;
  totalSources: number;
  sources: FoundryRequestSourceSummary[];
}

export interface FoundryRequestRestore {
  from: string;
  sourceAction: string | null;
  sourceRequestFile: string | null;
  requestText: string;
  requestLength: number;
  sourceEntry: RequestHistoryEntry;
}

export type RequestDiffLineType = "same" | "added" | "removed";

export interface RequestDiffLine {
  type: RequestDiffLineType;
  line: string;
}

export interface FoundryRequestDiff {
  from: string;
  sourceAction: string | null;
  sourceRequestFile: string | null;
  currentText: string;
  historyText: string;
  currentLength: number;
  historyLength: number;
  changed: boolean;
  sameLines: number;
  addedLines: number;
  removedLines: number;
  lines: RequestDiffLine[];
}

export interface SparkHistoryEntry extends Record<string, unknown> {
  timestamp?: string;
  mode?: SparkHistoryMode | string;
  domain?: string;
  title?: string;
  next_iteration?: number;
  request_file?: string;
  request_text?: string;
  request_length?: number;
  previous_request_length?: number;
  replayed?: boolean;
  replayed_from_timestamp?: string;
  original_mode?: SparkHistoryMode | string;
}

export interface FoundrySparkHistory {
  domain: string | null;
  mode: SparkHistoryMode | null;
  replayable: boolean | null;
  since: string | null;
  until: string | null;
  limit: number;
  total: number;
  entries: SparkHistoryEntry[];
}

export interface SparkDomainStats {
  domain: string;
  count: number;
  replayed: number;
  replayable: number;
}

export interface FoundrySparkStats {
  filters: {
    domain: string | null;
    mode: SparkHistoryMode | null;
    replayable: boolean | null;
    since: string | null;
    until: string | null;
  };
  total: number;
  original: number;
  replayed: number;
  replayable: number;
  byMode: Record<SparkHistoryMode, number>;
  byDomain: SparkDomainStats[];
  lastEvent: SparkHistoryEntry | null;
  lastReplay: SparkHistoryEntry | null;
}

type StatusIterationOutcome = "shipped" | "killed" | "skipped";
type StatusIterationSource = "ideator" | "human_redirect";
const CRITIC_REJECTION_PRESSURE_THRESHOLD = 0.4;

interface StatusIterationEntry {
  iteration?: unknown;
  outcome?: unknown;
  title?: unknown;
  domain?: unknown;
  source?: unknown;
  token_usage?: unknown;
}

interface StatusIterationLogSummary {
  latestLoggedIteration: number | null;
  lastArtifact: string | null;
  shipped: number;
  killed: number;
  skipped: number;
  domainCounts: Record<string, number>;
  recentOutcomes: FoundryStatus["recentOutcomes"];
  criticWindow: Array<{ iteration: number; rejected: boolean }>;
  totalTokens: { input: number; output: number };
  stokerEntries: StokerIterationEntry[];
}

function isStatusIterationOutcome(outcome: unknown): outcome is StatusIterationOutcome {
  return outcome === "shipped" || outcome === "killed" || outcome === "skipped";
}

function isStatusIterationSource(source: unknown): source is StatusIterationSource {
  return source === "ideator" || source === "human_redirect";
}

function incrementStatusOutcome(summary: StatusIterationLogSummary, outcome: StatusIterationOutcome): void {
  if (outcome === "shipped") {
    summary.shipped++;
  } else if (outcome === "killed") {
    summary.killed++;
  } else {
    summary.skipped++;
  }
}

function recordCriticArtifactDecision(stats: StatsTracker, iteration: number, outcome: StatusIterationOutcome): void {
  if (outcome === "shipped" || outcome === "killed") {
    stats.recordCriticDecision(iteration, outcome === "killed");
  }
}

function summarizeCriticStatus(window: Array<{ iteration: number; rejected: boolean }>): FoundryCriticStatus {
  const killed = window.filter((entry) => entry.rejected).length;
  const shipped = window.length - killed;
  const rejectionRate = window.length > 0 ? killed / window.length : 0;
  return {
    artifactRejection: {
      samples: window.length,
      killed,
      shipped,
      rejectionRate,
      threshold: CRITIC_REJECTION_PRESSURE_THRESHOLD,
      pressure: rejectionRate > CRITIC_REJECTION_PRESSURE_THRESHOLD ? "high" : "normal",
    },
  };
}

function readTokenUsageTotals(tokenUsage: unknown): { input: number; output: number } {
  if (tokenUsage === null || typeof tokenUsage !== "object") {
    return { input: 0, output: 0 };
  }
  const usage = tokenUsage as { input?: unknown; output?: unknown };
  return {
    input: typeof usage.input === "number" && Number.isFinite(usage.input) ? usage.input : 0,
    output: typeof usage.output === "number" && Number.isFinite(usage.output) ? usage.output : 0,
  };
}

async function readIterationStatusLogSummary(): Promise<StatusIterationLogSummary> {
  const summary: StatusIterationLogSummary = {
    latestLoggedIteration: null,
    lastArtifact: null,
    shipped: 0,
    killed: 0,
    skipped: 0,
    domainCounts: {},
    recentOutcomes: [],
    criticWindow: [],
    totalTokens: { input: 0, output: 0 },
    stokerEntries: [],
  };

  try {
    const logPath = resolve("logs", "iterations.jsonl");
    const content = await readFile(logPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (parsed === null || typeof parsed !== "object") continue;
      const entry = parsed as StatusIterationEntry;
      const iteration = typeof entry.iteration === "number" && Number.isFinite(entry.iteration)
        ? entry.iteration
        : null;

      if (iteration !== null) {
        summary.latestLoggedIteration = iteration;
      }

      const tokenTotals = readTokenUsageTotals(entry.token_usage);
      summary.totalTokens.input += tokenTotals.input;
      summary.totalTokens.output += tokenTotals.output;

      if (entry.outcome === "shipped" && typeof entry.title === "string" && entry.title.length > 0) {
        summary.lastArtifact = entry.title;
      }

      if (iteration === null || !isStatusIterationOutcome(entry.outcome)) continue;

      summary.stokerEntries.push({
        iteration,
        outcome: entry.outcome,
        ...(typeof entry.domain === "string" && entry.domain.length > 0 ? { domain: entry.domain } : {}),
        token_usage: tokenTotals,
      });
      incrementStatusOutcome(summary, entry.outcome);
      if (entry.outcome === "shipped" && typeof entry.domain === "string" && entry.domain.length > 0) {
        summary.domainCounts[entry.domain] = (summary.domainCounts[entry.domain] ?? 0) + 1;
      }
      if (entry.outcome === "shipped" || entry.outcome === "killed") {
        summary.criticWindow.push({ iteration, rejected: entry.outcome === "killed" });
        if (summary.criticWindow.length > 20) {
          summary.criticWindow.shift();
        }
      }
      const recent: FoundryStatus["recentOutcomes"][number] = {
        iteration,
        outcome: entry.outcome,
      };
      if (typeof entry.domain === "string" && entry.domain.length > 0) {
        recent.domain = entry.domain;
      }
      if (isStatusIterationSource(entry.source)) {
        recent.source = entry.source;
      }
      summary.recentOutcomes.push(recent);
      if (summary.recentOutcomes.length > 50) {
        summary.recentOutcomes.shift();
      }
    }
  } catch {
    // no log file yet
  }

  return summary;
}

async function readFurnaceStatus(
  targetIteration: number | undefined,
  currentIteration: number,
  stokerConfig?: FoundryConfig["stoker"],
  refineryConfig?: FoundryConfig["refinery"],
  monitorConfig?: FoundryConfig["monitor"],
  stimuliEnabled = false,
  stimuliRecord?: CheckpointState["last_stimuli_refresh"],
): Promise<FoundryFurnaceStatus> {
  const [stokerDirective, complexityBias, streakHistory, speculativeIdeas, lastRefineryIteration, iterationEntries, monitorEntries, refineryFuel, stimuli, logs] = await Promise.all([
    loadStokerDirective().catch(() => null),
    loadComplexityBias().catch(() => null),
    loadStreakHistory().catch(() => null),
    loadSpeculativeIdeas().catch(() => []),
    getLastRefineryIteration().catch(() => null),
    readJsonlEntries<StokerIterationEntry>(resolve("logs", "iterations.jsonl")).catch(() => []),
    readJsonlEntries<Partial<MonitorWarning>>(resolve("logs", "monitor.jsonl")).catch(() => []),
    getRefineryFuelStatus(currentIteration, refineryConfig).catch(() => ({
      enabled: false,
      queueLimit: 0,
      available: 0,
      byType: { dream: 0, companion: 0, lowRated: 0 },
      topTargets: [],
    })),
    readStimuliFurnaceStatus(currentIteration, stimuliEnabled, stimuliRecord),
    readJsonlLogHealth().catch(() => ({
      activeFiles: 0,
      archiveCount: 0,
      totalActiveBytes: 0,
      totalArchiveBytes: 0,
      totalLogBytes: 0,
      rotationThresholdBytes: 50 * 1024 * 1024,
      largestActivePercent: 0,
      largestActiveBytesRemaining: 50 * 1024 * 1024,
      rotationPressure: "clear" as const,
      healthState: "healthy" as const,
      malformedActiveLines: 0,
      malformedActiveFiles: [],
      malformedActiveFileDetails: [],
      recommendedActions: [],
      largestActive: null,
      largestArchive: null,
    })),
  ]);
  const activeStokerDirective = isStokerDirectiveCurrent(stokerDirective, targetIteration)
    ? stokerDirective
    : null;
  const inferredTargetIteration = targetIteration ?? (() => {
    const iterations = iterationEntries
      .map((entry) => entry.iteration)
      .filter((iteration): iteration is number => Number.isFinite(iteration));
    return iterations.length > 0 ? Math.max(...iterations) + 1 : undefined;
  })();
  const currentSpeculativeIdeas = filterCurrentSpeculativeIdeas(speculativeIdeas, inferredTargetIteration);
  const staleSpeculativeCount = inferredTargetIteration == null
    ? 0
    : Math.max(0, speculativeIdeas.length - currentSpeculativeIdeas.length);
  const stokerHeat = getStokerTokenHeatStatus(iterationEntries, stokerConfig);
  const refinery = getRefineryCadenceStatus(currentIteration, lastRefineryIteration, refineryConfig);
  const refineryReadiness = getStokerRefineryReadinessStatus({
    cadence: refinery,
    fuel: refineryFuel,
    heat: stokerHeat,
  });
  const monitor = summarizeMonitorWarnings(monitorEntries, {
    currentIteration,
    activeIterationWindow: monitorConfig?.active_warning_window ?? DEFAULT_MONITOR_CONFIG.active_warning_window,
  });
  const health = summarizeFurnaceHealth(logs, monitor, stimuli);

  return {
    stoker: activeStokerDirective
      ? {
          forIteration: activeStokerDirective.for_iteration,
          urgency: activeStokerDirective.urgency,
          refineryQueue: activeStokerDirective.refinery_queue ?? 0,
          rules: activeStokerDirective.rules_fired ?? [],
          hint: activeStokerDirective.ideator_hint ?? null,
        }
      : null,
    stokerCadence: getStokerCadenceStatus(currentIteration, stokerConfig),
    stokerHeat,
    complexity: complexityBias
      ? {
          favor: complexityBias.recommendation.favor,
          avoid: complexityBias.recommendation.avoid,
          confidence: complexityBias.recommendation.confidence,
          reason: complexityBias.recommendation.reason,
        }
      : null,
    streak: streakHistory
      ? {
          active: Boolean(streakHistory.current),
          domain: streakHistory.current?.domain,
          length: streakHistory.current?.length,
          avgRating: streakHistory.current?.avg_rating,
          cooldownDomains: streakHistory.cooldown_domains,
          cooldownRemaining: streakHistory.cooldown_remaining,
        }
      : null,
    speculative: {
      count: currentSpeculativeIdeas.length,
      staleCount: staleSpeculativeCount,
      ideas: currentSpeculativeIdeas.map((idea) => ({
        title: idea.proposal.title,
        domain: idea.proposal.domain,
        complexity: idea.proposal.complexity,
        decision: idea.critic_evaluation.decision,
        iteration: idea.iteration,
      })),
    },
    refinery,
    refineryFuel,
    refineryReadiness,
    stimuli,
    logs,
    monitor,
    health,
  };
}

async function readStimuliFurnaceStatus(
  currentIteration: number,
  enabled: boolean,
  record: CheckpointState["last_stimuli_refresh"] | undefined,
): Promise<StimuliRefreshHealth> {
  try {
    const stimuliConfig = await loadStimuliConfig();
    const states = recordToRefreshStates(record ?? {}, stimuliConfig);
    return summarizeStimuliRefreshHealth(stimuliConfig, states, currentIteration, enabled);
  } catch {
    return summarizeStimuliRefreshHealth(
      { mcp: {}, stimuli_ttl: 0, skills_per_context: 0 },
      new Map(),
      currentIteration,
      enabled,
    );
  }
}

const REQUEST_PREVIEW_MAX = 160;

function previewRequest(content: string): string {
  const compact = content.trim().replace(/\s+/g, " ");
  return compact.length > REQUEST_PREVIEW_MAX
    ? `${compact.slice(0, REQUEST_PREVIEW_MAX - 3)}...`
    : compact;
}

async function readInterventionStatus(config: FoundryConfig | null): Promise<FoundryInterventionStatus> {
  const stopFile = config?.intervention?.stop_file ?? "STOP";
  const requestsFile = config?.intervention?.requests_file ?? "requests.md";
  const [stopContent, requestContent] = await Promise.all([
    readFile(resolve(stopFile), "utf-8")
      .catch(() => null),
    readFile(resolve(requestsFile), "utf-8")
      .catch(() => ""),
  ]);
  const stopPreview = typeof stopContent === "string" ? previewRequest(stopContent) : "";
  const requestPreview = previewRequest(requestContent);

  return {
    stopFile,
    stopPending: typeof stopContent === "string",
    stopPreview: stopPreview.length > 0 ? stopPreview : null,
    requestsFile,
    requestPending: requestPreview.length > 0,
    requestPreview: requestPreview.length > 0 ? requestPreview : null,
  };
}

export async function getStatus(opts?: { rootDir?: string }): Promise<FoundryStatus> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const [checkpoint, config] = await Promise.all([
    loadCheckpoint(),
    loadConfig().catch(() => null),
  ]);
  const logSummary = await readIterationStatusLogSummary();

  const targetIteration = checkpoint
    ? checkpoint.iteration + 1
    : logSummary.latestLoggedIteration !== null
      ? logSummary.latestLoggedIteration + 1
      : undefined;
  const currentIteration = checkpoint?.iteration ?? logSummary.latestLoggedIteration ?? 0;
  const furnace = await readFurnaceStatus(
    targetIteration,
    currentIteration,
    config?.stoker,
    config?.refinery,
    config?.monitor,
    config?.stimuli?.enabled ?? false,
    checkpoint?.last_stimuli_refresh,
  );
  const intervention = await readInterventionStatus(config);

  if (!checkpoint) {
    return {
      running: !intervention.stopPending,
      iteration: logSummary.latestLoggedIteration ?? 0,
      savedAt: null,
      shipped: logSummary.shipped,
      killed: logSummary.killed,
      skipped: logSummary.skipped,
      critic: summarizeCriticStatus(logSummary.criticWindow),
      recentOutcomes: logSummary.recentOutcomes,
      lastArtifact: logSummary.lastArtifact,
      intervention,
      furnace,
    };
  }

  return {
    running: !intervention.stopPending,
    iteration: checkpoint.iteration,
    savedAt: checkpoint.saved_at,
    shipped: checkpoint.stats.shipped,
    killed: checkpoint.stats.killed,
    skipped: checkpoint.stats.skipped,
    critic: summarizeCriticStatus(checkpoint.stats.critic_rejection_window),
    recentOutcomes: checkpoint.stats.recent_outcomes,
    lastArtifact: logSummary.lastArtifact,
    intervention,
    furnace,
  };
}

function addForecastAction(actions: string[], action: string | null | undefined): void {
  if (!action) return;
  if (!actions.includes(action)) actions.push(action);
}

function addForecastActions(actions: string[], values: string[] | null | undefined): void {
  for (const value of values ?? []) addForecastAction(actions, value);
}

function pluralForecast(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function activeMonitorWarningDetail(status: FoundryStatus): string | null {
  const active = status.furnace.monitor.activeCounts;
  const critical = active.critical ?? 0;
  const warning = active.warning ?? 0;
  if (critical === 0 && warning === 0) return null;
  const parts: string[] = [];
  if (critical > 0) parts.push(pluralForecast(critical, "active critical warning"));
  if (warning > 0) parts.push(pluralForecast(warning, "active warning"));
  return `${parts.join(", ")} over the current monitor window.`;
}

function formatForecastStokerRules(rules: string[]): string {
  return rules.length > 0 ? `, rules ${rules.join(", ")}` : "";
}

function logHealthDetail(status: FoundryStatus): string | null {
  const logs = status.furnace.logs;
  if (logs.healthState === "healthy") return null;
  if (logs.healthState === "malformed" && logs.malformedActiveLines > 0) {
    const files = logs.malformedActiveFileDetails.length > 0
      ? logs.malformedActiveFileDetails
        .map((detail) => `${detail.name} line ${detail.firstMalformedLine}`)
        .join(", ")
      : logs.malformedActiveFiles.join(", ");
    return `${logs.malformedActiveLines} malformed active log ${logs.malformedActiveLines === 1 ? "line" : "lines"} in ${files}.`;
  }
  return `Log health is ${logs.healthState}.`;
}

export function forecastFromStatus(status: FoundryStatus): FoundryForecast {
  const nextIteration = status.iteration + 1;
  const actions: string[] = [];
  const signals: FoundryForecastSignal[] = [];
  const addSignal = (name: string, state: FoundryForecastSignalState, detail: string): void => {
    signals.push({ name, state, detail });
  };

  if (status.intervention.stopPending) {
    const preview = status.intervention.stopPreview ? `: ${status.intervention.stopPreview}` : "";
    addSignal("Intervention", "blocked", `STOP pending at ${status.intervention.stopFile}${preview}`);
    addForecastAction(actions, "Run foundry resume before starting.");
  }
  if (status.intervention.requestPending) {
    const preview = status.intervention.requestPreview ? `: ${status.intervention.requestPreview}` : "";
    addSignal("Human redirect", "warning", `Pending redirect in ${status.intervention.requestsFile}${preview}`);
    addForecastAction(actions, `Review ${status.intervention.requestsFile} or clear it with foundry request clear.`);
  }

  if (status.furnace.health.level !== "healthy") {
    const reasons = status.furnace.health.reasons.length > 0
      ? status.furnace.health.reasons.join("; ")
      : `Furnace health is ${status.furnace.health.level}.`;
    addSignal("Furnace health", "warning", reasons);
    addForecastActions(actions, status.furnace.health.actions);
  }

  const monitorDetail = activeMonitorWarningDetail(status);
  if (monitorDetail) {
    addSignal("Monitor", "warning", monitorDetail);
    addForecastAction(actions, `Run foundry monitor history --iteration ${status.iteration} --json.`);
  }

  const logsDetail = logHealthDetail(status);
  if (logsDetail) {
    addSignal("Log health", "warning", logsDetail);
    addForecastActions(actions, status.furnace.logs.recommendedActions);
  }

  if (status.critic.artifactRejection.pressure === "high") {
    const critic = status.critic.artifactRejection;
    addSignal(
      "Critic pressure",
      "warning",
      `${Math.round(critic.rejectionRate * 100)}% rejected over ${pluralForecast(critic.samples, "artifact decision")}.`,
    );
    addForecastAction(actions, "Inspect recent kills with foundry timeline --json.");
  }

  if (status.furnace.stimuli.disabled > 0 || status.furnace.stimuli.failing > 0) {
    addSignal(
      "Stimuli",
      "warning",
      `${status.furnace.stimuli.failing} failing, ${status.furnace.stimuli.disabled} disabled source${status.furnace.stimuli.disabled === 1 ? "" : "s"}.`,
    );
    addForecastAction(actions, "Run foundry stimuli status --json and repair failing sources.");
  } else if (status.furnace.stimuli.due > 0) {
    addSignal("Stimuli", "info", `${pluralForecast(status.furnace.stimuli.due, "source")} due for refresh.`);
  }

  if (status.furnace.stoker) {
    addSignal(
      "Stoker",
      "ready",
      `${status.furnace.stoker.urgency} directive for #${status.furnace.stoker.forIteration}${formatForecastStokerRules(status.furnace.stoker.rules)}.`,
    );
  } else if (status.furnace.stokerCadence.enabled && status.furnace.stokerCadence.nextRunIteration !== null) {
    const remaining = status.furnace.stokerCadence.iterationsUntilRun ?? 0;
    addSignal(
      "Stoker",
      "info",
      `Next deterministic stoke at #${status.furnace.stokerCadence.nextRunIteration} (${pluralForecast(remaining, "iteration")}).`,
    );
  } else {
    addSignal("Stoker", "info", "Deterministic stoking is disabled.");
  }

  const heatState = status.furnace.stokerHeat.pressure ?? (status.furnace.stokerHeat.hot ? "hot" : "cool");
  if (status.furnace.stokerHeat.hot || heatState === "hot") {
    addSignal(
      "Token heat",
      "warning",
      `${Math.round(status.furnace.stokerHeat.averageTokens)} average tokens is above the ${status.furnace.stokerHeat.threshold} threshold.`,
    );
    addForecastAction(actions, "Let main-loop token heat cool before queueing extra refinery work.");
  }

  const refineryState: FoundryForecastSignalState = status.furnace.refineryReadiness.canQueue
    ? "ready"
    : status.furnace.refineryReadiness.state === "hot"
      ? "warning"
      : "info";
  addSignal("Refinery", refineryState, status.furnace.refineryReadiness.reason);
  if (status.furnace.refineryReadiness.state === "hot") {
    addForecastAction(actions, "Let main-loop token heat cool before queueing extra refinery work.");
  }

  if (status.furnace.complexity) {
    const avoid = status.furnace.complexity.avoid.length > 0
      ? `, avoid ${status.furnace.complexity.avoid.join(", ")}`
      : "";
    addSignal(
      "Complexity",
      "info",
      `Favor ${status.furnace.complexity.favor} (${status.furnace.complexity.confidence})${avoid}: ${status.furnace.complexity.reason}`,
    );
  }

  if (status.furnace.speculative.count > 0) {
    addSignal(
      "Speculative fuel",
      "ready",
      `${pluralForecast(status.furnace.speculative.count, "warmed idea")} is ready for the next Ideator pass.`,
    );
  }
  if (status.furnace.speculative.staleCount > 0) {
    addSignal(
      "Speculative stale fuel",
      "info",
      `${pluralForecast(status.furnace.speculative.staleCount, "stale idea")} ignored for the next Ideator pass.`,
    );
  }

  const blocked = signals.find((signal) => signal.state === "blocked");
  const warnings = signals.filter((signal) => signal.state === "warning");
  const state: FoundryForecastState = blocked ? "blocked" : warnings.length > 0 ? "attention" : "ready";
  const summary = blocked
    ? `Next iteration #${nextIteration} is blocked: ${blocked.detail}.`
    : warnings.length > 0
      ? `Next iteration #${nextIteration} can run, but ${pluralForecast(warnings.length, "signal")} need attention.`
      : `Next iteration #${nextIteration} is ready.`;

  return {
    iteration: status.iteration,
    nextIteration,
    state,
    summary,
    actions,
    signals,
  };
}

export async function getForecast(opts?: { rootDir?: string }): Promise<FoundryForecast> {
  return forecastFromStatus(await getStatus(opts));
}

const SPARK_MOTIFS = [
  "false map",
  "maintenance ritual",
  "self-auditing window",
  "tiny instrument",
  "footnote machine",
  "weather report for a room",
  "catalog of useful mistakes",
  "clock with a missing hand",
  "conversation between tools",
  "manual for an impossible repair",
];

const SPARK_DECK_MAX_COUNT = 10;

const SPARK_DOMAIN_SHAPES: Record<string, string> = {
  fiction: "a three-scene miniature",
  poetry: "a concise poem or poetic system",
  essay: "a focused argument with one sharp example",
  "code-tool": "a single-purpose utility",
  "code-game": "a small playable loop",
  "code-art": "a generative sketch with readable controls",
  music: "a short composition or sound study",
  experiment: "a hybrid artifact with explicit rules",
  worldbuilding: "a compact fictional reference entry",
  "visual-art": "a visual composition with a clear constraint",
  screenplay: "a dialogue-driven scene",
  interactive: "a branching interaction",
  comics: "a panel-by-panel script",
  journalism: "a reported feature sketch",
  performance: "a repeatable performance score",
  "data-narrative": "a data-shaped story",
  translation: "a transcreation with visible choices",
  design: "a designed system or artifact",
  documentation: "creative documentation with practical value",
  correspondence: "an epistolary artifact",
  instruction: "an instruction-based piece",
  archive: "a fictional catalog entry",
  remix: "a transformation of found structure",
  annotation: "a layered commentary",
  manifesto: "a short declaration with teeth",
  "game-design": "a ruleset with a testable mechanic",
  speculative: "a future artifact with implications",
  erasure: "a subtractive text",
  bot: "a bot behavior spec",
  hypertext: "a nodal text",
};

interface ManifestoSparkValue {
  label: string;
  detail: string;
}

function titleCaseSpark(value: string): string {
  return value
    .split(/(\s+|-|_)/)
    .map((part) => /^[a-z]/.test(part) ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part)
    .join("")
    .replace(/_/g, " ");
}

function sentenceFragment(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[.?!]\s*$/, "")
    .trim();
}

function extractManifestoSparkValues(manifesto: string | null | undefined): ManifestoSparkValue[] {
  const values: ManifestoSparkValue[] = [];
  const content = manifesto ?? "";
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*-\s+\*\*([^*]+)\*\*\s*(.*)$/);
    if (!match) continue;
    const label = sentenceFragment(match[1]);
    const detail = sentenceFragment(match[2]);
    if (label) values.push({ label, detail });
  }

  return values.length > 0
    ? values
    : [
        { label: "Specificity over generality", detail: "make concrete choices" },
        { label: "Surprise", detail: "include one unexpected but earned turn" },
        { label: "Craft", detail: "revise toward deliberate structure" },
      ];
}

function countRecentSparkDomains(status: FoundryStatus): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of status.recentOutcomes) {
    if (!entry.domain) continue;
    counts.set(entry.domain, (counts.get(entry.domain) ?? 0) + 1);
  }
  return counts;
}

function rankedSparkDomains(status: FoundryStatus, domains: DomainEntry[]): DomainEntry[] {
  const recentCounts = countRecentSparkDomains(status);
  const cooldownDomains = new Set(status.furnace.streak?.cooldownDomains ?? []);
  const candidates = domains.filter((domain) => !cooldownDomains.has(domain.name));
  const pool = candidates.length > 0 ? candidates : domains;
  const indexed = new Map(domains.map((domain, index) => [domain.name, index]));
  return [...pool].sort((a, b) => {
    const recentDelta = (recentCounts.get(a.name) ?? 0) - (recentCounts.get(b.name) ?? 0);
    if (recentDelta !== 0) return recentDelta;
    const weightDelta = b.weight - a.weight;
    if (weightDelta !== 0) return weightDelta;
    return (indexed.get(a.name) ?? 0) - (indexed.get(b.name) ?? 0);
  });
}

function sparkDomainReason(status: FoundryStatus, domainName: string): string {
  const recentCount = countRecentSparkDomains(status).get(domainName) ?? 0;
  return recentCount === 0
    ? "least used recent domain"
    : `lowest recent pressure (${pluralForecast(recentCount, "recent outcome")})`;
}

function chooseSparkDomain(
  status: FoundryStatus,
  domains: DomainEntry[],
  requestedDomain?: string,
): { domain: DomainEntry; reason: string } {
  if (domains.length === 0) {
    throw new Error("No domains configured for spark generation.");
  }

  if (requestedDomain) {
    const domain = domains.find((entry) => entry.name === requestedDomain);
    if (!domain) {
      throw new Error(`Unknown spark domain '${requestedDomain}'. Available: ${domains.map((entry) => entry.name).join(", ")}`);
    }
    return { domain, reason: "requested via --domain" };
  }

  const domain = rankedSparkDomains(status, domains)[0];
  return { domain, reason: sparkDomainReason(status, domain.name) };
}

function sparkDomainShape(domain: DomainEntry): string {
  return SPARK_DOMAIN_SHAPES[domain.name] ?? `a focused ${domain.name} artifact`;
}

function formatSparkDomainSignal(domainName: string, count: number): string {
  return count === 0
    ? `Range: ${domainName} has no recent outcomes.`
    : `Range: ${domainName} has ${pluralForecast(count, "recent outcome")}.`;
}

export function sparkFromStatus(
  status: FoundryStatus,
  domainsConfig: DomainsConfig,
  opts?: { domain?: string; manifesto?: string | null },
): FoundrySpark {
  const { domain, reason } = chooseSparkDomain(status, domainsConfig.domains, opts?.domain);
  return buildSparkForDomain(status, domainsConfig, domain, reason, {
    manifesto: opts?.manifesto,
  });
}

function buildSparkForDomain(
  status: FoundryStatus,
  domainsConfig: DomainsConfig,
  domain: DomainEntry,
  reason: string,
  opts?: { manifesto?: string | null; motifOffset?: number },
): FoundrySpark {
  const nextIteration = status.iteration + 1;
  const motifOffset = opts?.motifOffset ?? 0;
  const recentDomainCount = countRecentSparkDomains(status).get(domain.name) ?? 0;
  const domainIndex = domainsConfig.domains.findIndex((entry) => entry.name === domain.name);
  const motif = SPARK_MOTIFS[(nextIteration + Math.max(0, domainIndex) + motifOffset) % SPARK_MOTIFS.length];
  const manifestoValues = extractManifestoSparkValues(opts?.manifesto);
  const manifestoValue = manifestoValues[(nextIteration + motifOffset) % manifestoValues.length];
  const shape = sparkDomainShape(domain);
  const domainMaterial = sentenceFragment(domain.description.split(".")[0] ?? domain.description);
  const title = `${titleCaseSpark(domain.name)} for a ${titleCaseSpark(motif)}`;
  const brief = `Build ${shape} around ${motif}. It should make "${manifestoValue.label}" visible in execution.`;
  const constraints = [
    `Use ${domainMaterial.toLowerCase()} as material, not just as a label.`,
    `Protect "${manifestoValue.label}": ${manifestoValue.detail || "make the choice visible"}.`,
  ];
  const signals = [formatSparkDomainSignal(domain.name, recentDomainCount)];

  if (status.furnace.complexity) {
    const avoid = status.furnace.complexity.avoid.length > 0
      ? `; avoid ${status.furnace.complexity.avoid.join(", ")}`
      : "";
    constraints.push(`Favor ${status.furnace.complexity.favor} complexity${avoid}.`);
    signals.push(`Complexity: favor ${status.furnace.complexity.favor} with ${status.furnace.complexity.confidence} confidence.`);
  }

  if (status.furnace.stokerHeat.hot || status.furnace.stokerHeat.pressure === "hot") {
    constraints.push("Keep the scope compact because token heat is already hot.");
    signals.push(`Token heat: hot at ${status.furnace.stokerHeat.thresholdPercent}% of threshold.`);
  }

  if (status.critic.artifactRejection.pressure === "high") {
    const critic = status.critic.artifactRejection;
    constraints.push("Make the success criteria obvious enough for the Critic to evaluate quickly.");
    signals.push(`Critic pressure: ${Math.round(critic.rejectionRate * 100)}% rejection rate over ${pluralForecast(critic.samples, "artifact")}.`);
  }

  if (status.furnace.speculative.count > 0) {
    signals.push(`Speculative fuel: ${pluralForecast(status.furnace.speculative.count, "warmed idea")} available.`);
  }

  const requestText = [
    `Make the next iteration a ${domain.name} artifact.`,
    `Title: ${title}`,
    `Domain: ${domain.name}`,
    `Brief: ${brief}`,
    "Constraints:",
    ...constraints.map((constraint) => `- ${constraint}`),
  ].join("\n");

  return {
    iteration: status.iteration,
    nextIteration,
    domain: domain.name,
    domainReason: reason,
    title,
    brief,
    constraints,
    signals,
    requestText,
  };
}

function validateSparkDeckCount(count: number): number {
  if (!Number.isInteger(count) || count < 1 || count > SPARK_DECK_MAX_COUNT) {
    throw new Error(`Spark deck count must be an integer between 1 and ${SPARK_DECK_MAX_COUNT}.`);
  }
  return count;
}

export function sparkDeckFromStatus(
  status: FoundryStatus,
  domainsConfig: DomainsConfig,
  opts?: { count?: number; domain?: string; manifesto?: string | null },
): FoundrySparkDeck {
  const count = validateSparkDeckCount(opts?.count ?? 3);
  if (domainsConfig.domains.length === 0) {
    throw new Error("No domains configured for spark generation.");
  }

  const selectedDomains = opts?.domain
    ? Array.from({ length: count }, () => chooseSparkDomain(status, domainsConfig.domains, opts.domain))
    : Array.from({ length: count }, (_, index) => {
        const ranked = rankedSparkDomains(status, domainsConfig.domains);
        const domain = ranked[index % ranked.length];
        return { domain, reason: sparkDomainReason(status, domain.name) };
      });

  const sparks = selectedDomains.map(({ domain, reason }, index) => (
    buildSparkForDomain(status, domainsConfig, domain, reason, {
      manifesto: opts?.manifesto,
      motifOffset: index,
    })
  ));

  return {
    iteration: status.iteration,
    nextIteration: status.iteration + 1,
    count,
    sparks,
  };
}

export async function getSpark(opts?: { rootDir?: string; domain?: string }): Promise<FoundrySpark> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const [status, domainsConfig, manifesto] = await Promise.all([
    getStatus(),
    loadDomainsConfig(),
    readFile(resolve("identity", "manifesto.md"), "utf-8").catch(() => null),
  ]);
  return sparkFromStatus(status, domainsConfig, {
    domain: opts?.domain,
    manifesto,
  });
}

export async function getSparkDeck(opts?: { rootDir?: string; domain?: string; count?: number }): Promise<FoundrySparkDeck> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const [status, domainsConfig, manifesto] = await Promise.all([
    getStatus(),
    loadDomainsConfig(),
    readFile(resolve("identity", "manifesto.md"), "utf-8").catch(() => null),
  ]);
  return sparkDeckFromStatus(status, domainsConfig, {
    domain: opts?.domain,
    count: opts?.count,
    manifesto,
  });
}

export async function getRequestHistory(opts?: {
  rootDir?: string;
  action?: RequestHistoryAction;
  restorable?: boolean;
  source?: string;
  contains?: string;
  since?: string;
  until?: string;
  limit?: number;
}): Promise<FoundryRequestHistory> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const action = normalizeRequestHistoryAction(opts?.action);
  const restorable = opts?.restorable === true ? true : null;
  const source = normalizeRequestHistorySource(opts?.source);
  const contains = normalizeRequestHistoryContains(opts?.contains);
  const since = normalizeRequestHistoryTimestamp(opts?.since);
  const until = normalizeRequestHistoryTimestamp(opts?.until);
  const sinceMs = requestHistoryTimestampMs(since);
  const untilMs = requestHistoryTimestampMs(until);
  const limit = normalizeRequestHistoryLimit(opts?.limit);
  const entries = (await readJsonlEntries<RequestHistoryEntry>(resolve("logs", "requests.jsonl")))
    .filter(isRequestHistoryEntry)
    .filter((entry) => action === null || entry.action === action)
    .filter((entry) => restorable !== true || isRestorableRequestHistoryEntry(entry))
    .filter((entry) => source === null || entry.source === source)
    .filter((entry) => requestHistoryEntryContains(entry, contains))
    .filter((entry) => isRequestHistoryEntryInWindow(entry, sinceMs, untilMs));

  return {
    action,
    restorable,
    source,
    contains,
    since,
    until,
    limit,
    total: entries.length,
    entries: entries.slice(-limit),
  };
}

export async function getRequestStats(opts?: {
  rootDir?: string;
  action?: RequestHistoryAction;
  source?: string;
  contains?: string;
  since?: string;
  until?: string;
}): Promise<FoundryRequestStats> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const action = normalizeRequestHistoryAction(opts?.action);
  const source = normalizeRequestHistorySource(opts?.source);
  const contains = normalizeRequestHistoryContains(opts?.contains);
  const since = normalizeRequestHistoryTimestamp(opts?.since);
  const until = normalizeRequestHistoryTimestamp(opts?.until);
  const sinceMs = requestHistoryTimestampMs(since);
  const untilMs = requestHistoryTimestampMs(until);
  const entries = (await readJsonlEntries<RequestHistoryEntry>(resolve("logs", "requests.jsonl")))
    .filter(isRequestHistoryEntry)
    .filter((entry) => action === null || entry.action === action)
    .filter((entry) => source === null || entry.source === source)
    .filter((entry) => requestHistoryEntryContains(entry, contains))
    .filter((entry) => isRequestHistoryEntryInWindow(entry, sinceMs, untilMs));
  const byAction: Record<RequestHistoryAction, number> = { set: 0, append: 0, clear: 0 };
  let withSource = 0;
  let withRequestText = 0;
  let lastSet: RequestHistoryEntry | null = null;
  let lastAppend: RequestHistoryEntry | null = null;
  let lastClear: RequestHistoryEntry | null = null;

  for (const entry of entries) {
    if (entry.action === "set" || entry.action === "append" || entry.action === "clear") {
      byAction[entry.action]++;
      if (entry.action === "set") lastSet = entry;
      if (entry.action === "append") lastAppend = entry;
      if (entry.action === "clear") lastClear = entry;
    }
    if (typeof entry.source === "string" && entry.source.length > 0) {
      withSource++;
    }
    if (typeof entry.request_text === "string" && entry.request_text.trim().length > 0) {
      withRequestText++;
    }
  }

  return {
    filters: {
      action,
      source,
      contains,
      since,
      until,
    },
    total: entries.length,
    byAction,
    withSource,
    withRequestText,
    lastEvent: entries.at(-1) ?? null,
    lastSet,
    lastAppend,
    lastClear,
  };
}

export async function getRequestSources(opts?: {
  rootDir?: string;
  action?: RequestHistoryAction;
  source?: string;
  contains?: string;
  since?: string;
  until?: string;
  limit?: number;
}): Promise<FoundryRequestSources> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const action = normalizeRequestHistoryAction(opts?.action);
  const sourceFilter = normalizeRequestHistorySource(opts?.source);
  const contains = normalizeRequestHistoryContains(opts?.contains);
  const since = normalizeRequestHistoryTimestamp(opts?.since);
  const until = normalizeRequestHistoryTimestamp(opts?.until);
  const sinceMs = requestHistoryTimestampMs(since);
  const untilMs = requestHistoryTimestampMs(until);
  const limit = normalizeRequestSourceLimit(opts?.limit);
  const summaries = new Map<string, FoundryRequestSourceSummary>();
  const entries = (await readJsonlEntries<RequestHistoryEntry>(resolve("logs", "requests.jsonl")))
    .filter(isRequestHistoryEntry)
    .filter((entry) => action === null || entry.action === action)
    .filter((entry) => sourceFilter === null || entry.source === sourceFilter)
    .filter((entry) => requestHistoryEntryContains(entry, contains))
    .filter((entry) => isRequestHistoryEntryInWindow(entry, sinceMs, untilMs));

  for (const entry of entries) {
    const source = typeof entry.source === "string" && entry.source.trim().length > 0
      ? entry.source
      : null;
    if (source === null) continue;

    const summary = summaries.get(source) ?? {
      source,
      total: 0,
      byAction: { set: 0, append: 0, clear: 0 },
      withRequestText: 0,
      latestTimestamp: null,
      lastEntry: null,
    };

    summary.total++;
    if (entry.action === "set" || entry.action === "append" || entry.action === "clear") {
      summary.byAction[entry.action]++;
    }
    if (typeof entry.request_text === "string" && entry.request_text.trim().length > 0) {
      summary.withRequestText++;
    }
    summary.latestTimestamp = typeof entry.timestamp === "string" && entry.timestamp.length > 0
      ? entry.timestamp
      : summary.latestTimestamp;
    summary.lastEntry = entry;
    summaries.set(source, summary);
  }

  const sources = [...summaries.values()]
    .sort((a, b) => requestSourceTimestampMs(b) - requestSourceTimestampMs(a) || b.total - a.total || a.source.localeCompare(b.source));

  return {
    filters: {
      action,
      source: sourceFilter,
      contains,
      since,
      until,
    },
    limit,
    totalSources: sources.length,
    sources: sources.slice(0, limit),
  };
}

export async function getRequestRestore(opts: {
  rootDir?: string;
  from?: string;
  latest?: boolean;
  action?: RequestHistoryAction;
  source?: string;
  contains?: string;
  since?: string;
  until?: string;
}): Promise<FoundryRequestRestore> {
  if (opts.rootDir) setRootDir(opts.rootDir);
  if (opts.from != null && opts.latest === true) {
    throw new Error("Use either request restore --from or --latest, not both");
  }
  if (opts.from == null && opts.latest !== true) {
    throw new Error("Missing request restore source: use --from timestamp or --latest");
  }
  const entries = (await readJsonlEntries<RequestHistoryEntry>(resolve("logs", "requests.jsonl")))
    .filter(isRequestHistoryEntry);
  const from = opts.from != null ? normalizeRequestRestoreTimestamp(opts.from) : null;
  const entry = from !== null
    ? entries.find((candidate) => candidate.timestamp === from)
    : (() => {
        const action = normalizeRequestHistoryAction(opts.action);
        const source = normalizeRequestHistorySource(opts.source);
        const contains = normalizeRequestHistoryContains(opts.contains);
        const since = normalizeRequestHistoryTimestamp(opts.since);
        const until = normalizeRequestHistoryTimestamp(opts.until);
        const sinceMs = requestHistoryTimestampMs(since);
        const untilMs = requestHistoryTimestampMs(until);
        return entries
          .filter(isRestorableRequestHistoryEntry)
          .filter((candidate) => action === null || candidate.action === action)
          .filter((candidate) => source === null || candidate.source === source)
          .filter((candidate) => requestHistoryEntryContains(candidate, contains))
          .filter((candidate) => isRequestHistoryEntryInWindow(candidate, sinceMs, untilMs))
          .at(-1);
      })();
  if (!entry) {
    if (from !== null) {
      throw new Error(`No request history entry found for "${from}"`);
    }
    throw new Error("No restorable request history entry found for latest restore filters");
  }
  if (!isRestorableRequestHistoryEntry(entry)) {
    throw new Error(`Request history entry "${entry.timestamp ?? from ?? "latest"}" has no request text to restore`);
  }
  const requestText = entry.request_text as string;
  const restoredFrom = typeof entry.timestamp === "string" && entry.timestamp.length > 0
    ? entry.timestamp
    : from ?? "latest";
  return {
    from: restoredFrom,
    sourceAction: typeof entry.action === "string" && entry.action.length > 0 ? entry.action : null,
    sourceRequestFile: typeof entry.request_file === "string" && entry.request_file.length > 0 ? entry.request_file : null,
    requestText,
    requestLength: requestText.length,
    sourceEntry: entry,
  };
}

export async function getRequestDiff(opts: {
  rootDir?: string;
  from?: string;
  latest?: boolean;
  action?: RequestHistoryAction;
  source?: string;
  contains?: string;
  since?: string;
  until?: string;
  currentText?: string;
}): Promise<FoundryRequestDiff> {
  const restore = await getRequestRestore({
    rootDir: opts.rootDir,
    from: opts.from,
    latest: opts.latest,
    action: opts.action,
    source: opts.source,
    contains: opts.contains,
    since: opts.since,
    until: opts.until,
  });
  const currentText = opts.currentText ?? "";
  const lines = buildRequestDiffLines(currentText, restore.requestText);
  const sameLines = lines.filter((line) => line.type === "same").length;
  const addedLines = lines.filter((line) => line.type === "added").length;
  const removedLines = lines.filter((line) => line.type === "removed").length;

  return {
    from: restore.from,
    sourceAction: restore.sourceAction,
    sourceRequestFile: restore.sourceRequestFile,
    currentText,
    historyText: restore.requestText,
    currentLength: currentText.length,
    historyLength: restore.requestText.length,
    changed: addedLines > 0 || removedLines > 0,
    sameLines,
    addedLines,
    removedLines,
    lines,
  };
}

export async function getSparkHistory(opts?: {
  rootDir?: string;
  domain?: string;
  mode?: SparkHistoryMode;
  replayable?: boolean;
  since?: string;
  until?: string;
  limit?: number;
}): Promise<FoundrySparkHistory> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const domain = normalizeSparkHistoryDomain(opts?.domain);
  const mode = normalizeSparkHistoryMode(opts?.mode);
  const replayable = opts?.replayable === true ? true : null;
  const since = normalizeSparkHistoryTimestamp(opts?.since);
  const until = normalizeSparkHistoryTimestamp(opts?.until);
  const sinceMs = sparkHistoryTimestampMs(since);
  const untilMs = sparkHistoryTimestampMs(until);
  const limit = normalizeSparkHistoryLimit(opts?.limit);
  const entries = (await readJsonlEntries<SparkHistoryEntry>(resolve("logs", "spark.jsonl")))
    .filter(isSparkHistoryEntry)
    .filter((entry) => domain === null || entry.domain === domain)
    .filter((entry) => mode === null || entry.mode === mode)
    .filter((entry) => replayable !== true || isReplayableSparkHistoryEntry(entry))
    .filter((entry) => isSparkHistoryEntryInWindow(entry, sinceMs, untilMs));

  return {
    domain,
    mode,
    replayable,
    since,
    until,
    limit,
    total: entries.length,
    entries: entries.slice(-limit),
  };
}

export async function getSparkStats(opts?: {
  rootDir?: string;
  domain?: string;
  mode?: SparkHistoryMode;
  replayable?: boolean;
  since?: string;
  until?: string;
}): Promise<FoundrySparkStats> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const domain = normalizeSparkHistoryDomain(opts?.domain);
  const mode = normalizeSparkHistoryMode(opts?.mode);
  const replayableFilter = opts?.replayable === true ? true : null;
  const since = normalizeSparkHistoryTimestamp(opts?.since);
  const until = normalizeSparkHistoryTimestamp(opts?.until);
  const sinceMs = sparkHistoryTimestampMs(since);
  const untilMs = sparkHistoryTimestampMs(until);
  const entries = (await readJsonlEntries<SparkHistoryEntry>(resolve("logs", "spark.jsonl")))
    .filter(isSparkHistoryEntry)
    .filter((entry) => domain === null || entry.domain === domain)
    .filter((entry) => mode === null || entry.mode === mode)
    .filter((entry) => replayableFilter !== true || isReplayableSparkHistoryEntry(entry))
    .filter((entry) => isSparkHistoryEntryInWindow(entry, sinceMs, untilMs));
  const byMode: Record<SparkHistoryMode, number> = { set: 0, append: 0 };
  const byDomain = new Map<string, SparkDomainStats>();
  let replayed = 0;
  let replayable = 0;
  let lastReplay: SparkHistoryEntry | null = null;

  for (const entry of entries) {
    if (entry.mode === "set" || entry.mode === "append") {
      byMode[entry.mode]++;
    }
    if (entry.replayed === true) {
      replayed++;
      lastReplay = entry;
    }
    const entryReplayable = isReplayableSparkHistoryEntry(entry);
    if (entryReplayable) replayable++;

    const domain = typeof entry.domain === "string" && entry.domain.length > 0
      ? entry.domain
      : "unknown-domain";
    const domainStats = byDomain.get(domain) ?? { domain, count: 0, replayed: 0, replayable: 0 };
    domainStats.count++;
    if (entry.replayed === true) domainStats.replayed++;
    if (entryReplayable) domainStats.replayable++;
    byDomain.set(domain, domainStats);
  }

  return {
    filters: {
      domain,
      mode,
      replayable: replayableFilter,
      since,
      until,
    },
    total: entries.length,
    original: entries.length - replayed,
    replayed,
    replayable,
    byMode,
    byDomain: sortSparkDomainStats([...byDomain.values()]),
    lastEvent: entries.at(-1) ?? null,
    lastReplay,
  };
}

/* v8 ignore start */
const isDirectRun = process.argv[1] &&
  import.meta.url === `file://${path.resolve(process.argv[1])}`;

if (isDirectRun) {
  startFoundry().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
/* v8 ignore stop */
