import type { ComplexityBias, ComplexityTier } from "../complexity/index.js";
import type { MoodState } from "../mood/index.js";
import type { StreakHistory } from "../streaks/index.js";

export type StokerUrgency = "low" | "normal" | "high";
export type StokerStreakInstruction = "amplify" | "break" | "neutral";
export type StokerForceReason =
  | "token_heat"
  | "quality_escalation"
  | "failure_escalation"
  | "dimension_repair"
  | "human_redirect"
  | "success_amplification"
  | "monitor_warning"
  | "underburn"
  | "domain_rut"
  | "startup_underburn";

export interface StokerConfig {
  enabled: boolean;
  run_interval: number;
  refinery_token_heat_window: number;
  refinery_token_heat_threshold: number;
}

export interface StokerTokenHeatStatus {
  window: number;
  threshold: number;
  samples: number;
  averageTokens: number;
  totalTokens: number;
  peakTokens: number;
  thresholdPercent: number;
  remainingTokensToThreshold: number;
  pressure: "cool" | "warm" | "hot";
  hot: boolean;
}

export type StokerRefineryReadinessState = "ready" | "disabled" | "empty" | "cooldown" | "hot";
export type StokerRefineryReadinessBlocker = Exclude<StokerRefineryReadinessState, "ready">;

export interface StokerRefineryReadinessStatus {
  state: StokerRefineryReadinessState;
  canQueue: boolean;
  blockers: StokerRefineryReadinessBlocker[];
  reason: string;
}

export interface StokerDomainPressure {
  toward: string[];
  away_from: string[];
}

export interface StokerDirective {
  generated_at: string;
  generated_iteration: number;
  for_iteration: number;
  ideator_hint?: string;
  complexity_override?: ComplexityTier;
  refinery_queue?: number;
  mood_amplifier?: string;
  streak_instruction: StokerStreakInstruction;
  domain_pressure?: StokerDomainPressure;
  urgency: StokerUrgency;
  rules_fired: string[];
}

export interface StokerIterationEntry {
  iteration: number;
  outcome: "shipped" | "killed" | "skipped" | "halted";
  domain?: string;
  mean_rating?: string;
  token_usage?: { input: number; output: number };
  duration_ms?: number;
}

export interface StokerForceContext {
  title?: string;
  domain?: string;
  rating?: number;
  threshold?: number;
  dimension?: string;
  complexity?: ComplexityTier;
  spent_tokens?: number;
  target_tokens?: number;
  streak_length?: number;
  request_file?: string;
  request_preview?: string;
  reason?: string;
  warning_count?: number;
  critical_warning_count?: number;
  token_heat_pressure?: StokerTokenHeatStatus["pressure"];
  token_heat_threshold_percent?: number;
}

export interface StokerSignals {
  current_iteration: number;
  for_iteration?: number;
  recent_iterations: StokerIterationEntry[];
  force_reason?: StokerForceReason;
  force_context?: StokerForceContext;
  streak: StreakHistory;
  complexity_bias: ComplexityBias;
  mood: MoodState | null;
  dream_count: number;
  refinery_target_count?: number;
  last_refinery_iteration?: number | null;
  refinery_min_iterations_between_runs?: number;
  refinery_token_heat_window?: number;
  refinery_token_heat_threshold?: number;
}
