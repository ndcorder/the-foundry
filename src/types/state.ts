// ── Checkpoint ────────────────────────────────────────────────

export interface CheckpointState {
  iteration: number;
  active_project_ids: string[];
  domain_counts: Record<string, number>;
  last_stimuli_refresh: Record<string, number>;
  last_curator_run: number;
  stats: StatsSnapshot;
  saved_at: string;
}

// ── Stats ─────────────────────────────────────────────────────

export interface StatsSnapshot {
  iteration: number;
  shipped: number;
  killed: number;
  skipped: number;
  domain_counts: Record<string, number>;
  recent_outcomes: Array<{ iteration: number; outcome: string; domain?: string }>;
  critic_rejection_window: Array<{ iteration: number; rejected: boolean }>;
  total_tokens: { input: number; output: number };
}

// ── Project ───────────────────────────────────────────────────

export interface ProjectBrief {
  name: string;
  description: string;
  estimated_iterations: number;
  structure: Array<Record<string, string>>;
}

export interface ProjectStatus {
  project_id: string;
  name: string;
  status: "active" | "complete" | "abandoned";
  estimated_iterations: number;
  completed_iterations: number;
  last_iteration: number;
  created_at: string;
  completed_at?: string;
  abandoned_reason?: string;
}

// ── Stimuli state ─────────────────────────────────────────────

export interface StimuliSourceConfig {
  server: string;
  query_template?: string;
  queries?: string[];
  strategy?: string;
  max_items: number;
  refresh_interval: number;
}

export interface StimuliConfig {
  mcp: Record<string, StimuliSourceConfig>;
  stimuli_ttl: number;
  skills_per_context: number;
}

export interface StimuliRefreshState {
  source: string;
  last_refresh_iteration: number;
  consecutive_failures: number;
  disabled: boolean;
}
