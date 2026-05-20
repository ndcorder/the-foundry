import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
});
