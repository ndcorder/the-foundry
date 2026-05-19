#!/usr/bin/env node

import path from "node:path";
import { setRootDir } from "./root.js";

/**
 * Parse --workdir <path> from argv. Returns the remaining args with --workdir stripped.
 */
export function parseWorkdir(argv: string[]): string[] {
  const args = argv.slice(2); // skip node + script
  const cleaned: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workdir" && i + 1 < args.length) {
      setRootDir(path.resolve(args[i + 1]));
      i++; // skip the value
    } else {
      cleaned.push(args[i]);
    }
  }
  return cleaned;
}

export async function initFoundry(name: string): Promise<void> {
  const { existsSync } = await import("node:fs");
  const { mkdir, cp, writeFile } = await import("node:fs/promises");
  const { execSync } = await import("node:child_process");

  const dest = path.resolve(name);

  // Fail if directory already exists with config/ — prevents overwriting
  if (existsSync(path.join(dest, "config"))) {
    console.error(`Error: ${dest}/config already exists. Refusing to overwrite an existing foundry directory.`);
    process.exit(1);
  }

  // Package root is one level up from dist/ (where this compiled file lives)
  const packageRoot = path.resolve(import.meta.dirname, "..");

  console.log(`Initializing Foundry portfolio: ${name}`);

  // ── Step 1: Create directory ──────────────────────────────
  await mkdir(dest, { recursive: true });

  // ── Step 2: git init ─────────────────────────────────────
  try {
    execSync("git init", { cwd: dest, stdio: "pipe" });
    console.log("  git init          ✓");
  } catch {
    console.warn("  git init          ✗ (git not available, continuing without)");
  }

  // ── Step 3: Copy from package root ───────────────────────
  await cp(path.join(packageRoot, "config"), path.join(dest, "config"), { recursive: true });
  await cp(path.join(packageRoot, "prompts"), path.join(dest, "prompts"), { recursive: true });
  await mkdir(path.join(dest, "identity"), { recursive: true });
  await cp(path.join(packageRoot, "identity", "manifesto.md"), path.join(dest, "identity", "manifesto.md"));

  // stimuli/skills/ (optional — may not exist in all installs)
  const stimuliSkillsSrc = path.join(packageRoot, "stimuli", "skills");
  if (existsSync(stimuliSkillsSrc)) {
    await cp(stimuliSkillsSrc, path.join(dest, "stimuli", "skills"), { recursive: true });
  }
  // stimuli/stimuli.yml — pipeline config
  const stimuliYmlSrc = path.join(packageRoot, "stimuli", "stimuli.yml");
  if (existsSync(stimuliYmlSrc)) {
    await cp(stimuliYmlSrc, path.join(dest, "stimuli", "stimuli.yml"));
  }

  // site/ — entire Astro project
  const siteSrc = path.join(packageRoot, "site");
  if (existsSync(siteSrc)) {
    await cp(siteSrc, path.join(dest, "site"), { recursive: true });
    console.log("  site/             ✓");
  } else {
    /* v8 ignore next */
    console.warn("  site/             ✗ (not found in package)");
  }

  // .github/workflows/site.yml
  const workflowSrc = path.join(packageRoot, ".github", "workflows", "site.yml");
  if (existsSync(workflowSrc)) {
    await mkdir(path.join(dest, ".github", "workflows"), { recursive: true });
    await cp(workflowSrc, path.join(dest, ".github", "workflows", "site.yml"));
    console.log("  .github/          ✓");
  } else {
    /* v8 ignore next */
    console.warn("  .github/          ✗ (workflow not found in package)");
  }

  console.log("  config/           ✓");
  console.log("  prompts/          ✓");
  console.log("  identity/         ✓");
  console.log("  stimuli/          ✓");

  // ── Step 4: Create empty directories ─────────────────────
  const emptyDirs = [
    "portfolio",
    "portfolio/killed",
    "portfolio/projects",
    "logs",
    "workspace/current",
    "workspace/sandbox",
    "stimuli/live",
  ];
  for (const dir of emptyDirs) {
    await mkdir(path.join(dest, dir), { recursive: true });
  }
  console.log("  portfolio/        ✓");
  console.log("  workspace/        ✓");
  console.log("  logs/             ✓");

  // ── Step 5: Create seed files ────────────────────────────
  await writeFile(
    path.join(dest, "portfolio", "index.md"),
    `# Portfolio Index\n\n| ID | Title | Domain | Rating | Date | Project |\n|---|---|---|---|---|---|\n`,
    "utf-8",
  );
  await writeFile(
    path.join(dest, "portfolio", "projects", "index.md"),
    `# Projects Index\n\nNo active projects.\n`,
    "utf-8",
  );
  await writeFile(
    path.join(dest, "identity", "journal.md"),
    `# The Foundry — Journal\n\n*Chronological record of iterations, decisions, and reflections.*\n\n---\n`,
    "utf-8",
  );
  await writeFile(
    path.join(dest, "identity", "journal-compressed.md"),
    `# The Foundry — Compressed Journal\n\n*Curator-compressed summaries of iteration history.*\n\n---\n`,
    "utf-8",
  );

  // ── Step 6: Create .gitignore ────────────────────────────
  await writeFile(
    path.join(dest, ".gitignore"),
    `node_modules/\ndist/\n.astro/\nsite/dist/\nsite/node_modules/\nsite/public/artifacts/\nworkspace/\ncheckpoint.json\nSTOP\n*.tsbuildinfo\n.DS_Store\n.env\n.env.*\n`,
    "utf-8",
  );

  // ── Step 7: Create README.md ─────────────────────────────
  await writeFile(
    path.join(dest, "README.md"),
    `# ${name}\n\nA Foundry portfolio. Artifacts are produced autonomously and deployed to GitHub Pages.\n`,
    "utf-8",
  );

  // ── Step 8: npm install in site/ ─────────────────────────
  if (existsSync(path.join(dest, "site", "package.json"))) {
    try {
      console.log("\nInstalling site dependencies...");
      execSync("npm install", { cwd: path.join(dest, "site"), stdio: "inherit" });
      console.log("  npm install       ✓");
    } catch {
      console.warn("  npm install       ✗ (failed, run manually: cd site && npm install)");
    }
  }

  // ── Step 9: git add + commit ─────────────────────────────
  try {
    execSync("git add -A", { cwd: dest, stdio: "pipe" });
    execSync('git commit -m "Initialize Foundry portfolio"', { cwd: dest, stdio: "pipe" });
    console.log("  git commit        ✓");
  } catch {
    console.warn("  git commit        ✗ (failed or nothing to commit)");
  }

  // ── Step 10: Create GitHub repo ──────────────────────────
  let ghUser = "";
  try {
    ghUser = execSync("gh api user --jq '.login'", { stdio: "pipe" }).toString().trim();
  } catch {
    // gh not authenticated
  }

  try {
    execSync(`gh repo create ${name} --public --source . --push`, { cwd: dest, stdio: "pipe" });
    console.log("  GitHub repo       ✓");
  } catch {
    console.warn("  GitHub repo       ✗ (create manually: gh repo create)");
    if (ghUser) {
      console.log(`  Manual steps:`);
      console.log(`    gh repo create ${ghUser}/${name} --public --source ${dest} --push`);
    }
  }

  // ── Step 11: Enable GitHub Pages ─────────────────────────
  if (ghUser) {
    try {
      execSync(
        `gh api repos/${ghUser}/${name}/pages -X POST -f build_type=workflow`,
        { cwd: dest, stdio: "pipe" },
      );
      console.log("  GitHub Pages      ✓");
    } catch {
      console.warn("  GitHub Pages      ✗ (enable manually in repo Settings > Pages)");
    }
  }

  // ── Step 12: Success ─────────────────────────────────────
  console.log(`\n✨ Foundry portfolio initialized: ${dest}`);
  if (ghUser) {
    console.log(`  Repository:  https://github.com/${ghUser}/${name}`);
    console.log(`  Site:        https://${ghUser}.github.io/${name}/`);
  }
  console.log(`\nRun \`foundry start --workdir ${dest}\` to begin.`);
}

export async function run(): Promise<void> {
  const args = parseWorkdir(process.argv);
  const command = args[0];

  switch (command) {
    case "init": {
      const target = args[1];
      if (!target) {
        console.error("Usage: foundry init <name>");
        process.exit(1);
      }
      await initFoundry(target);
      break;
    }

    case "start": {
      const { startFoundry } = await import("./index.js");
      await startFoundry();
      break;
    }

    case "stop": {
      const { stopFoundry } = await import("./index.js");
      await stopFoundry();
      console.log("STOP file created. The Foundry will halt after the current iteration.");
      break;
    }

    case "status": {
      const { getStatus } = await import("./index.js");
      const s = await getStatus();
      console.log(`The Foundry — ${s.running ? "running" : "stopped"}`);
      console.log(`  Iteration:  ${s.iteration}`);
      console.log(`  Shipped:    ${s.shipped}`);
      console.log(`  Killed:     ${s.killed}`);
      console.log(`  Skipped:    ${s.skipped}`);
      if (s.lastArtifact) console.log(`  Last ship:  ${s.lastArtifact}`);
      if (s.savedAt) console.log(`  Checkpoint: ${s.savedAt}`);
      if (s.recentOutcomes.length > 0) {
        console.log(`\n  Recent:`);
        for (const o of s.recentOutcomes.slice(-5)) {
          console.log(`    #${o.iteration} ${o.outcome}${o.domain ? " (" + o.domain + ")" : ""}`);
        }
      }
      break;
    }

    case "dashboard": {
      // Dashboard server lives in the package, not the workdir
      const serverPath = path.join(import.meta.dirname, "..", "dashboard", "server.ts");
      const { execSync } = await import("node:child_process");
      execSync(`npx tsx ${serverPath}`, { stdio: "inherit" });
      break;
    }

    default:
      console.log(`Usage: foundry [--workdir <path>] <command>\n`);
      console.log(`Commands:`);
      console.log(`  init <name>   Create a new Foundry portfolio repo in ./<name>/`);
      console.log(`  start         Run the iteration loop`);
      console.log(`  stop          Create STOP file to halt after current iteration`);
      console.log(`  status        Show current state (iteration, stats, checkpoint)`);
      console.log(`  dashboard     Start the dashboard server`);
      console.log(`\nOptions:`);
      console.log(`  --workdir <path>   Set the foundry data directory (default: cwd)`);
      process.exit(command ? 1 : 0);
  }
}

/* v8 ignore start */
const isDirectRun = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isDirectRun) {
  run().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
/* v8 ignore stop */
