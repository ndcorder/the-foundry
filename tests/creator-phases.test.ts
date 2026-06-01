import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setRootDir } from "../src/root.js";
import type { FoundryConfig, ModelsConfig, IdeatorProposal } from "../src/types/index.js";

// Mock callModel
const mockCallModel = vi.fn();
vi.mock("../src/model/index.js", () => ({
  callModel: (...args: any[]) => mockCallModel(...args),
}));

// Mock context
const mockBuildSharedContext = vi.fn().mockResolvedValue("shared context");
vi.mock("../src/context/index.js", () => ({
  buildSharedContext: (...args: any[]) => mockBuildSharedContext(...args),
}));

const mockSafeRead = vi.fn().mockResolvedValue("## What We Value\n\nQuality");
vi.mock("../src/context/data.js", () => ({
  safeRead: (...args: any[]) => mockSafeRead(...args),
}));

const mockGetProjectContext = vi.fn().mockResolvedValue("");
vi.mock("../src/files/projects.js", () => ({
  getProjectContext: (...args: any[]) => mockGetProjectContext(...args),
}));

const mockLoadStreakHistory = vi.fn().mockResolvedValue({});
const mockFormatStreakContext = vi.fn().mockReturnValue("");
vi.mock("../src/streaks/index.js", () => ({
  loadStreakHistory: (...args: any[]) => mockLoadStreakHistory(...args),
  formatStreakContext: (...args: any[]) => mockFormatStreakContext(...args),
}));

import { dispatchPlan, dispatchBuild, dispatchRevise, dispatchPolish, dispatchAssemble } from "../src/creator/phases.js";

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "foundry-phases-"));
  setRootDir(tempDir);
  vi.clearAllMocks();
  mockGetProjectContext.mockReset();
  mockGetProjectContext.mockResolvedValue("");

  // Create prompt templates
  const creatorDir = path.join(tempDir, "prompts", "creator");
  mkdirSync(creatorDir, { recursive: true });
  writeFileSync(path.join(creatorDir, "plan.md"), "{shared_context}\n{approved_proposal}\n{critic_sharpening_notes}\n{project_context}\n{manifesto_quality_standards}");
  writeFileSync(path.join(creatorDir, "build.md"), "{plan}\n{approved_proposal_brief}\n{critic_sharpening_notes_brief}\n{prior_files}\n{build_batch}");
  writeFileSync(path.join(creatorDir, "revise.md"), "{approved_proposal_brief}\n{critic_sharpening_notes}\n{key_decisions}\n{manifesto_quality_standards}\n{all_files}");
  writeFileSync(path.join(creatorDir, "polish.md"), "{key_decisions}\n{revised_files}");
  writeFileSync(path.join(creatorDir, "assemble.md"), "{file_manifest}\n{approved_proposal_brief}\n{all_files}");

  mkdirSync(path.join(tempDir, "identity"), { recursive: true });
});
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

const makeCtx = () => ({
  config: {
    foundry: { name: "test", version: "0.1.0" },
    iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
    projects: { max_active: 2, max_iterations_per_project: 12, allow_standalone_interrupts: true },
    stimuli: { enabled: false, stimuli_ttl: 30, skills_per_context: 2, mcp_timeout_seconds: 30 },
    context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 30, critic_review_history: 8, critic_gate1_history: 5 },
    intervention: { requests_file: "requests.md", stop_file: "STOP" },
    logging: { log_all_prompts: true, log_token_usage: true, log_decisions: true, log_test_reports: true },
    recovery: { checkpoint_every: 1, resume_on_crash: true },
    loop: { cooldown_seconds: 2, disk_space_min_gb: 1 },
  } as FoundryConfig,
  models: {
    agents: {
      ideator: { model: "test", temperature: 0.9, max_tokens: 4096 },
      creator: { model: "test", temperature: 0.7, max_tokens: 8192 },
      tester: { model: "test", temperature: 0.3, max_tokens: 4096 },
      critic: { model: "test", temperature: 0.5, max_tokens: 4096 },
      curator: { model: "test", temperature: 0.5, max_tokens: 4096 },
    },
  } as ModelsConfig,
  iteration: 1,
});

const makeProposal = (): IdeatorProposal => ({
  title: "Test", domain: "code-tool", pitch: "A test",
  complexity: "M", why: "Testing",
  project_id: null, stimulus_ref: null,
});

describe("creator/phases", () => {
  describe("dispatchPlan", () => {
    it("returns parsed plan from model response", async () => {
      const planYaml = `plan:
  approach: "Build incrementally"
  file_manifest:
    - path: main.ts
      purpose: Entry point
      estimated_lines: 50
  key_decisions:
    - "Use TypeScript"
  challenges:
    - "Complexity"
  build_order:
    - ["main.ts"]`;
      mockCallModel.mockResolvedValueOnce({ text: planYaml, usage: { input: 200, output: 100 } });

      const ctx = makeCtx();
      const result = await dispatchPlan(ctx, makeProposal(), "notes", 32768);

      expect(result.plan.approach).toBe("Build incrementally");
      expect(result.plan.file_manifest).toHaveLength(1);
      expect(result.usage.input).toBe(200);
    });

    it("normalizes missing build_order", async () => {
      const planYaml = `plan:
  approach: "Build it"
  file_manifest:
    - path: a.ts
      purpose: A
    - path: b.ts
      purpose: B
  key_decisions: []
  challenges: []`;
      mockCallModel.mockResolvedValueOnce({ text: planYaml, usage: { input: 100, output: 50 } });

      const result = await dispatchPlan(makeCtx(), makeProposal(), "notes", 32768);
      expect(result.plan.build_order).toEqual([["a.ts", "b.ts"]]);
    });

    it("includes creator streak context in the plan prompt when active", async () => {
      mockFormatStreakContext.mockReturnValueOnce("## Streak Context\n\nKeep the code run sharp.");
      const planYaml = `plan:
  approach: "Build it"
  file_manifest:
    - path: a.ts
      purpose: A
  key_decisions: []
  challenges: []
  build_order:
    - ["a.ts"]`;
      mockCallModel.mockResolvedValueOnce({ text: planYaml, usage: { input: 100, output: 50 } });

      await dispatchPlan(makeCtx(), makeProposal(), "notes", 32768);

      const systemPrompt = mockCallModel.mock.calls[0][1];
      expect(systemPrompt).toContain("Streak Context");
      expect(mockFormatStreakContext).toHaveBeenCalledWith(expect.anything(), "creator", undefined);
    });

    it("injects project context for project continuation plans", async () => {
      mockGetProjectContext.mockResolvedValueOnce("## Project Brief\n\nPrior project context");
      const planYaml = `plan:
  approach: "Continue the project"
  file_manifest:
    - path: next.md
      purpose: Next installment
  key_decisions: []
  challenges: []
  build_order:
    - ["next.md"]`;
      mockCallModel.mockResolvedValueOnce({ text: planYaml, usage: { input: 100, output: 50 } });

      await dispatchPlan(makeCtx(), { ...makeProposal(), project_id: "P001" }, "notes", 32768);

      const systemPrompt = mockCallModel.mock.calls[0][1];
      expect(mockGetProjectContext).toHaveBeenCalledWith("P001");
      expect(systemPrompt).toContain("Prior project context");
      expect(systemPrompt).not.toContain("No project context");
    });
  });

  describe("dispatchBuild", () => {
    it("returns built files from model response", async () => {
      const buildYaml = `files:
  - path: main.ts
    content: "console.log('hello')"`;
      mockCallModel.mockResolvedValueOnce({ text: buildYaml, usage: { input: 150, output: 80 } });

      const plan = {
        approach: "Build it",
        file_manifest: [{ path: "main.ts", purpose: "Entry" }],
        key_decisions: [],
        challenges: [],
        build_order: [["main.ts"]],
      };

      const result = await dispatchBuild(makeCtx(), makeProposal(), "notes", plan, [], 32768);
      expect(result.files).toHaveLength(1);
      expect(result.files[0].path).toBe("main.ts");
    });
  });

  describe("dispatchRevise", () => {
    it("returns revised files", async () => {
      const reviseYaml = `files:
  - path: main.ts
    content: "console.log('revised')"`;
      mockCallModel.mockResolvedValueOnce({ text: reviseYaml, usage: { input: 100, output: 50 } });

      const files = [{ path: "main.ts", content: "console.log('original')" }];
      const result = await dispatchRevise(makeCtx(), makeProposal(), "notes", null, files, 32768);
      expect(result.files[0].content).toContain("revised");
    });
  });

  describe("dispatchPolish", () => {
    it("returns polished files", async () => {
      const polishYaml = `files:
  - path: main.ts
    content: "console.log('polished')"`;
      mockCallModel.mockResolvedValueOnce({ text: polishYaml, usage: { input: 100, output: 50 } });

      const files = [{ path: "main.ts", content: "console.log('draft')" }];
      const result = await dispatchPolish(makeCtx(), null, files, 32768);
      expect(result.files[0].content).toContain("polished");
    });
  });

  describe("dispatchAssemble", () => {
    it("returns assembled files", async () => {
      const assembleYaml = `files:
  - path: main.ts
    content: "console.log('assembled')"
  - path: utils.ts
    content: "export const x = 1"`;
      mockCallModel.mockResolvedValueOnce({ text: assembleYaml, usage: { input: 200, output: 100 } });

      const files = [{ path: "main.ts", content: "console.log('draft')" }];
      const result = await dispatchAssemble(makeCtx(), makeProposal(), null, files, 100000);
      expect(result.files).toHaveLength(2);
    });
  });

  describe("callPhase retry", () => {
    it("retries on YAML validation failure", async () => {
      mockCallModel
        .mockResolvedValueOnce({ text: "not valid", usage: { input: 50, output: 20 } })
        .mockResolvedValueOnce({
          text: `files:\n  - path: main.ts\n    content: "fixed"`,
          usage: { input: 50, output: 30 },
        });

      const files = [{ path: "main.ts", content: "original" }];
      const result = await dispatchRevise(makeCtx(), makeProposal(), "notes", null, files, 32768);
      expect(result.files[0].content).toBe("fixed");
      expect(mockCallModel).toHaveBeenCalledTimes(2);
    });

    it("throws after exhausting retries", async () => {
      mockCallModel.mockResolvedValue({ text: "garbage", usage: { input: 10, output: 5 } });

      const files = [{ path: "main.ts", content: "original" }];
      await expect(
        dispatchPolish(makeCtx(), null, files, 32768),
      ).rejects.toThrow("Failed after");
    });
  });
});
