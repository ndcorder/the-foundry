import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "yaml";
import { setRootDir } from "../src/root.js";
import {
  analyzeComplexityYield,
  emptyComplexityBias,
  formatComplexityBias,
  loadComplexityBias,
  saveComplexityBias,
} from "../src/complexity/index.js";
import type { ComplexityIterationEntry } from "../src/complexity/types.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "foundry-complexity-"));
  setRootDir(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function shipped(
  iteration: number,
  complexity: "S" | "M" | "L" | "XL",
  meanRating: string,
  tokens: number,
): ComplexityIterationEntry {
  return {
    iteration,
    outcome: "shipped",
    complexity,
    mean_rating: meanRating,
    token_usage: { input: Math.floor(tokens * 0.6), output: Math.ceil(tokens * 0.4) },
  };
}

describe("complexity/analyzeComplexityYield", () => {
  it("computes ROI for tiers with enough shipped samples and recommends the best tier", () => {
    const entries: ComplexityIterationEntry[] = [
      shipped(1, "S", "3.0", 3000),
      shipped(2, "S", "3.2", 3000),
      shipped(3, "S", "2.8", 3000),
      shipped(4, "M", "4.0", 10000),
      shipped(5, "M", "4.2", 10000),
      shipped(6, "M", "3.8", 10000),
      shipped(7, "L", "4.5", 20000),
      { ...shipped(8, "XL", "5.0", 50000), outcome: "killed" },
    ];

    const bias = analyzeComplexityYield(entries, 9, { window: 20 });

    expect(bias.recommendation.favor).toBe("S");
    expect(bias.recommendation.avoid).toEqual(["M"]);
    expect(bias.recommendation.confidence).toBe("medium");
    expect(bias.yields.find((y) => y.tier === "S")).toMatchObject({
      shipped_count: 3,
      mean_rating: 3.0,
      mean_token_cost: 3000,
      roi: 1,
    });
    expect(bias.yields.some((y) => y.tier === "L")).toBe(false);
  });

  it("uses only the most recent configured window", () => {
    const entries: ComplexityIterationEntry[] = [
      shipped(1, "S", "5.0", 1000),
      shipped(2, "S", "5.0", 1000),
      shipped(3, "S", "5.0", 1000),
      shipped(4, "M", "4.0", 4000),
      shipped(5, "M", "4.0", 4000),
      shipped(6, "M", "4.0", 4000),
    ];

    const bias = analyzeComplexityYield(entries, 7, { window: 3 });

    expect(bias.yields).toHaveLength(1);
    expect(bias.yields[0].tier).toBe("M");
    expect(bias.recommendation.favor).toBe("M");
  });

  it("returns low confidence when no tier has enough samples", () => {
    const bias = analyzeComplexityYield(
      [
        shipped(1, "S", "4.0", 1000),
        shipped(2, "M", "4.0", 1000),
      ],
      3,
      { min_samples_for_confidence: 3 },
    );

    expect(bias.yields).toEqual([]);
    expect(bias.recommendation.confidence).toBe("low");
    expect(bias.recommendation.favor).toBe("balanced");
  });

  it("raises confidence when the top tier has high sample depth", () => {
    const entries = Array.from({ length: 5 }, (_, i) => shipped(i + 1, "XL", "4.0", 8000));
    const bias = analyzeComplexityYield(entries, 6, {
      min_samples_for_confidence: 3,
      high_confidence_samples: 5,
    });

    expect(bias.recommendation.confidence).toBe("high");
    expect(bias.recommendation.favor).toBe("XL");
  });
});

describe("complexity/formatComplexityBias", () => {
  it("formats actionable bias for ideator context", () => {
    const bias = analyzeComplexityYield(
      [
        shipped(1, "S", "3.0", 3000),
        shipped(2, "S", "3.0", 3000),
        shipped(3, "S", "3.0", 3000),
        shipped(4, "M", "4.0", 12000),
        shipped(5, "M", "4.0", 12000),
        shipped(6, "M", "4.0", 12000),
      ],
      7,
    );

    const formatted = formatComplexityBias(bias);
    expect(formatted).toContain("## Complexity Guidance");
    expect(formatted).toContain("S: avg 3.0 rating");
    expect(formatted).toContain("Recommendation: Lean toward S-tier");
    expect(formatted).toContain("Avoid M-tier");
  });

  it("returns empty string when confidence is low", () => {
    expect(formatComplexityBias(emptyComplexityBias(1))).toBe("");
  });
});

describe("complexity/persistence", () => {
  it("returns empty bias when no file exists", async () => {
    const bias = await loadComplexityBias();
    expect(bias.recommendation.confidence).toBe("low");
    expect(bias.yields).toEqual([]);
  });

  it("saves and loads complexity bias as YAML", async () => {
    const bias = analyzeComplexityYield(
      [
        shipped(1, "L", "4.0", 8000),
        shipped(2, "L", "4.2", 8000),
        shipped(3, "L", "3.8", 8000),
      ],
      4,
    );

    await saveComplexityBias(bias);

    const filePath = path.join(tempDir, "identity", "complexity-bias.yml");
    expect(existsSync(filePath)).toBe(true);
    expect(yaml.parse(readFileSync(filePath, "utf-8")).recommendation.favor).toBe("L");

    const loaded = await loadComplexityBias();
    expect(loaded.recommendation.favor).toBe("L");
  });
});
