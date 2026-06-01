import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "yaml";
import { setRootDir } from "../src/root.js";
import {
  getRefineryFuelStatusFromSources,
  getRefineryCadenceStatus,
  getLastRefineryIteration,
  parsePortfolioIndex,
  pickRefineryTargets,
  selectRefineryTargets,
} from "../src/refinery/index.js";
import type { DreamEntry } from "../src/dreams/index.js";
import type { PortfolioCandidate, RefineryAttempt } from "../src/refinery/index.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "foundry-refinery-"));
  setRootDir(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function dream(overrides: Partial<DreamEntry>): DreamEntry {
  return {
    artifact_id: "0001",
    title: "Fallen Clock",
    domain: "prose",
    pitch: "A clock complains about time.",
    kill_reason: "Execution failed, but the premise was strong.",
    iteration: 8,
    what_was_good: "The object voice was specific.",
    resurrection_hint: "Rebuild it as a complaint ledger with escalating timestamps.",
    added_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function candidate(overrides: Partial<PortfolioCandidate>): PortfolioCandidate {
  return {
    id: "0010",
    title: "Good Artifact",
    domain: "prose",
    rating: 4,
    iteration: 10,
    project: null,
    refined_from: null,
    readme_path: null,
    content: "Original readme",
    ...overrides,
  };
}

describe("refinery/parsePortfolioIndex", () => {
  it("parses portfolio table rows into candidates", () => {
    const entries = parsePortfolioIndex([
      "# Portfolio Index",
      "",
      "| ID | Title | Domain | Rating | Date | Project |",
      "|---|---|---|---|---|---|",
      "| 0007 | Low Piece | prose | 3.2 | 2026-01-01 | — |",
      "| 0012 | Strong Piece | code-tool | 4.6 | 2026-01-02 | P001 |",
    ].join("\n"));

    expect(entries).toEqual([
      expect.objectContaining({ id: "0007", title: "Low Piece", domain: "prose", rating: 3.2, iteration: 7, project: null }),
      expect.objectContaining({ id: "0012", title: "Strong Piece", domain: "code-tool", rating: 4.6, iteration: 12, project: "P001" }),
    ]);
  });

  it("parses refined source lineage from portfolio rows", () => {
    const entries = parsePortfolioIndex([
      "# Portfolio Index",
      "",
      "| ID | Title | Domain | Rating | Date | Project | Refined From |",
      "|---|---|---|---|---|---|---|",
      "| 0042 | Clock Ledger Reforged [refined] | prose | 4.1 | 2026-01-05 | — | #0007 |",
      "| 0043 | Standalone | prose | 4.0 | 2026-01-06 | — | — |",
    ].join("\n"));

    expect(entries).toEqual([
      expect.objectContaining({ id: "0042", refined_from: "0007" }),
      expect.objectContaining({ id: "0043", refined_from: null }),
    ]);
  });
});

describe("refinery/pickRefineryTargets", () => {
  it("prioritizes the strongest dream that was not attempted recently", () => {
    const attempts: RefineryAttempt[] = [{ source_id: "0001", iteration: 18, source_type: "dream" }];
    const targets = pickRefineryTargets({
      dreams: [
        dream({ artifact_id: "0001", title: "Recent Attempt", resurrection_hint: "This is a very strong hint but was attempted recently." }),
        dream({ artifact_id: "0002", title: "Open Dream", resurrection_hint: "Short hint." }),
        dream({ artifact_id: "0003", title: "Strong Open Dream", resurrection_hint: "Rebuild as a sequence of increasingly specific field notes from the failed artifact." }),
      ],
      portfolio: [],
      attempts,
      current_iteration: 20,
    });

    expect(targets[0]).toMatchObject({
      source_type: "dream",
      source_id: "0003",
      source_title: "Strong Open Dream",
      refinement_type: "resurrected",
    });
  });

  it("does not resurrect a dream that already shipped from refinery", () => {
    const attempts: RefineryAttempt[] = [{
      source_id: "0001",
      source_type: "dream",
      iteration: 3,
      result: "shipped",
    }];
    const targets = pickRefineryTargets({
      dreams: [
        dream({ artifact_id: "0001", title: "Already Resurrected", resurrection_hint: "Strong old hint from a shipped resurrection." }),
        dream({ artifact_id: "0002", title: "Open Dream", resurrection_hint: "Open hint." }),
      ],
      portfolio: [],
      attempts,
      current_iteration: 30,
    });

    expect(targets[0]).toMatchObject({
      source_type: "dream",
      source_id: "0002",
      source_title: "Open Dream",
    });
  });

  it("falls back to a companion target before low-rated remasters", () => {
    const targets = pickRefineryTargets({
      dreams: [],
      portfolio: [
        candidate({ id: "0010", title: "Low Piece", rating: 3.1, iteration: 10 }),
        candidate({ id: "0019", title: "Strong Recent Piece", rating: 4.7, iteration: 19 }),
      ],
      attempts: [],
      current_iteration: 20,
    });

    expect(targets[0]).toMatchObject({
      source_type: "companion",
      source_id: "0019",
      refinement_type: "companion",
      source_title: "Strong Recent Piece",
    });
  });

  it("does not select a companion source that already shipped a companion", () => {
    const attempts: RefineryAttempt[] = [{
      source_id: "0019",
      source_type: "companion",
      iteration: 3,
      result: "shipped",
    }];
    const targets = pickRefineryTargets({
      dreams: [],
      portfolio: [
        candidate({ id: "0018", title: "Second Strong Piece", rating: 4.2, iteration: 18 }),
        candidate({ id: "0019", title: "Already Companioned", rating: 4.9, iteration: 19 }),
      ],
      attempts,
      current_iteration: 20,
    });

    expect(targets[0]).toMatchObject({
      source_type: "companion",
      source_id: "0018",
      source_title: "Second Strong Piece",
    });
  });

  it("uses the lowest old low-rated artifact when no dreams or companion targets are available", () => {
    const attempts: RefineryAttempt[] = [{ source_id: "0019", source_type: "companion", iteration: 18 }];
    const targets = pickRefineryTargets({
      dreams: [],
      portfolio: [
        candidate({ id: "0010", title: "Low A", rating: 3.4, iteration: 10 }),
        candidate({ id: "0011", title: "Low B", rating: 3.0, iteration: 11 }),
        candidate({ id: "0018", title: "Too Fresh", rating: 3.0, iteration: 18 }),
        candidate({ id: "0019", title: "Strong Recent Piece", rating: 4.7, iteration: 19 }),
      ],
      attempts,
      current_iteration: 20,
    });

    expect(targets[0]).toMatchObject({
      source_type: "low_rated",
      source_id: "0011",
      refinement_type: "remastered",
      original_rating: 3.0,
    });
  });

  it("does not remaster a source that already has a refined descendant", () => {
    const targets = pickRefineryTargets({
      dreams: [],
      portfolio: [
        candidate({ id: "0010", title: "Already Refined Low", rating: 3.0, iteration: 10 }),
        candidate({ id: "0011", title: "Open Low", rating: 3.2, iteration: 11 }),
        candidate({ id: "0042", title: "Already Refined Low [refined]", rating: 4.0, iteration: 42, refined_from: "0010" }),
      ],
      attempts: [],
      current_iteration: 50,
    });

    expect(targets[0]).toMatchObject({
      source_type: "low_rated",
      source_id: "0011",
      source_title: "Open Low",
    });
  });
});

describe("refinery/getRefineryFuelStatusFromSources", () => {
  it("counts all eligible refinery fuel separately from the configured queue limit", () => {
    const status = getRefineryFuelStatusFromSources({
      dreams: [
        dream({ artifact_id: "0002", title: "Open Dream", resurrection_hint: "Short hint." }),
        dream({ artifact_id: "0003", title: "Strong Open Dream", resurrection_hint: "Rebuild as increasingly specific field notes from the failed artifact." }),
      ],
      portfolio: [
        candidate({ id: "0010", title: "Low Piece", rating: 3.1, iteration: 10 }),
        candidate({ id: "0019", title: "Strong Recent Piece", rating: 4.7, iteration: 19 }),
      ],
      attempts: [],
      current_iteration: 20,
      config: { enabled: true, min_iterations_between_runs: 5, max_refinery_queue: 1 },
    });

    expect(status).toEqual({
      enabled: true,
      queueLimit: 1,
      available: 4,
      byType: { dream: 2, companion: 1, lowRated: 1 },
      topTargets: [
        expect.objectContaining({ sourceType: "dream", sourceId: "0003", title: "Strong Open Dream" }),
        expect.objectContaining({ sourceType: "dream", sourceId: "0002", title: "Open Dream" }),
        expect.objectContaining({ sourceType: "companion", sourceId: "0019", title: "Strong Recent Piece" }),
      ],
    });
  });
});

describe("refinery/getRefineryCadenceStatus", () => {
  it("reports the next eligible refinery iteration from the configured run gap", () => {
    expect(getRefineryCadenceStatus(12, 9, { enabled: true, min_iterations_between_runs: 5, max_refinery_queue: 1 })).toEqual({
      enabled: true,
      minIterationsBetweenRuns: 5,
      lastIteration: 9,
      nextEligibleIteration: 14,
      iterationsUntilEligible: 2,
    });
  });

  it("reports immediate eligibility when no refinery run has been recorded", () => {
    expect(getRefineryCadenceStatus(12, null, { enabled: true, min_iterations_between_runs: 5, max_refinery_queue: 1 })).toEqual({
      enabled: true,
      minIterationsBetweenRuns: 5,
      lastIteration: null,
      nextEligibleIteration: 12,
      iterationsUntilEligible: 0,
    });
  });
});

describe("refinery/selectRefineryTargets", () => {
  it("loads dreams, portfolio entries, and recent attempts from disk", async () => {
    mkdirSync(path.join(tempDir, "identity"), { recursive: true });
    mkdirSync(path.join(tempDir, "portfolio", "prose", "0010-low-piece"), { recursive: true });
    mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    writeFileSync(path.join(tempDir, "identity", "dreams.yml"), yaml.stringify({
      updated_at: "2026-01-01T00:00:00Z",
      dreams: [dream({ artifact_id: "0005", title: "Disk Dream" })],
    }));
    writeFileSync(path.join(tempDir, "portfolio", "index.md"), [
      "# Portfolio Index",
      "",
      "| ID | Title | Domain | Rating | Date | Project |",
      "|---|---|---|---|---|---|",
      "| 0010 | Low Piece | prose | 3.2 | 2026-01-01 | — |",
    ].join("\n"));
    writeFileSync(path.join(tempDir, "portfolio", "prose", "0010-low-piece", "README.md"), "# Low Piece\n\nOriginal content");
    writeFileSync(path.join(tempDir, "logs", "refinery.jsonl"), JSON.stringify({
      source_id: "9999",
      source_type: "dream",
      iteration: 1,
    }) + "\n");

    const targets = await selectRefineryTargets(20);

    expect(targets[0]).toMatchObject({
      source_type: "dream",
      source_id: "0005",
      source_title: "Disk Dream",
    });
  });
});

describe("refinery/getLastRefineryIteration", () => {
  it("returns the latest recorded refinery attempt iteration", async () => {
    mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    writeFileSync(path.join(tempDir, "logs", "refinery.jsonl"), [
      JSON.stringify({ iteration: 4, source_id: "0001", source_type: "dream", result: "shipped" }),
      JSON.stringify({ iteration: 11, source_id: "0002", source_type: "companion", result: "killed" }),
      JSON.stringify({ iteration: 8, source_id: "0003", source_type: "low_rated", result: "skipped" }),
    ].join("\n") + "\n");

    await expect(getLastRefineryIteration()).resolves.toBe(11);
  });

  it("returns null when no refinery attempts have been recorded", async () => {
    await expect(getLastRefineryIteration()).resolves.toBeNull();
  });
});
