import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/root.js", () => ({
  resolve: (...parts: string[]) => "/mock/" + parts.join("/"),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { deriveDominantMood, generateCreativeNudge, computeMood } from "../src/mood/engine.js";
import { saveMood, loadMood } from "../src/mood/store.js";
import type { MoodAxis } from "../src/mood/types.js";
import yaml from "yaml";

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
});

function makeEntry(overrides: Partial<{
  iteration: number; outcome: string; domain: string;
  mean_rating: string; title: string;
}> = {}) {
  return {
    iteration: 1,
    outcome: "shipped" as const,
    domain: "fiction",
    mean_rating: "4.0",
    title: "Test",
    token_usage: { input: 100, output: 50 },
    duration_ms: 1000,
    ...overrides,
  };
}

describe("mood/engine", () => {
  describe("deriveDominantMood", () => {
    it("returns 'curious and open' when no strong axes", () => {
      const axes = { exploratory: 0.1, playful: -0.1, restless: 0, bold: 0.2, collaborative: 0 } as Record<MoodAxis, number>;
      expect(deriveDominantMood(axes)).toBe("curious and open");
    });

    it("returns single label for one strong axis", () => {
      const axes = { exploratory: 0.6, playful: 0, restless: 0, bold: 0, collaborative: 0 } as Record<MoodAxis, number>;
      expect(deriveDominantMood(axes)).toBe("exploratory");
    });

    it("returns negative label for strong negative axis", () => {
      const axes = { exploratory: -0.5, playful: 0, restless: 0, bold: 0, collaborative: 0 } as Record<MoodAxis, number>;
      expect(deriveDominantMood(axes)).toBe("refined");
    });

    it("combines two strong axes", () => {
      const axes = { exploratory: 0.6, playful: 0.5, restless: 0, bold: 0, collaborative: 0 } as Record<MoodAxis, number>;
      expect(deriveDominantMood(axes)).toBe("exploratory and playful");
    });

    it("combines three strong axes", () => {
      const axes = { exploratory: 0.6, playful: 0.5, restless: 0.4, bold: 0, collaborative: 0 } as Record<MoodAxis, number>;
      expect(deriveDominantMood(axes)).toBe("exploratory, playful, and restless");
    });
  });

  describe("generateCreativeNudge", () => {
    it("returns restless+exploratory nudge", () => {
      const axes = { exploratory: 0.5, playful: 0, restless: 0.5, bold: 0, collaborative: 0 } as Record<MoodAxis, number>;
      expect(generateCreativeNudge(axes, "")).toContain("domain");
    });

    it("returns playful+bold nudge", () => {
      const axes = { exploratory: 0, playful: 0.5, restless: 0, bold: 0.5, collaborative: 0 } as Record<MoodAxis, number>;
      expect(generateCreativeNudge(axes, "")).toContain("absurd");
    });

    it("returns default nudge when no match", () => {
      const axes = { exploratory: 0, playful: 0, restless: 0, bold: 0, collaborative: 0 } as Record<MoodAxis, number>;
      expect(generateCreativeNudge(axes, "")).toContain("Trust");
    });
  });

  describe("computeMood", () => {
    it("returns fresh mood for empty history", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      const mood = await computeMood([], 1);
      expect(mood.dominant_mood).toBe("curious and open");
      expect(mood.iteration).toBe(1);
    });

    it("computes mood from iteration entries", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      const entries = [
        makeEntry({ iteration: 1, domain: "fiction" }),
        makeEntry({ iteration: 2, domain: "poetry" }),
        makeEntry({ iteration: 3, domain: "code-art" }),
        makeEntry({ iteration: 4, domain: "music" }),
        makeEntry({ iteration: 5, domain: "experiment" }),
      ];
      const mood = await computeMood(entries, 6);
      expect(mood.axes).toBeDefined();
      expect(mood.dominant_mood).toBeTruthy();
      expect(mood.creative_nudge).toBeTruthy();
      expect(mood.influences.length).toBeGreaterThan(0);
    });

    it("detects restlessness from kills", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      const entries = [
        makeEntry({ iteration: 1, outcome: "killed" as any, domain: "fiction" }),
        makeEntry({ iteration: 2, outcome: "killed" as any, domain: "fiction" }),
        makeEntry({ iteration: 3, outcome: "killed" as any, domain: "fiction" }),
        makeEntry({ iteration: 4, domain: "fiction" }),
        makeEntry({ iteration: 5, domain: "fiction" }),
      ];
      const mood = await computeMood(entries, 6);
      expect(mood.axes.bold).toBeLessThan(0);
    });

    it("blends with previous mood via inertia", async () => {
      const prevMood = {
        axes: { exploratory: 1.0, playful: 1.0, restless: 1.0, bold: 1.0, collaborative: 1.0 },
        dominant_mood: "test", creative_nudge: "test",
        influences: [], iteration: 5, updated_at: "2026-01-01",
      };
      mockReadFile.mockResolvedValue(yaml.stringify(prevMood));
      const entries = [
        makeEntry({ iteration: 1, domain: "fiction" }),
        makeEntry({ iteration: 2, domain: "fiction" }),
      ];
      const mood = await computeMood(entries, 6);
      // Inertia pulls axes toward previous values (all 1.0), so at least some should be > 0
      const anyPositive = Object.values(mood.axes).some((v) => v > 0);
      expect(anyPositive).toBe(true);
    });
  });
});

describe("mood/store", () => {
  it("saves mood as YAML", async () => {
    const mood = {
      axes: { exploratory: 0.5, playful: 0, restless: 0, bold: 0, collaborative: 0 } as Record<MoodAxis, number>,
      dominant_mood: "exploratory", creative_nudge: "go",
      influences: [], iteration: 10, updated_at: "2026-01-01",
    };
    await saveMood(mood);
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/mock/identity/mood.yml", expect.any(String), "utf-8",
    );
  });

  it("loads mood from YAML", async () => {
    const mood = {
      axes: { exploratory: 0.5, playful: 0, restless: 0, bold: 0, collaborative: 0 },
      dominant_mood: "exploratory", creative_nudge: "go",
      influences: [], iteration: 10, updated_at: "2026-01-01",
    };
    mockReadFile.mockResolvedValue(yaml.stringify(mood));
    const result = await loadMood();
    expect(result?.dominant_mood).toBe("exploratory");
  });

  it("returns null when file missing", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const result = await loadMood();
    expect(result).toBeNull();
  });
});
