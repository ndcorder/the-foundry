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

  it("reports correct queue length", async () => {
    const mutex = new Mutex();
    const release1 = await mutex.acquire();
    expect(mutex.queueLength).toBe(0);

    const p2 = mutex.acquire();
    const p3 = mutex.acquire();
    expect(mutex.queueLength).toBe(2);

    release1();
    const release2 = await p2;
    expect(mutex.queueLength).toBe(1);

    release2();
    const release3 = await p3;
    expect(mutex.queueLength).toBe(0);
    release3();
  });
});
