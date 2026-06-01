export type StreakBreakReason = "killed" | "low_rating" | "domain_shift";

export interface StreakState {
  active: true;
  length: number;
  domain: string;
  avg_rating: number;
  start_iteration: number;
  last_iteration: number;
  artifact_ids: string[];
  project_id?: string | null;
}

export interface StreakBreak {
  iteration: number;
  domain: string;
  break_reason: StreakBreakReason;
}

export interface StreakHistory {
  current: StreakState | null;
  recent_breaks: StreakBreak[];
  cooldown_domains: string[];
  cooldown_remaining: number;
}

export interface StreakConfig {
  min_length_for_amplify: number;
  cooldown_after_break: number;
  high_rating_threshold: number;
  rating_break_threshold: number;
}

export type StreakIterationResult =
  | {
      iteration: number;
      outcome: "shipped";
      artifact_id: string;
      title?: string;
      domain: string;
      mean_rating: string | number;
      project_id?: string | null;
    }
  | {
      iteration: number;
      outcome: "killed";
      artifact_id?: string;
      title?: string;
      domain?: string;
      reason?: string;
      project_id?: string | null;
    }
  | {
      iteration: number;
      outcome: "skipped" | "halted";
      reason?: string;
    };
