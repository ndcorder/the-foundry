export * from "./agents.js";
export * from "./state.js";

export type {
  FoundryConfig,
  AgentModelConfig,
  ModelsConfig,
  ModelTierOverride,
  DomainEntry,
  DomainsConfig,
  ComplexityProfileConfig,
  StreaksConfig,
  ComplexityConfig,
  StokerConfig,
  SpeculativeConfig,
  RefineryConfig,
} from "./config.js";

export type AgentRole = "ideator" | "creator" | "tester" | "critic" | "curator";

export interface ContextBlock {
  shared: string;
  agentSpecific: string;
  full: string;
}

export interface DecisionLogEntry {
  timestamp: string;
  iteration: number;
  gate: "gate1" | "gate2";
  agent: "critic";
  source?: "ideator" | "human_redirect";
  decision: "approve" | "reject" | "revise" | "ship" | "kill";
  proposal_title?: string;
  artifact_id?: string;
  ratings?: Record<string, number>;
  review?: string;
  sharpening_notes?: string;
  reasons?: string;
  recommended_complexity?: "S" | "M" | "L" | "XL" | null;
}

export interface TestReportEntry {
  timestamp: string;
  iteration: number;
  artifact_id: string;
  outcome: "pass" | "fail_fixable" | "fail_catastrophic";
  summary: string;
  tests_run: number;
  tests_passed: number;
  tests_failed: number;
  details?: string;
  error_output?: string;
}
