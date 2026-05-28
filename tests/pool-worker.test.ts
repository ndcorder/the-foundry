import { describe, it, expect } from "vitest";
import { IterationPool } from "../src/pool/worker-pool.js";
import { FoundryEventBus } from "../src/pool/events.js";
import type { IterationResult } from "../src/types/index.js";

const makeResult = (iter: number, outcome = "shipped"): IterationResult => ({
  iteration: iter,
  outcome: outcome as IterationResult["outcome"],
  token_usage: { input: 100, output: 50 },
  duration_ms: 100,
});

function makeBus(): FoundryEventBus {
  const bus = new FoundryEventBus();
  // Skip file writes in tests
  (bus as any).appendToLog = async () => {};
  return bus;
}

describe("IterationPool", () => {
  it("runs iterations up to concurrency limit", async () => {
    const bus = makeBus();
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
    expect(completed).toBeGreaterThanOrEqual(4);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("converts rejected iterations into skipped completions and continues", async () => {
    const bus = makeBus();
    const pool = new IterationPool(2, 1, bus);
    const completed: IterationResult[] = [];

    const callbacks = {
      runIteration: async (_c: any, _m: any, iter: number) => {
        if (iter === 1) throw new Error("model provider unavailable");
        await new Promise((r) => setTimeout(r, 10));
        return makeResult(iter);
      },
      onIterationComplete: async (result: IterationResult) => {
        completed.push(result);
      },
      shouldStop: () => completed.length >= 3,
      shouldRunCurator: () => false,
      runCurator: async () => {},
    };

    await expect(pool.run({} as any, {} as any, callbacks)).resolves.toBeGreaterThanOrEqual(3);
    expect(completed.some((r) => r.iteration === 1 && r.outcome === "skipped")).toBe(true);
    expect(completed.some((r) => r.iteration > 1 && r.outcome === "shipped")).toBe(true);
    expect(completed.find((r) => r.iteration === 1)?.reason).toContain("model provider unavailable");
  });

  it("drains in-flight iterations on shutdown", async () => {
    const bus = makeBus();
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

  it("completes 4+ iterations with concurrency=2", async () => {
    const bus = makeBus();
    const pool = new IterationPool(2, 1, bus);
    const completedIters: number[] = [];

    const callbacks = {
      runIteration: async (_c: any, _m: any, iter: number) => {
        await new Promise((r) => setTimeout(r, 20));
        return makeResult(iter);
      },
      onIterationComplete: async (result: IterationResult) => {
        completedIters.push(result.iteration);
      },
      shouldStop: () => completedIters.length >= 6,
      shouldRunCurator: () => false,
      runCurator: async () => {},
    };

    const last = await pool.run({} as any, {} as any, callbacks);
    expect(completedIters.length).toBeGreaterThanOrEqual(4);
    expect(last).toBeGreaterThanOrEqual(4);
  });

  it("exposes gitLock and artifactLock mutexes", () => {
    const bus = makeBus();
    const pool = new IterationPool(2, 1, bus);
    expect(pool.gitLock).toBeDefined();
    expect(pool.artifactLock).toBeDefined();
    expect(pool.gitLock).not.toBe(pool.artifactLock);
  });

  it("reserveIteration atomically increments", () => {
    const bus = makeBus();
    const pool = new IterationPool(2, 5, bus);
    expect(pool.reserveIteration()).toBe(5);
    expect(pool.reserveIteration()).toBe(6);
    expect(pool.reserveIteration()).toBe(7);
  });

  it("drains pool before running curator", async () => {
    const bus = makeBus();
    const pool = new IterationPool(2, 1, bus);
    let completed = 0;
    const events: string[] = [];
    let curatorRan = false;
    let inFlightWhenCuratorRan = -1;

    const callbacks = {
      runIteration: async (_c: any, _m: any, iter: number) => {
        await new Promise((r) => setTimeout(r, iter === 1 ? 10 : 40));
        return makeResult(iter);
      },
      onIterationComplete: async (result: IterationResult) => {
        completed++;
        events.push(`complete-${result.iteration}`);
      },
      shouldStop: () => completed >= 3,
      shouldRunCurator: (iter: number) => iter === 1 && !curatorRan,
      runCurator: async () => {
        curatorRan = true;
        events.push('curator');
        // Access private inFlight via any — pool should have drained before calling curator
        inFlightWhenCuratorRan = (pool as any).inFlight.size;
      },
    };

    await pool.run({} as any, {} as any, callbacks);
    expect(curatorRan).toBe(true);
    expect(inFlightWhenCuratorRan).toBe(0);
    expect(events.indexOf('complete-2')).toBeGreaterThan(-1);
    expect(events.indexOf('complete-2')).toBeLessThan(events.indexOf('curator'));
  });

  it("does not reuse an occupied workspace slot when refilling the pool", async () => {
    const bus = makeBus();
    const pool = new IterationPool(2, 1, bus);
    const activeSlots = new Set<number>();
    const duplicateSlots: number[] = [];
    let completed = 0;

    const callbacks = {
      runIteration: async (_c: any, _m: any, iter: number, slot: number) => {
        if (activeSlots.has(slot)) duplicateSlots.push(slot);
        activeSlots.add(slot);
        await new Promise((r) => setTimeout(r, iter === 1 ? 10 : 60));
        activeSlots.delete(slot);
        return makeResult(iter);
      },
      onIterationComplete: async () => { completed++; },
      shouldStop: () => completed >= 3,
      shouldRunCurator: () => false,
      runCurator: async () => {},
    };

    await pool.run({} as any, {} as any, callbacks);

    expect(duplicateSlots).toEqual([]);
  });
});
