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
  private readonly availableSlots: number[] = [];
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
    this.resetAvailableSlots();
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

  private takeSlot(): number | undefined {
    return this.availableSlots.shift();
  }

  private releaseSlot(slot: number): void {
    if (this.availableSlots.includes(slot)) return;
    this.availableSlots.push(slot);
    this.availableSlots.sort((a, b) => a - b);
  }

  private resetAvailableSlots(): void {
    this.availableSlots.length = 0;
    for (let slot = 1; slot <= this.concurrency; slot++) {
      this.availableSlots.push(slot);
    }
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
        const slot = this.takeSlot();
        if (slot === undefined) break;

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
      this.releaseSlot(completed.slot);
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
    this.resetAvailableSlots();
  }
}
