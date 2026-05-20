# Throughput Overhaul: Complexity-Scaled Creator Pipeline

**Date:** 2026-05-20
**Status:** Draft
**Goal:** 10-20x increase in token throughput per iteration for M/L/XL work

---

## Problem Statement

After 75 iterations over ~2 days, The Foundry uses ~19M tokens/week — roughly 2% of a typical plan allocation. Three root causes:

1. **Complexity is decorative.** The Ideator labels ideas S/M/L but it changes nothing mechanically. The Creator always gets one call with `max_tokens: 16384`.
2. **Creator is single-shot.** The prompt says "Plan → Build → Revise → Polish" but the harness fires one call and expects all four steps in a single response.
3. **Projects don't happen.** The project system is wired up but the Ideator prompt doesn't push for them. Everything is standalone.

## Design Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Creator multi-call architecture | Hybrid: harness-orchestrated phase boundaries, flexible execution inside each | Best observability + checkpointing while keeping phases natural |
| Token budget enforcement | Soft guidance + scaled calls | Log warnings at 2x expected budget, don't enforce hard caps |
| XL tier scope | Both single-iteration and project-starter | Ideator decides which form fits the idea |
| Ambition scaling | Critic-driven via complexity distribution | No hardcoded quotas in Ideator; Critic penalizes too many small ideas |
| Project activation | Ideator nudge + Curator kickstart fallback | Belt and suspenders — soft nudge first, Curator forces if ignored |

---

## 1. Complexity Profiles

### 1.1 ComplexityProfile Type

```typescript
interface ComplexityProfile {
  phases: PhaseKind[];            // which phases to run, in order
  maxTokensPerPhase: number;      // max_tokens for each Creator call
  expectedFiles: [number, number]; // [min, max] files expected
  budgetWarningThreshold: number;  // log warning if total output exceeds this
}

type PhaseKind = "plan" | "build" | "revise" | "polish" | "assemble";
```

### 1.2 Tier Definitions

| Tier | Phases | max_tokens/call | Expected files | Warning threshold |
|---|---|---|---|---|
| S | `[build]` | 16,384 | 1-2 | 25K |
| M | `[plan, build, revise]` | 32,768 | 1-4 | 120K |
| L | `[plan, build, build, revise, polish]` | 65,536 | 2-8 | 400K |
| XL | `[plan, build, build, build, assemble, revise, polish]` | 100,000 | 4-15 | 800K |

Phase sequences are hardcoded in the pipeline module (structural, not tunable). Token budgets per phase are configurable via `foundry.yml`.

The `build` phase can repeat — the plan phase outputs a file manifest with `build_order` grouping files into batches. Each batch becomes one `build` call.

---

## 2. Creator Phase Pipeline

### 2.1 Pipeline Module

New module at `src/creator/pipeline.ts`. Replaces the direct `dispatchCreator` call in the iteration runner.

```typescript
async function runCreatorPipeline(
  ctx: IterationContext,
  proposal: IdeatorProposal,
  criticNotes: string,
  revisionNotes?: string,
): Promise<{ artifact: CreatorResponse; usage: TokenUsage }>
```

Internally:
1. Looks up the `ComplexityProfile` for the proposal's complexity tier
2. For S complexity: delegates to existing `dispatchCreator` (unchanged behavior)
3. For M/L/XL: iterates through `profile.phases` sequentially
4. For each phase, calls a phase-specific dispatch function with outputs from prior phases injected as context
5. Accumulates files and token usage
6. Returns the assembled `CreatorResponse` (same shape as today)

### 2.2 Phase Dispatch

Each phase has a dispatch function in `src/creator/phases.ts`:

- `dispatchPlan(ctx, proposal, criticNotes, manifestoQuality)` → `CreatorPlanResult`
- `dispatchBuild(ctx, plan, criticNotes, priorFiles, batchIndex)` → `CreatorBuildResult`
- `dispatchRevise(ctx, plan, allFiles, criticNotes, manifestoQuality)` → `CreatorBuildResult`
- `dispatchPolish(ctx, plan, revisedFiles)` → `CreatorBuildResult`
- `dispatchAssemble(ctx, plan, allFiles)` → `CreatorBuildResult`

All use `callModel` from `src/model/client.ts` with `max_tokens` from the complexity profile. Agent names for logging: `creator-plan`, `creator-build-1`, `creator-build-2`, `creator-revise`, `creator-polish`, `creator-assemble`.

### 2.3 Plan Phase Output

The plan phase returns structured YAML:

```yaml
plan:
  approach: "High-level description of how to build this"
  file_manifest:
    - path: "main.py"
      purpose: "Entry point and core game loop"
      estimated_lines: 200
    - path: "engine.py"
      purpose: "Game state management and rules"
      estimated_lines: 150
  key_decisions:
    - "Using curses for terminal UI because..."
    - "State machine pattern for game flow because..."
  challenges:
    - "Handling terminal resize gracefully"
  build_order:
    - ["main.py", "engine.py"]    # build call 1
    - ["ui.py", "README.md"]      # build call 2
```

The `build_order` determines how many `build` calls to make and which files each call produces.

### 2.4 Context Assembly Per Phase

| Phase | Shared ctx | Proposal | Critic notes | Plan output | Prior files | Manifesto |
|---|---|---|---|---|---|---|
| plan | ✓ | ✓ | ✓ | — | — | ✓ |
| build | — | brief | brief | ✓ | prior batches | — |
| revise | — | brief | ✓ | key_decisions | all files | ✓ |
| polish | — | — | — | key_decisions | revised files | — |
| assemble | — | brief | — | file_manifest | all files | — |

The `build` phase gets minimal context beyond the plan — it should focus on writing. The `revise` phase gets the most context for holistic quality evaluation.

### 2.5 Graceful Fallback

If a phase produces invalid YAML after retries (existing `MAX_YAML_RETRIES = 2`):

- **`plan` failure:** Fall back to S-tier single-call Creator. Log the downgrade.
- **`plan` missing `build_order`:** If the plan parses but omits `build_order`, default to a single build call for all files in `file_manifest`. If `file_manifest` is also missing, fall back to S-tier.
- **`build` failure on batch N:** Retry that batch. If still failing, assemble whatever files were built so far and proceed to revise.
- **`revise`/`polish`/`assemble` failure:** Use the last valid `files` array from the build phase. The artifact ships unrevised rather than failing entirely.

---

## 3. XL Tier & Project Integration

### 3.1 XL Dual-Mode

XL proposals include a new field `xl_mode`:

- **`xl_mode: "single"`** — A massive single-iteration artifact. Runs the full XL phase pipeline (7 phases, 100K max_tokens/call).
- **`xl_mode: "project"`** — Starts a multi-iteration project. The first iteration creates the project and produces the first deliverable at L complexity.

### 3.2 Ideator Output for XL Projects

```yaml
ideas:
  - title: "..."
    domain: "code-game"
    complexity: "XL"
    xl_mode: "project"
    pitch: "..."
    why: "..."
    project:
      name: "..."
      description: "..."
      estimated_iterations: 6
      structure:
        - iteration_1: "Core engine and basic gameplay"
        - iteration_2: "Level design and progression"
```

### 3.3 Iteration Runner Logic

After the Critic approves a proposal, in `runIteration`:

```
if proposal.complexity === "XL" && proposal.xl_mode === "project":
  → create project via existing project system (files/projects.ts)
  → downgrade this iteration's complexity to L
  → set proposal.project_id to the new project
  → proceed with normal L pipeline for first deliverable
else:
  → proceed with pipeline using proposal.complexity as-is
```

Subsequent iterations pick up the project via `project_id` references in the Ideator's proposals, using the existing project continuation flow.

---

## 4. Critic-Driven Ambition Scaling

### 4.1 Complexity Distribution Tracking

New helper in `src/context/data.ts`:

```typescript
async function getComplexityDistribution(
  window: number
): Promise<Record<string, number>>
```

Reads the last N entries from `iterations.jsonl`, counts complexity per tier. Requires logging `complexity` in iteration entries (currently not stored).

### 4.2 Critic Gate 1 Changes

The Critic Gate 1 prompt receives a new context variable `{complexity_distribution}`:

```
## Recent Complexity Distribution (last 20 iterations)

S: 14 (70%)  M: 5 (25%)  L: 1 (5%)  XL: 0 (0%)
```

New rule added to the Critic Gate 1 prompt:

> If the portfolio has been dominated by S-complexity work (>60% of the last 20 iterations), you should penalize S proposals in your evaluation and explicitly call for more ambitious work in your rejection reasons. Approve M/L/XL proposals more generously when the portfolio needs ambition.

### 4.3 Ideator Project Nudge

New rule added to the Ideator prompt:

> If no multi-iteration projects are currently active (check the shared context), at least one of your 3 proposals should be a project starter (complexity L or XL with `xl_mode: "project"`). Multi-iteration projects produce richer, more cohesive work.

### 4.4 Curator Project Kickstart

New section in the Curator full cycle prompt:

> **Project Activation:** If no projects have been active for the last {kickstart_after} iterations, propose a specific project idea in your `domain_recommendations`. Frame it as: "Consider starting a project: [concrete idea]. This would span ~[N] iterations and produce [what]." The Ideator should pick this up.

New config field:

```yaml
projects:
  kickstart_after: 15
```

---

## 5. Phase Prompt Templates

New directory `prompts/creator/` with five templates:

### 5.1 `prompts/creator/plan.md`

Receives: `{shared_context}`, `{approved_proposal}`, `{critic_sharpening_notes}`, `{manifesto_quality_standards}`, `{project_context}`

Instructs the Creator to outline structure, file manifest, key decisions, challenges, and build order. Output: YAML `plan` block.

### 5.2 `prompts/creator/build.md`

Receives: `{plan}`, `{critic_sharpening_notes_brief}`, `{prior_files}`, `{build_batch}` (which files to produce this call)

Instructs the Creator to build the specified files according to the plan. Output: YAML `files` array.

### 5.3 `prompts/creator/revise.md`

Receives: `{key_decisions}`, `{all_files}`, `{critic_sharpening_notes}`, `{manifesto_quality_standards}`, `{approved_proposal_brief}`

Instructs the Creator to read the complete draft critically, fix structural issues, sharpen language/logic, cut filler. Output: revised YAML `files` array.

### 5.4 `prompts/creator/polish.md`

Receives: `{key_decisions}`, `{revised_files}`

Final craft pass — naming, rhythm, edge cases, opening/closing strength. Output: final YAML `files` array.

### 5.5 `prompts/creator/assemble.md` (XL only)

Receives: `{file_manifest}`, `{all_files}`, `{approved_proposal_brief}`

Integration: ensure imports/references between files are correct, add glue code, verify coherence. Output: assembled YAML `files` array.

The existing `prompts/creator.md` remains unchanged for S-tier single-call creation.

---

## 6. Logging & Observability

### 6.1 Iteration Log Additions

`iterations.jsonl` entries gain:

```json
{
  "complexity": "L",
  "phases_run": ["plan", "build-1", "build-2", "revise", "polish"],
  "phase_tokens": {
    "plan": 4200,
    "build-1": 38000,
    "build-2": 29000,
    "revise": 42000,
    "polish": 18000
  }
}
```

### 6.2 Token Usage Log

Each phase call gets its own entry in `token-usage.jsonl` with agent names like `creator-plan`, `creator-build-1`, `creator-revise`, etc. (already handled by `callModel`'s `agent` parameter).

### 6.3 Budget Warnings

If total output tokens across all Creator phases exceed `budgetWarningThreshold`, log a warning to console and `monitor.jsonl`.

---

## 7. Config Changes

### 7.1 `config/foundry.yml` additions

```yaml
iteration:
  # ... existing fields ...
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

projects:
  # ... existing fields ...
  kickstart_after: 15
```

---

## 8. Files Changed/Created

### New Files

| File | Purpose |
|---|---|
| `src/creator/pipeline.ts` | Phase pipeline orchestrator |
| `src/creator/phases.ts` | Per-phase dispatch functions |
| `src/creator/profiles.ts` | Complexity profile lookup |
| `src/creator/index.ts` | Re-exports |
| `prompts/creator/plan.md` | Plan phase prompt template |
| `prompts/creator/build.md` | Build phase prompt template |
| `prompts/creator/revise.md` | Revise phase prompt template |
| `prompts/creator/polish.md` | Polish phase prompt template |
| `prompts/creator/assemble.md` | Assemble phase prompt template (XL) |

### Modified Files

| File | Changes |
|---|---|
| `src/iteration/runner.ts` | Replace `dispatchCreator` with `runCreatorPipeline`, add XL→project logic |
| `src/types/agents.ts` | Expand complexity to include "XL", add `xl_mode` and `project` fields |
| `src/types/config.ts` | Add `complexity_profiles` and `kickstart_after` types |
| `src/parser/yaml-parser.ts` | Accept "XL" in complexity enum, validate new fields, add plan validator |
| `src/context/shared.ts` | Add complexity distribution to shared context |
| `src/context/data.ts` | Add `getComplexityDistribution()` helper |
| `src/logging/index.ts` | Add complexity and phase_tokens to iteration log |
| `prompts/ideator.md` | Add project nudge rule |
| `prompts/critic.md` | Add complexity distribution context and ambition pressure rule |
| `src/curator/index.ts` | Add project kickstart logic |
| `config/foundry.yml` | Add complexity_profiles and kickstart_after |

### Unchanged

- `src/model/client.ts` — `max_tokens` already passed per-call
- `src/sandbox/` — Testing pipeline unaffected
- `src/index.ts` — Main loop unchanged

---

## 9. Expected Impact

### Token Usage Per Iteration (estimated)

| Tier | Current | After overhaul | Multiplier |
|---|---|---|---|
| S | ~75K total | ~75K total | 1x |
| M | ~75K total | ~200K total | ~2.7x |
| L | ~75K total | ~500K total | ~6.7x |
| XL (single) | N/A | ~1M+ total | ~13x |
| XL (project) | N/A | ~500K/iter × 6-12 iters | ~40-80x cumulative |

With Critic-driven ambition scaling pushing toward M/L/XL, the average iteration should shift from ~75K to ~200-300K tokens, with periodic L/XL spikes. Weekly throughput should increase from ~19M to ~100-200M tokens.
