// ── Ideator ──────────────────────────────────────────────────────

export interface IdeatorProposal {
  title: string;
  domain: string;
  pitch: string;
  complexity: "S" | "M" | "L";
  why: string;
  project_id: string | null;
  stimulus_ref: string | null;
}

export interface IdeatorResponse {
  ideas: IdeatorProposal[];
}

// ── Critic Gate 1 ────────────────────────────────────────────────

export interface CriticGate1Evaluation {
  title: string;
  decision: "approve" | "reject" | "revise";
  sharpening_notes: string;
  reasons: string;
}

export interface CriticGate1Response {
  evaluations: CriticGate1Evaluation[];
  selected: string;
}

// ── Creator ──────────────────────────────────────────────────────

export interface CreatorFile {
  path: string;
  content: string;
  language?: string;
}

export interface CreatorResponse {
  title: string;
  files: CreatorFile[];
  notes?: string;
}

// ── Tester ───────────────────────────────────────────────────────

export interface TesterTestPlan {
  language: string;
  setup_commands: string[];
  files: Array<{ path: string; content: string }>;
  run_command: string;
}

export interface TesterTestResult {
  name: string;
  result: "pass" | "fail";
  details: string;
}

export interface TesterIssue {
  severity: "critical" | "major" | "minor";
  description: string;
  location: string;
  suggested_fix?: string;
}

export interface TesterResponse {
  verdict: "pass" | "fail_fixable" | "fail_catastrophic";
  summary: string;
  tests_run: TesterTestResult[];
  issues: TesterIssue[];
  post_mortem?: string;
  test_plan?: TesterTestPlan;
}

// ── Critic Gate 2 ────────────────────────────────────────────────

export interface CriticRatings {
  originality: number;
  specificity: number;
  craft: number;
  surprise: number;
  coherence: number;
  portfolio_fit: number;
  technical_quality?: number;
}

export interface CriticGate2Response {
  decision: "ship" | "revise" | "kill";
  ratings: CriticRatings;
  review: string;
  revision_notes?: string;
  kill_reason?: string;
}

// ── Curator redirect ─────────────────────────────────────────────

export interface CuratorRedirectResponse {
  proposal: IdeatorProposal;
}

// ── Curator full cycle ────────────────────────────────────────

export interface ManifestoChange {
  section: string;
  old: string;
  new: string;
  reason: string;
}

export interface ProjectDecision {
  project_id: string;
  action: "continue" | "complete" | "abandon" | "extend";
  reason: string;
}

export interface StimuliAction {
  action: "refresh" | "commission_skill";
  target: string;
  content?: string;
}

export interface CuratorFullResponse {
  retrospective: string;
  compressed_journal: string;
  manifesto_changes: ManifestoChange[];
  domain_recommendations: string;
  project_decisions: ProjectDecision[];
  stimuli_actions: StimuliAction[];
  human_redirect: null | { proposal: IdeatorProposal };
}

// ── Iteration result ─────────────────────────────────────────────

export interface IterationResult {
  iteration: number;
  outcome: "shipped" | "killed" | "skipped" | "halted";
  artifact_id?: string;
  title?: string;
  domain?: string;
  ratings?: CriticRatings;
  reason?: string;
  token_usage: { input: number; output: number };
  duration_ms: number;
}
