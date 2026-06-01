import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { loadDreamJournal, type DreamEntry } from "../dreams/index.js";
import { readJsonlEntries } from "../context/data.js";
import { resolve } from "../root.js";
import type {
  PortfolioCandidate,
  RefineryCadenceStatus,
  RefineryAttempt,
  RefineryConfig,
  RefineryFuelStatus,
  RefineryFuelTargetSummary,
  RefineryTarget,
} from "./types.js";

export const DEFAULT_REFINERY_CONFIG: RefineryConfig = {
  enabled: true,
  min_iterations_between_runs: 5,
  max_refinery_queue: 1,
};

const ATTEMPT_COOLDOWN = 10;
const FUEL_TARGET_PREVIEW_LIMIT = 3;

function configWithDefaults(config?: Partial<RefineryConfig>): RefineryConfig {
  return { ...DEFAULT_REFINERY_CONFIG, ...config };
}

export function getRefineryCadenceStatus(
  currentIteration: number,
  lastIteration: number | null,
  config?: Partial<RefineryConfig>,
): RefineryCadenceStatus {
  const merged = configWithDefaults(config);
  const minIterationsBetweenRuns = Math.max(0, Math.floor(merged.min_iterations_between_runs));
  if (!merged.enabled) {
    return {
      enabled: false,
      minIterationsBetweenRuns,
      lastIteration,
      nextEligibleIteration: null,
      iterationsUntilEligible: null,
    };
  }

  const completedIteration = Math.max(0, Math.floor(currentIteration));
  const nextEligibleIteration = lastIteration == null
    ? completedIteration
    : lastIteration + minIterationsBetweenRuns;
  return {
    enabled: true,
    minIterationsBetweenRuns,
    lastIteration,
    nextEligibleIteration,
    iterationsUntilEligible: Math.max(0, nextEligibleIteration - completedIteration),
  };
}

function wasAttemptedRecently(
  sourceId: string,
  sourceType: RefineryAttempt["source_type"],
  attempts: RefineryAttempt[],
  currentIteration: number,
): boolean {
  return attempts.some((attempt) =>
    attempt.source_id === sourceId
    && attempt.source_type === sourceType
    && currentIteration - attempt.iteration < ATTEMPT_COOLDOWN,
  );
}

function wasSuccessfullyRefined(
  sourceId: string,
  sourceType: RefineryAttempt["source_type"],
  attempts: RefineryAttempt[],
): boolean {
  return attempts.some((attempt) =>
    attempt.source_id === sourceId
    && attempt.source_type === sourceType
    && attempt.result === "shipped",
  );
}

function normalizedSourceId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—" || trimmed === "-") return null;
  const match = trimmed.match(/#?(\d{4})/);
  return match ? match[1] : trimmed.replace(/^#/, "");
}

function dreamScore(dream: DreamEntry): number {
  const hint = dream.resurrection_hint?.trim() ?? "";
  const good = dream.what_was_good?.trim() ?? "";
  const reason = dream.kill_reason?.toLowerCase() ?? "";
  let score = hint.length + Math.round(good.length / 2);
  if (reason.includes("execution") || reason.includes("implementation") || reason.includes("structure")) score += 40;
  if (reason.includes("fundamental") || reason.includes("derivative") || reason.includes("idea")) score -= 80;
  return score;
}

function dreamTarget(dream: DreamEntry): RefineryTarget {
  return {
    source_type: "dream",
    source_id: dream.artifact_id,
    source_title: dream.title,
    source_domain: dream.domain,
    resurrection_hint: dream.resurrection_hint,
    original_content: [
      `Pitch: ${dream.pitch}`,
      `Killed because: ${dream.kill_reason}`,
      `What was good: ${dream.what_was_good}`,
      `Resurrection hint: ${dream.resurrection_hint}`,
    ].join("\n"),
    refinement_type: "resurrected",
  };
}

function companionTarget(candidate: PortfolioCandidate): RefineryTarget {
  return {
    source_type: "companion",
    source_id: candidate.id,
    source_title: candidate.title,
    source_domain: candidate.domain,
    original_rating: candidate.rating,
    original_content: candidate.content,
    refinement_type: "companion",
  };
}

function remasterTarget(candidate: PortfolioCandidate): RefineryTarget {
  return {
    source_type: "low_rated",
    source_id: candidate.id,
    source_title: candidate.title,
    source_domain: candidate.domain,
    original_rating: candidate.rating,
    original_content: candidate.content,
    refinement_type: "remastered",
  };
}

export function parsePortfolioIndex(content: string): PortfolioCandidate[] {
  const entries: PortfolioCandidate[] = [];
  let headers: string[] | null = null;

  const cellFor = (cells: string[], normalizedHeader: string, fallbackIndex: number): string | undefined => {
    if (headers) {
      const index = headers.indexOf(normalizedHeader);
      if (index >= 0) return cells[index];
    }
    return cells[fallbackIndex];
  };

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;

    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.some((cell) => cell === "ID") && cells.some((cell) => cell === "Title")) {
      headers = cells.map((cell) => cell.toLowerCase().replace(/\s+/g, "_"));
      continue;
    }
    if (line.includes("---")) continue;
    if (cells.length < 4) continue;
    const id = cellFor(cells, "id", 0) ?? "";
    const title = cellFor(cells, "title", 1) ?? "";
    const domain = cellFor(cells, "domain", 2) ?? "";
    const ratingRaw = cellFor(cells, "rating", 3) ?? "";
    const projectRaw = cellFor(cells, "project", 5);
    const refinedFromRaw = cellFor(cells, "refined_from", 6);
    if (!/^\d{4}$/.test(id)) continue;
    const rating = parseFloat(ratingRaw);
    if (!Number.isFinite(rating)) continue;

    entries.push({
      id,
      title,
      domain,
      rating,
      iteration: parseInt(id, 10),
      project: projectRaw && projectRaw !== "—" ? projectRaw : null,
      refined_from: normalizedSourceId(refinedFromRaw),
      readme_path: null,
    });
  }
  return entries;
}

export function pickRefineryTargets(input: {
  dreams: DreamEntry[];
  portfolio: PortfolioCandidate[];
  attempts: RefineryAttempt[];
  current_iteration: number;
  config?: Partial<RefineryConfig>;
}): RefineryTarget[] {
  const config = configWithDefaults(input.config);
  if (!config.enabled) return [];

  const targets: RefineryTarget[] = [];
  const maxTargets = Math.max(0, config.max_refinery_queue);
  if (maxTargets === 0) return [];
  const refinedSourceIds = new Set(
    input.portfolio
      .map((candidate) => candidate.refined_from)
      .filter((id): id is string => Boolean(id)),
  );

  const dreams = input.dreams
    .filter((dream) => !wasAttemptedRecently(dream.artifact_id, "dream", input.attempts, input.current_iteration))
    .filter((dream) => !wasSuccessfullyRefined(dream.artifact_id, "dream", input.attempts))
    .sort((a, b) => dreamScore(b) - dreamScore(a));
  for (const dream of dreams) {
    targets.push(dreamTarget(dream));
    if (targets.length >= maxTargets) return targets;
  }

  const companionCandidates = input.portfolio
    .filter((candidate) => !candidate.refined_from)
    .filter((candidate) => !refinedSourceIds.has(candidate.id))
    .filter((candidate) => candidate.rating >= 4)
    .filter((candidate) => input.current_iteration - candidate.iteration <= 10)
    .filter((candidate) => !wasAttemptedRecently(candidate.id, "companion", input.attempts, input.current_iteration))
    .filter((candidate) => !wasSuccessfullyRefined(candidate.id, "companion", input.attempts))
    .sort((a, b) => b.rating - a.rating || b.iteration - a.iteration);
  for (const candidate of companionCandidates) {
    targets.push(companionTarget(candidate));
    if (targets.length >= maxTargets) return targets;
  }

  const remasterCandidates = input.portfolio
    .filter((candidate) => !candidate.refined_from)
    .filter((candidate) => !refinedSourceIds.has(candidate.id))
    .filter((candidate) => candidate.rating >= 3.0 && candidate.rating <= 3.5)
    .filter((candidate) => input.current_iteration - candidate.iteration >= 5)
    .filter((candidate) => !wasAttemptedRecently(candidate.id, "low_rated", input.attempts, input.current_iteration))
    .filter((candidate) => !wasSuccessfullyRefined(candidate.id, "low_rated", input.attempts))
    .sort((a, b) => a.rating - b.rating || a.iteration - b.iteration);
  for (const candidate of remasterCandidates) {
    targets.push(remasterTarget(candidate));
    if (targets.length >= maxTargets) return targets;
  }

  return targets;
}

function summarizeFuelTarget(target: RefineryTarget): RefineryFuelTargetSummary {
  return {
    sourceType: target.source_type,
    sourceId: target.source_id,
    title: target.source_title,
    domain: target.source_domain,
    refinementType: target.refinement_type,
    originalRating: target.original_rating,
  };
}

export function getRefineryFuelStatusFromSources(input: {
  dreams: DreamEntry[];
  portfolio: PortfolioCandidate[];
  attempts: RefineryAttempt[];
  current_iteration: number;
  config?: Partial<RefineryConfig>;
}): RefineryFuelStatus {
  const config = configWithDefaults(input.config);
  const queueLimit = Math.max(0, Math.floor(config.max_refinery_queue));
  const emptyByType = { dream: 0, companion: 0, lowRated: 0 };
  if (!config.enabled) {
    return {
      enabled: false,
      queueLimit,
      available: 0,
      byType: emptyByType,
      topTargets: [],
    };
  }

  const targets = pickRefineryTargets({
    ...input,
    config: {
      ...config,
      max_refinery_queue: Number.MAX_SAFE_INTEGER,
    },
  });
  const byType = { ...emptyByType };
  for (const target of targets) {
    if (target.source_type === "low_rated") {
      byType.lowRated++;
    } else {
      byType[target.source_type]++;
    }
  }

  return {
    enabled: true,
    queueLimit,
    available: targets.length,
    byType,
    topTargets: targets.slice(0, FUEL_TARGET_PREVIEW_LIMIT).map(summarizeFuelTarget),
  };
}

async function findArtifactReadme(id: string): Promise<string | null> {
  const portfolioRoot = resolve("portfolio");
  let domains;
  try {
    domains = await readdir(portfolioRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const domain of domains) {
    if (!domain.isDirectory() || domain.name === "killed" || domain.name === "projects") continue;
    const domainDir = path.join(portfolioRoot, domain.name);
    let artifacts;
    try {
      artifacts = await readdir(domainDir, { withFileTypes: true });
    } catch {
      continue;
    }
    const match = artifacts.find((entry) => entry.isDirectory() && entry.name.startsWith(`${id}-`));
    if (match) return path.join(domainDir, match.name, "README.md");
  }
  return null;
}

async function loadPortfolioCandidates(): Promise<PortfolioCandidate[]> {
  let indexContent = "";
  try {
    indexContent = await readFile(resolve("portfolio", "index.md"), "utf-8");
  } catch {
    return [];
  }

  const candidates = parsePortfolioIndex(indexContent);
  for (const candidate of candidates) {
    const readmePath = await findArtifactReadme(candidate.id);
    candidate.readme_path = readmePath;
    if (readmePath) {
      try {
        candidate.content = await readFile(readmePath, "utf-8");
      } catch {
        candidate.content = undefined;
      }
    }
  }
  return candidates;
}

export async function selectRefineryTargets(
  currentIteration: number,
  config?: Partial<RefineryConfig>,
): Promise<RefineryTarget[]> {
  const [dreamJournal, portfolio, attempts] = await Promise.all([
    loadDreamJournal(),
    loadPortfolioCandidates(),
    readJsonlEntries<RefineryAttempt>(resolve("logs", "refinery.jsonl")),
  ]);

  return pickRefineryTargets({
    dreams: dreamJournal.dreams,
    portfolio,
    attempts,
    current_iteration: currentIteration,
    config,
  });
}

export async function getRefineryFuelStatus(
  currentIteration: number,
  config?: Partial<RefineryConfig>,
): Promise<RefineryFuelStatus> {
  const [dreamJournal, portfolio, attempts] = await Promise.all([
    loadDreamJournal(),
    loadPortfolioCandidates(),
    readJsonlEntries<RefineryAttempt>(resolve("logs", "refinery.jsonl")),
  ]);

  return getRefineryFuelStatusFromSources({
    dreams: dreamJournal.dreams,
    portfolio,
    attempts,
    current_iteration: currentIteration,
    config,
  });
}

export async function getLastRefineryIteration(): Promise<number | null> {
  const attempts = await readJsonlEntries<RefineryAttempt>(resolve("logs", "refinery.jsonl"));
  const iterations = attempts
    .map((attempt) => attempt.iteration)
    .filter((iteration): iteration is number => Number.isFinite(iteration));

  return iterations.length > 0 ? Math.max(...iterations) : null;
}
