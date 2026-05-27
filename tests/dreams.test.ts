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
import { extractDreamFromKill } from "../src/dreams/analyzer.js";
import { loadDreamJournal, saveDreamJournal, addDream, getDreamsForIdeator } from "../src/dreams/store.js";
import yaml from "yaml";

const mockReadFile = vi.mocked(readFile);
const mockWriteFile = vi.mocked(writeFile);
const mockMkdir = vi.mocked(mkdir);

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
});

describe("dreams/analyzer", () => {
  describe("extractDreamFromKill", () => {
    it("extracts a dream entry from kill data", () => {
      const dream = extractDreamFromKill(
        "0099", "A Clock That Counts Wrong", "code-art",
        "A clock that deliberately miscounts",
        "Too generic — could have been written by anyone",
        "The concept is interesting but the execution lacks specificity.",
        42,
      );
      expect(dream.artifact_id).toBe("0099");
      expect(dream.title).toBe("A Clock That Counts Wrong");
      expect(dream.domain).toBe("code-art");
      expect(dream.iteration).toBe(42);
      expect(dream.kill_reason).toContain("generic");
      expect(dream.resurrection_hint.length).toBeGreaterThan(0);
    });

    it("generates angle-based hint for generic kills", () => {
      const dream = extractDreamFromKill(
        "0100", "Test", "fiction", "pitch",
        "Too generic and predictable",
        "The concept was sound.", 50,
      );
      expect(dream.resurrection_hint).toContain("specific detail");
    });

    it("generates scale-down hint for scope kills", () => {
      const dream = extractDreamFromKill(
        "0101", "Test", "fiction", "pitch",
        "Too ambitious in scope",
        "Review.", 51,
      );
      expect(dream.resurrection_hint).toContain("Scale it down");
    });

    it("generates execution hint for craft kills", () => {
      const dream = extractDreamFromKill(
        "0102", "Test", "fiction", "pitch",
        "The execution and craft fell short",
        "Review.", 52,
      );
      expect(dream.resurrection_hint).toContain("structural approach");
    });

    it("extracts positives from review text", () => {
      const dream = extractDreamFromKill(
        "0103", "Test", "fiction", "pitch",
        "Killed",
        "The concept is brilliantly original. However the execution failed.",
        53,
      );
      expect(dream.what_was_good).toContain("concept is brilliantly original");
    });

    it("truncates long pitch and kill_reason", () => {
      const longPitch = "x".repeat(500);
      const longReason = "y".repeat(500);
      const dream = extractDreamFromKill(
        "0104", "Test", "fiction", longPitch, longReason, "Review.", 54,
      );
      expect(dream.pitch.length).toBeLessThanOrEqual(200);
      expect(dream.kill_reason.length).toBeLessThanOrEqual(150);
    });
  });
});

describe("dreams/store", () => {
  describe("loadDreamJournal", () => {
    it("loads from YAML file", async () => {
      const journal = { dreams: [{ artifact_id: "0099", title: "Test" }], updated_at: "2026-01-01" };
      mockReadFile.mockResolvedValue(yaml.stringify(journal));
      const result = await loadDreamJournal();
      expect(result.dreams).toHaveLength(1);
      expect(result.dreams[0].artifact_id).toBe("0099");
    });

    it("returns empty journal when file missing", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      const result = await loadDreamJournal();
      expect(result.dreams).toHaveLength(0);
    });
  });

  describe("saveDreamJournal", () => {
    it("writes YAML to identity/dreams.yml", async () => {
      const journal = { dreams: [], updated_at: "2026-01-01" };
      await saveDreamJournal(journal);
      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).toHaveBeenCalledWith(
        "/mock/identity/dreams.yml",
        expect.any(String),
        "utf-8",
      );
    });
  });

  describe("addDream", () => {
    it("prepends dream and caps at 30", async () => {
      const existingDreams = Array.from({ length: 30 }, (_, i) => ({
        artifact_id: String(i).padStart(4, "0"),
        title: `Dream ${i}`,
        domain: "fiction",
        pitch: "p",
        kill_reason: "r",
        what_was_good: "w",
        resurrection_hint: "h",
        iteration: i,
        added_at: "2026-01-01",
      }));
      mockReadFile.mockResolvedValue(yaml.stringify({ dreams: existingDreams, updated_at: "2026-01-01" }));

      await addDream({
        artifact_id: "9999", title: "New Dream", domain: "code-art",
        pitch: "p", kill_reason: "r", what_was_good: "w",
        resurrection_hint: "h", iteration: 99, added_at: "2026-01-02",
      });

      const written = yaml.parse(mockWriteFile.mock.calls[0][1] as string);
      expect(written.dreams).toHaveLength(30);
      expect(written.dreams[0].artifact_id).toBe("9999");
    });
  });

  describe("getDreamsForIdeator", () => {
    it("formats top N dreams for context", async () => {
      mockReadFile.mockResolvedValue(yaml.stringify({
        dreams: [
          { artifact_id: "0099", title: "Clock", domain: "code-art", kill_reason: "generic", what_was_good: "concept", resurrection_hint: "try harder" },
          { artifact_id: "0100", title: "Poem", domain: "poetry", kill_reason: "flat", what_was_good: "rhythm", resurrection_hint: "add tension" },
        ],
        updated_at: "2026-01-01",
      }));

      const result = await getDreamsForIdeator(2);
      expect(result).toContain("Clock");
      expect(result).toContain("Poem");
      expect(result).toContain("Resurrection hint");
    });

    it("returns placeholder when no dreams", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      const result = await getDreamsForIdeator();
      expect(result).toContain("No fallen artifacts");
    });
  });
});
