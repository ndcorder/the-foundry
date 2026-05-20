# Parallel Iterations & Multi-Provider (Codex) Integration

**Date:** 2026-05-20
**Status:** Draft
**Goal:** 3x throughput via concurrent iterations + OpenAI Codex as second model provider

---

## Problem Statement

The Foundry runs one iteration at a time. Even with the complexity-scaled Creator pipeline, throughput is limited by sequential execution — each iteration waits for the previous to finish. The user's plan provides high concurrency and access to OpenAI Codex (GPT-5.5) alongside Z.ai GLM-5.1, but only one provider is used.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Parallelism model | Worker pool with 3 slots | Full iteration parallelism, saturates API concurrency |
| Output format | JSONL event stream + thin console renderer | Structured data as source of truth, display is swappable |
| Provider assignment | Configurable per-agent in models.yml | Maximum flexibility, each agent gets the best model for its role |
| Console display | Slot-prefixed compact summaries | Readable at 3 concurrent without noise |
| Curator timing | Runs between pool cycles | Avoids shared-state conflicts with concurrent iterations |

---

## 1. Worker Pool

### 1.1 Pool Architecture

New module `src/pool/worker-pool.ts`. Maintains a set of in-flight iteration promises with configurable concurrency (default: 3).

```
Main Loop (src/index.ts)
  └─ IterationPool(concurrency=3)
       ├─ Slot 1: runIteration(config, models, 42) → Promise
       ├─ Slot 2: runIteration(config, models, 43) → Promise
       └─ Slot 3: runIteration(config, models, 44) → Promise
```

Uses `Promise.race` on the in-flight set — when any iteration completes, the pool immediately spawns the next to fill the slot.

### 1.2 Iteration Number Reservation

Atomic in-memory counter reserves iteration numbers before spawning. Backed by checkpoint on save.

### 1.3 Artifact ID Mutex

`getNextArtifactId()` wrapped with a promise-based `Mutex` to prevent concurrent iterations racing on the same ID.

### 1.4 Config

```yaml
loop:
  concurrency: 3
  cooldown_seconds: 2
  disk_space_min_gb: 1
```

`concurrency: 1` degrades to current sequential behavior.

---

## 2. JSONL Event Stream

### 2.1 Event Format

All iteration activity emits to `logs/events.jsonl`:

```json
{
  "ts": "2026-05-20T08:55:00.000Z",
  "iteration": 42,
  "slot": 1,
  "phase": "ideation",
  "event": "proposals",
  "data": {
    "ideas": ["Title A [fiction, M]", "Title B [code-tool, L]"]
  }
}
```

### 2.2 Event Types

| Phase | Event | Data |
|---|---|---|
| ideation | `proposals` | idea titles with domain/complexity |
| gate1 | `decisions` | approve/reject per proposal |
| creation | `phase_start` | pipeline phase name |
| creation | `phase_complete` | phase name, output tokens |
| creation | `complete` | file count, total tokens |
| testing | `verdict` | pass/fail verdict |
| gate2 | `decision` | ship/revise/kill, ratings |
| bookkeeping | `shipped` | artifact_id, title, domain, rating |
| bookkeeping | `killed` | artifact_id, title, reason |
| error | `failed` | error message |

### 2.3 Console Renderer

Thin renderer subscribes to an in-memory `EventEmitter` (not the file). Prints slot-prefixed compact lines:

```
[1] ▶ Ideation: "The Cartographer's Confession" [fiction, M] + 2 others
[2] ▶ Creation [L]: plan phase (4.2K tokens)
[3] ✓ Shipped #0042: "Zero Participants" [code-art] ★4.9
```

### 2.4 Existing Logs Unchanged

`iterations.jsonl`, `token-usage.jsonl`, `decisions.jsonl`, `test-reports.jsonl` continue as before. `events.jsonl` is additive.

---

## 3. Multi-Provider Support

### 3.1 Provider Configuration

`models.yml` gains a `providers` section and agents gain a `provider` field:

```yaml
providers:
  zai:
    # uses ZAI_API_KEY env var
  openai-codex:
    # uses Codex CLI OAuth token
    model_default: "gpt-5.5"

agents:
  ideator:
    provider: "zai"
    model: "glm-5.1"
    temperature: 0.9
    max_tokens: 4096

  creator:
    provider: "openai-codex"
    model: "gpt-5.5"
    temperature: 0.7
    max_tokens: 16384
    reasoning_effort: "medium"

  tester:
    provider: "zai"
    model: "glm-5.1"
    temperature: 0.2
    max_tokens: 8192

  critic:
    provider: "zai"
    model: "glm-5.1"
    temperature: 0.3
    max_tokens: 4096

  curator:
    provider: "zai"
    model: "glm-5.1"
    temperature: 0.5
    max_tokens: 8192
```

If `provider` is omitted, defaults to `"zai"` (backwards compatible).

### 3.2 Model Client Changes

`src/model/client.ts` changes `resolveModel` to accept a provider:

```typescript
function resolveModel(provider: string, modelId: string): Model<any> {
  const key = `${provider}:${modelId}`;
  const cached = modelCache.get(key);
  if (cached) return cached;
  const model = getModel(provider as any, modelId as any);
  modelCache.set(key, model);
  return model;
}
```

`callModel` reads `provider` from `AgentModelConfig` and passes it through.

### 3.3 Type Changes

`AgentModelConfig` gains:

```typescript
export interface AgentModelConfig {
  provider?: string;          // defaults to "zai"
  model: string;
  temperature: number;
  max_tokens: number;
  reasoning_effort?: string;  // codex-specific
}
```

### 3.4 Codex API Details

The Pi SDK's `openai-codex-responses` provider handles Codex transparently:
- Uses `https://chatgpt.com/backend-api` as base URL
- Authenticates via Codex CLI OAuth token (user must be logged in)
- Supports WebSocket connections for efficiency
- `gpt-5.5` is a reasoning model — Pi SDK auto-handles thinking tokens
- `reasoningEffort` option maps to the config's `reasoning_effort`

### 3.5 Provider Health Check

At startup:
1. For each unique provider in agent configs, attempt a lightweight validation
2. If `openai-codex` fails (not logged in), log warning and fall back those agents to `zai`
3. Print: `Mode: 3 parallel iterations (zai + openai-codex)`

---

## 4. Git Serialization & Shared State

### 4.1 Git Commit Mutex

A promise-based `GitMutex` serializes all git operations. `autoCommitAndPush` acquires the mutex before `git add && commit && push`.

### 4.2 Shared State Safety

| Resource | Safety |
|---|---|
| Portfolio index | Mutex-serialized with git |
| Journal | Append-only (atomic for small writes) |
| JSONL logs | Append-only |
| Workspace | Per-slot: `workspace/slot-{N}/` |
| Checkpoint | Written by main loop between pool cycles |
| Manifesto | Read-only during iterations; Curator writes between cycles |
| `requests.md` / `STOP` | Checked by main loop before spawning |

### 4.3 Per-Slot Workspaces

Each concurrent iteration gets `workspace/slot-{N}/`. `clearWorkspace` and `writeWorkspaceFile` accept an optional slot parameter. After completion, the slot workspace is cleared for reuse.

### 4.4 Curator Timing

Curator runs between pool cycles. Specifically: after the pool detects that `shouldRunCurator` is true for the latest completed iteration, the pool drains all in-flight iterations (waits for them to finish), runs the Curator cycle, then resumes filling slots. This ensures no iterations are running while the Curator modifies shared state.

---

## 5. Files Changed/Created

### New Files

| File | Purpose |
|---|---|
| `src/pool/index.ts` | Re-exports |
| `src/pool/worker-pool.ts` | Iteration pool with configurable concurrency |
| `src/pool/mutex.ts` | Promise-based mutex for git and artifact IDs |
| `src/pool/events.ts` | Event types, EventEmitter, JSONL writer |
| `src/pool/renderer.ts` | Console renderer with slot-prefixed output |

### Modified Files

| File | Changes |
|---|---|
| `src/index.ts` | Replace sequential loop with pool-based main loop |
| `src/model/client.ts` | `resolveModel` accepts provider, `callModel` reads provider from config |
| `src/types/config.ts` | `AgentModelConfig` gains `provider`, `reasoning_effort`. Loop gains `concurrency`. |
| `src/iteration/runner.ts` | Accept slot number, per-slot workspace, emit events |
| `src/files/index.ts` | Workspace functions accept optional slot |
| `src/files/portfolio.ts` | `getNextArtifactId` wrapped with mutex |
| `config/foundry.yml` | Add `concurrency: 3` |
| `config/models.yml` | Add `providers` section, `provider` field per agent |

### Unchanged

- `src/agents/dispatcher.ts` — provider flows through AgentModelConfig
- `src/creator/` — iteration-scoped, no concurrency concern
- `src/parser/` — no changes
- `src/curator/index.ts` — runs between pool cycles
- `prompts/` — no changes

### Backwards Compatibility

- `concurrency: 1` = sequential (current behavior)
- `provider` omitted = defaults to `"zai"`
- Existing `models.yml` without `providers` works unchanged
- All existing tests pass unmodified

---

## 6. Expected Impact

| Metric | Before | After |
|---|---|---|
| Iterations/hour | ~4-6 | ~12-18 (3x) |
| Tokens/hour | ~300K-500K | ~1M-2M |
| Tokens/week | ~50M-80M | ~150M-300M |
| Provider utilization | Z.ai only | Z.ai + Codex |
| API concurrency used | 1 request at a time | Up to 3×5 agents = 15 concurrent |

Combined with the throughput overhaul (M/L/XL scaling), total weekly token usage should reach 200M-500M+ depending on complexity mix.
