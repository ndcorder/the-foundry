#!/usr/bin/env node

import { loadConfig, loadModelsConfig } from "./context/config.js";
import { setModelOverrides } from "./model/index.js";
import { runIteration } from "./iteration/index.js";
import { checkStopFile } from "./files/intervention.js";
import { appendJournal } from "./files/journal.js";
import { saveCheckpoint, loadCheckpoint } from "./checkpoint/index.js";
import { StatsTracker } from "./stats/index.js";
import { dispatchCuratorFull, applyCuratorCycle, shouldRunCurator } from "./curator/index.js";
import {
  loadStimuliConfig,
  refreshAllStale,
  initRefreshStates,
  recordToRefreshStates,
  refreshStatesToRecord,
} from "./stimuli/index.js";

import { runAllDetectors, type MonitorWarning } from "./monitor/index.js";
import { readJsonlEntries } from "./context/index.js";
import type { CheckpointState, StimuliRefreshState } from "./types/index.js";
import type { FoundryConfig, ModelsConfig } from "./types/index.js";
import { execSync, execFileSync } from "node:child_process";
import { readFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { resolve, getRootDir, setRootDir } from "./root.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function autoCommitAndPush(
  iteration: number,
  outcome: string,
  artifactId: string | null,
  title: string,
  domain: string,
  rating: number | null,
  autoGitPush: boolean,
): void {
  const rootDir = getRootDir();
  const ratingStr = rating !== null ? ` ★${rating.toFixed(1)}` : "";
  let msg: string;
  if (outcome === "shipped") {
    msg = `feat: ship #${artifactId} — ${title} [${domain}]${ratingStr}`;
  } else if (outcome === "killed") {
    msg = `chore: kill #${artifactId} — ${title} [${domain}]`;
  } else {
    /* v8 ignore next */
    msg = `chore: iteration ${iteration} failed`;
  }

  try {
    execSync("git add portfolio/ identity/ logs/iterations.jsonl logs/decisions.jsonl", { cwd: rootDir, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", msg], { cwd: rootDir, stdio: "pipe" });
    if (autoGitPush) {
      /* v8 ignore next */
      execSync("git push origin HEAD", { cwd: rootDir, stdio: "pipe", timeout: 30000 });
    }
  } catch {
    console.warn("[git] auto-commit/push failed, will retry next iteration");
  }
}

async function getLastIterationFromLog(): Promise<number> {
  const logPath = resolve("logs", "iterations.jsonl");
  try {
    const content = await readFile(logPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return 0;
    const last = JSON.parse(lines[lines.length - 1]);
    return last.iteration ?? 0;
  } catch {
    return 0;
  }
}

export async function startFoundry(opts?: { rootDir?: string }): Promise<void> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const config = await loadConfig();
  const models = await loadModelsConfig();

  const autoGitCommit = config.git?.auto_commit !== false;
  const autoGitPush = config.git?.auto_push !== false;

  // ── Auto-upgrade if CLI is newer than project ────────────
  const { upgradeProject } = await import("./upgrade.js");
  const upgraded = await upgradeProject({ silent: false });
  if (upgraded) console.log();

  console.log(`The Foundry v${config.foundry.version} — Phase 3`);
  console.log(`Mode: infinite loop with crash recovery + observability`);
  if (autoGitCommit) console.log(`Git: auto-commit${autoGitPush ? " + push" : ""} enabled`);
  console.log();

  // Load model tier overrides for A/B testing
  if (models.overrides && models.overrides.length > 0) {
    setModelOverrides(models.overrides);
    console.log(`Model overrides active: ${models.overrides.map((o) => `${o.agent}→${o.model} (${o.label})`).join(", ")}`);
  }

  // ── Restore or initialize state ──────────────────────────────
  const checkpoint = await loadCheckpoint();
  let stats: StatsTracker;
  let iteration: number;
  let lastCuratorRun: number;
  let stimuliRefreshStates: Map<string, StimuliRefreshState>;

  if (checkpoint) {
    iteration = checkpoint.iteration + 1;
    lastCuratorRun = checkpoint.last_curator_run;
    stats = StatsTracker.fromSnapshot(checkpoint.stats);
    try {
      const stimuliConfig = await loadStimuliConfig();
      stimuliRefreshStates = recordToRefreshStates(checkpoint.last_stimuli_refresh, stimuliConfig);
    } catch {
      stimuliRefreshStates = new Map();
    }
    console.log(`Resumed from checkpoint at iteration ${checkpoint.iteration}.`);
    await appendJournal(
      `**Iteration ${iteration}:** Resumed from checkpoint at iteration ${checkpoint.iteration} after interruption.`,
    );
  } else {
    const lastLogged = await getLastIterationFromLog();
    iteration = lastLogged + 1;
    lastCuratorRun = 0;
    stats = StatsTracker.fresh();
    try {
      const stimuliConfig = await loadStimuliConfig();
      stimuliRefreshStates = initRefreshStates(stimuliConfig);
    } catch {
      stimuliRefreshStates = new Map();
    }
    console.log(`Fresh start — no checkpoint found. Continuing from iteration ${iteration} (per log).`);
  }

  // Graceful shutdown on signals
  let shutdownRequested = false;
  const onSignal = () => {
    if (shutdownRequested) {
      console.log("\nForce shutdown.");
      process.exit(1);
    }
    shutdownRequested = true;
    console.log("\nShutdown requested — will stop after current iteration...");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  // ── Main loop ────────────────────────────────────────────────
  while (true) {
    // Check STOP file or shutdown signal
    if (shutdownRequested || await checkStopFile(config)) {
      console.log(`\n${shutdownRequested ? "Signal" : "STOP file"} detected — halting after saving checkpoint.`);
      await saveState(config, iteration - 1, lastCuratorRun, stats, stimuliRefreshStates);
      await appendJournal(`**System:** Halted by ${shutdownRequested ? "signal" : "STOP file"} at iteration ${iteration}.`);
      break;
    }

    // ── Stimuli refresh (if enabled) ───────────────────────────
    if (config.stimuli.enabled) {
      try {
        stimuliRefreshStates = await refreshAllStale(iteration, stimuliRefreshStates);
      } catch (err) {
        console.error(`[stimuli] Refresh error (non-fatal):`, err);
      }
    }

    // ── Run iteration ──────────────────────────────────────────
    stats.setIteration(iteration);

    try {
      const result = await runIteration(config, models, iteration);

      // Record stats
      if (result.outcome === "shipped" || result.outcome === "killed" || result.outcome === "skipped") {
        stats.recordOutcome(iteration, result.outcome, result.domain);
      }
      stats.recordTokens(result.token_usage.input, result.token_usage.output);

      console.log(`\n${"━".repeat(60)}`);
      console.log(`  Iteration ${iteration}: ${result.outcome}${result.title ? " — " + result.title : ""}`);
      console.log(`${"━".repeat(60)}\n`);

      if (result.outcome === "halted") {
        await saveState(config, iteration, lastCuratorRun, stats, stimuliRefreshStates);
        break;
      }

      // ── Auto-commit after successful iteration ──────────────
      if (autoGitCommit && (result.outcome === "shipped" || result.outcome === "killed")) {
        const meanRating = result.ratings
          ? Object.values(result.ratings).reduce((a, b) => a + b, 0) / Object.values(result.ratings).length
          : null;
        autoCommitAndPush(
          iteration,
          result.outcome,
          result.artifact_id ?? null,
          result.title ?? "untitled",
          result.domain ?? "unknown",
          meanRating,
          autoGitPush,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n  ✘ Iteration ${iteration} failed: ${msg}`);
      await appendJournal(`**Iteration ${iteration}:** Failed: ${msg}`);
      stats.recordOutcome(iteration, "skipped");

      // Auto-commit failed iterations too
      if (autoGitCommit) {
        /* v8 ignore next */
        autoCommitAndPush(iteration, "skipped", null, "", "", null, autoGitPush);
      }
    }

    // ── Curator full cycle ──────────────────────────────────────
    if (shouldRunCurator(iteration, lastCuratorRun, config)) {
      console.log(`\n▶ Curator full cycle (iteration ${iteration})`);
      try {
        const curatorResponse = await dispatchCuratorFull(config, models, iteration, stats);
        await applyCuratorCycle(curatorResponse, iteration);
        lastCuratorRun = iteration;
        stats.recordTokens(0, 0); // token usage already logged inside dispatch
        console.log(`  Curator cycle complete.`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Curator cycle failed (non-fatal): ${msg}`);
        await appendJournal(`**Iteration ${iteration}:** Curator cycle failed: ${msg}`);
      }
    }

    // ── Checkpoint ──────────────────────────────────────────────
    if (iteration % config.recovery.checkpoint_every === 0) {
      await saveState(config, iteration, lastCuratorRun, stats, stimuliRefreshStates);
      console.log(`  Checkpoint saved at iteration ${iteration}.`);
    }

    // ── Anti-entropy monitoring ─────────────────────────────────
    try {
      const iterEntries = await readJsonlEntries<any>(
        resolve("logs", "iterations.jsonl"),
      );
      /* v8 ignore next 3 */
      const journal = await readFile(
        resolve("identity", "journal.md"), "utf-8",
      ).catch(() => "");

      const warnings = runAllDetectors(iterEntries, journal, iteration);
      for (const w of warnings) {
        console.log(`  [${w.severity}] ${w.detector}: ${w.message}`);
        await appendFile(
          resolve("logs", "monitor.jsonl"),
          JSON.stringify(w) + "\n",
        );
      }

      const critical = warnings.filter((w) => w.severity === "critical");
      if (critical.some((w) => w.action?.type === "emergency_curator")) {
        console.log(`  ▶ Emergency Curator triggered by quality crisis`);
        try {
          const curatorResponse = await dispatchCuratorFull(config, models, iteration, stats);
          await applyCuratorCycle(curatorResponse, iteration);
          lastCuratorRun = iteration;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  Emergency Curator failed: ${msg}`);
        }
      }
    } catch {
      // monitor is non-fatal
    }

    // ── Cooldown ────────────────────────────────────────────────
    const cooldownMs = (config.loop?.cooldown_seconds ?? 2) * 1000;
    await sleep(cooldownMs);

    iteration++;
  }

  process.removeListener("SIGINT", onSignal);
  process.removeListener("SIGTERM", onSignal);

  console.log("\nThe Foundry has stopped.");
}

async function saveState(
  config: FoundryConfig,
  iteration: number,
  lastCuratorRun: number,
  stats: StatsTracker,
  stimuliRefreshStates: Map<string, StimuliRefreshState>,
): Promise<void> {
  const snapshot = stats.getSnapshot();
  const state: CheckpointState = {
    iteration,
    active_project_ids: [],
    domain_counts: snapshot.domain_counts,
    last_stimuli_refresh: refreshStatesToRecord(stimuliRefreshStates),
    last_curator_run: lastCuratorRun,
    stats: snapshot,
    saved_at: new Date().toISOString(),
  };
  await saveCheckpoint(state);
}

export async function stopFoundry(stopFile = "STOP", opts?: { rootDir?: string }): Promise<void> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const { writeFile } = await import("node:fs/promises");
  const stopPath = resolve(stopFile);
  await writeFile(stopPath, `Stopped at ${new Date().toISOString()}\n`, "utf-8");
}

export interface FoundryStatus {
  running: boolean;
  iteration: number;
  savedAt: string | null;
  shipped: number;
  killed: number;
  skipped: number;
  recentOutcomes: Array<{ iteration: number; outcome: string; domain?: string }>;
  lastArtifact: string | null;
}

export async function getStatus(opts?: { rootDir?: string }): Promise<FoundryStatus> {
  if (opts?.rootDir) setRootDir(opts.rootDir);
  const checkpoint = await loadCheckpoint();
  let lastArtifact: string | null = null;

  try {
    const logPath = resolve("logs", "iterations.jsonl");
    const content = await readFile(logPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      const entry = JSON.parse(lines[i]);
      if (entry.outcome === "shipped" && entry.title) {
        lastArtifact = entry.title;
        break;
      }
    }
  } catch {
    // no log file yet
  }

  const stopExists = await readFile(resolve("STOP"), "utf-8")
    .then(() => true)
    .catch(() => false);

  if (!checkpoint) {
    return {
      running: !stopExists,
      iteration: 0,
      savedAt: null,
      shipped: 0,
      killed: 0,
      skipped: 0,
      recentOutcomes: [],
      lastArtifact,
    };
  }

  return {
    running: !stopExists,
    iteration: checkpoint.iteration,
    savedAt: checkpoint.saved_at,
    shipped: checkpoint.stats.shipped,
    killed: checkpoint.stats.killed,
    skipped: checkpoint.stats.skipped,
    recentOutcomes: checkpoint.stats.recent_outcomes,
    lastArtifact,
  };
}

/* v8 ignore start */
const isDirectRun = process.argv[1] &&
  import.meta.url === `file://${path.resolve(process.argv[1])}`;

if (isDirectRun) {
  startFoundry().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
/* v8 ignore stop */
