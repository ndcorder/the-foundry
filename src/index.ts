#!/usr/bin/env node

import { loadConfig, loadModelsConfig } from "./context/config.js";
import { runIteration } from "./iteration/index.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function getIterationNumber(): Promise<number> {
  const logPath = path.join(process.cwd(), "logs", "iterations.jsonl");
  try {
    const content = await readFile(logPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return 1;
    const last = JSON.parse(lines[lines.length - 1]);
    return (last.iteration ?? 0) + 1;
  } catch {
    return 1;
  }
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const models = await loadModelsConfig();
  const iteration = await getIterationNumber();

  console.log(`The Foundry v${config.foundry.version} — Phase 1`);
  console.log(`Starting iteration ${iteration}...\n`);

  const result = await runIteration(config, models, iteration);

  console.log(`\n${"━".repeat(60)}`);
  console.log(`  Result: ${result.outcome}${result.title ? " — " + result.title : ""}`);
  console.log(`${"━".repeat(60)}\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
