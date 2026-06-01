import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import { resolve } from "../root.js";
import type {
  ComplexityAnalysisOptions,
  ComplexityBias,
  ComplexityConfig,
  ComplexityIterationEntry,
  ComplexityTier,
  ComplexityYield,
} from "./types.js";

const COMPLEXITY_BIAS_PATH = "identity/complexity-bias.yml";
const TIERS: ComplexityTier[] = ["S", "M", "L", "XL"];

export const DEFAULT_COMPLEXITY_CONFIG: ComplexityConfig = {
  yield_window: 20,
  min_samples_for_confidence: 3,
  high_confidence_samples: 5,
};

function configWithDefaults(options?: ComplexityAnalysisOptions): ComplexityConfig {
  return {
    yield_window: options?.window ?? DEFAULT_COMPLEXITY_CONFIG.yield_window,
    min_samples_for_confidence: options?.min_samples_for_confidence ?? DEFAULT_COMPLEXITY_CONFIG.min_samples_for_confidence,
    high_confidence_samples: options?.high_confidence_samples ?? DEFAULT_COMPLEXITY_CONFIG.high_confidence_samples,
  };
}

function round(value: number, digits: number = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseRating(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tokenCost(entry: ComplexityIterationEntry): number | null {
  if (!entry.token_usage) return null;
  const cost = entry.token_usage.input + entry.token_usage.output;
  return Number.isFinite(cost) && cost > 0 ? cost : null;
}

export function emptyComplexityBias(iteration: number = 0): ComplexityBias {
  return {
    updated_at: new Date().toISOString(),
    updated_iteration: iteration,
    yields: [],
    recommendation: {
      favor: "balanced",
      avoid: [],
      confidence: "low",
      reason: "Not enough shipped artifacts with ratings and token usage to estimate complexity yield.",
    },
  };
}

export function analyzeComplexityYield(
  entries: ComplexityIterationEntry[],
  currentIteration: number,
  options?: ComplexityAnalysisOptions,
): ComplexityBias {
  const config = configWithDefaults(options);
  const recent = entries.slice(-config.yield_window);
  const yields: ComplexityYield[] = [];

  for (const tier of TIERS) {
    const samples = recent.filter((entry) => {
      const entryTier = entry.complexity ?? "S";
      return entry.outcome === "shipped"
        && entryTier === tier
        && parseRating(entry.mean_rating) != null
        && tokenCost(entry) != null;
    });

    if (samples.length < config.min_samples_for_confidence) continue;

    const ratings = samples.map((entry) => parseRating(entry.mean_rating)!);
    const costs = samples.map((entry) => tokenCost(entry)!);
    const meanRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    const meanTokenCost = costs.reduce((a, b) => a + b, 0) / costs.length;
    yields.push({
      tier,
      shipped_count: samples.length,
      mean_rating: round(meanRating, 1),
      mean_token_cost: Math.round(meanTokenCost),
      roi: round(meanRating / (meanTokenCost / 1000), 2),
    });
  }

  yields.sort((a, b) => b.roi - a.roi);
  if (yields.length === 0) return emptyComplexityBias(currentIteration);

  const best = yields[0];
  const confidence = best.shipped_count >= config.high_confidence_samples ? "high" : "medium";
  const avoid = yields
    .filter((entry) => entry.tier !== best.tier && entry.roi < best.roi * 0.5)
    .map((entry) => entry.tier);

  return {
    updated_at: new Date().toISOString(),
    updated_iteration: currentIteration,
    yields,
    recommendation: {
      favor: best.tier,
      avoid,
      confidence,
      reason: `${best.tier} has the strongest recent rating-per-token yield (${best.roi.toFixed(2)} ROI across ${best.shipped_count} shipped artifacts).`,
    },
  };
}

function compactTokens(tokens: number): string {
  if (tokens >= 1000) {
    const value = tokens / 1000;
    return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}K`;
  }
  return `${tokens}`;
}

export function formatComplexityBias(bias: ComplexityBias): string {
  if (bias.recommendation.confidence === "low" || bias.yields.length === 0 || bias.recommendation.favor === "balanced") {
    return "";
  }

  const lines = bias.yields.map((entry) =>
    `- ${entry.tier}: avg ${entry.mean_rating.toFixed(1)} rating, ${compactTokens(entry.mean_token_cost)} tokens -> ROI ${entry.roi.toFixed(2)}`,
  );
  const favor = bias.recommendation.favor;
  const avoid = bias.recommendation.avoid.length > 0
    ? `\nAvoid ${bias.recommendation.avoid.map((tier) => `${tier}-tier`).join(", ")} unless the idea demands it.`
    : "";

  return [
    "## Complexity Guidance",
    "",
    `Recent yield analysis (updated at iteration ${bias.updated_iteration}):`,
    ...lines,
    "",
    `Recommendation: Lean toward ${favor}-tier artifacts when the idea can work at that scale. ${bias.recommendation.reason}${avoid}`,
  ].join("\n");
}

export async function saveComplexityBias(bias: ComplexityBias): Promise<void> {
  const filePath = resolve(COMPLEXITY_BIAS_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, yaml.stringify(bias, { lineWidth: 120 }), "utf-8");
}

export async function loadComplexityBias(): Promise<ComplexityBias> {
  try {
    const content = await readFile(resolve(COMPLEXITY_BIAS_PATH), "utf-8");
    const parsed = yaml.parse(content) as Partial<ComplexityBias> | null;
    if (!parsed) return emptyComplexityBias();
    return {
      ...emptyComplexityBias(),
      ...parsed,
      yields: parsed.yields ?? [],
      recommendation: {
        ...emptyComplexityBias().recommendation,
        ...parsed.recommendation,
      },
    };
  } catch {
    return emptyComplexityBias();
  }
}

export type {
  ComplexityAnalysisOptions,
  ComplexityBias,
  ComplexityConfig,
  ComplexityConfidence,
  ComplexityIterationEntry,
  ComplexityTier,
  ComplexityYield,
} from "./types.js";
