import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import { resolve } from "../root.js";
import type {
  StreakBreak,
  StreakConfig,
  StreakHistory,
  StreakIterationResult,
  StreakState,
} from "./types.js";

const STREAKS_PATH = "identity/streaks.yml";
const RECENT_BREAK_LIMIT = 8;

export const DEFAULT_STREAK_CONFIG: StreakConfig = {
  min_length_for_amplify: 2,
  cooldown_after_break: 2,
  high_rating_threshold: 3.5,
  rating_break_threshold: 3.0,
};

export function emptyStreakHistory(): StreakHistory {
  return {
    current: null,
    recent_breaks: [],
    cooldown_domains: [],
    cooldown_remaining: 0,
  };
}

function configWithDefaults(config?: Partial<StreakConfig>): StreakConfig {
  return { ...DEFAULT_STREAK_CONFIG, ...config };
}

function parseRating(value: string | number | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isCodeDomain(domain: string | undefined): boolean {
  return domain?.startsWith("code-") ?? false;
}

function displayDomain(domain: string, projectId?: string | null): string {
  if (projectId) return `project ${projectId}`;
  if (isCodeDomain(domain)) return "code";
  return domain;
}

function sameStreak(current: StreakState, result: Extract<StreakIterationResult, { outcome: "shipped" }>): boolean {
  if (current.project_id && result.project_id && current.project_id === result.project_id) return true;
  if (isCodeDomain(current.domain) || current.domain === "code") return isCodeDomain(result.domain);
  return current.domain === result.domain;
}

function decrementCooldown(history: StreakHistory): StreakHistory {
  if (history.cooldown_remaining <= 0) {
    return { ...history, cooldown_domains: [], cooldown_remaining: 0 };
  }
  const nextRemaining = history.cooldown_remaining - 1;
  return {
    ...history,
    cooldown_remaining: nextRemaining,
    cooldown_domains: nextRemaining > 0 ? history.cooldown_domains : [],
  };
}

function roundedRating(value: number): number {
  return Math.round(value * 10) / 10;
}

function startStreak(result: Extract<StreakIterationResult, { outcome: "shipped" }>, rating: number): StreakState {
  return {
    active: true,
    length: 1,
    domain: displayDomain(result.domain, result.project_id),
    avg_rating: roundedRating(rating),
    start_iteration: result.iteration,
    last_iteration: result.iteration,
    artifact_ids: [result.artifact_id],
    project_id: result.project_id ?? null,
  };
}

function extendStreak(
  current: StreakState,
  result: Extract<StreakIterationResult, { outcome: "shipped" }>,
  rating: number,
): StreakState {
  const length = current.length + 1;
  const avg = ((current.avg_rating * current.length) + rating) / length;
  return {
    ...current,
    length,
    domain: displayDomain(result.domain, current.project_id ?? result.project_id),
    avg_rating: roundedRating(avg),
    last_iteration: result.iteration,
    artifact_ids: [...current.artifact_ids, result.artifact_id],
    project_id: current.project_id ?? result.project_id ?? null,
  };
}

function breakStreak(
  history: StreakHistory,
  iteration: number,
  domain: string | undefined,
  breakReason: StreakBreak["break_reason"],
  config: StreakConfig,
): StreakHistory {
  const brokenDomain = history.current?.domain ?? (domain ? displayDomain(domain) : "unknown");
  const recentBreaks = [
    {
      iteration,
      domain: brokenDomain,
      break_reason: breakReason,
    },
    ...history.recent_breaks,
  ].slice(0, RECENT_BREAK_LIMIT);

  return {
    current: null,
    recent_breaks: recentBreaks,
    cooldown_domains: brokenDomain === "unknown" ? [] : [brokenDomain],
    cooldown_remaining: brokenDomain === "unknown" ? 0 : config.cooldown_after_break,
  };
}

export function updateStreakState(
  history: StreakHistory,
  result: StreakIterationResult,
  configInput?: Partial<StreakConfig>,
): StreakHistory {
  const config = configWithDefaults(configInput);

  if (result.outcome === "killed") {
    if (!history.current) return decrementCooldown(history);
    return breakStreak(history, result.iteration, result.domain, "killed", config);
  }

  if (result.outcome !== "shipped") {
    return decrementCooldown(history);
  }

  const rating = parseRating(result.mean_rating);
  if (rating == null) return decrementCooldown(history);

  if (history.current && rating < config.rating_break_threshold) {
    return breakStreak(history, result.iteration, result.domain, "low_rating", config);
  }

  const cooled = decrementCooldown(history);
  if (rating < config.high_rating_threshold) return cooled;

  if (!cooled.current) {
    return { ...cooled, current: startStreak(result, rating) };
  }

  if (sameStreak(cooled.current, result)) {
    return { ...cooled, current: extendStreak(cooled.current, result, rating) };
  }

  const oldDomain = cooled.current.domain;
  const recentBreaks = [
    {
      iteration: result.iteration,
      domain: oldDomain,
      break_reason: "domain_shift" as const,
    },
    ...cooled.recent_breaks,
  ].slice(0, RECENT_BREAK_LIMIT);

  return {
    current: startStreak(result, rating),
    recent_breaks: recentBreaks,
    cooldown_domains: [oldDomain],
    cooldown_remaining: config.cooldown_after_break,
  };
}

export function formatStreakContext(
  history: StreakHistory,
  audience: "ideator" | "creator",
  configInput?: Partial<StreakConfig>,
): string {
  const config = configWithDefaults(configInput);
  const current = history.current;

  if (current && current.length >= config.min_length_for_amplify) {
    const recentIds = current.artifact_ids.slice(-5).join(", ");
    if (audience === "creator") {
      return [
        "## Streak Context",
        "",
        `Previous artifacts in this ${current.domain} streak scored ${current.avg_rating.toFixed(1)} on average.`,
        `Recent work: ${recentIds}. Maintain or exceed that standard without merely repeating the pattern.`,
      ].join("\n");
    }

    return [
      "## Hot Streak",
      "",
      `You're on a ${current.length}-iteration hot streak in ${current.domain}. Average rating: ${current.avg_rating.toFixed(1)}.`,
      `Recent work: ${recentIds}. Permission to push further in this vein, but add a new angle instead of cloning the last success.`,
    ].join("\n");
  }

  if (audience === "ideator" && history.cooldown_remaining > 0 && history.cooldown_domains.length > 0) {
    const domains = history.cooldown_domains.join(", ");
    return [
      "## Streak Broken - Pivot Hard",
      "",
      `A recent streak broke. Avoid ${domains} for the next ${history.cooldown_remaining} iteration${history.cooldown_remaining === 1 ? "" : "s"}.`,
      "Go somewhere unexpected and let the portfolio reset its pattern.",
    ].join("\n");
  }

  return "";
}

export async function saveStreakHistory(history: StreakHistory): Promise<void> {
  const filePath = resolve(STREAKS_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, yaml.stringify(history, { lineWidth: 120 }), "utf-8");
}

export async function loadStreakHistory(): Promise<StreakHistory> {
  try {
    const content = await readFile(resolve(STREAKS_PATH), "utf-8");
    const parsed = yaml.parse(content) as Partial<StreakHistory> | null;
    return {
      ...emptyStreakHistory(),
      ...parsed,
      recent_breaks: parsed?.recent_breaks ?? [],
      cooldown_domains: parsed?.cooldown_domains ?? [],
      cooldown_remaining: parsed?.cooldown_remaining ?? 0,
    };
  } catch {
    return emptyStreakHistory();
  }
}

export type {
  StreakBreak,
  StreakBreakReason,
  StreakConfig,
  StreakHistory,
  StreakIterationResult,
  StreakState,
} from "./types.js";
