export interface ComplexityProfileConfig {
  max_tokens_per_phase: number;
  budget_warning_threshold: number;
}

export interface StreaksConfig {
  min_length_for_amplify: number;
  cooldown_after_break: number;
  high_rating_threshold: number;
  rating_break_threshold: number;
}

export interface ComplexityConfig {
  yield_window: number;
  min_samples_for_confidence: number;
  high_confidence_samples: number;
}

export interface StokerConfig {
  enabled: boolean;
  run_interval: number;
  refinery_token_heat_window: number;
  refinery_token_heat_threshold: number;
}

export interface SpeculativeConfig {
  enabled: boolean;
  max_carried_ideas: number;
}

export interface RefineryConfig {
  enabled: boolean;
  min_iterations_between_runs: number;
  max_refinery_queue: number;
}

export interface MonitorRuntimeConfig {
  active_warning_window?: number;
}

export interface FoundryConfig {
  foundry: {
    name: string;
    version: string;
  };
  iteration: {
    max_idea_retries: number;
    max_revision_rounds: number;
    max_test_fix_cycles: number;
    ideation_burst_count?: number;
    curator_interval: number;
    domain_cooldown: number;
    novelty_window: number;
    complexity_profiles?: Record<string, ComplexityProfileConfig>;
  };
  projects: {
    max_active: number;
    max_iterations_per_project: number;
    allow_standalone_interrupts: boolean;
    kickstart_after?: number;
  };
  stimuli: {
    enabled: boolean;
    stimuli_ttl: number;
    skills_per_context: number;
    mcp_timeout_seconds: number;
  };
  context: {
    journal_compressed_max_tokens: number;
    portfolio_index_max_entries: number;
    critic_review_history: number;
    critic_gate1_history: number;
  };
  intervention: {
    requests_file: string;
    stop_file: string;
  };
  logging: {
    log_all_prompts: boolean;
    log_token_usage: boolean;
    log_decisions: boolean;
    log_test_reports: boolean;
  };
  recovery: {
    checkpoint_every: number;
    resume_on_crash: boolean;
  };
  streaks?: StreaksConfig;
  complexity?: ComplexityConfig;
  stoker?: StokerConfig;
  speculative?: SpeculativeConfig;
  refinery?: RefineryConfig;
  monitor?: MonitorRuntimeConfig;
  loop: {
    cooldown_seconds: number;
    disk_space_min_gb: number;
    concurrency?: number;
  };
  git?: {
    auto_commit?: boolean;
    auto_push?: boolean;
  };
}

export interface AgentModelConfig {
  model: string;
  temperature: number;
  max_tokens: number;
  provider?: string;
  reasoning_effort?: string;
}

export interface ModelTierOverride {
  agent: string;
  model: string;
  start_iteration: number;
  end_iteration: number;
  label: string;
}

export interface ModelsConfig {
  agents: {
    ideator: AgentModelConfig;
    creator: AgentModelConfig;
    tester: AgentModelConfig;
    critic: AgentModelConfig;
    curator: AgentModelConfig;
  };
  overrides?: ModelTierOverride[];
}

export interface DomainEntry {
  name: string;
  description: string;
  weight: number;
}

export interface DomainsConfig {
  domains: DomainEntry[];
}
