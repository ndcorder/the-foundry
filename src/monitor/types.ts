import type { ComplexityBias } from "../complexity/index.js";

export type MonitorSeverity = "info" | "warning" | "critical";

export type CorrectiveAction =
  | { type: "emergency_curator"; reason: string }
  | { type: "anti_repetition_pressure"; context: string }
  | { type: "manifesto_stability_warning"; message: string }
  | { type: "domain_force_diversify"; excluded_domain: string; duration_iterations: number }
  | { type: "complexity_bias_update"; bias: ComplexityBias };

export interface MonitorWarning {
  detector: string;
  severity: MonitorSeverity;
  message: string;
  action?: CorrectiveAction;
  iteration: number;
  timestamp: string;
}

export interface MonitorWarningSnapshot {
  detector: string;
  severity: MonitorSeverity;
  message: string;
  iteration: number | null;
  timestamp: string | null;
}

export interface MonitorWarningStatus {
  counts: Record<MonitorSeverity, number>;
  activeCounts: Record<MonitorSeverity, number>;
  activeWarnings: MonitorWarningSnapshot[];
  activeWindow: {
    currentIteration: number;
    iterations: number;
  } | null;
  recentWarnings: MonitorWarningSnapshot[];
  latestWarning: MonitorWarningSnapshot | null;
}

export type FurnaceHealthLevel = "healthy" | "warning" | "critical";

export interface FurnaceHealthStatus {
  level: FurnaceHealthLevel;
  reasons: string[];
  actions: string[];
}

export interface MonitorConfig {
  active_warning_window: number;
  slop_window: number;
  slop_threshold: number;
  repetition_window: number;
  repetition_threshold: number;
  manifesto_change_window: number;
  manifesto_max_changes: number;
  manifesto_stagnation_threshold: number;
  domain_collapse_window: number;
  domain_collapse_threshold: number;
  domain_force_duration: number;
  complexity_yield_window: number;
  complexity_min_samples_for_confidence: number;
  complexity_high_confidence_samples: number;
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  active_warning_window: 10,
  slop_window: 20,
  slop_threshold: 2.5,
  repetition_window: 15,
  repetition_threshold: 0.6,
  manifesto_change_window: 30,
  manifesto_max_changes: 5,
  manifesto_stagnation_threshold: 50,
  domain_collapse_window: 30,
  domain_collapse_threshold: 0.6,
  domain_force_duration: 5,
  complexity_yield_window: 20,
  complexity_min_samples_for_confidence: 3,
  complexity_high_confidence_samples: 5,
};
