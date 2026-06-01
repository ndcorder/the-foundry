import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "yaml";
import { setRootDir } from "../src/root.js";
import {
  emptyStreakHistory,
  formatStreakContext,
  loadStreakHistory,
  saveStreakHistory,
  updateStreakState,
} from "../src/streaks/index.js";
import type { StreakIterationResult } from "../src/streaks/types.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "foundry-streaks-"));
  setRootDir(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const shipped = {
  iteration: 1,
  outcome: "shipped",
  artifact_id: "0001",
  title: "Artifact One",
  domain: "fiction",
  mean_rating: "3.8",
  project_id: null,
} satisfies StreakIterationResult;

describe("streaks/updateStreakState", () => {
  it("starts and extends a same-domain hot streak with high-rated shipped artifacts", () => {
    const first = updateStreakState(emptyStreakHistory(), shipped);
    const second = updateStreakState(first, {
      ...shipped,
      iteration: 2,
      artifact_id: "0002",
      title: "Artifact Two",
    });

    expect(second.current?.active).toBe(true);
    expect(second.current?.length).toBe(2);
    expect(second.current?.domain).toBe("fiction");
    expect(second.current?.artifact_ids).toEqual(["0001", "0002"]);
    expect(second.current?.avg_rating).toBe(3.8);
  });

  it("extends a hot streak across code domains", () => {
    const first = updateStreakState(emptyStreakHistory(), {
      ...shipped,
      domain: "code-tool",
    });
    const second = updateStreakState(first, {
      ...shipped,
      iteration: 2,
      artifact_id: "0002",
      domain: "code-art",
      mean_rating: "4.0",
    });

    expect(second.current?.domain).toBe("code");
    expect(second.current?.length).toBe(2);
    expect(second.current?.avg_rating).toBe(3.9);
  });

  it("extends a hot streak across a shared project even when domains differ", () => {
    const first = updateStreakState(emptyStreakHistory(), {
      ...shipped,
      project_id: "P001",
    });
    const second = updateStreakState(first, {
      ...shipped,
      iteration: 2,
      artifact_id: "0002",
      domain: "poetry",
      project_id: "P001",
    });

    expect(second.current?.project_id).toBe("P001");
    expect(second.current?.length).toBe(2);
  });

  it("breaks a streak on a low-rated ship and applies cooldown", () => {
    const active = updateStreakState(
      updateStreakState(emptyStreakHistory(), shipped),
      { ...shipped, iteration: 2, artifact_id: "0002" },
    );

    const broken = updateStreakState(active, {
      ...shipped,
      iteration: 3,
      artifact_id: "0003",
      mean_rating: "2.9",
    });

    expect(broken.current).toBeNull();
    expect(broken.recent_breaks[0]).toMatchObject({
      iteration: 3,
      domain: "fiction",
      break_reason: "low_rating",
    });
    expect(broken.cooldown_domains).toEqual(["fiction"]);
    expect(broken.cooldown_remaining).toBe(2);
  });

  it("breaks a streak on a kill and records the killed domain", () => {
    const active = updateStreakState(
      updateStreakState(emptyStreakHistory(), shipped),
      { ...shipped, iteration: 2, artifact_id: "0002" },
    );

    const broken = updateStreakState(active, {
      iteration: 3,
      outcome: "killed",
      artifact_id: "0003",
      title: "Failed Artifact",
      domain: "fiction",
      reason: "Too derivative",
    });

    expect(broken.current).toBeNull();
    expect(broken.recent_breaks[0]).toMatchObject({
      iteration: 3,
      domain: "fiction",
      break_reason: "killed",
    });
    expect(broken.cooldown_domains).toEqual(["fiction"]);
  });

  it("does not break or extend streaks on skipped iterations", () => {
    const active = updateStreakState(emptyStreakHistory(), shipped);
    const skipped = updateStreakState(active, {
      iteration: 2,
      outcome: "skipped",
      reason: "deadlock",
    });

    expect(skipped.current?.length).toBe(1);
    expect(skipped.cooldown_remaining).toBe(0);
  });

  it("decrements cooldown on subsequent shipped work outside the cooled domain", () => {
    const active = updateStreakState(
      updateStreakState(emptyStreakHistory(), shipped),
      { ...shipped, iteration: 2, artifact_id: "0002" },
    );
    const broken = updateStreakState(active, {
      ...shipped,
      iteration: 3,
      artifact_id: "0003",
      mean_rating: "2.5",
    });
    const pivoted = updateStreakState(broken, {
      ...shipped,
      iteration: 4,
      artifact_id: "0004",
      domain: "poetry",
      mean_rating: "3.8",
    });

    expect(pivoted.cooldown_remaining).toBe(1);
    expect(pivoted.cooldown_domains).toEqual(["fiction"]);
    expect(pivoted.current?.domain).toBe("poetry");
  });
});

describe("streaks/formatStreakContext", () => {
  it("formats active streak guidance once the streak is worth amplifying", () => {
    const history = updateStreakState(
      updateStreakState(emptyStreakHistory(), shipped),
      { ...shipped, iteration: 2, artifact_id: "0002", title: "Artifact Two" },
    );

    const context = formatStreakContext(history, "ideator");
    expect(context).toContain("Hot Streak");
    expect(context).toContain("2-iteration hot streak");
    expect(context).toContain("fiction");
  });

  it("formats creator context for an active streak", () => {
    const history = updateStreakState(
      updateStreakState(emptyStreakHistory(), shipped),
      { ...shipped, iteration: 2, artifact_id: "0002", title: "Artifact Two" },
    );

    const context = formatStreakContext(history, "creator");
    expect(context).toContain("Streak Context");
    expect(context).toContain("Maintain or exceed");
  });

  it("formats pivot guidance during cooldown", () => {
    const active = updateStreakState(
      updateStreakState(emptyStreakHistory(), shipped),
      { ...shipped, iteration: 2, artifact_id: "0002" },
    );
    const broken = updateStreakState(active, {
      ...shipped,
      iteration: 3,
      mean_rating: "2.5",
    });

    const context = formatStreakContext(broken, "ideator");
    expect(context).toContain("Streak Broken");
    expect(context).toContain("Avoid fiction");
  });

  it("returns an empty string when no guidance is useful yet", () => {
    expect(formatStreakContext(emptyStreakHistory(), "ideator")).toBe("");
    expect(formatStreakContext(updateStreakState(emptyStreakHistory(), shipped), "creator")).toBe("");
  });
});

describe("streaks/persistence", () => {
  it("returns empty history when no streak file exists", async () => {
    const history = await loadStreakHistory();
    expect(history).toEqual(emptyStreakHistory());
  });

  it("saves and loads streak history as YAML", async () => {
    const history = updateStreakState(
      updateStreakState(emptyStreakHistory(), shipped),
      { ...shipped, iteration: 2, artifact_id: "0002", title: "Artifact Two" },
    );

    await saveStreakHistory(history);

    const filePath = path.join(tempDir, "identity", "streaks.yml");
    expect(existsSync(filePath)).toBe(true);
    expect(yaml.parse(readFileSync(filePath, "utf-8")).current.length).toBe(2);

    const loaded = await loadStreakHistory();
    expect(loaded.current?.artifact_ids).toEqual(["0001", "0002"]);
  });
});
