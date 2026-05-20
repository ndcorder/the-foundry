import { describe, it, expect } from "vitest";
import { IterationPool } from "../src/pool/worker-pool.js";
import { FoundryEventBus } from "../src/pool/events.js";
import { ConsoleRenderer } from "../src/pool/renderer.js";
import type { IterationResult } from "../src/types/index.js";

describe("pool integration", () => {
  it("runs 3 concurrent iterations with events", async () => {
    const bus = new FoundryEventBus();
    // Suppress file writes in test
    (bus as any).appendToLog = async () => {};

    const renderer = new ConsoleRenderer();
    renderer.attach(bus);

    const pool = new IterationPool(3, 1, bus);
    const completed: number[] = [];
    const maxConcurrent = { value: 0 };
    const running = new Set<number>();

    const callbacks = {
      runIteration: async (_c: any, _m: any, iter: number, slot: number) => {
        running.add(iter);
        maxConcurrent.value = Math.max(maxConcurrent.value, running.size);

        await bus.emit({
          iteration: iter, slot, phase: "ideation", event: "proposals",
          data: { ideas: [`Idea ${iter} [fiction, M]`] },
        });

        await new Promise(r => setTimeout(r, 30 + Math.random() * 20));

        await bus.emit({
          iteration: iter, slot, phase: "bookkeeping", event: "shipped",
          data: { artifact_id: `000${iter}`, title: `Art ${iter}`, domain: "fiction", rating: 4.5 },
        });

        running.delete(iter);
        return {
          iteration: iter, outcome: "shipped" as const, title: `Art ${iter}`,
          domain: "fiction", token_usage: { input: 1000, output: 500 }, duration_ms: 50,
        } as IterationResult;
      },
      onIterationComplete: async (result: IterationResult) => {
        completed.push(result.iteration);
      },
      shouldStop: () => completed.length >= 6,
      shouldRunCurator: () => false,
      runCurator: async () => {},
    };

    await pool.run({} as any, {} as any, callbacks);
    renderer.detach();

    expect(completed.length).toBeGreaterThanOrEqual(6);
    expect(maxConcurrent.value).toBeLessThanOrEqual(3);
    expect(maxConcurrent.value).toBeGreaterThan(1); // actually ran in parallel
  });

  it("git mutex prevents concurrent commits", async () => {
    const bus = new FoundryEventBus();
    (bus as any).appendToLog = async () => {};
    const pool = new IterationPool(2, 1, bus);

    const commitOrder: string[] = [];

    // Simulate two iterations trying to commit
    const commit = async (id: string) => {
      const release = await pool.gitLock.acquire();
      commitOrder.push(`start-${id}`);
      await new Promise(r => setTimeout(r, 20));
      commitOrder.push(`end-${id}`);
      release();
    };

    await Promise.all([commit("a"), commit("b")]);

    // Should be serialized: start-a, end-a, start-b, end-b
    expect(commitOrder).toEqual(["start-a", "end-a", "start-b", "end-b"]);
  });
});
