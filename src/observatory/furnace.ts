import { loadCheckpoint } from "../checkpoint/index.js";
import { loadConfig } from "../context/config.js";
import { readJsonlEntries } from "../context/index.js";
import { loadComplexityBias, type ComplexityTier } from "../complexity/index.js";
import {
  getLastRefineryIteration,
  getRefineryCadenceStatus,
  getRefineryFuelStatus,
  type RefineryCadenceStatus,
  type RefineryFuelStatus,
} from "../refinery/index.js";
import { filterCurrentSpeculativeIdeas, loadSpeculativeIdeas } from "../speculative/index.js";
import {
  getStokerCadenceStatus,
  getStokerRefineryReadinessStatus,
  getStokerTokenHeatStatus,
  isStokerDirectiveCurrent,
  loadStokerDirective,
  type StokerCadenceStatus,
  type StokerIterationEntry,
  type StokerRefineryReadinessStatus,
  type StokerStreakInstruction,
  type StokerTokenHeatStatus,
  type StokerUrgency,
} from "../stoker/index.js";
import { loadStreakHistory, type StreakBreakReason } from "../streaks/index.js";
import { readJsonlLogHealth, type JsonlLogHealth } from "../logging/index.js";
import {
  loadStimuliConfig,
  recordToRefreshStates,
  summarizeStimuliRefreshHealth,
  type StimuliRefreshHealth,
} from "../stimuli/index.js";
import {
  DEFAULT_MONITOR_CONFIG,
  summarizeFurnaceHealth,
  summarizeMonitorWarnings,
  type FurnaceHealthStatus,
  type MonitorWarning,
  type MonitorWarningStatus,
} from "../monitor/index.js";
import { resolve } from "../root.js";
import type { CheckpointState } from "../types/index.js";

export interface ObservatoryFurnaceTelemetry {
  stoker: {
    forIteration: number;
    urgency: StokerUrgency;
    refineryQueue: number;
    rules: string[];
    hint: string | null;
    complexityOverride: ComplexityTier | null;
    streakInstruction: StokerStreakInstruction;
    moodAmplifier: string | null;
    domainPressure: {
      toward: string[];
      awayFrom: string[];
    } | null;
  } | null;
  stokerCadence: StokerCadenceStatus;
  stokerHeat: StokerTokenHeatStatus;
  critic: {
    artifactRejection: {
      samples: number;
      killed: number;
      shipped: number;
      rejectionRate: number;
      threshold: number;
      pressure: "normal" | "high";
    };
  };
  complexity: {
    favor: ComplexityTier | "balanced";
    avoid: ComplexityTier[];
    confidence: "low" | "medium" | "high";
    reason: string;
    updatedIteration: number;
    yields: Array<{
      tier: ComplexityTier;
      shippedCount: number;
      meanRating: number;
      meanTokenCost: number;
      roi: number;
    }>;
  };
  streak: {
    active: boolean;
    domain: string | null;
    length: number;
    avgRating: number | null;
    artifactIds: string[];
    cooldownDomains: string[];
    cooldownRemaining: number;
    recentBreaks: Array<{
      iteration: number;
      domain: string;
      breakReason: StreakBreakReason;
    }>;
  };
  speculative: {
    count: number;
    staleCount: number;
    ideas: Array<{
      title: string;
      domain: string;
      complexity: ComplexityTier;
      decision: "approve" | "revise" | "reject";
      reason: string;
      iteration: number;
    }>;
  };
  refinery: RefineryCadenceStatus;
  refineryFuel: RefineryFuelStatus;
  refineryReadiness: StokerRefineryReadinessStatus;
  stimuli: StimuliRefreshHealth;
  logs: JsonlLogHealth;
  monitor: MonitorWarningStatus;
  health: FurnaceHealthStatus;
}

const CRITIC_REJECTION_PRESSURE_THRESHOLD = 0.4;
const CRITIC_REJECTION_WINDOW = 20;

function summarizeCriticArtifactRejection(entries: StokerIterationEntry[]): ObservatoryFurnaceTelemetry["critic"] {
  const window: Array<{ rejected: boolean }> = [];
  for (const entry of entries) {
    if (entry.outcome !== "shipped" && entry.outcome !== "killed") continue;
    window.push({ rejected: entry.outcome === "killed" });
    if (window.length > CRITIC_REJECTION_WINDOW) {
      window.shift();
    }
  }

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

async function readIterationPosition(): Promise<{ currentIteration: number; nextIteration?: number; checkpoint: CheckpointState | null }> {
  const checkpoint = await loadCheckpoint().catch(() => null);
  if (checkpoint) return { currentIteration: checkpoint.iteration, nextIteration: checkpoint.iteration + 1, checkpoint };

  const entries = await readJsonlEntries<{ iteration?: number }>(resolve("logs", "iterations.jsonl")).catch(() => []);
  const iterations = entries
    .map((entry) => entry.iteration)
    .filter((iteration): iteration is number => Number.isFinite(iteration));
  if (iterations.length === 0) return { currentIteration: 0, checkpoint: null };
  const currentIteration = Math.max(...iterations);
  return { currentIteration, nextIteration: currentIteration + 1, checkpoint: null };
}

export async function readFurnaceTelemetry(): Promise<ObservatoryFurnaceTelemetry> {
  const [stokerDirective, complexityBias, streakHistory, speculativeIdeas, lastRefineryIteration, iterationPosition, config, iterationEntries, monitorEntries, logs] = await Promise.all([
    loadStokerDirective(),
    loadComplexityBias(),
    loadStreakHistory(),
    loadSpeculativeIdeas(),
    getLastRefineryIteration().catch(() => null),
    readIterationPosition(),
    loadConfig().catch(() => null),
    readJsonlEntries<StokerIterationEntry>(resolve("logs", "iterations.jsonl")).catch(() => []),
    readJsonlEntries<Partial<MonitorWarning>>(resolve("logs", "monitor.jsonl")).catch(() => []),
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
  const activeStokerDirective = isStokerDirectiveCurrent(stokerDirective, iterationPosition.nextIteration)
    ? stokerDirective
    : null;
  const currentSpeculativeIdeas = filterCurrentSpeculativeIdeas(
    speculativeIdeas,
    iterationPosition.nextIteration,
  );
  const staleSpeculativeCount = iterationPosition.nextIteration == null
    ? 0
    : Math.max(0, speculativeIdeas.length - currentSpeculativeIdeas.length);
  const refineryFuel = await getRefineryFuelStatus(
    iterationPosition.currentIteration,
    config?.refinery,
  ).catch(() => ({
    enabled: false,
    queueLimit: 0,
    available: 0,
    byType: { dream: 0, companion: 0, lowRated: 0 },
    topTargets: [],
  }));
  const stokerHeat = getStokerTokenHeatStatus(iterationEntries, config?.stoker);
  const refinery = getRefineryCadenceStatus(
    iterationPosition.currentIteration,
    lastRefineryIteration,
    config?.refinery,
  );
  const refineryReadiness = getStokerRefineryReadinessStatus({
    cadence: refinery,
    fuel: refineryFuel,
    heat: stokerHeat,
  });
  const monitor = summarizeMonitorWarnings(monitorEntries, {
    currentIteration: iterationPosition.currentIteration,
    activeIterationWindow: config?.monitor?.active_warning_window ?? DEFAULT_MONITOR_CONFIG.active_warning_window,
  });
  const stimuli = await readStimuliTelemetry(
    iterationPosition.currentIteration,
    config?.stimuli?.enabled ?? false,
    iterationPosition.checkpoint?.last_stimuli_refresh,
  );
  const health = summarizeFurnaceHealth(logs, monitor, stimuli);

  return {
    stoker: activeStokerDirective
      ? {
          forIteration: activeStokerDirective.for_iteration,
          urgency: activeStokerDirective.urgency,
          refineryQueue: activeStokerDirective.refinery_queue ?? 0,
          rules: activeStokerDirective.rules_fired,
          hint: activeStokerDirective.ideator_hint ?? null,
          complexityOverride: activeStokerDirective.complexity_override ?? null,
          streakInstruction: activeStokerDirective.streak_instruction,
          moodAmplifier: activeStokerDirective.mood_amplifier ?? null,
          domainPressure: activeStokerDirective.domain_pressure
            ? {
                toward: activeStokerDirective.domain_pressure.toward,
                awayFrom: activeStokerDirective.domain_pressure.away_from,
              }
            : null,
        }
      : null,
    stokerCadence: getStokerCadenceStatus(iterationPosition.currentIteration, config?.stoker),
    stokerHeat,
    critic: summarizeCriticArtifactRejection(iterationEntries),
    complexity: {
      favor: complexityBias.recommendation.favor,
      avoid: complexityBias.recommendation.avoid,
      confidence: complexityBias.recommendation.confidence,
      reason: complexityBias.recommendation.reason,
      updatedIteration: complexityBias.updated_iteration,
      yields: complexityBias.yields.map((entry) => ({
        tier: entry.tier,
        shippedCount: entry.shipped_count,
        meanRating: entry.mean_rating,
        meanTokenCost: entry.mean_token_cost,
        roi: entry.roi,
      })),
    },
    streak: {
      active: Boolean(streakHistory.current),
      domain: streakHistory.current?.domain ?? null,
      length: streakHistory.current?.length ?? 0,
      avgRating: streakHistory.current?.avg_rating ?? null,
      artifactIds: streakHistory.current?.artifact_ids ?? [],
      cooldownDomains: streakHistory.cooldown_domains,
      cooldownRemaining: streakHistory.cooldown_remaining,
      recentBreaks: streakHistory.recent_breaks.map((entry) => ({
        iteration: entry.iteration,
        domain: entry.domain,
        breakReason: entry.break_reason,
      })),
    },
    speculative: {
      count: currentSpeculativeIdeas.length,
      staleCount: staleSpeculativeCount,
      ideas: currentSpeculativeIdeas.map((idea) => ({
        title: idea.proposal.title,
        domain: idea.proposal.domain,
        complexity: idea.proposal.complexity,
        decision: idea.critic_evaluation.decision,
        reason: idea.critic_evaluation.reasons,
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

async function readStimuliTelemetry(
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
