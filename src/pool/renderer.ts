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
