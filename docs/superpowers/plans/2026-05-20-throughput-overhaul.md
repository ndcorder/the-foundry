# Throughput Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement complexity-scaled multi-call Creator pipeline with XL tier, Critic-driven ambition scaling, and project activation to achieve 10-20x token throughput increase.

**Architecture:** A new `src/creator/` module replaces the single-shot `dispatchCreator` call with a phase pipeline (plan → build → revise → polish) whose depth scales with complexity (S/M/L/XL). Complexity distribution tracking feeds into the Critic's Gate 1 evaluation to push ambition organically. Ideator and Curator nudges activate the dormant project system.

**Tech Stack:** TypeScript (strict), Vitest, YAML (agent I/O), JSONL (logging)

---

### Task 1: Types & Config — Expand Complexity to Include XL

**Goal:** Add XL to the complexity enum, new fields to `IdeatorProposal`, complexity profile types to config, and update the YAML schema/validator.

**Files:**
- Modify: `src/types/agents.ts:1-12` (IdeatorProposal)
- Modify: `src/types/config.ts:1-15` (FoundryConfig.iteration, FoundryConfig.projects)
- Modify: `src/types/index.ts` (re-export new types)
- Modify: `src/parser/yaml-parser.ts:25-35` (ideator schema enum)
- Modify: `config/foundry.yml` (add complexity_profiles, kickstart_after)
- Test: `tests/parser.test.ts`
- Test: `tests/types-config.test.ts` (new)

**Acceptance Criteria:**
- [ ] `IdeatorProposal.complexity` accepts `"S" | "M" | "L" | "XL"`
- [ ] `IdeatorProposal` has optional `xl_mode` and `project` fields
- [ ] `FoundryConfig` has `complexity_profiles` and `projects.kickstart_after`
- [ ] Parser schema accepts `"XL"` in complexity enum
- [ ] `validateIdeator` passes with XL proposals
- [ ] `config/foundry.yml` loads with new fields

**Verify:** `npx vitest run tests/parser.test.ts --reporter=verbose` → all pass including new XL cases

**Steps:**

- [ ] **Step 1: Update IdeatorProposal type**

```typescript
// src/types/agents.ts — replace IdeatorProposal
export interface IdeatorProposal {
  title: string;
  domain: string;
  pitch: string;
  complexity: "S" | "M" | "L" | "XL";
  why: string;
  project_id: string | null;
  stimulus_ref: string | null;
  xl_mode?: "single" | "project";
  project?: {
    name: string;
    description: string;
    estimated_iterations: number;
    structure: Array<Record<string, string>>;
  };
}
```

- [ ] **Step 2: Add complexity profile types to config**

```typescript
// src/types/config.ts — add to FoundryConfig.iteration
export interface ComplexityProfileConfig {
  max_tokens_per_phase: number;
  budget_warning_threshold: number;
}

// Add to FoundryConfig:
iteration: {
  // ... existing fields ...
  complexity_profiles: Record<string, ComplexityProfileConfig>;
};
projects: {
  // ... existing fields ...
  kickstart_after: number;
};
```

- [ ] **Step 3: Re-export new types from index**

```typescript
// src/types/index.ts — add to existing exports
export type { ComplexityProfileConfig } from "./config.js";
```

- [ ] **Step 4: Update parser schema to accept XL**

```typescript
// src/parser/yaml-parser.ts — in SCHEMAS.ideator.properties.ideas.items.properties
complexity: { type: "string", enum: ["S", "M", "L", "XL"] },
// Add optional fields:
xl_mode: { type: "string", enum: ["single", "project"] },
project: { type: "object" },
```

- [ ] **Step 5: Update foundry.yml config**

```yaml
# config/foundry.yml — add under iteration:
  complexity_profiles:
    S:
      max_tokens_per_phase: 16384
      budget_warning_threshold: 25000
    M:
      max_tokens_per_phase: 32768
      budget_warning_threshold: 120000
    L:
      max_tokens_per_phase: 65536
      budget_warning_threshold: 400000
    XL:
      max_tokens_per_phase: 100000
      budget_warning_threshold: 800000

# Add under projects:
  kickstart_after: 15
```

- [ ] **Step 6: Write tests for XL validation**

```typescript
// tests/parser.test.ts — add to validateIdeator describe block
it('accepts XL complexity with xl_mode', () => {
  const data = {
    ideas: [{
      title: 'Big Game',
      domain: 'code-game',
      pitch: 'A massive game',
      complexity: 'XL',
      why: 'Ambition',
      project_id: null,
      stimulus_ref: null,
      xl_mode: 'single',
    }],
  };
  expect(validateIdeator(data)).toBe(true);
});

it('accepts XL project proposal', () => {
  const data = {
    ideas: [{
      title: 'Epic Novella',
      domain: 'fiction',
      pitch: 'A six-chapter novella',
      complexity: 'XL',
      why: 'Depth',
      project_id: null,
      stimulus_ref: null,
      xl_mode: 'project',
      project: {
        name: 'The Last Librarian',
        description: 'A novella in 6 chapters',
        estimated_iterations: 6,
        structure: [{ chapter_1: 'The arrival' }],
      },
    }],
  };
  expect(validateIdeator(data)).toBe(true);
});
```

- [ ] **Step 7: Run tests and verify**

Run: `npx vitest run tests/parser.test.ts --reporter=verbose`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/types/agents.ts src/types/config.ts src/types/index.ts src/parser/yaml-parser.ts config/foundry.yml tests/parser.test.ts
git commit -m "feat: add XL complexity tier to types, parser, and config"
```

---

### Task 2: Creator Phase Pipeline — Profiles & Orchestrator

**Goal:** Create the `src/creator/` module with complexity profiles, phase types, and the pipeline orchestrator that replaces single-shot creation for M/L/XL.

**Files:**
- Create: `src/creator/profiles.ts`
- Create: `src/creator/pipeline.ts`
- Create: `src/creator/index.ts`
- Test: `tests/creator-profiles.test.ts`
- Test: `tests/creator-pipeline.test.ts`

**Acceptance Criteria:**
- [ ] `getComplexityProfile("S", config)` returns single-build profile
- [ ] `getComplexityProfile("XL", config)` returns 7-phase profile with 100K max_tokens
- [ ] `runCreatorPipeline` for S complexity delegates to existing `dispatchCreator`
- [ ] `runCreatorPipeline` for M complexity runs plan → build → revise (3 calls)
- [ ] Pipeline returns `CreatorResponse` (same shape as current)
- [ ] Budget warning logged when output exceeds threshold

**Verify:** `npx vitest run tests/creator-profiles.test.ts tests/creator-pipeline.test.ts --reporter=verbose` → all pass

**Steps:**

- [ ] **Step 1: Create profiles module**

```typescript
// src/creator/profiles.ts
import type { FoundryConfig, ComplexityProfileConfig } from "../types/index.js";

export type PhaseKind = "plan" | "build" | "revise" | "polish" | "assemble";

export interface ComplexityProfile {
  phases: PhaseKind[];
  maxTokensPerPhase: number;
  expectedFiles: [number, number];
  budgetWarningThreshold: number;
}

const PHASE_SEQUENCES: Record<string, PhaseKind[]> = {
  S: ["build"],
  M: ["plan", "build", "revise"],
  L: ["plan", "build", "build", "revise", "polish"],
  XL: ["plan", "build", "build", "build", "assemble", "revise", "polish"],
};

const EXPECTED_FILES: Record<string, [number, number]> = {
  S: [1, 2],
  M: [1, 4],
  L: [2, 8],
  XL: [4, 15],
};

const DEFAULTS: Record<string, { maxTokens: number; warning: number }> = {
  S: { maxTokens: 16384, warning: 25000 },
  M: { maxTokens: 32768, warning: 120000 },
  L: { maxTokens: 65536, warning: 400000 },
  XL: { maxTokens: 100000, warning: 800000 },
};

export function getComplexityProfile(
  complexity: string,
  config: FoundryConfig,
): ComplexityProfile {
  const tier = complexity in PHASE_SEQUENCES ? complexity : "S";
  const configProfile = config.iteration.complexity_profiles?.[tier] as
    | ComplexityProfileConfig
    | undefined;
  const defaults = DEFAULTS[tier];

  return {
    phases: PHASE_SEQUENCES[tier],
    maxTokensPerPhase: configProfile?.max_tokens_per_phase ?? defaults.maxTokens,
    expectedFiles: EXPECTED_FILES[tier],
    budgetWarningThreshold:
      configProfile?.budget_warning_threshold ?? defaults.warning,
  };
}
```

- [ ] **Step 2: Write profiles tests**

```typescript
// tests/creator-profiles.test.ts
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

  it("returns 5 phases for L", () => {
    const p = getComplexityProfile("L", makeConfig());
    expect(p.phases).toHaveLength(5);
    expect(p.phases[0]).toBe("plan");
    expect(p.phases[4]).toBe("polish");
  });

  it("returns 7 phases for XL with assemble", () => {
    const p = getComplexityProfile("XL", makeConfig());
    expect(p.phases).toHaveLength(7);
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
```

- [ ] **Step 3: Create the pipeline orchestrator**

```typescript
// src/creator/pipeline.ts
import type {
  FoundryConfig,
  ModelsConfig,
  IdeatorProposal,
  CreatorResponse,
  CreatorFile,
} from "../types/index.js";
import { getComplexityProfile, type PhaseKind } from "./profiles.js";
import { dispatchCreator } from "../agents/index.js";
import {
  dispatchPlan,
  dispatchBuild,
  dispatchRevise,
  dispatchPolish,
  dispatchAssemble,
  type CreatorPlan,
} from "./phases.js";

interface PipelineContext {
  config: FoundryConfig;
  models: ModelsConfig;
  iteration: number;
}

interface PipelineResult {
  artifact: CreatorResponse;
  usage: { input: number; output: number };
  phasesRun: string[];
  phaseTokens: Record<string, number>;
}

export async function runCreatorPipeline(
  ctx: PipelineContext,
  proposal: IdeatorProposal,
  criticNotes: string,
  revisionNotes?: string,
): Promise<PipelineResult> {
  const profile = getComplexityProfile(proposal.complexity, ctx.config);

  // S complexity: delegate to existing single-shot Creator
  if (proposal.complexity === "S" || profile.phases.length === 1) {
    const result = await dispatchCreator(
      ctx.config, ctx.models, ctx.iteration, proposal, criticNotes, revisionNotes,
    );
    return {
      artifact: result.data,
      usage: result.usage,
      phasesRun: ["build"],
      phaseTokens: { build: result.usage.output },
    };
  }

  // M/L/XL: run phase pipeline
  const totalUsage = { input: 0, output: 0 };
  const phasesRun: string[] = [];
  const phaseTokens: Record<string, number> = {};
  let plan: CreatorPlan | null = null;
  let files: CreatorFile[] = [];
  let buildIndex = 0;

  for (const phase of profile.phases) {
    const phaseName = phase === "build" ? `build-${++buildIndex}` : phase;

    try {
      const result = await runPhase(
        ctx, phase, phaseName, proposal, criticNotes,
        plan, files, profile.maxTokensPerPhase, revisionNotes,
      );

      totalUsage.input += result.usage.input;
      totalUsage.output += result.usage.output;
      phasesRun.push(phaseName);
      phaseTokens[phaseName] = result.usage.output;

      if (result.plan) plan = result.plan;
      if (result.files.length > 0) files = mergeFiles(files, result.files);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  [creator-${phaseName}] Phase failed: ${msg}`);

      if (phase === "plan") {
        // Fall back to S-tier single-shot
        console.warn("  [creator] Plan phase failed — falling back to S-tier.");
        const fallback = await dispatchCreator(
          ctx.config, ctx.models, ctx.iteration, proposal, criticNotes, revisionNotes,
        );
        return {
          artifact: fallback.data,
          usage: { input: totalUsage.input + fallback.usage.input, output: totalUsage.output + fallback.usage.output },
          phasesRun: [...phasesRun, "build-fallback"],
          phaseTokens: { ...phaseTokens, "build-fallback": fallback.usage.output },
        };
      }
      // For other phases, continue with what we have
    }
  }

  // Budget warning
  const totalOutput = Object.values(phaseTokens).reduce((a, b) => a + b, 0);
  if (totalOutput > profile.budgetWarningThreshold) {
    console.warn(
      `  [creator] Budget warning: ${totalOutput} output tokens exceeds threshold of ${profile.budgetWarningThreshold}`,
    );
  }

  // Assemble final CreatorResponse
  const title = plan?.approach
    ? proposal.title
    : proposal.title;

  return {
    artifact: { title: proposal.title, files, notes: plan?.approach },
    usage: totalUsage,
    phasesRun,
    phaseTokens,
  };
}

async function runPhase(
  ctx: PipelineContext,
  phase: PhaseKind,
  phaseName: string,
  proposal: IdeatorProposal,
  criticNotes: string,
  plan: CreatorPlan | null,
  currentFiles: CreatorFile[],
  maxTokens: number,
  revisionNotes?: string,
): Promise<{ plan?: CreatorPlan; files: CreatorFile[]; usage: { input: number; output: number } }> {
  switch (phase) {
    case "plan": {
      const r = await dispatchPlan(ctx, proposal, criticNotes, maxTokens);
      return { plan: r.plan, files: [], usage: r.usage };
    }
    case "build": {
      const r = await dispatchBuild(ctx, proposal, criticNotes, plan, currentFiles, maxTokens);
      return { files: r.files, usage: r.usage };
    }
    case "revise": {
      const r = await dispatchRevise(ctx, proposal, criticNotes, plan, currentFiles, maxTokens, revisionNotes);
      return { files: r.files, usage: r.usage };
    }
    case "polish": {
      const r = await dispatchPolish(ctx, plan, currentFiles, maxTokens);
      return { files: r.files, usage: r.usage };
    }
    case "assemble": {
      const r = await dispatchAssemble(ctx, proposal, plan, currentFiles, maxTokens);
      return { files: r.files, usage: r.usage };
    }
  }
}

function mergeFiles(existing: CreatorFile[], incoming: CreatorFile[]): CreatorFile[] {
  const merged = new Map<string, CreatorFile>();
  for (const f of existing) merged.set(f.path, f);
  for (const f of incoming) merged.set(f.path, f);
  return [...merged.values()];
}
```

- [ ] **Step 4: Create index re-exports**

```typescript
// src/creator/index.ts
export { runCreatorPipeline } from "./pipeline.js";
export { getComplexityProfile, type PhaseKind, type ComplexityProfile } from "./profiles.js";
```

- [ ] **Step 5: Write pipeline tests (mocked phases)**

```typescript
// tests/creator-pipeline.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { FoundryConfig, ModelsConfig, IdeatorProposal } from "../src/types/index.js";

const mockDispatchCreator = vi.fn();
vi.mock("../src/agents/index.js", () => ({
  dispatchCreator: mockDispatchCreator,
}));

const mockDispatchPlan = vi.fn();
const mockDispatchBuild = vi.fn();
const mockDispatchRevise = vi.fn();
const mockDispatchPolish = vi.fn();
const mockDispatchAssemble = vi.fn();
vi.mock("../src/creator/phases.js", () => ({
  dispatchPlan: mockDispatchPlan,
  dispatchBuild: mockDispatchBuild,
  dispatchRevise: mockDispatchRevise,
  dispatchPolish: mockDispatchPolish,
  dispatchAssemble: mockDispatchAssemble,
}));

import { runCreatorPipeline } from "../src/creator/pipeline.js";

// Use same makeConfig/makeModels as other test files but with complexity_profiles
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
  complexity: complexity as any, why: "Testing", project_id: null, stimulus_ref: null,
});

beforeEach(() => vi.clearAllMocks());

describe("creator/pipeline", () => {
  it("delegates S complexity to dispatchCreator", async () => {
    mockDispatchCreator.mockResolvedValue({
      data: { title: "Test", files: [{ path: "main.py", content: "print()" }] },
      usage,
    });
    const result = await runCreatorPipeline(
      { config: makeConfig(), models: makeModels(), iteration: 1 },
      makeProposal("S"), "notes",
    );
    expect(mockDispatchCreator).toHaveBeenCalledOnce();
    expect(result.phasesRun).toEqual(["build"]);
  });

  it("runs plan/build/revise for M complexity", async () => {
    mockDispatchPlan.mockResolvedValue({
      plan: { approach: "test", file_manifest: [], key_decisions: [], challenges: [], build_order: [["main.py"]] },
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
    });

    const result = await runCreatorPipeline(
      { config: makeConfig(), models: makeModels(), iteration: 1 },
      makeProposal("M"), "notes",
    );
    expect(result.phasesRun).toContain("build-fallback");
    expect(mockDispatchCreator).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/creator-profiles.test.ts tests/creator-pipeline.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/creator/ tests/creator-profiles.test.ts tests/creator-pipeline.test.ts
git commit -m "feat: creator phase pipeline with complexity profiles"
```

---

### Task 3: Creator Phase Dispatch Functions & Prompt Templates

**Goal:** Implement the five phase dispatch functions and their corresponding prompt templates.

**Files:**
- Create: `src/creator/phases.ts`
- Create: `prompts/creator/plan.md`
- Create: `prompts/creator/build.md`
- Create: `prompts/creator/revise.md`
- Create: `prompts/creator/polish.md`
- Create: `prompts/creator/assemble.md`
- Modify: `src/agents/prompt.ts` (add `loadCreatorPhasePrompt`)
- Modify: `src/parser/yaml-parser.ts` (add `creator-plan` schema and validator)
- Test: `tests/creator-phases.test.ts`

**Acceptance Criteria:**
- [ ] `dispatchPlan` calls the model and returns a parsed `CreatorPlan`
- [ ] `dispatchBuild` produces files according to the plan's build_order
- [ ] `dispatchRevise` returns a revised files array
- [ ] `dispatchPolish` returns a polished files array
- [ ] `dispatchAssemble` returns an assembled files array
- [ ] Each function uses the correct agent name for logging (creator-plan, creator-build-N, etc.)
- [ ] All five prompt templates exist and contain the expected template variables

**Verify:** `npx vitest run tests/creator-phases.test.ts --reporter=verbose` → all pass

**Steps:**

- [ ] **Step 1: Add loadCreatorPhasePrompt to prompt.ts**

```typescript
// src/agents/prompt.ts — add new function
export async function loadCreatorPhasePrompt(phase: string): Promise<string> {
  return readFile(path.join(promptsDir(), "creator", `${phase}.md`), "utf-8");
}
```

- [ ] **Step 2: Add creator-plan schema and validator to parser**

```typescript
// src/parser/yaml-parser.ts — add to SCHEMAS object
"creator-plan": {
  type: "object",
  required: ["plan"],
  properties: {
    plan: {
      type: "object",
      required: ["approach", "file_manifest"],
      properties: {
        approach: { type: "string" },
        file_manifest: { type: "array" },
        key_decisions: { type: "array" },
        challenges: { type: "array" },
        build_order: { type: "array" },
      },
    },
  },
},
"creator-build": {
  type: "object",
  required: ["files"],
  properties: {
    files: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
      },
    },
  },
},
```

Add validators:

```typescript
export interface CreatorPlanResponse {
  plan: CreatorPlan;
}

export interface CreatorPlan {
  approach: string;
  file_manifest: Array<{ path: string; purpose: string; estimated_lines?: number }>;
  key_decisions: string[];
  challenges: string[];
  build_order?: string[][];
}

export interface CreatorBuildResponse {
  files: Array<{ path: string; content: string }>;
}

export function validateCreatorPlan(data: unknown): data is CreatorPlanResponse {
  if (!isObj(data) || !isObj(data.plan)) return false;
  const p = data.plan as any;
  return typeof p.approach === "string" && Array.isArray(p.file_manifest);
}

export function validateCreatorBuild(data: unknown): data is CreatorBuildResponse {
  if (!isObj(data) || !Array.isArray(data.files)) return false;
  return data.files.length > 0 && data.files.every(
    (f: any) => typeof f.path === "string" && typeof f.content === "string",
  );
}
```

Register in `validators` and `SCHEMAS`.

- [ ] **Step 3: Create the five prompt templates**

Create `prompts/creator/plan.md`:

```markdown
{shared_context}

## Assignment

{approved_proposal}

{critic_sharpening_notes}

## Project Context

{project_context}

## Quality Standards (from our manifesto)

{manifesto_quality_standards}

## Your Role

You are the Creator in the PLANNING phase. Your job is to design the structure of this artifact before building it.

Think carefully about:
1. What files are needed and what each one does
2. Key technical/creative decisions and why
3. Potential challenges and how to handle them
4. The order files should be built in (dependencies first)

## Output Format

Respond with ONLY valid YAML:

` ` `yaml
plan:
  approach: "High-level description of your approach"
  file_manifest:
    - path: "filename.ext"
      purpose: "What this file does"
      estimated_lines: 100
  key_decisions:
    - "Decision 1 and why"
    - "Decision 2 and why"
  challenges:
    - "Challenge and mitigation"
  build_order:
    - ["file1.ext", "file2.ext"]  # batch 1
    - ["file3.ext"]                # batch 2
` ` `
```

Create `prompts/creator/build.md`:

```markdown
## Plan

{plan}

## Assignment

{approved_proposal_brief}

{critic_sharpening_notes_brief}

## Files Already Built

{prior_files}

## Your Task

Build the following files: {build_batch}

Follow the plan exactly. Write complete, production-quality code/prose. Every file must be self-contained and finished.

## Output Format

Respond with ONLY valid YAML:

` ` `yaml
files:
  - path: "filename.ext"
    content: |
      # Complete file content here
` ` `
```

Create `prompts/creator/revise.md`:

```markdown
## Original Assignment

{approved_proposal_brief}

{critic_sharpening_notes}

## Key Decisions From Planning

{key_decisions}

## Quality Standards (from our manifesto)

{manifesto_quality_standards}

## Complete Draft

{all_files}

## Your Role

You are the Creator in the REVISION phase. Read the complete draft critically.

1. CHECK: Does each file fulfill its purpose from the plan?
2. FIX: Structural issues, logic errors, inconsistencies between files
3. SHARPEN: Tighten language/logic, strengthen weak sections
4. CUT: Remove filler, redundancy, anything that doesn't earn its place

Output the COMPLETE revised files — not just the changes.

## Output Format

Respond with ONLY valid YAML:

` ` `yaml
files:
  - path: "filename.ext"
    content: |
      # Complete revised content
` ` `
```

Create `prompts/creator/polish.md`:

```markdown
## Key Decisions

{key_decisions}

## Current Draft

{revised_files}

## Your Role

You are the Creator in the POLISH phase. This is the final pass — focus on craft.

For code: naming consistency, edge cases, error messages, clean formatting, idiomatic patterns.
For prose: rhythm, word choice, opening hooks, closing resonance, sensory details.
For both: the small details that separate good from great.

Do NOT change the structure or key decisions. Polish, don't redesign.

Output the COMPLETE polished files.

## Output Format

Respond with ONLY valid YAML:

` ` `yaml
files:
  - path: "filename.ext"
    content: |
      # Complete polished content
` ` `
```

Create `prompts/creator/assemble.md`:

```markdown
## File Manifest

{file_manifest}

## Original Assignment

{approved_proposal_brief}

## All Built Files

{all_files}

## Your Role

You are the Creator in the ASSEMBLY phase (XL artifacts only).

Multiple build calls produced these files independently. Your job:

1. Verify all imports/references between files are correct
2. Add any glue code, shared types, or connecting narrative needed
3. Ensure the pieces form a coherent whole
4. Add any missing files (READMEs, configs, entry points)

Output ALL files — the complete assembled artifact.

## Output Format

Respond with ONLY valid YAML:

` ` `yaml
files:
  - path: "filename.ext"
    content: |
      # Complete content
` ` `
```

- [ ] **Step 4: Create phases.ts dispatch functions**

```typescript
// src/creator/phases.ts
import type {
  FoundryConfig,
  ModelsConfig,
  IdeatorProposal,
  CreatorFile,
} from "../types/index.js";
import { callModel } from "../model/index.js";
import {
  parseYaml,
  buildCorrectionPrompt,
  validateCreatorPlan,
  validateCreatorBuild,
  type CreatorPlan,
  type CreatorPlanResponse,
  type CreatorBuildResponse,
} from "../parser/index.js";
import { loadCreatorPhasePrompt, injectVars } from "../agents/prompt.js";
import { buildSharedContext } from "../context/index.js";
import { safeRead } from "../context/data.js";
import { resolve } from "../root.js";

export type { CreatorPlan };

interface PhaseContext {
  config: FoundryConfig;
  models: ModelsConfig;
  iteration: number;
}

const MAX_PHASE_RETRIES = 2;

async function callPhase<T>(
  ctx: PhaseContext,
  systemPrompt: string,
  agentName: string,
  maxTokens: number,
  validator: (data: unknown) => data is T,
  schemaKey?: string,
): Promise<{ data: T; usage: { input: number; output: number } }> {
  const agentConfig = { ...ctx.models.agents.creator, max_tokens: maxTokens };
  let totalUsage = { input: 0, output: 0 };
  let lastText = "";

  for (let attempt = 0; attempt <= MAX_PHASE_RETRIES; attempt++) {
    const userMessage = attempt === 0
      ? "Begin."
      : buildCorrectionPrompt(lastText, "YAML validation failed.", schemaKey);

    const result = await callModel(
      agentConfig, systemPrompt, userMessage, ctx.iteration, agentName,
    );
    totalUsage.input += result.usage.input;
    totalUsage.output += result.usage.output;
    lastText = result.text;

    try {
      const data = parseYaml<T>(result.text);
      if (validator(data)) return { data, usage: totalUsage };
    } catch {
      // retry
    }
  }
  throw new Error(`[${agentName}] Failed after ${MAX_PHASE_RETRIES + 1} attempts`);
}

function serializeFiles(files: CreatorFile[]): string {
  if (files.length === 0) return "*No files built yet.*";
  return files.map((f) => `### ${f.path}\n\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n");
}

function extractQualityStandards(manifesto: string): string {
  const sections = ["What We Value", "What We Avoid", "Our Aesthetic"];
  const lines = manifesto.split("\n");
  const extracted: string[] = [];
  let capturing = false;
  for (const line of lines) {
    if (line.startsWith("## ")) capturing = sections.some((s) => line.includes(s));
    if (capturing) extracted.push(line);
  }
  return extracted.length > 0 ? extracted.join("\n") : manifesto;
}

// ── Plan ──────────────────────────────────────────────────────

export async function dispatchPlan(
  ctx: PhaseContext,
  proposal: IdeatorProposal,
  criticNotes: string,
  maxTokens: number,
): Promise<{ plan: CreatorPlan; usage: { input: number; output: number } }> {
  const shared = await buildSharedContext(ctx.config);
  const manifesto = await safeRead(resolve("identity", "manifesto.md"));
  const template = await loadCreatorPhasePrompt("plan");

  const proposalText = [
    `**${proposal.title}** [${proposal.domain}, ${proposal.complexity}]`,
    "", proposal.pitch, "", `Why: ${proposal.why}`,
  ].join("\n");

  const prompt = injectVars(template, {
    shared_context: shared,
    approved_proposal: proposalText,
    critic_sharpening_notes: criticNotes || "*No sharpening notes.*",
    project_context: "*No project context (standalone artifact).*",
    manifesto_quality_standards: extractQualityStandards(manifesto),
  });

  const result = await callPhase<CreatorPlanResponse>(
    ctx, prompt, "creator-plan", maxTokens, validateCreatorPlan, "creator-plan",
  );

  // Normalize missing build_order
  if (!result.data.plan.build_order || result.data.plan.build_order.length === 0) {
    result.data.plan.build_order = [
      result.data.plan.file_manifest.map((f) => f.path),
    ];
  }

  return { plan: result.data.plan, usage: result.usage };
}

// ── Build ─────────────────────────────────────────────────────

export async function dispatchBuild(
  ctx: PhaseContext,
  proposal: IdeatorProposal,
  criticNotes: string,
  plan: CreatorPlan | null,
  priorFiles: CreatorFile[],
  maxTokens: number,
): Promise<{ files: CreatorFile[]; usage: { input: number; output: number } }> {
  const template = await loadCreatorPhasePrompt("build");

  // Determine which files to build this call
  const builtPaths = new Set(priorFiles.map((f) => f.path));
  let batchFiles: string[] = [];
  if (plan?.build_order) {
    for (const batch of plan.build_order) {
      if (batch.some((p) => !builtPaths.has(p))) {
        batchFiles = batch.filter((p) => !builtPaths.has(p));
        break;
      }
    }
  }
  if (batchFiles.length === 0 && plan?.file_manifest) {
    batchFiles = plan.file_manifest
      .map((f) => f.path)
      .filter((p) => !builtPaths.has(p));
  }

  const planYaml = plan
    ? `Approach: ${plan.approach}\n\nFile manifest:\n${plan.file_manifest.map((f) => `- ${f.path}: ${f.purpose}`).join("\n")}`
    : "*No plan available.*";

  const prompt = injectVars(template, {
    plan: planYaml,
    approved_proposal_brief: `**${proposal.title}** [${proposal.domain}]: ${proposal.pitch}`,
    critic_sharpening_notes_brief: criticNotes ? criticNotes.slice(0, 500) : "",
    prior_files: serializeFiles(priorFiles),
    build_batch: batchFiles.join(", ") || "all remaining files",
  });

  const result = await callPhase<CreatorBuildResponse>(
    ctx, prompt, `creator-build`, maxTokens, validateCreatorBuild, "creator-build",
  );
  return { files: result.data.files as CreatorFile[], usage: result.usage };
}

// ── Revise ────────────────────────────────────────────────────

export async function dispatchRevise(
  ctx: PhaseContext,
  proposal: IdeatorProposal,
  criticNotes: string,
  plan: CreatorPlan | null,
  allFiles: CreatorFile[],
  maxTokens: number,
  revisionNotes?: string,
): Promise<{ files: CreatorFile[]; usage: { input: number; output: number } }> {
  const manifesto = await safeRead(resolve("identity", "manifesto.md"));
  const template = await loadCreatorPhasePrompt("revise");

  let prompt = injectVars(template, {
    approved_proposal_brief: `**${proposal.title}** [${proposal.domain}]: ${proposal.pitch}`,
    critic_sharpening_notes: criticNotes || "*No sharpening notes.*",
    key_decisions: plan?.key_decisions?.join("\n") ?? "*No key decisions recorded.*",
    manifesto_quality_standards: extractQualityStandards(manifesto),
    all_files: serializeFiles(allFiles),
  });

  if (revisionNotes) {
    prompt += "\n\n## Revision Required\n\n" + revisionNotes;
  }

  const result = await callPhase<CreatorBuildResponse>(
    ctx, prompt, "creator-revise", maxTokens, validateCreatorBuild, "creator-build",
  );
  return { files: result.data.files as CreatorFile[], usage: result.usage };
}

// ── Polish ────────────────────────────────────────────────────

export async function dispatchPolish(
  ctx: PhaseContext,
  plan: CreatorPlan | null,
  revisedFiles: CreatorFile[],
  maxTokens: number,
): Promise<{ files: CreatorFile[]; usage: { input: number; output: number } }> {
  const template = await loadCreatorPhasePrompt("polish");
  const prompt = injectVars(template, {
    key_decisions: plan?.key_decisions?.join("\n") ?? "*No key decisions recorded.*",
    revised_files: serializeFiles(revisedFiles),
  });

  const result = await callPhase<CreatorBuildResponse>(
    ctx, prompt, "creator-polish", maxTokens, validateCreatorBuild, "creator-build",
  );
  return { files: result.data.files as CreatorFile[], usage: result.usage };
}

// ── Assemble (XL only) ───────────────────────────────────────

export async function dispatchAssemble(
  ctx: PhaseContext,
  proposal: IdeatorProposal,
  plan: CreatorPlan | null,
  allFiles: CreatorFile[],
  maxTokens: number,
): Promise<{ files: CreatorFile[]; usage: { input: number; output: number } }> {
  const template = await loadCreatorPhasePrompt("assemble");
  const manifest = plan?.file_manifest
    ?.map((f) => `- ${f.path}: ${f.purpose}`)
    .join("\n") ?? "*No manifest.*";

  const prompt = injectVars(template, {
    file_manifest: manifest,
    approved_proposal_brief: `**${proposal.title}** [${proposal.domain}]: ${proposal.pitch}`,
    all_files: serializeFiles(allFiles),
  });

  const result = await callPhase<CreatorBuildResponse>(
    ctx, prompt, "creator-assemble", maxTokens, validateCreatorBuild, "creator-build",
  );
  return { files: result.data.files as CreatorFile[], usage: result.usage };
}
```

- [ ] **Step 5: Write phase dispatch tests**

Test `dispatchPlan` and `dispatchBuild` via mocked `callModel`, verifying prompt assembly and YAML parsing. Use the same mock pattern as `tests/agents-dispatcher.test.ts`.

- [ ] **Step 6: Run all creator tests**

Run: `npx vitest run tests/creator-*.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/creator/phases.ts src/agents/prompt.ts src/parser/yaml-parser.ts prompts/creator/ tests/creator-phases.test.ts
git commit -m "feat: creator phase dispatch functions and prompt templates"
```

---

### Task 4: Iteration Runner Integration & XL Project Logic

**Goal:** Wire the Creator pipeline into the iteration runner, replacing direct `dispatchCreator` calls. Add XL→project creation logic. Log complexity and phase data in iteration entries.

**Files:**
- Modify: `src/iteration/runner.ts:200-350` (creation phase + XL logic)
- Modify: `src/logging/logger.ts` (no schema change needed, entries are freeform)
- Test: `tests/iteration-runner.test.ts` (add new test cases)

**Acceptance Criteria:**
- [ ] `runIteration` uses `runCreatorPipeline` instead of `dispatchCreator`
- [ ] XL project proposals create a project and downgrade to L for first iteration
- [ ] Iteration log includes `complexity`, `phases_run`, and `phase_tokens` fields
- [ ] Existing tests still pass (S-complexity behavior unchanged)
- [ ] New test covers M-complexity multi-phase path
- [ ] New test covers XL project creation path

**Verify:** `npx vitest run tests/iteration-runner.test.ts --reporter=verbose` → all pass

**Steps:**

- [ ] **Step 1: Add imports to runner.ts**

```typescript
// src/iteration/runner.ts — add import
import { runCreatorPipeline } from "../creator/index.js";
import { createProject } from "../files/projects.js";
```

- [ ] **Step 2: Add XL→project logic after proposal approval**

After `const proposal = approvedProposal!;` and before the creation phase loop, add:

```typescript
// Handle XL project proposals
let effectiveComplexity = proposal.complexity;
if (proposal.complexity === "XL" && proposal.xl_mode === "project" && proposal.project) {
  console.log(`\n  ▶ Creating project: "${proposal.project.name}"`);
  const projectId = await createProject(proposal.project, iteration);
  proposal.project_id = projectId;
  effectiveComplexity = "L";
  await appendJournal(
    `**Iteration ${iteration}:** Started project ${projectId}: "${proposal.project.name}" (${proposal.project.estimated_iterations} iterations planned)`,
  );
}
```

- [ ] **Step 3: Replace dispatchCreator calls with runCreatorPipeline**

In the Phase 3 creation section, replace:

```typescript
const creatorResult = await dispatchCreator(
  ctx.config, ctx.models, ctx.iteration, proposal, criticNotes, revisionNotes,
);
addUsage(creatorResult.usage);
artifact = creatorResult.data;
```

With:

```typescript
const pipelineProposal = effectiveComplexity !== proposal.complexity
  ? { ...proposal, complexity: effectiveComplexity as any }
  : proposal;
const pipelineResult = await runCreatorPipeline(
  { config: ctx.config, models: ctx.models, iteration: ctx.iteration },
  pipelineProposal, criticNotes, revisionNotes,
);
addUsage(pipelineResult.usage);
artifact = pipelineResult.artifact;

// Track phase data for logging
if (!iterationPhaseData) {
  iterationPhaseData = { phasesRun: pipelineResult.phasesRun, phaseTokens: pipelineResult.phaseTokens };
} else {
  iterationPhaseData.phasesRun.push(...pipelineResult.phasesRun);
  Object.assign(iterationPhaseData.phaseTokens, pipelineResult.phaseTokens);
}
```

Declare `let iterationPhaseData: { phasesRun: string[]; phaseTokens: Record<string, number> } | null = null;` at the top of the creation loop.

- [ ] **Step 4: Add complexity and phase data to iteration log**

In the `logIteration` call at the end (both shipped and killed paths), add:

```typescript
complexity: proposal.complexity,
phases_run: iterationPhaseData?.phasesRun,
phase_tokens: iterationPhaseData?.phaseTokens,
```

- [ ] **Step 5: Update existing tests' mock setup**

Add `runCreatorPipeline` mock alongside the existing `dispatchCreator` mock. The mock should return the same shape but with `phasesRun` and `phaseTokens`.

- [ ] **Step 6: Add new test cases**

Add tests for:
- M-complexity proposal triggers pipeline (not direct dispatchCreator)
- XL project proposal calls createProject and downgrades to L
- Iteration log contains complexity field

- [ ] **Step 7: Run tests**

Run: `npx vitest run tests/iteration-runner.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add src/iteration/runner.ts tests/iteration-runner.test.ts
git commit -m "feat: wire creator pipeline into iteration runner with XL project logic"
```

---

### Task 5: Complexity Distribution Tracking & Shared Context

**Goal:** Track complexity distribution from iteration logs and inject it into the Critic Gate 1 and Ideator shared context.

**Files:**
- Modify: `src/context/data.ts` (add `getComplexityDistribution`)
- Modify: `src/context/shared.ts` (add distribution to shared context)
- Modify: `src/agents/dispatcher.ts:80-120` (inject into Critic Gate 1 and Ideator)
- Test: `tests/context-data.test.ts` (add distribution tests)
- Test: `tests/context-shared.test.ts` (verify new section)

**Acceptance Criteria:**
- [ ] `getComplexityDistribution(20)` returns counts per tier from last 20 iteration log entries
- [ ] Shared context includes "Complexity Distribution" section
- [ ] Critic Gate 1 prompt receives `{complexity_distribution}`
- [ ] Ideator prompt receives active project info prominently

**Verify:** `npx vitest run tests/context-data.test.ts tests/context-shared.test.ts --reporter=verbose` → all pass

**Steps:**

- [ ] **Step 1: Add getComplexityDistribution to data.ts**

```typescript
// src/context/data.ts — add function
export async function getComplexityDistribution(
  window: number,
): Promise<Record<string, number>> {
  const entries = await readJsonlEntries<{ complexity?: string }>(resolve("logs", "iterations.jsonl"));
  const recent = entries.slice(-window);
  const counts: Record<string, number> = { S: 0, M: 0, L: 0, XL: 0 };
  for (const entry of recent) {
    const tier = entry.complexity ?? "S";
    counts[tier] = (counts[tier] ?? 0) + 1;
  }
  return counts;
}

export function formatComplexityDistribution(counts: Record<string, number>): string {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return "*No iteration data yet.*";
  const parts = Object.entries(counts)
    .map(([tier, count]) => `${tier}: ${count} (${Math.round((count / total) * 100)}%)`)
    .join("  ");
  return parts;
}
```

- [ ] **Step 2: Add to shared context**

```typescript
// src/context/shared.ts — in buildSharedContext, add after domain balance section
const complexityDist = await getComplexityDistribution(
  config.iteration.novelty_window,
);
const complexitySection = formatComplexityDistribution(complexityDist);

// Add to sections array:
"\n## Complexity Distribution (last " + config.iteration.novelty_window + " iterations)\n",
complexitySection,
```

Add imports for `getComplexityDistribution` and `formatComplexityDistribution` from `"./data.js"`.

- [ ] **Step 3: Inject into Critic Gate 1 dispatcher**

In `dispatchCriticGate1` in `src/agents/dispatcher.ts`, add `{complexity_distribution}` to the template variables by reading from shared context (it's already included via `buildSharedContext`).

- [ ] **Step 4: Write tests**

```typescript
// tests/context-data.test.ts — add to existing describe
describe("getComplexityDistribution", () => {
  it("counts complexity tiers from iteration log", async () => {
    const logContent = [
      '{"iteration":1,"complexity":"S"}',
      '{"iteration":2,"complexity":"M"}',
      '{"iteration":3,"complexity":"S"}',
      '{"iteration":4,"complexity":"L"}',
    ].join("\n");
    writeFileSync(path.join(tempDir, "logs", "iterations.jsonl"), logContent);

    const { getComplexityDistribution } = await import("../src/context/data.js");
    const dist = await getComplexityDistribution(10);
    expect(dist.S).toBe(2);
    expect(dist.M).toBe(1);
    expect(dist.L).toBe(1);
    expect(dist.XL).toBe(0);
  });

  it("defaults missing complexity to S", async () => {
    const logContent = '{"iteration":1}';
    writeFileSync(path.join(tempDir, "logs", "iterations.jsonl"), logContent);

    const { getComplexityDistribution } = await import("../src/context/data.js");
    const dist = await getComplexityDistribution(10);
    expect(dist.S).toBe(1);
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/context-data.test.ts tests/context-shared.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/context/data.ts src/context/shared.ts src/agents/dispatcher.ts tests/context-data.test.ts tests/context-shared.test.ts
git commit -m "feat: complexity distribution tracking in shared context"
```

---

### Task 6: Prompt Updates — Critic Ambition, Ideator Nudge, Curator Kickstart

**Goal:** Update the Ideator, Critic, and Curator prompts to drive ambition scaling and project activation.

**Files:**
- Modify: `prompts/ideator.md` (add project nudge rule + XL format)
- Modify: `prompts/critic.md` (add ambition pressure rule in Gate 1)
- Modify: `prompts/curator.md` (add project kickstart section)
- Modify: `src/curator/index.ts` (inject kickstart_after context)

**Acceptance Criteria:**
- [ ] Ideator prompt includes rule about proposing projects when none are active
- [ ] Ideator YAML format includes `xl_mode` and `project` fields
- [ ] Critic Gate 1 prompt includes complexity distribution and ambition rule
- [ ] Curator prompt includes project activation section with `{kickstart_after}`
- [ ] Curator injects `kickstart_after` from config

**Verify:** Manual review of prompt files + `npx vitest run tests/agents-dispatcher.test.ts --reporter=verbose` → all pass

**Steps:**

- [ ] **Step 1: Update ideator.md**

Add to Rules section:

```markdown
- If no multi-iteration projects are currently active (check the Active Projects section above), at least one of your 3 proposals should be a project starter (complexity L or XL with `xl_mode: "project"`). Multi-iteration projects produce richer, more cohesive work.
- For XL proposals, include `xl_mode: "single"` for massive standalone artifacts or `xl_mode: "project"` to start a multi-iteration project.
```

Update YAML format to include new fields:

```yaml
    xl_mode: null          # "single" or "project" (required for XL)
    project: null           # project block (required for xl_mode: "project")
```

- [ ] **Step 2: Update critic.md Gate 1 section**

Add after the existing Rules section:

```markdown
## Complexity Distribution

{complexity_distribution}

If the portfolio has been dominated by S-complexity work (>60% of the last 20 iterations), penalize S proposals and explicitly call for more ambitious work. Approve M/L/XL proposals more generously when the portfolio needs ambition.
```

- [ ] **Step 3: Update curator.md**

Add new section:

```markdown
### 7. Project Activation

If no projects have been active for the last {kickstart_after} iterations, propose a specific project idea in your `domain_recommendations`. Frame it as: "Consider starting a project: [concrete idea]. This would span ~[N] iterations and produce [what]." The Ideator should pick this up in its next proposal set.
```

- [ ] **Step 4: Inject kickstart_after in Curator dispatch**

In `src/curator/index.ts`, add to the `injectVars` call:

```typescript
kickstart_after: String(config.projects.kickstart_after ?? 15),
```

- [ ] **Step 5: Inject complexity_distribution into Critic Gate 1 dispatch**

In `dispatchCriticGate1` in `src/agents/dispatcher.ts`, the shared context already contains the distribution (added in Task 5). Just add the template variable to the Critic Gate 1 prompt template:

The `{complexity_distribution}` in the critic prompt will be populated from the shared context which now includes the distribution section.

- [ ] **Step 6: Run existing tests to verify no breakage**

Run: `npx vitest run tests/agents-dispatcher.test.ts --reporter=verbose`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add prompts/ideator.md prompts/critic.md prompts/curator.md src/curator/index.ts src/agents/dispatcher.ts
git commit -m "feat: prompt updates for ambition scaling and project activation"
```

---

### Task 7: Parser Re-exports & Full Integration Test

**Goal:** Ensure parser re-exports new validators, run the full test suite, and fix any integration issues.

**Files:**
- Modify: `src/parser/index.ts` (re-export new validators and types)
- Modify: `src/context/index.ts` (re-export new distribution functions)
- Test: `tests/integration-pipeline.test.ts` (new — end-to-end iteration with M complexity)

**Acceptance Criteria:**
- [ ] All new types/validators are importable from `src/parser/index.js`
- [ ] All new context functions are importable from `src/context/index.js`
- [ ] Full test suite passes: `npx vitest run`
- [ ] Integration test runs a mocked M-complexity iteration through the full pipeline

**Verify:** `npx vitest run --reporter=verbose` → all tests pass, zero failures

**Steps:**

- [ ] **Step 1: Update parser re-exports**

```typescript
// src/parser/index.ts — add to existing exports
export {
  validateCreatorPlan,
  validateCreatorBuild,
  type CreatorPlan,
  type CreatorPlanResponse,
  type CreatorBuildResponse,
} from "./yaml-parser.js";
```

- [ ] **Step 2: Update context re-exports**

```typescript
// src/context/index.ts — add to existing exports
export { getComplexityDistribution, formatComplexityDistribution } from "./data.js";
```

- [ ] **Step 3: Write integration test**

A test that mocks `callModel` and runs `runIteration` with an M-complexity proposal, verifying that multiple Creator calls happen and the iteration result includes phase data.

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass

- [ ] **Step 5: Fix any failures**

Address any type errors, missing imports, or test failures from integration.

- [ ] **Step 6: Final commit**

```bash
git add src/parser/index.ts src/context/index.ts tests/integration-pipeline.test.ts
git commit -m "feat: complete throughput overhaul — parser exports and integration test"
```
