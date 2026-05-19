#!/usr/bin/env node

import path from "node:path";
import { setRootDir } from "./root.js";

/**
 * Parse --workdir <path> from argv. Returns the remaining args with --workdir stripped.
 */
function parseWorkdir(argv: string[]): string[] {
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

async function initFoundry(targetPath: string): Promise<void> {
  const { existsSync } = await import("node:fs");
  const { mkdir, cp, writeFile } = await import("node:fs/promises");

  const dest = path.resolve(targetPath);

  // Fail if config/ already exists — prevents overwriting an existing foundry
  if (existsSync(path.join(dest, "config"))) {
    console.error(`Error: ${dest}/config already exists. Refusing to overwrite an existing foundry directory.`);
    process.exit(1);
  }

  // Package root is one level up from dist/ (where this compiled file lives)
  const packageRoot = path.resolve(import.meta.dirname, "..");

  // Copy seed directories from the installed package
  await mkdir(dest, { recursive: true });
  await cp(path.join(packageRoot, "config"), path.join(dest, "config"), { recursive: true });
  await cp(path.join(packageRoot, "prompts"), path.join(dest, "prompts"), { recursive: true });
  await mkdir(path.join(dest, "identity"), { recursive: true });
  await cp(path.join(packageRoot, "identity", "manifesto.md"), path.join(dest, "identity", "manifesto.md"));
  await cp(path.join(packageRoot, "stimuli", "skills"), path.join(dest, "stimuli", "skills"), { recursive: true });

  // Create empty directories
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

  // Create seed files
  await writeFile(
    path.join(dest, "portfolio", "index.md"),
    `# Portfolio Index\n\n| ID | Title | Domain | Rating | Date | Project |\n|---|---|---|---|---|---|\n`,
    "utf-8",
  );
  await writeFile(
    path.join(dest, "portfolio", "projects", "index.md"),
    `# Projects Index\n\n| ID | Name | Status | Progress | Started | Updated |\n|---|---|---|---|---|---|\n\n*No active projects.*\n`,
    "utf-8",
  );
  await writeFile(
    path.join(dest, "identity", "journal.md"),
    `# The Foundry — Journal\n\n*Chronological record of iterations, decisions, and reflections.*\n\n---\n`,
    "utf-8",
  );

  console.log(`Foundry initialized at ${dest}`);
  console.log(`  config/        ✓`);
  console.log(`  prompts/       ✓`);
  console.log(`  identity/      ✓`);
  console.log(`  portfolio/     ✓`);
  console.log(`  stimuli/       ✓`);
  console.log(`  workspace/     ✓`);
  console.log(`  logs/          ✓`);
  console.log(`\nRun \`foundry start --workdir ${dest}\` to begin.`);
}

async function run(): Promise<void> {
  const args = parseWorkdir(process.argv);
  const command = args[0];

  switch (command) {
    case "init": {
      const target = args[1];
      if (!target) {
        console.error("Usage: foundry init <path>");
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
      console.log(`  init <path>   Scaffold a new foundry data directory`);
      console.log(`  start         Run the iteration loop`);
      console.log(`  stop          Create STOP file to halt after current iteration`);
      console.log(`  status        Show current state (iteration, stats, checkpoint)`);
      console.log(`  dashboard     Start the dashboard server`);
      console.log(`\nOptions:`);
      console.log(`  --workdir <path>   Set the foundry data directory (default: cwd)`);
      process.exit(command ? 1 : 0);
  }
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
