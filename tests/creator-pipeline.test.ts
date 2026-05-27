import { vi, describe, it, expect, beforeEach } from "vitest";
import type { FoundryConfig, ModelsConfig, IdeatorProposal } from "../src/types/index.js";

// Mock dispatchCreator (S-tier fallback)
const mockDispatchCreator = vi.fn();
vi.mock("../src/agents/index.js", () => ({
  dispatchCreator: (...args: any[]) => mockDispatchCreator(...args),
}));

// Mock phase dispatchers
const mockDispatchPlan = vi.fn();
const mockDispatchBuild = vi.fn();
const mockDispatchRevise = vi.fn();
const mockDispatchPolish = vi.fn();
const mockDispatchAssemble = vi.fn();
vi.mock("../src/creator/phases.js", () => ({
  dispatchPlan: (...args: any[]) => mockDispatchPlan(...args),
  dispatchBuild: (...args: any[]) => mockDispatchBuild(...args),
  dispatchRevise: (...args: any[]) => mockDispatchRevise(...args),
  dispatchPolish: (...args: any[]) => mockDispatchPolish(...args),
  dispatchAssemble: (...args: any[]) => mockDispatchAssemble(...args),
}));

import { runCreatorPipeline } from "../src/creator/pipeline.js";

const makeConfig = (): FoundryConfig => ({
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
  },
  projects: { max_active: 2, max_iterations_per_project: 12, allow_standalone_interrupts: true, kickstart_after: 15 },
  stimuli: { enabled: false, stimuli_ttl: 30, skills_per_context: 2, mcp_timeout_seconds: 30 },
  context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 30, critic_review_history: 8, critic_gate1_history: 5 },
  intervention: { requests_file: "requests.md", stop_file: "STOP" },
  logging: { log_all_prompts: true, log_token_usage: true, log_decisions: true, log_test_reports: true },
  recovery: { checkpoint_every: 1, resume_on_crash: true },
  loop: { cooldown_seconds: 2, disk_space_min_gb: 1 },
} as any);

const makeModels = (): ModelsConfig => ({
  agents: {
    ideator: { model: "test", temperature: 0.9, max_tokens: 4096 },
    creator: { model: "test", temperature: 0.7, max_tokens: 8192 },
    tester: { model: "test", temperature: 0.3, max_tokens: 4096 },
    critic: { model: "test", temperature: 0.5, max_tokens: 4096 },
    curator: { model: "test", temperature: 0.5, max_tokens: 4096 },
  },
});

const usage = { input: 100, output: 50 };

const makeProposal = (complexity: string): IdeatorProposal => ({
  title: "Test Artifact", domain: "code-tool", pitch: "A test",
  complexity: complexity as any, why: "Testing",
  project_id: null, stimulus_ref: null,
});

beforeEach(() => vi.clearAllMocks());

describe("creator/pipeline", () => {
  it("delegates S complexity to dispatchCreator", async () => {
    mockDispatchCreator.mockResolvedValue({
      data: { title: "Test", files: [{ path: "main.py", content: "print()" }] },
      usage,
      rawText: "",
    });

    const result = await runCreatorPipeline(
      { config: makeConfig(), models: makeModels(), iteration: 1 },
      makeProposal("S"), "notes",
    );

    expect(result.phasesRun).toEqual(["build"]);
    expect(mockDispatchCreator).toHaveBeenCalledOnce();
    expect(mockDispatchPlan).not.toHaveBeenCalled();
  });

  it("runs plan/build/revise for M complexity", async () => {
    mockDispatchPlan.mockResolvedValue({
      plan: {
        approach: "Build it",
        file_manifest: [{ path: "main.py", purpose: "Entry" }],
        key_decisions: ["Use Python"],
        challenges: ["None"],
        build_order: [["main.py"]],
      },
      usage,
    });
    mockDispatchBuild.mockResolvedValue({
      files: [{ path: "main.py", content: "print()" }],
      usage,
    });
    mockDispatchRevise.mockResolvedValue({
      files: [{ path: "main.py", content: "print('revised')" }],
      usage,
    });

    const result = await runCreatorPipeline(
      { config: makeConfig(), models: makeModels(), iteration: 1 },
      makeProposal("M"), "notes",
    );

    expect(result.phasesRun).toEqual(["plan", "build-1", "revise"]);
    expect(mockDispatchPlan).toHaveBeenCalledOnce();
    expect(mockDispatchBuild).toHaveBeenCalledOnce();
    expect(mockDispatchRevise).toHaveBeenCalledOnce();
  });

  it("falls back to S-tier when plan phase fails", async () => {
    mockDispatchPlan.mockRejectedValue(new Error("YAML failed"));
    mockDispatchCreator.mockResolvedValue({
      data: { title: "Fallback", files: [{ path: "f.py", content: "x" }] },
      usage,
      rawText: "",
    });

    const result = await runCreatorPipeline(
      { config: makeConfig(), models: makeModels(), iteration: 1 },
      makeProposal("M"), "notes",
    );

    expect(result.phasesRun).toContain("build-fallback");
    expect(mockDispatchCreator).toHaveBeenCalledOnce();
  });

  it("merges files across build phases", async () => {
    mockDispatchPlan.mockResolvedValue({
      plan: {
        approach: "Build",
        file_manifest: [
          { path: "a.py", purpose: "A" },
          { path: "b.py", purpose: "B" },
          { path: "c.py", purpose: "C" },
          { path: "d.py", purpose: "D" },
        ],
        key_decisions: [],
        challenges: [],
        build_order: [["a.py"], ["b.py"], ["c.py"], ["d.py"]],
      },
      usage,
    });
    mockDispatchBuild
      .mockResolvedValueOnce({ files: [{ path: "a.py", content: "a" }], usage })
      .mockResolvedValueOnce({ files: [{ path: "b.py", content: "b" }], usage })
      .mockResolvedValueOnce({ files: [{ path: "c.py", content: "c" }], usage })
      .mockResolvedValueOnce({ files: [{ path: "d.py", content: "d" }], usage });
    mockDispatchRevise.mockResolvedValue({
      files: [
        { path: "a.py", content: "a-rev" },
        { path: "b.py", content: "b-rev" },
        { path: "c.py", content: "c-rev" },
        { path: "d.py", content: "d-rev" },
      ],
      usage,
    });
    mockDispatchPolish.mockResolvedValue({
      files: [
        { path: "a.py", content: "a-pol" },
        { path: "b.py", content: "b-pol" },
        { path: "c.py", content: "c-pol" },
        { path: "d.py", content: "d-pol" },
      ],
      usage,
    });

    const result = await runCreatorPipeline(
      { config: makeConfig(), models: makeModels(), iteration: 1 },
      makeProposal("L"), "notes",
    );

    expect(result.phasesRun).toEqual(["plan", "build-1", "build-2", "build-3", "build-4", "revise", "polish"]);
    expect(result.artifact.files).toHaveLength(4);
  });

  it("keeps scheduled L build passes even when the initial manifest is complete", async () => {
    mockDispatchPlan.mockResolvedValue({
      plan: {
        approach: "Build and expand",
        file_manifest: [{ path: "core.py", purpose: "Core" }],
        key_decisions: [],
        challenges: [],
        build_order: [["core.py"]],
      },
      usage,
    });
    mockDispatchBuild
      .mockResolvedValueOnce({ files: [{ path: "core.py", content: "core" }], usage })
      .mockResolvedValueOnce({ files: [{ path: "examples.py", content: "examples" }], usage })
      .mockResolvedValueOnce({ files: [{ path: "tests.py", content: "tests" }], usage })
      .mockResolvedValueOnce({ files: [{ path: "README.md", content: "docs" }], usage });
    mockDispatchRevise.mockResolvedValue({
      files: [
        { path: "core.py", content: "core-rev" },
        { path: "examples.py", content: "examples-rev" },
        { path: "tests.py", content: "tests-rev" },
        { path: "README.md", content: "docs-rev" },
      ],
      usage,
    });
    mockDispatchPolish.mockResolvedValue({
      files: [
        { path: "core.py", content: "core-pol" },
        { path: "examples.py", content: "examples-pol" },
        { path: "tests.py", content: "tests-pol" },
        { path: "README.md", content: "docs-pol" },
      ],
      usage,
    });

    const result = await runCreatorPipeline(
      { config: makeConfig(), models: makeModels(), iteration: 1 },
      makeProposal("L"), "notes",
    );

    expect(mockDispatchBuild).toHaveBeenCalledTimes(4);
    expect(result.phasesRun).toEqual(["plan", "build-1", "build-2", "build-3", "build-4", "revise", "polish"]);
  });

  it("accumulates usage across phases", async () => {
    mockDispatchPlan.mockResolvedValue({
      plan: { approach: "x", file_manifest: [{ path: "a.py", purpose: "a" }], key_decisions: [], challenges: [] },
      usage: { input: 200, output: 100 },
    });
    mockDispatchBuild.mockResolvedValue({
      files: [{ path: "a.py", content: "code" }],
      usage: { input: 300, output: 150 },
    });
    mockDispatchRevise.mockResolvedValue({
      files: [{ path: "a.py", content: "revised" }],
      usage: { input: 250, output: 120 },
    });

    const result = await runCreatorPipeline(
      { config: makeConfig(), models: makeModels(), iteration: 1 },
      makeProposal("M"), "notes",
    );

    expect(result.usage.input).toBe(750);
    expect(result.usage.output).toBe(370);
  });
});
