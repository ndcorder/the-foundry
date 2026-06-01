import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import { resolve } from "../root.js";
import type { CriticGate1Evaluation, IdeatorProposal } from "../types/index.js";
import type { SpeculativeConfig, SpeculativeIdea, SpeculativeStore } from "./types.js";

const SPECULATIVE_PATH = "workspace/speculative.yml";

export const DEFAULT_SPECULATIVE_CONFIG: SpeculativeConfig = {
  enabled: true,
  max_carried_ideas: 2,
};

const SALVAGEABLE_REJECT_PATTERNS = [
  "vague",
  "generic",
  "underspecified",
  "under-specified",
  "thin",
  "pitch",
  "sharpen",
  "unclear",
  "needs focus",
];

const FUNDAMENTAL_REJECT_PATTERNS = [
  "fundamental",
  "derivative",
  "too similar",
  "stale",
  "impossible",
  "not interesting",
  "no clear value",
  "bad fit",
];

function configWithDefaults(config?: Partial<SpeculativeConfig>): SpeculativeConfig {
  return { ...DEFAULT_SPECULATIVE_CONFIG, ...config };
}

function includesAny(text: string, patterns: string[]): boolean {
  const lowered = text.toLowerCase();
  return patterns.some((pattern) => lowered.includes(pattern));
}

export function isSalvageableEvaluation(
  evaluation: Pick<CriticGate1Evaluation, "decision" | "reasons" | "sharpening_notes">,
): boolean {
  if (evaluation.decision === "approve" || evaluation.decision === "revise") return true;
  if (evaluation.decision !== "reject") return false;

  const text = `${evaluation.reasons ?? ""} ${evaluation.sharpening_notes ?? ""}`;
  if (includesAny(text, FUNDAMENTAL_REJECT_PATTERNS)) return false;
  return includesAny(text, SALVAGEABLE_REJECT_PATTERNS);
}

export function buildSpeculativeIdeas(
  proposals: IdeatorProposal[],
  evaluations: CriticGate1Evaluation[],
  selectedTitle: string | null | undefined,
  iteration: number,
  configInput?: Partial<SpeculativeConfig>,
): SpeculativeIdea[] {
  const config = configWithDefaults(configInput);
  if (!config.enabled) return [];

  const selected = selectedTitle?.trim() ?? "";
  const proposalsByTitle = new Map(proposals.map((proposal) => [proposal.title, proposal]));
  const ideas: SpeculativeIdea[] = [];

  for (const evaluation of evaluations) {
    if (selected && evaluation.title === selected) continue;
    if (!isSalvageableEvaluation(evaluation)) continue;

    const proposal = proposalsByTitle.get(evaluation.title);
    if (!proposal) continue;

    ideas.push({
      proposal,
      critic_evaluation: {
        decision: evaluation.decision,
        reasons: evaluation.reasons,
        sharpening_notes: evaluation.sharpening_notes,
      },
      iteration,
      salvageable: true,
    });
  }

  return ideas.slice(0, Math.max(0, config.max_carried_ideas));
}

export async function saveSpeculativeIdeas(ideas: SpeculativeIdea[]): Promise<void> {
  const filePath = resolve(SPECULATIVE_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  const store: SpeculativeStore = {
    ideas,
    updated_at: new Date().toISOString(),
  };
  await writeFile(filePath, yaml.stringify(store, { lineWidth: 120 }), "utf-8");
}

export async function loadSpeculativeIdeas(): Promise<SpeculativeIdea[]> {
  try {
    const content = await readFile(resolve(SPECULATIVE_PATH), "utf-8");
    const parsed = yaml.parse(content) as Partial<SpeculativeStore> | null;
    return parsed?.ideas ?? [];
  } catch {
    return [];
  }
}

export async function clearSpeculativeIdeas(): Promise<void> {
  try {
    await unlink(resolve(SPECULATIVE_PATH));
  } catch {
    // already clear
  }
}

export function filterCurrentSpeculativeIdeas(
  ideas: SpeculativeIdea[],
  targetIteration?: number,
): SpeculativeIdea[] {
  if (targetIteration == null) return ideas;
  const sourceIteration = targetIteration - 1;
  return ideas.filter((idea) => idea.iteration === sourceIteration);
}

export function formatSpeculativeIdeas(
  ideas: SpeculativeIdea[],
  options?: { last_outcome?: string },
): string {
  if (ideas.length === 0) return "";

  const fastTrack = options?.last_outcome === "killed";
  const lines = ideas.map((entry) => {
    const notes = entry.critic_evaluation.sharpening_notes
      ? ` Sharpening notes: ${entry.critic_evaluation.sharpening_notes}`
      : "";
    return [
      `- **${entry.proposal.title}** [${entry.proposal.domain}, ${entry.proposal.complexity}]`,
      `  Pitch: ${entry.proposal.pitch}`,
      `  Critic: ${entry.critic_evaluation.decision} — ${entry.critic_evaluation.reasons || "no reason given"}.${notes}`,
    ].join("\n");
  });

  return [
    fastTrack ? "## Fast-Track Options" : "## Salvaged Ideas from Last Iteration",
    "",
    fastTrack
      ? "The last iteration was killed. Here are pre-validated alternatives from the last Gate 1 slate. Strongly consider refining one of these."
      : "The Critic did not select these ideas last round, but they still had kernels worth revisiting. You may refine one or ignore them.",
    "",
    ...lines,
  ].join("\n");
}

export type { SpeculativeConfig, SpeculativeIdea, SpeculativeStore } from "./types.js";
