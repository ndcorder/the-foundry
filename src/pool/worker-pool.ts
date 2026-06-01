import type { FoundryConfig, ModelsConfig, IterationResult } from "../types/index.js";
import type { FoundryEventBus } from "./events.js";
import { Mutex } from "./mutex.js";

interface CompletedIteration {
  iter: number;
  result: IterationResult;
  slot: number;
}

export interface PoolCallbacks {
  runIteration: (config: FoundryConfig, models: ModelsConfig, iteration: number, slot: number) => Promise<IterationResult>;
  onIterationComplete: (result: IterationResult, slot: number) => Promise<void>;
  shouldStop: () => boolean | Promise<boolean>;
  maxConcurrentIterations?: () => number | Promise<number>;
  shouldRunCurator: (iteration: number, result: IterationResult) => boolean;
  runCurator: (iteration: number, result: IterationResult) => Promise<void>;
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

  private runSafely(
    callbacks: PoolCallbacks,
    config: FoundryConfig,
    models: ModelsConfig,
    iter: number,
    slot: number,
  ): Promise<{ result: IterationResult; slot: number }> {
    const startMs = Date.now();
    return Promise.resolve()
      .then(() => callbacks.runIteration(config, models, iter, slot))
      .then((result) => ({ result, slot }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        return {
          slot,
          result: {
            iteration: iter,
            outcome: "skipped",
            reason: `Iteration failed in worker pool: ${message}`,
            token_usage: { input: 0, output: 0 },
            duration_ms: Date.now() - startMs,
          },
        };
      });
  }

  private async handleCompletion(
    completed: CompletedIteration,
    callbacks: Pick<PoolCallbacks, "onIterationComplete">,
  ): Promise<void> {
    this.inFlight.delete(completed.iter);
    this.releaseSlot(completed.slot);
    await callbacks.onIterationComplete(completed.result, completed.slot);
  }

  private async currentConcurrencyLimit(
    callbacks: Pick<PoolCallbacks, "maxConcurrentIterations">,
  ): Promise<number> {
    if (!callbacks.maxConcurrentIterations) return this.concurrency;

    const requestedLimit = await callbacks.maxConcurrentIterations();
    if (!Number.isFinite(requestedLimit)) return this.concurrency;
    return Math.max(1, Math.min(this.concurrency, Math.floor(requestedLimit)));
  }

  private async drainInFlight(callbacks?: Pick<PoolCallbacks, "onIterationComplete">): Promise<number> {
    if (this.inFlight.size === 0) return 0;

    const entries = [...this.inFlight.entries()];
    const completions = await Promise.all(entries.map(([iter, promise]) => (
      promise.then((result) => ({ iter, ...result }))
    )));

    let lastCompletedIteration = 0;
    for (const completed of completions.sort((a, b) => a.iter - b.iter)) {
      if (!this.inFlight.has(completed.iter)) continue;
      lastCompletedIteration = Math.max(lastCompletedIteration, completed.iter);
      if (callbacks) {
        await this.handleCompletion(completed, callbacks);
      } else {
        this.inFlight.delete(completed.iter);
        this.releaseSlot(completed.slot);
      }
    }

    return lastCompletedIteration;
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
      while (!this.shuttingDown) {
        if (await callbacks.shouldStop()) break;
        const concurrencyLimit = await this.currentConcurrencyLimit(callbacks);
        if (this.inFlight.size >= concurrencyLimit) break;

        const iter = this.reserveIteration();
        const slot = this.takeSlot();
        if (slot === undefined) break;

        const promise = this.runSafely(callbacks, config, models, iter, slot);

        this.inFlight.set(iter, promise);
      }

      if (this.inFlight.size === 0) break;

      // Wait for any to complete
      const entries = [...this.inFlight.entries()];
      const results = entries.map(([iter, p]) => p.then((r) => ({ iter, ...r })));
      const completed = await Promise.race(results);

      lastCompletedIteration = Math.max(lastCompletedIteration, completed.iter);
      await this.handleCompletion(completed, callbacks);

      // Curator check (drains pool first)
      if (!this.shuttingDown && callbacks.shouldRunCurator(completed.iter, completed.result)) {
        lastCompletedIteration = Math.max(
          lastCompletedIteration,
          await this.drainInFlight(callbacks),
        );
        await callbacks.runCurator(completed.iter, completed.result);
      }
    }

    // Drain remaining
    lastCompletedIteration = Math.max(
      lastCompletedIteration,
      await this.drainInFlight(callbacks),
    );
    return lastCompletedIteration;
  }

  async drain(): Promise<void> {
    await this.drainInFlight();
  }
}
