import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FoundryEventBus, type FoundryEvent } from "../src/pool/events.js";
import { ConsoleRenderer } from "../src/pool/renderer.js";

function makeEvent(overrides: Partial<FoundryEvent> & Pick<FoundryEvent, "event" | "data">): FoundryEvent {
  return {
    ts: new Date().toISOString(),
    iteration: 1,
    slot: 0,
    phase: "test",
    ...overrides,
  };
}

describe("ConsoleRenderer", () => {
  let bus: FoundryEventBus;
  let renderer: ConsoleRenderer;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    bus = new FoundryEventBus();
    // Stub appendToLog so we don't hit the filesystem
    vi.spyOn(bus as any, "appendToLog").mockResolvedValue(undefined);
    renderer = new ConsoleRenderer();
    renderer.attach(bus);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    renderer.detach();
    logSpy.mockRestore();
  });

  it("renders proposals with truncation", async () => {
    await bus.emit({
      iteration: 1, slot: 0, phase: "ideation",
      event: "proposals",
      data: { ideas: ["idea-a", "idea-b", "idea-c"] },
    });
    expect(logSpy).toHaveBeenCalledWith(
      "[0] ▶ Ideation: idea-a, idea-b + more",
    );
  });

  it("renders proposals without truncation when <= 2", async () => {
    await bus.emit({
      iteration: 1, slot: 0, phase: "ideation",
      event: "proposals",
      data: { ideas: ["idea-a", "idea-b"] },
    });
    expect(logSpy).toHaveBeenCalledWith(
      "[0] ▶ Ideation: idea-a, idea-b",
    );
  });

  it("renders decisions with selected idea", async () => {
    await bus.emit({
      iteration: 1, slot: 0, phase: "gate1",
      event: "decisions",
      data: { selected: "build a CLI" },
    });
    expect(logSpy).toHaveBeenCalledWith(
      '[0] ▶ Gate 1: approved "build a CLI"',
    );
  });

  it("renders decisions with all rejected", async () => {
    await bus.emit({
      iteration: 1, slot: 0, phase: "gate1",
      event: "decisions",
      data: {},
    });
    expect(logSpy).toHaveBeenCalledWith(
      "[0] ▶ Gate 1: all rejected",
    );
  });

  it("renders phase_start", async () => {
    await bus.emit({
      iteration: 1, slot: 0, phase: "creation",
      event: "phase_start",
      data: { phase: "code" },
    });
    expect(logSpy).toHaveBeenCalledWith(
      "[0] ▶ Creation: code phase",
    );
  });

  it("renders phase_complete with token formatting", async () => {
    await bus.emit({
      iteration: 1, slot: 0, phase: "creation",
      event: "phase_complete",
      data: { phase: "code", output_tokens: 2500 },
    });
    expect(logSpy).toHaveBeenCalledWith(
      "[0]   code: 2.5K tokens",
    );
  });

  it("renders phase_complete with small token count", async () => {
    await bus.emit({
      iteration: 1, slot: 0, phase: "creation",
      event: "phase_complete",
      data: { phase: "outline", output_tokens: 500 },
    });
    expect(logSpy).toHaveBeenCalledWith(
      "[0]   outline: 500 tokens",
    );
  });

  it("renders complete", async () => {
    await bus.emit({
      iteration: 1, slot: 0, phase: "creation",
      event: "complete",
      data: { file_count: 3, total_tokens: 8000 },
    });
    expect(logSpy).toHaveBeenCalledWith(
      "[0] ▶ Created: 3 file(s), 8.0K tokens",
    );
  });

  it("renders verdict", async () => {
    await bus.emit({
      iteration: 1, slot: 0, phase: "testing",
      event: "verdict",
      data: { verdict: "pass" },
    });
    expect(logSpy).toHaveBeenCalledWith(
      "[0] ▶ Tester: pass",
    );
  });

  it("renders decision with rating", async () => {
    await bus.emit({
      iteration: 1, slot: 0, phase: "gate2",
      event: "decision",
      data: { decision: "ship", mean_rating: 4.2 },
    });
    expect(logSpy).toHaveBeenCalledWith(
      "[0] ▶ Gate 2: ship (★4.2)",
    );
  });

  it("renders decision without rating", async () => {
    await bus.emit({
      iteration: 1, slot: 0, phase: "gate2",
      event: "decision",
      data: { decision: "kill" },
    });
    expect(logSpy).toHaveBeenCalledWith(
      "[0] ▶ Gate 2: kill",
    );
  });

  it("renders shipped", async () => {
    await bus.emit({
      iteration: 1, slot: 0, phase: "shipping",
      event: "shipped",
      data: { artifact_id: 42, title: "My Tool", domain: "code", rating: 4.5 },
    });
    expect(logSpy).toHaveBeenCalledWith(
      '[0] ✓ Shipped #42: "My Tool" [code] ★4.5',
    );
  });

  it("renders killed", async () => {
    await bus.emit({
      iteration: 1, slot: 0, phase: "shipping",
      event: "killed",
      data: { artifact_id: 7, title: "Bad Poem" },
    });
    expect(logSpy).toHaveBeenCalledWith(
      '[0] ✘ Killed #7: "Bad Poem"',
    );
  });

  it("renders failed", async () => {
    await bus.emit({
      iteration: 3, slot: 1, phase: "creation",
      event: "failed",
      data: { message: "timeout" },
    });
    expect(logSpy).toHaveBeenCalledWith(
      "[1] ✘ Iteration 3 failed: timeout",
    );
  });

  it("skips unknown events", async () => {
    await bus.emit({
      iteration: 1, slot: 0, phase: "unknown",
      event: "some_unknown_event",
      data: {},
    });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("detach stops rendering", async () => {
    renderer.detach();
    await bus.emit({
      iteration: 1, slot: 0, phase: "testing",
      event: "verdict",
      data: { verdict: "pass" },
    });
    expect(logSpy).not.toHaveBeenCalled();
  });
});
