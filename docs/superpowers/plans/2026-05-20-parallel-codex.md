# Parallel Iterations & Codex Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run 3 iterations concurrently via a worker pool with JSONL event stream, and add OpenAI Codex GPT-5.5 as a second model provider alongside Z.ai GLM-5.1.

**Architecture:** A new `src/pool/` module manages concurrent iteration slots using `Promise.race`. All iteration output flows through a typed `EventEmitter` that writes to `logs/events.jsonl` and renders slot-prefixed console summaries. The model client gains provider-awareness so each agent can be configured to use either `zai` or `openai-codex`.

**Tech Stack:** TypeScript (strict), Pi SDK (`@earendil-works/pi-ai`), Vitest

---

### Task 1: Mutex & Event Primitives

**Goal:** Create the promise-based `Mutex` class and the typed event system that all other pool modules depend on.

**Files:**
- Create: `src/pool/mutex.ts`
- Create: `src/pool/events.ts`
- Create: `src/pool/index.ts`
- Test: `tests/pool-mutex.test.ts`
- Test: `tests/pool-events.test.ts`

**Acceptance Criteria:**
- [ ] `Mutex.acquire()` returns a release function; concurrent acquires serialize correctly
- [ ] `FoundryEventBus` emits typed events and subscribers receive them
- [ ] `appendEvent` writes JSONL to `logs/events.jsonl`
- [ ] Mutex handles 10 concurrent acquires without deadlock

**Verify:** `npx vitest run tests/pool-mutex.test.ts tests/pool-events.test.ts --reporter=verbose` → all pass

**Steps:**

- [ ] **Step 1: Create mutex.ts**

```typescript
// src/pool/mutex.ts
export class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return this.createRelease();
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => resolve(this.createRelease()));
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        next();
      } else {
        this.locked = false;
      }
    };
  }

  get isLocked(): boolean {
    return this.locked;
  }

  get queueLength(): number {
    return this.queue.length;
  }
}
```

- [ ] **Step 2: Create events.ts**

```typescript
// src/pool/events.ts
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { resolve } from "../root.js";

export interface FoundryEvent {
  ts: string;
  iteration: number;
  slot: number;
  phase: string;
  event: string;
  data: Record<string, unknown>;
}

type EventHandler = (event: FoundryEvent) => void;

export class FoundryEventBus {
  private handlers: EventHandler[] = [];
  private logDirEnsured = false;

  on(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  async emit(event: Omit<FoundryEvent, "ts">): Promise<void> {
    const full: FoundryEvent = { ts: new Date().toISOString(), ...event };
    for (const handler of this.handlers) {
      try {
        handler(full);
      } catch {
        // handlers must not crash the bus
      }
    }
    await this.appendToLog(full);
  }

  private async appendToLog(event: FoundryEvent): Promise<void> {
    if (!this.logDirEnsured) {
      await mkdir(resolve("logs"), { recursive: true });
      this.logDirEnsured = true;
    }
    await appendFile(
      resolve("logs", "events.jsonl"),
      JSON.stringify(event) + "\n",
      "utf-8",
    );
  }
}
```

- [ ] **Step 3: Create index.ts re-exports**

```typescript
// src/pool/index.ts
export { Mutex } from "./mutex.js";
export { FoundryEventBus, type FoundryEvent } from "./events.js";
export { IterationPool } from "./worker-pool.js";
export { ConsoleRenderer } from "./renderer.js";
```

Note: `worker-pool.js` and `renderer.js` exports will be added in Tasks 2-3. For now, comment them out or leave them — they'll be uncommented as those files are created.

- [ ] **Step 4: Write mutex tests**

```typescript
// tests/pool-mutex.test.ts
import { describe, it, expect } from "vitest";
import { Mutex } from "../src/pool/mutex.js";

describe("Mutex", () => {
  it("allows immediate acquire when unlocked", async () => {
    const mutex = new Mutex();
    const release = await mutex.acquire();
    expect(mutex.isLocked).toBe(true);
    release();
    expect(mutex.isLocked).toBe(false);
  });

  it("serializes concurrent acquires", async () => {
    const mutex = new Mutex();
    const order: number[] = [];

    const run = async (id: number) => {
      const release = await mutex.acquire();
      order.push(id);
      await new Promise((r) => setTimeout(r, 10));
      release();
    };

    await Promise.all([run(1), run(2), run(3)]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("handles 10 concurrent acquires without deadlock", async () => {
    const mutex = new Mutex();
    const results: number[] = [];

    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      const release = await mutex.acquire();
      results.push(i);
      release();
    });

    await Promise.all(tasks.map((t) => t()));
    expect(results).toHaveLength(10);
  });

  it("double release is safe", async () => {
    const mutex = new Mutex();
    const release = await mutex.acquire();
    release();
    release(); // should not throw or corrupt state
    expect(mutex.isLocked).toBe(false);
  });
});
```

- [ ] **Step 5: Write events tests**

```typescript
// tests/pool-events.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setRootDir } from "../src/root.js";
import { FoundryEventBus } from "../src/pool/events.js";

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "foundry-events-"));
  setRootDir(tempDir);
});
afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

describe("FoundryEventBus", () => {
  it("emits events to subscribers", async () => {
    const bus = new FoundryEventBus();
    const received: any[] = [];
    bus.on((e) => received.push(e));

    await bus.emit({ iteration: 1, slot: 0, phase: "ideation", event: "proposals", data: { ideas: ["A"] } });

    expect(received).toHaveLength(1);
    expect(received[0].phase).toBe("ideation");
    expect(received[0].ts).toBeDefined();
  });

  it("writes events to JSONL log", async () => {
    const bus = new FoundryEventBus();
    await bus.emit({ iteration: 1, slot: 0, phase: "test", event: "verdict", data: { result: "pass" } });

    const content = readFileSync(path.join(tempDir, "logs", "events.jsonl"), "utf-8");
    const entry = JSON.parse(content.trim());
    expect(entry.phase).toBe("test");
    expect(entry.data.result).toBe("pass");
  });

  it("unsubscribe works", async () => {
    const bus = new FoundryEventBus();
    const received: any[] = [];
    const unsub = bus.on((e) => received.push(e));

    await bus.emit({ iteration: 1, slot: 0, phase: "a", event: "x", data: {} });
    unsub();
    await bus.emit({ iteration: 2, slot: 0, phase: "b", event: "y", data: {} });

    expect(received).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run tests/pool-mutex.test.ts tests/pool-events.test.ts --reporter=verbose`
Expected: All pass

```bash
git add src/pool/mutex.ts src/pool/events.ts src/pool/index.ts tests/pool-mutex.test.ts tests/pool-events.test.ts
git commit -m "feat(pool): mutex and event bus primitives"
```

---

### Task 2: Multi-Provider Model Client

**Goal:** Update the model client to accept a `provider` field from agent config, resolving models from any Pi SDK provider (zai, openai-codex, etc.).

**Files:**
- Modify: `src/types/config.ts` (add `provider` and `reasoning_effort` to `AgentModelConfig`)
- Modify: `src/model/client.ts` (provider-aware `resolveModel` and `callModel`)
- Modify: `config/models.yml` (add `providers` section and `provider` per agent)
- Modify: `config/foundry.yml` (add `concurrency` to loop)
- Test: `tests/model-client.test.ts` (add provider tests)

**Acceptance Criteria:**
- [ ] `AgentModelConfig` has optional `provider` field defaulting to `"zai"`
- [ ] `callModel` resolves models using the configured provider
- [ ] Model cache keys include provider (no collisions between `zai:glm-5.1` and `openai-codex:gpt-5.5`)
- [ ] Existing tests pass unchanged (backwards compatible default)
- [ ] `config/models.yml` has example Codex configuration

**Verify:** `npx vitest run tests/model-client.test.ts --reporter=verbose` → all pass

**Steps:**

- [ ] **Step 1: Update AgentModelConfig type**

```typescript
// src/types/config.ts — update AgentModelConfig
export interface AgentModelConfig {
  provider?: string;          // defaults to "zai"
  model: string;
  temperature: number;
  max_tokens: number;
  reasoning_effort?: string;  // "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
}
```

Add `concurrency` to the loop config:

```typescript
  loop: {
    concurrency?: number;       // parallel iteration slots (default 1)
    cooldown_seconds: number;
    disk_space_min_gb: number;
  };
```

- [ ] **Step 2: Update model client for provider awareness**

```typescript
// src/model/client.ts — update resolveModel
function resolveModel(provider: string, modelId: string): Model<any> {
  const key = `${provider}:${modelId}`;
  const cached = modelCache.get(key);
  if (cached) return cached;
  const model = getModel(provider as any, modelId as any);
  modelCache.set(key, model);
  return model;
}

// Update callModel to use provider from config
export async function callModel(
  agentConfig: AgentModelConfig,
  systemPrompt: string,
  userMessage: string,
  iteration: number,
  agent: string,
): Promise<ModelCallResult> {
  const effectiveConfig = resolveAgentConfig(agentConfig, agent, iteration);
  const provider = effectiveConfig.provider ?? "zai";

  // ... existing backoff logic ...

  const model = resolveModel(provider, effectiveConfig.model);

  // ... rest unchanged, but pass reasoning_effort in options if present ...
}
```

In the `complete()` call options, add reasoning effort if configured:

```typescript
const options: any = {
  temperature: effectiveConfig.temperature,
  maxTokens: effectiveConfig.max_tokens,
  maxRetries: 5,
  timeoutMs: 180_000,
};
if (effectiveConfig.reasoning_effort) {
  options.reasoningEffort = effectiveConfig.reasoning_effort;
}
```

- [ ] **Step 3: Update models.yml with provider example**

```yaml
# config/models.yml
agents:
  ideator:
    provider: "zai"
    model: "glm-5.1"
    temperature: 0.9
    max_tokens: 4096

  creator:
    provider: "zai"  # change to "openai-codex" + model: "gpt-5.5" to use Codex
    model: "glm-5.1"
    temperature: 0.7
    max_tokens: 16384

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

- [ ] **Step 4: Add concurrency to foundry.yml**

```yaml
# config/foundry.yml — update loop section
loop:
  concurrency: 3
  cooldown_seconds: 2
  disk_space_min_gb: 1
```

- [ ] **Step 5: Write provider tests**

Add test cases to `tests/model-client.test.ts` verifying:
- Default provider is `"zai"` when omitted
- Provider field is passed through to `getModel`
- Cache key includes provider

- [ ] **Step 6: Run tests and commit**

Run: `npx vitest run tests/model-client.test.ts --reporter=verbose`
Expected: All pass

```bash
git add src/types/config.ts src/model/client.ts config/models.yml config/foundry.yml tests/model-client.test.ts
git commit -m "feat: multi-provider model client with Codex support"
```

---

### Task 3: Per-Slot Workspaces

**Goal:** Update workspace functions to support per-slot isolation so concurrent iterations don't collide.

**Files:**
- Modify: `src/files/workspace.ts` (accept optional slot parameter)
- Modify: `src/iteration/runner.ts` (pass slot to workspace functions)
- Test: `tests/files-workspace.test.ts` (add slot tests)

**Acceptance Criteria:**
- [ ] `clearWorkspace(2)` clears `workspace/slot-2/` instead of `workspace/current/`
- [ ] `writeWorkspaceFile("main.py", content, 2)` writes to `workspace/slot-2/main.py`
- [ ] `clearWorkspace()` without args still uses `workspace/current/` (backwards compat)
- [ ] `runIteration` accepts optional `slot` parameter and passes it through

**Verify:** `npx vitest run tests/files-workspace.test.ts --reporter=verbose` → all pass

**Steps:**

- [ ] **Step 1: Update workspace.ts**

```typescript
// src/files/workspace.ts — update all three functions
function workspaceDir(slot?: number): string {
  return slot != null ? resolve("workspace", `slot-${slot}`) : resolve("workspace", "current");
}

export async function clearWorkspace(slot?: number): Promise<void> {
  const dir = workspaceDir(slot);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

export async function writeWorkspaceFile(filePath: string, content: string, slot?: number): Promise<void> {
  const root = workspaceDir(slot);
  const full = path.resolve(root, filePath);
  if (!full.startsWith(path.resolve(root) + path.sep) && full !== path.resolve(root)) {
    throw new Error(`Path traversal blocked: "${filePath}" escapes workspace`);
  }
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf-8");
}

export async function readWorkspaceFiles(slot?: number): Promise<Array<{ path: string; content: string }>> {
  const dir = workspaceDir(slot);
  // ... rest unchanged, just uses dir instead of hardcoded path
}
```

- [ ] **Step 2: Update runner.ts to accept slot**

Add `slot?: number` to the `runIteration` signature and pass it to `clearWorkspace(slot)` and `writeWorkspaceFile(f.path, f.content, slot)`.

- [ ] **Step 3: Write slot workspace tests**

```typescript
// tests/files-workspace.test.ts — add to existing describe
it("uses slot-specific directory when slot provided", async () => {
  await clearWorkspace(2);
  await writeWorkspaceFile("test.txt", "hello", 2);
  const files = await readWorkspaceFiles(2);
  expect(files).toHaveLength(1);
  expect(files[0].path).toBe("test.txt");
});

it("slot workspaces are isolated from each other", async () => {
  await clearWorkspace(1);
  await clearWorkspace(2);
  await writeWorkspaceFile("a.txt", "slot1", 1);
  await writeWorkspaceFile("b.txt", "slot2", 2);
  const files1 = await readWorkspaceFiles(1);
  const files2 = await readWorkspaceFiles(2);
  expect(files1).toHaveLength(1);
  expect(files2).toHaveLength(1);
  expect(files1[0].path).toBe("a.txt");
  expect(files2[0].path).toBe("b.txt");
});

it("defaults to workspace/current when no slot", async () => {
  await clearWorkspace();
  await writeWorkspaceFile("test.txt", "default");
  const files = await readWorkspaceFiles();
  expect(files).toHaveLength(1);
});
```

- [ ] **Step 4: Run tests and commit**

Run: `npx vitest run tests/files-workspace.test.ts tests/iteration-runner.test.ts --reporter=verbose`
Expected: All pass

```bash
git add src/files/workspace.ts src/iteration/runner.ts tests/files-workspace.test.ts
git commit -m "feat: per-slot workspaces for concurrent iterations"
```

---

### Task 4: Console Renderer

**Goal:** Create a thin renderer that subscribes to the event bus and prints slot-prefixed compact summaries.

**Files:**
- Create: `src/pool/renderer.ts`
- Test: `tests/pool-renderer.test.ts`

**Acceptance Criteria:**
- [ ] Renderer subscribes to `FoundryEventBus` and formats output with `[N]` slot prefix
- [ ] `shipped` events print `✓ Shipped #ID: "Title" [domain] ★rating`
- [ ] `failed` events print `✘ Iteration N failed: message`
- [ ] Renderer can be disabled (for tests) by not calling `attach()`

**Verify:** `npx vitest run tests/pool-renderer.test.ts --reporter=verbose` → all pass

**Steps:**

- [ ] **Step 1: Create renderer.ts**

```typescript
// src/pool/renderer.ts
import type { FoundryEvent, FoundryEventBus } from "./events.js";

export class ConsoleRenderer {
  private unsub: (() => void) | null = null;

  attach(bus: FoundryEventBus): void {
    this.unsub = bus.on((event) => this.render(event));
  }

  detach(): void {
    this.unsub?.();
    this.unsub = null;
  }

  private render(event: FoundryEvent): void {
    const prefix = `[${event.slot}]`;
    const line = this.formatEvent(event);
    if (line) console.log(`${prefix} ${line}`);
  }

  private formatEvent(e: FoundryEvent): string | null {
    switch (e.event) {
      case "proposals":
        return `▶ Ideation: ${(e.data.ideas as string[]).slice(0, 2).join(", ")}${(e.data.ideas as string[]).length > 2 ? " + more" : ""}`;
      case "decisions": {
        const selected = e.data.selected as string | undefined;
        return selected ? `▶ Gate 1: approved "${selected}"` : `▶ Gate 1: all rejected`;
      }
      case "phase_start":
        return `▶ Creation: ${e.data.phase} phase`;
      case "phase_complete":
        return `  ${e.data.phase}: ${formatTokens(e.data.output_tokens as number)}`;
      case "complete":
        return `▶ Created: ${e.data.file_count} file(s), ${formatTokens(e.data.total_tokens as number)}`;
      case "verdict":
        return `▶ Tester: ${e.data.verdict}`;
      case "decision":
        return `▶ Gate 2: ${e.data.decision}${e.data.mean_rating ? ` (★${e.data.mean_rating})` : ""}`;
      case "shipped":
        return `✓ Shipped #${e.data.artifact_id}: "${e.data.title}" [${e.data.domain}] ★${e.data.rating}`;
      case "killed":
        return `✘ Killed #${e.data.artifact_id}: "${e.data.title}"`;
      case "failed":
        return `✘ Iteration ${e.iteration} failed: ${e.data.message}`;
      default:
        return null;
    }
  }
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K tokens`;
  return `${n} tokens`;
}
```

- [ ] **Step 2: Write renderer tests**

Test that `formatEvent` produces expected strings for each event type. Use a spy on `console.log` to capture output.

- [ ] **Step 3: Update pool/index.ts exports**

Uncomment the `ConsoleRenderer` export.

- [ ] **Step 4: Run tests and commit**

Run: `npx vitest run tests/pool-renderer.test.ts --reporter=verbose`
Expected: All pass

```bash
git add src/pool/renderer.ts src/pool/index.ts tests/pool-renderer.test.ts
git commit -m "feat(pool): console renderer with slot-prefixed output"
```

---

### Task 5: Worker Pool

**Goal:** Create the `IterationPool` that manages concurrent iteration slots, artifact ID mutex, and git commit serialization.

**Files:**
- Create: `src/pool/worker-pool.ts`
- Modify: `src/files/portfolio.ts` (wrap `getNextArtifactId` with mutex)
- Test: `tests/pool-worker.test.ts`

**Acceptance Criteria:**
- [ ] `IterationPool` runs up to N iterations concurrently
- [ ] `pool.run()` fills all slots and refills as iterations complete
- [ ] `pool.drain()` waits for all in-flight iterations to finish
- [ ] Artifact ID generation is serialized via mutex (no duplicates under concurrency)
- [ ] Git commits are serialized via mutex
- [ ] Pool respects STOP/shutdown signals

**Verify:** `npx vitest run tests/pool-worker.test.ts --reporter=verbose` → all pass

**Steps:**

- [ ] **Step 1: Create worker-pool.ts**

```typescript
// src/pool/worker-pool.ts
import type { FoundryConfig, ModelsConfig, IterationResult } from "../types/index.js";
import type { FoundryEventBus } from "./events.js";
import { Mutex } from "./mutex.js";

export interface PoolCallbacks {
  runIteration: (config: FoundryConfig, models: ModelsConfig, iteration: number, slot: number) => Promise<IterationResult>;
  onIterationComplete: (result: IterationResult, slot: number) => Promise<void>;
  shouldStop: () => boolean | Promise<boolean>;
  shouldRunCurator: (iteration: number) => boolean;
  runCurator: (iteration: number) => Promise<void>;
}

export class IterationPool {
  private readonly concurrency: number;
  private readonly gitMutex = new Mutex();
  private readonly artifactMutex = new Mutex();
  private inFlight = new Map<number, Promise<{ result: IterationResult; slot: number }>>();
  private nextIteration: number;
  private shuttingDown = false;

  readonly bus: FoundryEventBus;

  constructor(
    concurrency: number,
    startIteration: number,
    bus: FoundryEventBus,
  ) {
    this.concurrency = Math.max(1, concurrency);
    this.nextIteration = startIteration;
    this.bus = bus;
  }

  get gitLock(): Mutex {
    return this.gitMutex;
  }

  get artifactLock(): Mutex {
    return this.artifactMutex;
  }

  requestShutdown(): void {
    this.shuttingDown = true;
  }

  reserveIteration(): number {
    return this.nextIteration++;
  }

  async run(
    config: FoundryConfig,
    models: ModelsConfig,
    callbacks: PoolCallbacks,
  ): Promise<number> {
    let lastCompletedIteration = this.nextIteration - 1;

    while (true) {
      // Check stop conditions
      if (this.shuttingDown || await callbacks.shouldStop()) {
        break;
      }

      // Fill slots
      while (this.inFlight.size < this.concurrency && !this.shuttingDown) {
        if (await callbacks.shouldStop()) break;
        const iter = this.reserveIteration();
        const slot = this.inFlight.size + 1;

        const promise = callbacks.runIteration(config, models, iter, slot)
          .then((result) => ({ result, slot }));

        this.inFlight.set(iter, promise);
      }

      if (this.inFlight.size === 0) break;

      // Wait for any to complete
      const entries = [...this.inFlight.entries()];
      const results = entries.map(([iter, p]) => p.then((r) => ({ iter, ...r })));
      const completed = await Promise.race(results);

      this.inFlight.delete(completed.iter);
      lastCompletedIteration = Math.max(lastCompletedIteration, completed.iter);

      await callbacks.onIterationComplete(completed.result, completed.slot);

      // Curator check (drains pool first)
      if (callbacks.shouldRunCurator(completed.iter)) {
        await this.drain();
        await callbacks.runCurator(completed.iter);
      }
    }

    // Drain remaining
    await this.drain();
    return lastCompletedIteration;
  }

  async drain(): Promise<void> {
    if (this.inFlight.size === 0) return;
    await Promise.allSettled([...this.inFlight.values()]);
    this.inFlight.clear();
  }
}
```

- [ ] **Step 2: Wrap getNextArtifactId with mutex support**

In `src/files/portfolio.ts`, export the function as-is (the mutex will be applied by the caller in the runner via `pool.artifactLock`). Add a note in the runner where it calls `getNextArtifactId` to acquire the mutex.

- [ ] **Step 3: Update pool/index.ts exports**

Uncomment the `IterationPool` export.

- [ ] **Step 4: Write pool tests**

```typescript
// tests/pool-worker.test.ts
import { describe, it, expect, vi } from "vitest";
import { IterationPool } from "../src/pool/worker-pool.js";
import { FoundryEventBus } from "../src/pool/events.js";
import type { IterationResult } from "../src/types/index.js";

const makeResult = (iter: number, outcome = "shipped"): IterationResult => ({
  iteration: iter,
  outcome: outcome as any,
  token_usage: { input: 100, output: 50 },
  duration_ms: 100,
});

describe("IterationPool", () => {
  it("runs iterations up to concurrency limit", async () => {
    const bus = new FoundryEventBus();
    (bus as any).appendToLog = async () => {}; // skip file writes
    const pool = new IterationPool(2, 1, bus);
    const running: number[] = [];
    let maxConcurrent = 0;
    let completed = 0;

    const callbacks = {
      runIteration: async (_c: any, _m: any, iter: number, _slot: number) => {
        running.push(iter);
        maxConcurrent = Math.max(maxConcurrent, running.length);
        await new Promise((r) => setTimeout(r, 50));
        running.splice(running.indexOf(iter), 1);
        return makeResult(iter);
      },
      onIterationComplete: async () => { completed++; },
      shouldStop: () => completed >= 4,
      shouldRunCurator: () => false,
      runCurator: async () => {},
    };

    await pool.run({} as any, {} as any, callbacks);
    expect(completed).toBe(4);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("drains in-flight iterations on shutdown", async () => {
    const bus = new FoundryEventBus();
    (bus as any).appendToLog = async () => {};
    const pool = new IterationPool(3, 1, bus);
    let completed = 0;

    const callbacks = {
      runIteration: async (_c: any, _m: any, iter: number) => {
        await new Promise((r) => setTimeout(r, 30));
        return makeResult(iter);
      },
      onIterationComplete: async () => {
        completed++;
        if (completed >= 2) pool.requestShutdown();
      },
      shouldStop: () => false,
      shouldRunCurator: () => false,
      runCurator: async () => {},
    };

    await pool.run({} as any, {} as any, callbacks);
    expect(completed).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 5: Run tests and commit**

Run: `npx vitest run tests/pool-worker.test.ts --reporter=verbose`
Expected: All pass

```bash
git add src/pool/worker-pool.ts src/pool/index.ts tests/pool-worker.test.ts
git commit -m "feat(pool): worker pool with concurrent iteration management"
```

---

### Task 6: Main Loop Refactor

**Goal:** Replace the sequential while-loop in `src/index.ts` with the pool-based main loop. Wire up event bus, renderer, git mutex, and Curator drain logic.

**Files:**
- Modify: `src/index.ts` (main loop rewrite)
- Modify: `src/iteration/runner.ts` (emit events, accept slot)
- Test: `tests/index.test.ts` (if exists, update; otherwise integration tested via pool)

**Acceptance Criteria:**
- [ ] `startFoundry` uses `IterationPool` when `concurrency > 1`
- [ ] `concurrency: 1` produces identical behavior to the old sequential loop
- [ ] Git commits are serialized via `pool.gitLock`
- [ ] Curator drains the pool before running
- [ ] STOP file and SIGINT/SIGTERM drain the pool gracefully
- [ ] Console shows slot-prefixed output via `ConsoleRenderer`
- [ ] Iteration runner emits events to the bus
- [ ] Full test suite passes

**Verify:** `npx vitest run --reporter=verbose` → all pass, zero failures

**Steps:**

- [ ] **Step 1: Add event emission to runner.ts**

Add an optional `eventBus` and `slot` parameter to `runIteration`. At key points (ideation, gate1, creation phases, testing, gate2, bookkeeping), call `bus.emit(...)` with the appropriate event data. Keep existing `console.log` calls as fallback when no bus is provided (backwards compat for `concurrency: 1`).

- [ ] **Step 2: Refactor main loop in index.ts**

Replace the `while (true)` loop with:

```typescript
const concurrency = config.loop?.concurrency ?? 1;

if (concurrency <= 1) {
  // Sequential mode — existing behavior, no pool overhead
  // ... keep current while loop as-is ...
} else {
  // Parallel mode
  const bus = new FoundryEventBus();
  const renderer = new ConsoleRenderer();
  renderer.attach(bus);

  const pool = new IterationPool(concurrency, iteration, bus);

  const onSignalParallel = () => {
    if (pool) pool.requestShutdown();
    // ... existing shutdown logic
  };

  const lastIteration = await pool.run(config, models, {
    runIteration: async (cfg, mdls, iter, slot) => {
      stats.setIteration(iter);
      return runIteration(cfg, mdls, iter, slot, bus);
    },
    onIterationComplete: async (result, slot) => {
      // Record stats
      if (result.outcome === "shipped" || result.outcome === "killed" || result.outcome === "skipped") {
        stats.recordOutcome(result.iteration, result.outcome, result.domain);
      }
      stats.recordTokens(result.token_usage.input, result.token_usage.output);

      // Git commit (serialized)
      if (autoGitCommit && (result.outcome === "shipped" || result.outcome === "killed")) {
        const release = await pool.gitLock.acquire();
        try {
          autoCommitAndPush(/* ... */);
        } finally {
          release();
        }
      }
    },
    shouldStop: async () => shutdownRequested || await checkStopFile(config),
    shouldRunCurator: (iter) => shouldRunCurator(iter, lastCuratorRun, config),
    runCurator: async (iter) => {
      const curatorResponse = await dispatchCuratorFull(config, models, iter, stats);
      await applyCuratorCycle(curatorResponse, iter);
      lastCuratorRun = iter;
    },
  });

  iteration = lastIteration + 1;
  renderer.detach();
}
```

- [ ] **Step 3: Wire artifact ID mutex in runner**

In `runIteration`, when calling `getNextArtifactId()`, acquire the artifact mutex if a pool reference is available. Pass the pool's `artifactLock` via the bus or a context parameter.

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/iteration/runner.ts
git commit -m "feat: pool-based main loop with parallel iterations"
```

---

### Task 7: Provider Health Check & Startup Banner

**Goal:** Validate configured providers at startup and print a summary banner showing concurrency and provider status.

**Files:**
- Modify: `src/index.ts` (startup validation)
- Modify: `src/model/client.ts` (add `validateProvider` function)

**Acceptance Criteria:**
- [ ] Startup prints `Mode: 3 parallel iterations (zai + openai-codex)` or similar
- [ ] If openai-codex is configured but unreachable, warning is logged and agents fall back to zai
- [ ] Startup prints provider list with status

**Verify:** Manual verification + `npx vitest run --reporter=verbose` → all pass

**Steps:**

- [ ] **Step 1: Add validateProvider to model client**

```typescript
// src/model/client.ts
export async function validateProvider(provider: string, modelId: string): Promise<boolean> {
  try {
    resolveModel(provider, modelId);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Add startup validation in index.ts**

After loading config and models, iterate unique providers from agent configs. For each, call `validateProvider`. Print results.

If a provider fails, reassign those agents to `"zai"` with a warning.

- [ ] **Step 3: Update startup banner**

```typescript
const concurrency = config.loop?.concurrency ?? 1;
const providers = [...new Set(Object.values(models.agents).map((a) => a.provider ?? "zai"))];
console.log(`Mode: ${concurrency} parallel iteration${concurrency > 1 ? "s" : ""} (${providers.join(" + ")})`);
```

- [ ] **Step 4: Run tests and commit**

Run: `npx vitest run --reporter=verbose`
Expected: All pass

```bash
git add src/index.ts src/model/client.ts
git commit -m "feat: provider health check and startup banner"
```

---

### Task 8: Full Integration Test & Version Bump

**Goal:** End-to-end integration test with mocked models running 3 parallel iterations, plus version bump to rc.2.

**Files:**
- Create: `tests/pool-integration.test.ts`
- Modify: `package.json` (version bump)
- Modify: `config/foundry.yml` (version bump)

**Acceptance Criteria:**
- [ ] Integration test runs pool with concurrency=3 and mocked `runIteration`
- [ ] Test verifies 3+ iterations complete and events are emitted
- [ ] Test verifies git mutex prevents concurrent commits
- [ ] Full test suite passes
- [ ] Version bumped to 1.0.0-rc.2

**Verify:** `npx vitest run --reporter=verbose` → all pass, zero failures

**Steps:**

- [ ] **Step 1: Write integration test**

Test that creates a pool with concurrency=3, mocks `runIteration` with small delays, and verifies:
- Multiple iterations run concurrently (track max in-flight)
- Event bus receives events from all slots
- All iterations complete successfully

- [ ] **Step 2: Run full suite**

Run: `npx vitest run --reporter=verbose`
Expected: All pass

- [ ] **Step 3: Version bump**

```bash
# package.json and config/foundry.yml
version: "1.0.0-rc.2"
```

- [ ] **Step 4: Final commit and tag**

```bash
git add -A
git commit -m "feat: parallel iterations + Codex integration complete"
git tag -a v1.0.0-rc.2 -m "v1.0.0-rc.2 — Parallel iterations (3x) + Codex provider support"
git push origin master --tags
```
