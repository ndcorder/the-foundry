import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setRootDir } from "../src/root.js";
import { FoundryEventBus } from "../src/pool/events.js";

let tempDir: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tempDir = mkdtempSync(path.join(tmpdir(), "foundry-events-"));
  setRootDir(tempDir);
});

afterEach(() => {
  setRootDir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe("FoundryEventBus", () => {
  it("emits events to subscribers", async () => {
    const bus = new FoundryEventBus();
    const received: any[] = [];
    bus.on((e) => received.push(e));

    await bus.emit({
      iteration: 1,
      slot: 0,
      phase: "ideation",
      event: "proposals",
      data: { ideas: ["A"] },
    });

    expect(received).toHaveLength(1);
    expect(received[0].phase).toBe("ideation");
    expect(received[0].ts).toBeDefined();
  });

  it("writes events to JSONL log", async () => {
    const bus = new FoundryEventBus();
    await bus.emit({
      iteration: 1,
      slot: 0,
      phase: "test",
      event: "verdict",
      data: { result: "pass" },
    });

    const content = readFileSync(
      path.join(tempDir, "logs", "events.jsonl"),
      "utf-8",
    );
    const entry = JSON.parse(content.trim());
    expect(entry.phase).toBe("test");
    expect(entry.data.result).toBe("pass");
  });

  it("unsubscribe works", async () => {
    const bus = new FoundryEventBus();
    const received: any[] = [];
    const unsub = bus.on((e) => received.push(e));

    await bus.emit({
      iteration: 1,
      slot: 0,
      phase: "a",
      event: "x",
      data: {},
    });
    unsub();
    await bus.emit({
      iteration: 2,
      slot: 0,
      phase: "b",
      event: "y",
      data: {},
    });

    expect(received).toHaveLength(1);
  });

  it("handler errors do not crash the bus", async () => {
    const bus = new FoundryEventBus();
    const received: any[] = [];

    bus.on(() => {
      throw new Error("boom");
    });
    bus.on((e) => received.push(e));

    await bus.emit({
      iteration: 1,
      slot: 0,
      phase: "test",
      event: "x",
      data: {},
    });

    expect(received).toHaveLength(1);
  });

  it("appends multiple events as separate lines", async () => {
    const bus = new FoundryEventBus();
    await bus.emit({ iteration: 1, slot: 0, phase: "a", event: "x", data: {} });
    await bus.emit({ iteration: 2, slot: 1, phase: "b", event: "y", data: {} });

    const content = readFileSync(
      path.join(tempDir, "logs", "events.jsonl"),
      "utf-8",
    );
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).iteration).toBe(1);
    expect(JSON.parse(lines[1]).iteration).toBe(2);
  });
});
