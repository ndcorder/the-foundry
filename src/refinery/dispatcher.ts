import type {
  CreatorResponse,
  FoundryConfig,
  ModelsConfig,
} from "../types/index.js";
import { callModel, type ModelCallResult } from "../model/index.js";
import {
  buildCorrectionPrompt,
  parseYaml,
  validateCreator,
} from "../parser/index.js";
import { injectVars, loadPrompt } from "../agents/prompt.js";
import type { RefineryTarget } from "./types.js";

interface RefineryDispatchResult {
  artifact: CreatorResponse;
  usage: { input: number; output: number };
  rawText: string;
}

const MAX_REFINERY_RETRIES = 2;
const MAX_SOURCE_CHARS = 12000;

function trimSource(content: string): string {
  if (content.length <= MAX_SOURCE_CHARS) return content;
  return content.slice(0, MAX_SOURCE_CHARS) + "\n[...source truncated]";
}

export function formatRefinerySourceContext(target: RefineryTarget): string {
  const lines = [
    "## Refinery Source",
    "",
    `Source type: ${target.source_type}`,
    `Source id: ${target.source_id}`,
    `Title: ${target.source_title}`,
    `Domain: ${target.source_domain}`,
    `Refinement type: ${target.refinement_type}`,
  ];

  if (target.original_rating !== undefined) {
    lines.push(`Original rating: ${target.original_rating}`);
  }
  if (target.resurrection_hint?.trim()) {
    lines.push(`Resurrection hint: ${target.resurrection_hint.trim()}`);
  }

  lines.push("", "## Original Material");
  lines.push(target.original_content?.trim()
    ? trimSource(target.original_content.trim())
    : "*No original material was available; infer cautiously from the metadata.*");

  return lines.join("\n");
}

export function formatRefinementInstructions(target: RefineryTarget): string {
  switch (target.refinement_type) {
    case "resurrected":
      return [
        "Resurrect this killed artifact by preserving the strongest surviving premise, voice, or mechanic.",
        "Do not merely repair the old artifact. Rebuild it as a fresh artifact that answers the resurrection hint.",
        "Keep the title lineage visible, but allow the final artifact to become stranger, sharper, or more complete than the source.",
      ].join("\n");
    case "remastered":
      return [
        "Remaster this low-rated artifact into a stronger portfolio candidate.",
        "Identify what likely held the original back, then produce a cleaner, more specific, and more memorable version.",
        "Preserve only the durable core; replace weak structure, vague language, or underdeveloped mechanics.",
      ].join("\n");
    case "companion":
      return [
        "Create a companion artifact that belongs beside the source without repeating it.",
        "Extend the source's strongest pattern into a new angle, adjacent tool, sequel, counterpoint, or supporting piece.",
        "The result must stand alone while making the original artifact feel more valuable in the portfolio.",
      ].join("\n");
  }
}

export async function dispatchRefinery(
  _config: FoundryConfig,
  models: ModelsConfig,
  iteration: number,
  target: RefineryTarget,
): Promise<RefineryDispatchResult> {
  const template = await loadPrompt("refinery");
  const systemPrompt = injectVars(template, {
    source_context: formatRefinerySourceContext(target),
    refinement_instructions: formatRefinementInstructions(target),
  });
  const agentConfig = { ...models.agents.creator, temperature: 0.5 };
  const usage = { input: 0, output: 0 };
  let lastText = "";

  for (let attempt = 0; attempt <= MAX_REFINERY_RETRIES; attempt++) {
    const userMessage = attempt === 0
      ? "Begin."
      : buildCorrectionPrompt(lastText, "YAML validation failed.", "creator");
    const result: ModelCallResult = await callModel(
      agentConfig,
      systemPrompt,
      userMessage,
      iteration,
      attempt === 0 ? "refinery" : `refinery-retry${attempt}`,
    );

    usage.input += result.usage.input;
    usage.output += result.usage.output;
    lastText = result.text;

    try {
      const artifact = parseYaml<CreatorResponse>(result.text);
      if (validateCreator(artifact)) {
        return { artifact, usage, rawText: result.text };
      }
    } catch {
      // Retry below with the correction prompt.
    }
  }

  throw new Error(`[refinery] Failed to get valid creator YAML after ${MAX_REFINERY_RETRIES + 1} attempts`);
}
