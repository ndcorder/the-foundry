export * from "./agents.js";

export type {
  FoundryConfig,
  AgentModelConfig,
  ModelsConfig,
  DomainEntry,
  DomainsConfig,
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
  decision: "approve" | "reject" | "revise" | "ship" | "kill";
  proposal_title?: string;
  artifact_id?: string;
  ratings?: Record<string, number>;
  review?: string;
  sharpening_notes?: string;
  reasons?: string;
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
