import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import { resolve } from "../root.js";
import type { StokerDirective } from "./types.js";
import { emptyStokerDirective } from "./rules.js";
import { DEFAULT_STOKER_CONFIG } from "./rules.js";
import type { StokerConfig } from "./types.js";

const STOKER_DIRECTIVE_PATH = "identity/stoker-directive.yml";

export interface StokerCadenceStatus {
  enabled: boolean;
  runInterval: number;
  nextRunIteration: number | null;
  iterationsUntilRun: number | null;
}

function compactList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "";
}

function normalizeDirective(parsed: Partial<StokerDirective> | null): StokerDirective | null {
  if (!parsed) return null;
  const generatedIteration = parsed.generated_iteration ?? 0;
  return {
    ...emptyStokerDirective(generatedIteration, parsed.for_iteration ?? generatedIteration + 1),
    ...parsed,
    streak_instruction: parsed.streak_instruction ?? "neutral",
    urgency: parsed.urgency ?? "normal",
    rules_fired: parsed.rules_fired ?? [],
  };
}

export function formatStokerDirective(
  directive: StokerDirective | null,
  targetIteration?: number,
): string {
  if (!isStokerDirectiveCurrent(directive, targetIteration)) return "";

  const lines = [
    "## Stoker Directive",
    "",
    `Urgency: ${directive.urgency}.`,
  ];

  if (directive.ideator_hint) lines.push(directive.ideator_hint);
  if (directive.complexity_override) lines.push(`Prefer ${directive.complexity_override}-tier unless the idea clearly demands another scale.`);

  if (directive.domain_pressure) {
    const toward = compactList(directive.domain_pressure.toward);
    const away = compactList(directive.domain_pressure.away_from);
    if (toward) lines.push(`Lean toward ${toward}.`);
    if (away) lines.push(`Avoid ${away}.`);
  }

  if (directive.mood_amplifier) lines.push(`Mood amplifier: ${directive.mood_amplifier}`);
  if (directive.streak_instruction === "amplify") lines.push("Streak instruction: amplify what is working, but add a new constraint or angle.");
  if (directive.streak_instruction === "break") lines.push("Streak instruction: break pattern and pivot hard.");
  if (directive.refinery_queue && directive.refinery_queue > 0) lines.push(`Refinery queue: ${directive.refinery_queue} job.`);

  return lines.join("\n");
}

export function isStokerDirectiveCurrent(
  directive: StokerDirective | null,
  targetIteration?: number,
): directive is StokerDirective {
  if (!directive) return false;
  return targetIteration == null || directive.for_iteration === targetIteration;
}

export function getStokerCadenceStatus(
  currentIteration: number,
  config?: StokerConfig,
): StokerCadenceStatus {
  const merged = { ...DEFAULT_STOKER_CONFIG, ...config };
  const runInterval = Math.max(1, Math.floor(merged.run_interval));
  if (!merged.enabled) {
    return {
      enabled: false,
      runInterval,
      nextRunIteration: null,
      iterationsUntilRun: null,
    };
  }

  const completedIteration = Math.max(0, Math.floor(currentIteration));
  const remainder = completedIteration % runInterval;
  const iterationsUntilRun = completedIteration === 0
    ? runInterval
    : remainder === 0
      ? runInterval
      : runInterval - remainder;
  return {
    enabled: true,
    runInterval,
    nextRunIteration: completedIteration + iterationsUntilRun,
    iterationsUntilRun,
  };
}

export async function saveStokerDirective(directive: StokerDirective): Promise<void> {
  const filePath = resolve(STOKER_DIRECTIVE_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, yaml.stringify(directive, { lineWidth: 120 }), "utf-8");
}

export async function loadStokerDirective(): Promise<StokerDirective | null> {
  try {
    const content = await readFile(resolve(STOKER_DIRECTIVE_PATH), "utf-8");
    return normalizeDirective(yaml.parse(content) as Partial<StokerDirective> | null);
  } catch {
    return null;
  }
}

export async function clearConsumedStokerDirective(iteration: number): Promise<void> {
  const directive = await loadStokerDirective();
  if (!directive || directive.for_iteration > iteration) return;

  try {
    await unlink(resolve(STOKER_DIRECTIVE_PATH));
  } catch {
    // Already clear.
  }
}

export {
  DEFAULT_STOKER_CONFIG,
  emptyStokerDirective,
  generateStokerDirective,
  getStokerRefineryReadinessStatus,
  getStokerTokenHeatStatus,
  shouldRunStoker,
} from "./rules.js";

export type {
  StokerConfig,
  StokerDirective,
  StokerDomainPressure,
  StokerForceContext,
  StokerForceReason,
  StokerIterationEntry,
  StokerRefineryReadinessBlocker,
  StokerRefineryReadinessState,
  StokerRefineryReadinessStatus,
  StokerSignals,
  StokerStreakInstruction,
  StokerTokenHeatStatus,
  StokerUrgency,
} from "./types.js";
