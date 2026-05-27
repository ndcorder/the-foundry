import { describe, it, expect } from "vitest";
import { getComplexityProfile } from "../src/creator/profiles.js";
import type { FoundryConfig } from "../src/types/index.js";

const makeConfig = (overrides?: Record<string, any>): FoundryConfig => ({
  foundry: { name: "test", version: "0.1.0" },
  iteration: {
    max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2,
    curator_interval: 10, domain_cooldown: 3, novelty_window: 5,
    complexity_profiles: {
      S: { max_tokens_per_phase: 16384, budget_warning_threshold: 25000 },
      M: { max_tokens_per_phase: 32768, budget_warning_threshold: 120000 },
      L: { max_tokens_per_phase: 65536, budget_warning_threshold: 400000 },
      XL: { max_tokens_per_phase: 100000, budget_warning_threshold: 800000 },
    },
    ...overrides,
  },
  projects: { max_active: 2, max_iterations_per_project: 12, allow_standalone_interrupts: true, kickstart_after: 15 },
  stimuli: { enabled: false, stimuli_ttl: 30, skills_per_context: 2, mcp_timeout_seconds: 30 },
  context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 30, critic_review_history: 8, critic_gate1_history: 5 },
  intervention: { requests_file: "requests.md", stop_file: "STOP" },
  logging: { log_all_prompts: true, log_token_usage: true, log_decisions: true, log_test_reports: true },
  recovery: { checkpoint_every: 1, resume_on_crash: true },
  loop: { cooldown_seconds: 2, disk_space_min_gb: 1 },
} as any);

describe("creator/profiles", () => {
  it("returns single build phase for S", () => {
    const p = getComplexityProfile("S", makeConfig());
    expect(p.phases).toEqual(["build"]);
    expect(p.maxTokensPerPhase).toBe(16384);
  });

  it("returns plan/build/revise for M", () => {
    const p = getComplexityProfile("M", makeConfig());
    expect(p.phases).toEqual(["plan", "build", "revise"]);
    expect(p.maxTokensPerPhase).toBe(32768);
  });

  it("returns 7 phases for L", () => {
    const p = getComplexityProfile("L", makeConfig());
    expect(p.phases).toHaveLength(7);
    expect(p.phases[0]).toBe("plan");
    expect(p.phases.filter((phase) => phase === "build")).toHaveLength(4);
    expect(p.phases[6]).toBe("polish");
  });

  it("returns 12 phases for XL with assemble", () => {
    const p = getComplexityProfile("XL", makeConfig());
    expect(p.phases).toHaveLength(12);
    expect(p.phases.filter((phase) => phase === "build")).toHaveLength(8);
    expect(p.phases).toContain("assemble");
    expect(p.maxTokensPerPhase).toBe(100000);
  });

  it("falls back to S for unknown complexity", () => {
    const p = getComplexityProfile("Z", makeConfig());
    expect(p.phases).toEqual(["build"]);
  });

  it("uses config overrides when present", () => {
    const p = getComplexityProfile("M", makeConfig({
      complexity_profiles: {
        M: { max_tokens_per_phase: 50000, budget_warning_threshold: 200000 },
      },
    }));
    expect(p.maxTokensPerPhase).toBe(50000);
    expect(p.budgetWarningThreshold).toBe(200000);
  });
});
