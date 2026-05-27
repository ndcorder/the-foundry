import { basename, dirname, resolve as resolvePath } from "node:path";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import yaml from "yaml";
import { getRootDir } from "./root.js";

const MANAGED_DIRS = [
  "prompts",
  "site/src",
  ".github",
  "stimuli/skills",
] as const;

const MANAGED_FILES = [
  "site/astro.config.mjs",
  "site/package.json",
  "site/showcase.yml",
  "site/tsconfig.json",
] as const;

const CONFIG_FILES = [
  "config/foundry.yml",
  "config/models.yml",
  "config/domains.yml",
  "stimuli/stimuli.yml",
] as const;

const SCAFFOLD_DIRS = [
  "config",
  "identity",
  "portfolio",
  "portfolio/killed",
  "portfolio/projects",
  "logs",
  "workspace/current",
  "workspace/sandbox",
  "stimuli/live",
  "stimuli/skills",
  "site",
] as const;

const DEFAULT_GITIGNORE_ENTRIES = [
  "node_modules/",
  "dist/",
  ".astro/",
  "site/dist/",
  "site/node_modules/",
  "site/public/artifacts/",
  "workspace/",
  "checkpoint.json",
  "STOP",
  "*.tsbuildinfo",
  ".DS_Store",
  ".env",
  ".env.*",
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
    const parsed = yaml.parse(content) as { foundry?: { version?: unknown } } | null;
    const version = parsed?.foundry?.version;
    if (typeof version === "string" || typeof version === "number") return String(version).trim();
  } catch {
    // Fall back below.
  }
  return "0.0.0";
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (!pa.prerelease && !pb.prerelease) return 0;
  if (!pa.prerelease) return 1;
  if (!pb.prerelease) return -1;
  const max = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < max; i++) {
    const ai = pa.prerelease[i];
    const bi = pb.prerelease[i];
    if (ai == null && bi == null) return 0;
    if (ai == null) return -1;
    if (bi == null) return 1;
    const diff = comparePrereleasePart(ai, bi);
    if (diff !== 0) return diff;
  }
  return 0;
}

function parseVersion(version: string): { core: number[]; prerelease: string[] | null } {
  const normalized = version.trim().replace(/^v/, "");
  const prereleaseStart = normalized.indexOf("-");
  const corePart = prereleaseStart === -1 ? normalized : normalized.slice(0, prereleaseStart);
  const prereleasePart = prereleaseStart === -1 ? "" : normalized.slice(prereleaseStart + 1);
  return {
    core: corePart.split(".").map((part) => {
      const parsed = Number.parseInt(part, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    }),
    prerelease: prereleasePart ? prereleasePart.split(".") : null,
  };
}

function comparePrereleasePart(a: string, b: string): number {
  const aNum = /^\d+$/.test(a) ? Number.parseInt(a, 10) : null;
  const bNum = /^\d+$/.test(b) ? Number.parseInt(b, 10) : null;
  if (aNum != null && bNum != null) return aNum - bNum;
  if (aNum != null) return -1;
  if (bNum != null) return 1;
  return a.localeCompare(b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function mergeDefaults(defaultValue: unknown, projectValue: unknown): unknown {
  if (projectValue === undefined) return defaultValue;
  if (!isRecord(defaultValue) || !isRecord(projectValue)) return projectValue;

  const merged: Record<string, unknown> = { ...projectValue };
  for (const [key, value] of Object.entries(defaultValue)) {
    merged[key] = mergeDefaults(value, merged[key]);
  }
  return merged;
}

async function ensureDir(rootDir: string, relativePath: string): Promise<void> {
  await mkdir(resolvePath(rootDir, relativePath), { recursive: true });
}

async function writeIfMissing(rootDir: string, relativePath: string, content: string): Promise<void> {
  const dest = resolvePath(rootDir, relativePath);
  if (existsSync(dest)) return;
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, content, "utf-8");
}

async function copyIfMissing(
  packageRoot: string,
  rootDir: string,
  sourceRelativePath: string,
  destRelativePath = sourceRelativePath,
): Promise<void> {
  const src = resolvePath(packageRoot, sourceRelativePath);
  const dest = resolvePath(rootDir, destRelativePath);
  if (!existsSync(src) || existsSync(dest)) return;
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
}

async function mergeYamlFile(
  packageRoot: string,
  rootDir: string,
  relativePath: string,
  mutate?: (data: Record<string, unknown>) => void,
): Promise<void> {
  const src = resolvePath(packageRoot, relativePath);
  if (!existsSync(src)) return;

  const dest = resolvePath(rootDir, relativePath);
  const defaults = yaml.parse(await readFile(src, "utf-8")) as unknown;
  const project = existsSync(dest)
    ? yaml.parse(await readFile(dest, "utf-8")) as unknown
    : undefined;
  const merged = mergeDefaults(defaults, project);
  const output = isRecord(merged) ? merged : {};
  mutate?.(output);

  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, yaml.stringify(output), "utf-8");
}

async function ensureGitignore(rootDir: string): Promise<void> {
  const gitignorePath = resolvePath(rootDir, ".gitignore");
  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, `${DEFAULT_GITIGNORE_ENTRIES.join("\n")}\n`, "utf-8");
    return;
  }

  const content = await readFile(gitignorePath, "utf-8");
  const existing = new Set(content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const missing = DEFAULT_GITIGNORE_ENTRIES.filter((entry) => !existing.has(entry));
  if (missing.length === 0) return;

  const prefix = content.endsWith("\n") ? content : `${content}\n`;
  await writeFile(gitignorePath, `${prefix}${missing.join("\n")}\n`, "utf-8");
}

async function ensureScaffold(packageRoot: string, rootDir: string): Promise<void> {
  for (const dir of SCAFFOLD_DIRS) {
    await ensureDir(rootDir, dir);
  }

  await writeIfMissing(
    rootDir,
    "portfolio/index.md",
    "# Portfolio Index\n\n| ID | Title | Domain | Rating | Date | Project |\n|---|---|---|---|---|---|\n",
  );
  await writeIfMissing(rootDir, "portfolio/projects/index.md", "# Projects Index\n\nNo active projects.\n");
  await writeIfMissing(
    rootDir,
    "identity/journal.md",
    "# The Foundry — Journal\n\n*Chronological record of iterations, decisions, and reflections.*\n\n---\n",
  );
  await writeIfMissing(
    rootDir,
    "identity/journal-compressed.md",
    "# The Foundry — Compressed Journal\n\n*Curator-compressed summaries of iteration history.*\n\n---\n",
  );
  await copyIfMissing(packageRoot, rootDir, "identity/manifesto.md");
  await writeIfMissing(rootDir, "requests.md", "");
  await writeIfMissing(
    rootDir,
    "README.md",
    `# ${basename(resolvePath(rootDir)) || "Foundry Portfolio"}\n\nA Foundry portfolio. Artifacts are produced autonomously and deployed to GitHub Pages.\n`,
  );
  await ensureGitignore(rootDir);
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

  await ensureScaffold(packageRoot, rootDir);

  for (const file of CONFIG_FILES) {
    await mergeYamlFile(
      packageRoot,
      rootDir,
      file,
      file === "config/foundry.yml"
        ? (data) => {
            const foundry = isRecord(data.foundry) ? data.foundry : {};
            foundry.version = cliVersion;
            data.foundry = foundry;
          }
        : undefined,
    );
    log(`  ${file}  ✓`);
  }

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

  log(`Upgrade complete.`);
  return true;
}
