import { appendFile, mkdir } from "node:fs/promises";
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
