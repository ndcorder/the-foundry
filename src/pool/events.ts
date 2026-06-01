import { logEvent } from "../logging/index.js";

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
    await logEvent({ ...event });
  }
}
