import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setRootDir } from "../src/root.js";
import type { FoundryConfig, ModelsConfig } from "../src/types/index.js";
import type { RefineryTarget } from "../src/refinery/index.js";

const mockCallModel = vi.fn();
vi.mock("../src/model/index.js", () => ({
  callModel: (...args: any[]) => mockCallModel(...args),
}));

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "foundry-refinery-dispatch-"));
  setRootDir(tempDir);
  vi.clearAllMocks();

  mkdirSync(path.join(tempDir, "prompts"), { recursive: true });
  writeFileSync(
    path.join(tempDir, "prompts", "refinery.md"),
    [
      "Refinery prompt",
      "",
      "{source_context}",
      "",
      "{refinement_instructions}",
    ].join("\n"),
    "utf-8",
  );
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const makeConfig = (): FoundryConfig => ({
  foundry: { name: "test", version: "0.1.0" },
  iteration: {
    max_idea_retries: 3,
    max_revision_rounds: 2,
    max_test_fix_cycles: 2,
    curator_interval: 10,
    domain_cooldown: 3,
    novelty_window: 5,
  },
  projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
  stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
  context: {
    journal_compressed_max_tokens: 4000,
    portfolio_index_max_entries: 50,
    critic_review_history: 5,
    critic_gate1_history: 5,
  },
  intervention: { requests_file: "requests.md", stop_file: "STOP" },
  logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
  recovery: { checkpoint_every: 5, resume_on_crash: true },
  refinery: { enabled: true, min_iterations_between_runs: 5, max_refinery_queue: 1 },
  loop: { cooldown_seconds: 2, disk_space_min_gb: 1 },
});

const makeModels = (): ModelsConfig => ({
  agents: {
    ideator: { model: "ideator-model", temperature: 0.9, max_tokens: 4096 },
    creator: { model: "creator-model", temperature: 0.7, max_tokens: 8192 },
    tester: { model: "tester-model", temperature: 0.3, max_tokens: 4096 },
    critic: { model: "critic-model", temperature: 0.5, max_tokens: 4096 },
    curator: { model: "curator-model", temperature: 0.5, max_tokens: 4096 },
  },
});

function target(overrides: Partial<RefineryTarget> = {}): RefineryTarget {
  return {
    source_type: "dream",
    source_id: "0007",
    source_title: "Clock Complaint Ledger",
    source_domain: "prose",
    resurrection_hint: "Rebuild it as escalating timestamped complaints.",
    original_content: "Pitch: A clock complains about time.\nWhat was good: the voice was exact.",
    refinement_type: "resurrected",
    ...overrides,
  };
}

describe("refinery dispatcher", () => {
  it("formats source context with target metadata and original material", async () => {
    const refinery = await import("../src/refinery/index.js") as any;
    expect(typeof refinery.formatRefinerySourceContext).toBe("function");

    const context = refinery.formatRefinerySourceContext(target({ original_rating: 3.2 }));

    expect(context).toContain("Source type: dream");
    expect(context).toContain("Source id: 0007");
    expect(context).toContain("Title: Clock Complaint Ledger");
    expect(context).toContain("Domain: prose");
    expect(context).toContain("Refinement type: resurrected");
    expect(context).toContain("Original rating: 3.2");
    expect(context).toContain("Resurrection hint: Rebuild it as escalating timestamped complaints.");
    expect(context).toContain("Pitch: A clock complains about time.");
  });

  it("dispatches a refinery target through the creator model with refinement context", async () => {
    const creatorYaml = [
      'title: "Clock Complaint Ledger: Second Wind"',
      "files:",
      "  - path: README.md",
      "    content: |",
      "      # Clock Complaint Ledger: Second Wind",
      "      A sharper artifact.",
      'notes: "Refined from a killed dream."',
    ].join("\n");
    mockCallModel.mockResolvedValueOnce({ text: creatorYaml, usage: { input: 100, output: 45 } });

    const refinery = await import("../src/refinery/index.js") as any;
    expect(typeof refinery.dispatchRefinery).toBe("function");
    const result = await refinery.dispatchRefinery(makeConfig(), makeModels(), 12, target());

    expect(result.artifact.title).toBe("Clock Complaint Ledger: Second Wind");
    expect(result.artifact.files[0].path).toBe("README.md");
    expect(result.usage).toEqual({ input: 100, output: 45 });
    expect(result.rawText).toBe(creatorYaml);

    const [agentConfig, systemPrompt, userMessage, iteration, agentName] = mockCallModel.mock.calls[0];
    expect(agentConfig).toMatchObject({
      model: "creator-model",
      temperature: 0.5,
      max_tokens: 8192,
    });
    expect(systemPrompt).toContain("Clock Complaint Ledger");
    expect(systemPrompt).toContain("Resurrection hint");
    expect(systemPrompt).toContain("resurrect");
    expect(systemPrompt).not.toContain("{source_context}");
    expect(systemPrompt).not.toContain("{refinement_instructions}");
    expect(userMessage).toBe("Begin.");
    expect(iteration).toBe(12);
    expect(agentName).toBe("refinery");
  });

  it("retries invalid creator YAML with a correction prompt and aggregates usage", async () => {
    mockCallModel
      .mockResolvedValueOnce({ text: 'title: "Missing files"', usage: { input: 30, output: 10 } })
      .mockResolvedValueOnce({
        text: [
          'title: "Remastered Weather Map"',
          "files:",
          "  - path: README.md",
          "    content: Remastered content",
        ].join("\n"),
        usage: { input: 40, output: 20 },
      });

    const refinery = await import("../src/refinery/index.js") as any;
    expect(typeof refinery.dispatchRefinery).toBe("function");
    const result = await refinery.dispatchRefinery(
      makeConfig(),
      makeModels(),
      13,
      target({
        source_type: "low_rated",
        source_id: "0012",
        source_title: "Weather Map",
        original_rating: 3.1,
        refinement_type: "remastered",
      }),
    );

    expect(result.artifact.title).toBe("Remastered Weather Map");
    expect(result.usage).toEqual({ input: 70, output: 30 });
    expect(mockCallModel).toHaveBeenCalledTimes(2);
    expect(mockCallModel.mock.calls[1][2]).toContain("YAML validation failed");
    expect(mockCallModel.mock.calls[1][4]).toBe("refinery-retry1");
  });
});
