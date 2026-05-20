import { resolve as resolvePath } from "node:path";
import { existsSync } from "node:fs";
import { cp, readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { getRootDir } from "./root.js";

const MANAGED_DIRS = [
  "prompts",
  "site/src",
  ".github",
] as const;

const MANAGED_FILES = [
  "site/package.json",
  "site/tsconfig.json",
] as const;

function getPackageRoot(): string {
  return resolvePath(import.meta.dirname, "..");
}

export async function getCliVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile(resolvePath(getPackageRoot(), "package.json"), "utf-8"));
  return pkg.version;
}

export async function getProjectVersion(): Promise<string> {
  const configPath = resolvePath(getRootDir(), "config", "foundry.yml");
  try {
    const content = await readFile(configPath, "utf-8");
    const match = content.match(/version:\s*["']?([^"'\n]+)/);
    return match?.[1]?.trim() ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function compareVersions(a: string, b: string): number {
  // Strip prerelease suffixes for comparison (e.g., "1.0.0-rc.1" → "1.0.0")
  const stripPre = (v: string) => v.replace(/-.*$/, "");
  const pa = stripPre(a).split(".").map(Number);
  const pb = stripPre(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function upgradeProject(opts?: { silent?: boolean }): Promise<boolean> {
  const rootDir = getRootDir();
  const packageRoot = getPackageRoot();

  if (!existsSync(resolvePath(rootDir, "config", "foundry.yml"))) {
    return false;
  }

  const cliVersion = await getCliVersion();
  const projectVersion = await getProjectVersion();

  if (compareVersions(cliVersion, projectVersion) <= 0) {
    if (!opts?.silent) console.log(`Project is up to date (v${projectVersion}).`);
    return false;
  }

  const log = opts?.silent ? () => {} : (msg: string) => console.log(msg);
  log(`Upgrading project: v${projectVersion} → v${cliVersion}`);

  for (const dir of MANAGED_DIRS) {
    const src = resolvePath(packageRoot, dir);
    const dest = resolvePath(rootDir, dir);
    if (existsSync(src)) {
      await cp(src, dest, { recursive: true, force: true });
      log(`  ${dir}/  ✓`);
    }
  }

  let sitePackageChanged = false;
  for (const file of MANAGED_FILES) {
    const src = resolvePath(packageRoot, file);
    const dest = resolvePath(rootDir, file);
    if (existsSync(src)) {
      const oldContent = existsSync(dest) ? await readFile(dest, "utf-8") : "";
      const newContent = await readFile(src, "utf-8");
      if (oldContent !== newContent) {
        await cp(src, dest, { force: true });
        log(`  ${file}  ✓`);
        if (file === "site/package.json") sitePackageChanged = true;
      } else {
        log(`  ${file}  (unchanged)`);
      }
    }
  }

  if (sitePackageChanged) {
    const siteDir = resolvePath(rootDir, "site");
    if (existsSync(resolvePath(siteDir, "package.json"))) {
      try {
        log("  Installing site dependencies...");
        execSync("npm install", { cwd: siteDir, stdio: "pipe", timeout: 60000 });
        log("  npm install  ✓");
      } catch {
        log("  npm install  ✗ (run manually: cd site && npm install)");
      }
    }
  }

  const configPath = resolvePath(rootDir, "config", "foundry.yml");
  if (existsSync(configPath)) {
    const configContent = await readFile(configPath, "utf-8");
    const updated = configContent.replace(
      /version:\s*["']?[^"'\n]+["']?/,
      `version: "${cliVersion}"`,
    );
    await writeFile(configPath, updated, "utf-8");
    log(`  config version → v${cliVersion}  ✓`);
  }

  log(`Upgrade complete.`);
  return true;
}
