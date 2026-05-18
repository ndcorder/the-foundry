export type MonitorSeverity = "info" | "warning" | "critical";

export type CorrectiveAction =
  | { type: "emergency_curator"; reason: string }
  | { type: "anti_repetition_pressure"; context: string }
  | { type: "manifesto_stability_warning"; message: string }
  | { type: "domain_force_diversify"; excluded_domain: string; duration_iterations: number };

export interface MonitorWarning {
  detector: string;
  severity: MonitorSeverity;
  message: string;
  action?: CorrectiveAction;
  iteration: number;
  timestamp: string;
}

export interface MonitorConfig {
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
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
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
};
