import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "yaml";
import { setRootDir } from "../src/root.js";
import { getProjectVersion, compareVersions, upgradeProject } from "../src/upgrade.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "foundry-upgrade-"));
  setRootDir(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("compareVersions", () => {
  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns positive when first is greater", () => {
    expect(compareVersions("1.3.0", "1.2.9")).toBeGreaterThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("orders prerelease versions of the same release", () => {
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0-rc.2")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
  });

  it("returns negative when first is less", () => {
    expect(compareVersions("0.5.0", "0.6.0")).toBeLessThan(0);
  });
});

describe("getProjectVersion", () => {
  it("reads version from foundry.yml", async () => {
    mkdirSync(path.join(tempDir, "config"), { recursive: true });
    writeFileSync(path.join(tempDir, "config", "foundry.yml"), 'foundry:\n  version: "0.5.0"\n');
    expect(await getProjectVersion()).toBe("0.5.0");
  });

  it("returns 0.0.0 when config missing", async () => {
    expect(await getProjectVersion()).toBe("0.0.0");
  });

  it("returns 0.0.0 when version field missing", async () => {
    mkdirSync(path.join(tempDir, "config"), { recursive: true });
    writeFileSync(path.join(tempDir, "config", "foundry.yml"), "foundry:\n  name: test\n");
    expect(await getProjectVersion()).toBe("0.0.0");
  });
});

describe("upgradeProject", () => {
  it("returns false when project version matches CLI version", async () => {
    mkdirSync(path.join(tempDir, "config"), { recursive: true });
    const { getCliVersion } = await import("../src/upgrade.js");
    const cliVersion = await getCliVersion();
    writeFileSync(path.join(tempDir, "config", "foundry.yml"), `foundry:\n  version: "${cliVersion}"\n`);
    const result = await upgradeProject({ silent: true });
    expect(result).toBe(false);
  });

  it("copies managed files and bumps version on upgrade", async () => {
    mkdirSync(path.join(tempDir, "config"), { recursive: true });
    writeFileSync(path.join(tempDir, "config", "foundry.yml"), 'foundry:\n  version: "0.0.1"\n');
    mkdirSync(path.join(tempDir, "site", "src"), { recursive: true });
    mkdirSync(path.join(tempDir, "prompts"), { recursive: true });

    // Pre-seed site/package.json with same content as package root to avoid npm install
    const packageRoot = path.resolve(import.meta.dirname, "..");
    const sitePkg = readFileSync(path.join(packageRoot, "site", "package.json"), "utf-8");
    writeFileSync(path.join(tempDir, "site", "package.json"), sitePkg);

    const result = await upgradeProject({ silent: true });
    expect(result).toBe(true);

    expect(existsSync(path.join(tempDir, "prompts"))).toBe(true);
    expect(existsSync(path.join(tempDir, "site", "src"))).toBe(true);

    const config = readFileSync(path.join(tempDir, "config", "foundry.yml"), "utf-8");
    expect(config).not.toContain("0.0.1");
  });

  it("merges new config defaults without replacing existing project choices", async () => {
    mkdirSync(path.join(tempDir, "config"), { recursive: true });
    writeFileSync(
      path.join(tempDir, "config", "foundry.yml"),
      [
        "foundry:",
        '  name: "Long Running Foundry"',
        '  version: "0.0.1"',
        "iteration:",
        "  max_idea_retries: 11",
        "  max_revision_rounds: 7",
        "projects:",
        "  max_active: 9",
        "stimuli:",
        "  enabled: false",
        "context:",
        "  journal_compressed_max_tokens: 1234",
        "intervention:",
        '  requests_file: "human-requests.md"',
        "logging:",
        "  log_all_prompts: false",
        "recovery:",
        "  checkpoint_every: 99",
        "",
      ].join("\n"),
      "utf-8",
    );
    writeFileSync(
      path.join(tempDir, "config", "models.yml"),
      [
        "agents:",
        "  ideator:",
        '    model: "custom-idea-model"',
        "    temperature: 0.1",
        "    max_tokens: 123",
        "",
      ].join("\n"),
      "utf-8",
    );

    const packageRoot = path.resolve(import.meta.dirname, "..");
    mkdirSync(path.join(tempDir, "site"), { recursive: true });
    const sitePkg = readFileSync(path.join(packageRoot, "site", "package.json"), "utf-8");
    writeFileSync(path.join(tempDir, "site", "package.json"), sitePkg);

    await upgradeProject({ silent: true });

    const foundryConfig = yaml.parse(readFileSync(path.join(tempDir, "config", "foundry.yml"), "utf-8"));
    expect(foundryConfig.foundry.name).toBe("Long Running Foundry");
    expect(foundryConfig.iteration.max_idea_retries).toBe(11);
    expect(foundryConfig.iteration.max_revision_rounds).toBe(7);
    expect(foundryConfig.iteration.max_test_fix_cycles).toBe(25);
    expect(foundryConfig.loop.cooldown_seconds).toBe(0);
    expect(foundryConfig.loop.concurrency).toBe(8);
    expect(foundryConfig.git.auto_commit).toBe(true);
    expect(foundryConfig.git.auto_push).toBe(false);
    expect(foundryConfig.stimuli.enabled).toBe(false);
    expect(foundryConfig.intervention.requests_file).toBe("human-requests.md");
    expect(foundryConfig.foundry.version).not.toBe("0.0.1");

    const modelsConfig = yaml.parse(readFileSync(path.join(tempDir, "config", "models.yml"), "utf-8"));
    expect(modelsConfig.agents.ideator.model).toBe("custom-idea-model");
    expect(modelsConfig.agents.ideator.temperature).toBe(0.1);
    expect(modelsConfig.agents.creator.model).toBe("glm-5.1");
  });

  it("creates missing scaffold files while preserving worker progress", async () => {
    mkdirSync(path.join(tempDir, "config"), { recursive: true });
    mkdirSync(path.join(tempDir, "portfolio", "code", "0001-first-artifact"), { recursive: true });
    mkdirSync(path.join(tempDir, "identity"), { recursive: true });
    mkdirSync(path.join(tempDir, "logs"), { recursive: true });
    mkdirSync(path.join(tempDir, "workspace", "current"), { recursive: true });
    mkdirSync(path.join(tempDir, "stimuli", "live"), { recursive: true });
    writeFileSync(path.join(tempDir, "config", "foundry.yml"), 'foundry:\n  version: "0.0.1"\n', "utf-8");
    writeFileSync(path.join(tempDir, "portfolio", "index.md"), "portfolio progress\n", "utf-8");
    writeFileSync(path.join(tempDir, "portfolio", "code", "0001-first-artifact", "README.md"), "artifact\n", "utf-8");
    writeFileSync(path.join(tempDir, "identity", "journal.md"), "journal progress\n", "utf-8");
    writeFileSync(path.join(tempDir, "identity", "journal-compressed.md"), "compressed progress\n", "utf-8");
    writeFileSync(path.join(tempDir, "logs", "iterations.jsonl"), '{"iteration":42}\n', "utf-8");
    writeFileSync(path.join(tempDir, "checkpoint.json"), '{"iteration":42}\n', "utf-8");
    writeFileSync(path.join(tempDir, "workspace", "current", "draft.txt"), "in-flight draft\n", "utf-8");
    writeFileSync(path.join(tempDir, "requests.md"), "human redirect\n", "utf-8");
    writeFileSync(path.join(tempDir, "STOP"), "stop after current phase\n", "utf-8");
    writeFileSync(path.join(tempDir, "stimuli", "live", "news.md"), "live stimuli\n", "utf-8");

    const packageRoot = path.resolve(import.meta.dirname, "..");
    mkdirSync(path.join(tempDir, "site"), { recursive: true });
    const sitePkg = readFileSync(path.join(packageRoot, "site", "package.json"), "utf-8");
    writeFileSync(path.join(tempDir, "site", "package.json"), sitePkg);

    await upgradeProject({ silent: true });

    expect(readFileSync(path.join(tempDir, "portfolio", "index.md"), "utf-8")).toBe("portfolio progress\n");
    expect(readFileSync(path.join(tempDir, "portfolio", "code", "0001-first-artifact", "README.md"), "utf-8")).toBe("artifact\n");
    expect(readFileSync(path.join(tempDir, "identity", "journal.md"), "utf-8")).toBe("journal progress\n");
    expect(readFileSync(path.join(tempDir, "identity", "journal-compressed.md"), "utf-8")).toBe("compressed progress\n");
    expect(readFileSync(path.join(tempDir, "logs", "iterations.jsonl"), "utf-8")).toBe('{"iteration":42}\n');
    expect(readFileSync(path.join(tempDir, "checkpoint.json"), "utf-8")).toBe('{"iteration":42}\n');
    expect(readFileSync(path.join(tempDir, "workspace", "current", "draft.txt"), "utf-8")).toBe("in-flight draft\n");
    expect(readFileSync(path.join(tempDir, "requests.md"), "utf-8")).toBe("human redirect\n");
    expect(readFileSync(path.join(tempDir, "STOP"), "utf-8")).toBe("stop after current phase\n");
    expect(readFileSync(path.join(tempDir, "stimuli", "live", "news.md"), "utf-8")).toBe("live stimuli\n");

    expect(existsSync(path.join(tempDir, "portfolio", "projects", "index.md"))).toBe(true);
    expect(existsSync(path.join(tempDir, "portfolio", "killed"))).toBe(true);
    expect(existsSync(path.join(tempDir, "workspace", "sandbox"))).toBe(true);
    expect(existsSync(path.join(tempDir, "stimuli", "skills", "writing-techniques.md"))).toBe(true);
    expect(existsSync(path.join(tempDir, "stimuli", "stimuli.yml"))).toBe(true);
    expect(existsSync(path.join(tempDir, "identity", "manifesto.md"))).toBe(true);
  });
});
