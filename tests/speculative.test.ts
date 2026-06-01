import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "yaml";
import { setRootDir } from "../src/root.js";
import {
  buildSpeculativeIdeas,
  clearSpeculativeIdeas,
  filterCurrentSpeculativeIdeas,
  formatSpeculativeIdeas,
  isSalvageableEvaluation,
  loadSpeculativeIdeas,
  saveSpeculativeIdeas,
} from "../src/speculative/index.js";
import type { IdeatorProposal } from "../src/types/index.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "foundry-speculative-"));
  setRootDir(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function proposal(title: string): IdeatorProposal {
  return {
    title,
    domain: "prose",
    pitch: `${title} pitch`,
    complexity: "M",
    why: `${title} matters`,
    project_id: null,
    stimulus_ref: null,
  };
}

describe("speculative/isSalvageableEvaluation", () => {
  it("keeps revise evaluations and vague rejects while dropping fundamental rejects", () => {
    expect(isSalvageableEvaluation({
      title: "Needs Work",
      decision: "revise",
      sharpening_notes: "Find a better structure.",
      reasons: "The angle is good but underspecified.",
    })).toBe(true);

    expect(isSalvageableEvaluation({
      title: "Thin Pitch",
      decision: "reject",
      sharpening_notes: "",
      reasons: "Too vague and generic, but the kernel might work.",
    })).toBe(true);

    expect(isSalvageableEvaluation({
      title: "Bad Fit",
      decision: "reject",
      sharpening_notes: "",
      reasons: "Fundamentally derivative and too similar to recent work.",
    })).toBe(false);
  });
});

describe("speculative/buildSpeculativeIdeas", () => {
  it("carries unselected approved, revised, and salvageable rejected ideas up to the configured limit", () => {
    const ideas = [proposal("Selected"), proposal("Approved Spare"), proposal("Revise Me"), proposal("Vague Reject"), proposal("Bad Reject")];
    const entries = buildSpeculativeIdeas(
      ideas,
      [
        { title: "Selected", decision: "approve", sharpening_notes: "", reasons: "Best option." },
        { title: "Approved Spare", decision: "approve", sharpening_notes: "Strong but not selected.", reasons: "Also viable." },
        { title: "Revise Me", decision: "revise", sharpening_notes: "Clarify the ending.", reasons: "Good kernel." },
        { title: "Vague Reject", decision: "reject", sharpening_notes: "", reasons: "Pitch is too vague." },
        { title: "Bad Reject", decision: "reject", sharpening_notes: "", reasons: "Fundamentally stale." },
      ],
      "Selected",
      9,
      { max_carried_ideas: 2 },
    );

    expect(entries.map((entry) => entry.proposal.title)).toEqual(["Approved Spare", "Revise Me"]);
    expect(entries.every((entry) => entry.iteration === 9)).toBe(true);
    expect(entries.every((entry) => entry.salvageable)).toBe(true);
  });
});

describe("speculative/persistence", () => {
  it("saves, loads, formats, and clears speculative ideas", async () => {
    const entries = buildSpeculativeIdeas(
      [proposal("Revise Me")],
      [{ title: "Revise Me", decision: "revise", sharpening_notes: "Make it stranger.", reasons: "Good kernel." }],
      null,
      3,
    );

    await saveSpeculativeIdeas(entries);

    const filePath = path.join(tempDir, "workspace", "speculative.yml");
    expect(existsSync(filePath)).toBe(true);
    expect(yaml.parse(await readFile(filePath, "utf-8")).ideas).toHaveLength(1);

    const loaded = await loadSpeculativeIdeas();
    expect(loaded[0].proposal.title).toBe("Revise Me");

    const formatted = formatSpeculativeIdeas(loaded);
    expect(formatted).toContain("## Salvaged Ideas from Last Iteration");
    expect(formatted).toContain("Revise Me");
    expect(formatted).toContain("Make it stranger.");

    await clearSpeculativeIdeas();
    expect(existsSync(filePath)).toBe(false);
    await expect(loadSpeculativeIdeas()).resolves.toEqual([]);
  });

  it("formats killed-run fast-track options when requested", () => {
    const formatted = formatSpeculativeIdeas([
      {
        proposal: proposal("Fast Track"),
        critic_evaluation: {
          decision: "approve",
          reasons: "Approved but not selected.",
          sharpening_notes: "Build it next.",
        },
        iteration: 4,
        salvageable: true,
      },
    ], { last_outcome: "killed" });

    expect(formatted).toContain("## Fast-Track Options");
    expect(formatted).toContain("Strongly consider refining");
  });
});

describe("speculative/filterCurrentSpeculativeIdeas", () => {
  it("keeps warmed ideas only for the iteration immediately after they were generated", () => {
    const current = {
      proposal: proposal("Current"),
      critic_evaluation: { decision: "revise" as const, reasons: "Good kernel.", sharpening_notes: "" },
      iteration: 12,
      salvageable: true,
    };
    const stale = {
      proposal: proposal("Stale"),
      critic_evaluation: { decision: "revise" as const, reasons: "Old kernel.", sharpening_notes: "" },
      iteration: 10,
      salvageable: true,
    };

    expect(filterCurrentSpeculativeIdeas([current, stale], 13)).toEqual([current]);
    expect(filterCurrentSpeculativeIdeas([current, stale], undefined)).toEqual([current, stale]);
  });
});
