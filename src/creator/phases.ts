import type {
  FoundryConfig,
  ModelsConfig,
  IdeatorProposal,
  CreatorFile,
} from "../types/index.js";
import { callModel } from "../model/index.js";
import {
  parseYaml,
  buildCorrectionPrompt,
  validateCreatorPlan,
  validateCreatorBuild,
  type CreatorPlan,
  type CreatorPlanResponse,
  type CreatorBuildResponse,
} from "../parser/index.js";
import { loadCreatorPhasePrompt, injectVars } from "../agents/prompt.js";
import { buildSharedContext } from "../context/index.js";
import { safeRead } from "../context/data.js";
import { resolve } from "../root.js";
import { formatStreakContext, loadStreakHistory } from "../streaks/index.js";
import { getProjectContext } from "../files/projects.js";

export type { CreatorPlan };

interface PhaseContext {
  config: FoundryConfig;
  models: ModelsConfig;
  iteration: number;
}

const MAX_PHASE_RETRIES = 2;

async function callPhase<T>(
  ctx: PhaseContext,
  systemPrompt: string,
  agentName: string,
  maxTokens: number,
  validator: (data: unknown) => data is T,
  schemaKey?: string,
): Promise<{ data: T; usage: { input: number; output: number } }> {
  const agentConfig = { ...ctx.models.agents.creator, max_tokens: maxTokens };
  let totalUsage = { input: 0, output: 0 };
  let lastText = "";

  for (let attempt = 0; attempt <= MAX_PHASE_RETRIES; attempt++) {
    const userMessage = attempt === 0
      ? "Begin."
      : buildCorrectionPrompt(lastText, "YAML validation failed.", schemaKey);

    const result = await callModel(
      agentConfig, systemPrompt, userMessage, ctx.iteration, agentName,
    );
    totalUsage.input += result.usage.input;
    totalUsage.output += result.usage.output;
    lastText = result.text;

    try {
      const data = parseYaml<T>(result.text);
      if (validator(data)) return { data, usage: totalUsage };
    } catch {
      // retry
    }
  }
  throw new Error(`[${agentName}] Failed after ${MAX_PHASE_RETRIES + 1} attempts`);
}

function serializeFiles(files: CreatorFile[]): string {
  if (files.length === 0) return "*No files built yet.*";
  return files.map((f) => `### ${f.path}\n\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n");
}

function extractQualityStandards(manifesto: string): string {
  const sections = ["What We Value", "What We Avoid", "Our Aesthetic"];
  const lines = manifesto.split("\n");
  const extracted: string[] = [];
  let capturing = false;
  for (const line of lines) {
    if (line.startsWith("## ")) capturing = sections.some((s) => line.includes(s));
    if (capturing) extracted.push(line);
  }
  return extracted.length > 0 ? extracted.join("\n") : manifesto;
}

async function loadProjectContextForProposal(proposal: IdeatorProposal): Promise<string> {
  if (!proposal.project_id) return "*No project context (standalone artifact).*";
  const projectContext = await getProjectContext(proposal.project_id);
  return projectContext.trim() || `*Project context unavailable for ${proposal.project_id}; treat as a standalone artifact.*`;
}

// ── Plan ──────────────────────────────────────────────────────

export async function dispatchPlan(
  ctx: PhaseContext,
  proposal: IdeatorProposal,
  criticNotes: string,
  maxTokens: number,
): Promise<{ plan: CreatorPlan; usage: { input: number; output: number } }> {
  const shared = await buildSharedContext(ctx.config);
  const manifesto = await safeRead(resolve("identity", "manifesto.md"));
  const template = await loadCreatorPhasePrompt("plan");
  const streakContext = formatStreakContext(
    await loadStreakHistory(),
    "creator",
    ctx.config.streaks,
  );
  const projectContext = await loadProjectContextForProposal(proposal);

  const proposalText = [
    `**${proposal.title}** [${proposal.domain}, ${proposal.complexity}]`,
    "", proposal.pitch, "", `Why: ${proposal.why}`,
  ].join("\n");

  const basePrompt = injectVars(template, {
    shared_context: shared,
    approved_proposal: proposalText,
    critic_sharpening_notes: criticNotes || "*No sharpening notes.*",
    project_context: projectContext,
    manifesto_quality_standards: extractQualityStandards(manifesto),
    streak_context: streakContext,
  });
  const prompt = streakContext ? `${basePrompt}\n\n${streakContext}` : basePrompt;

  const result = await callPhase<CreatorPlanResponse>(
    ctx, prompt, "creator-plan", maxTokens, validateCreatorPlan, "creator-plan",
  );

  // Normalize missing build_order
  if (!result.data.plan.build_order || result.data.plan.build_order.length === 0) {
    result.data.plan.build_order = [
      result.data.plan.file_manifest.map((f) => f.path),
    ];
  }

  return { plan: result.data.plan, usage: result.usage };
}

// ── Build ─────────────────────────────────────────────────────

export async function dispatchBuild(
  ctx: PhaseContext,
  proposal: IdeatorProposal,
  criticNotes: string,
  plan: CreatorPlan | null,
  priorFiles: CreatorFile[],
  maxTokens: number,
): Promise<{ files: CreatorFile[]; usage: { input: number; output: number } }> {
  const template = await loadCreatorPhasePrompt("build");

  // Determine which files to build this call
  const builtPaths = new Set(priorFiles.map((f) => f.path));
  let batchFiles: string[] = [];
  if (plan?.build_order) {
    for (const batch of plan.build_order) {
      if (batch.some((p) => !builtPaths.has(p))) {
        batchFiles = batch.filter((p) => !builtPaths.has(p));
        break;
      }
    }
  }
  if (batchFiles.length === 0 && plan?.file_manifest) {
    batchFiles = plan.file_manifest
      .map((f) => f.path)
      .filter((p) => !builtPaths.has(p));
  }

  const planYaml = plan
    ? `Approach: ${plan.approach}\n\nFile manifest:\n${plan.file_manifest.map((f) => `- ${f.path}: ${f.purpose}`).join("\n")}`
    : "*No plan available.*";

  const prompt = injectVars(template, {
    plan: planYaml,
    approved_proposal_brief: `**${proposal.title}** [${proposal.domain}]: ${proposal.pitch}`,
    critic_sharpening_notes_brief: criticNotes ? criticNotes.slice(0, 500) : "",
    prior_files: serializeFiles(priorFiles),
    build_batch: batchFiles.join(", ") || "additional supporting files, examples, tests, docs, or sections that make the artifact more complete",
  });

  const result = await callPhase<CreatorBuildResponse>(
    ctx, prompt, `creator-build`, maxTokens, validateCreatorBuild, "creator-build",
  );
  return { files: result.data.files as CreatorFile[], usage: result.usage };
}

// ── Revise ────────────────────────────────────────────────────

export async function dispatchRevise(
  ctx: PhaseContext,
  proposal: IdeatorProposal,
  criticNotes: string,
  plan: CreatorPlan | null,
  allFiles: CreatorFile[],
  maxTokens: number,
  revisionNotes?: string,
): Promise<{ files: CreatorFile[]; usage: { input: number; output: number } }> {
  const manifesto = await safeRead(resolve("identity", "manifesto.md"));
  const template = await loadCreatorPhasePrompt("revise");

  let prompt = injectVars(template, {
    approved_proposal_brief: `**${proposal.title}** [${proposal.domain}]: ${proposal.pitch}`,
    critic_sharpening_notes: criticNotes || "*No sharpening notes.*",
    key_decisions: plan?.key_decisions?.join("\n") ?? "*No key decisions recorded.*",
    manifesto_quality_standards: extractQualityStandards(manifesto),
    all_files: serializeFiles(allFiles),
  });

  if (revisionNotes) {
    prompt += "\n\n## Revision Required\n\n" + revisionNotes;
  }

  const result = await callPhase<CreatorBuildResponse>(
    ctx, prompt, "creator-revise", maxTokens, validateCreatorBuild, "creator-build",
  );
  return { files: result.data.files as CreatorFile[], usage: result.usage };
}

// ── Polish ────────────────────────────────────────────────────

export async function dispatchPolish(
  ctx: PhaseContext,
  plan: CreatorPlan | null,
  revisedFiles: CreatorFile[],
  maxTokens: number,
): Promise<{ files: CreatorFile[]; usage: { input: number; output: number } }> {
  const template = await loadCreatorPhasePrompt("polish");
  const prompt = injectVars(template, {
    key_decisions: plan?.key_decisions?.join("\n") ?? "*No key decisions recorded.*",
    revised_files: serializeFiles(revisedFiles),
  });

  const result = await callPhase<CreatorBuildResponse>(
    ctx, prompt, "creator-polish", maxTokens, validateCreatorBuild, "creator-build",
  );
  return { files: result.data.files as CreatorFile[], usage: result.usage };
}

// ── Assemble (XL only) ───────────────────────────────────────

export async function dispatchAssemble(
  ctx: PhaseContext,
  proposal: IdeatorProposal,
  plan: CreatorPlan | null,
  allFiles: CreatorFile[],
  maxTokens: number,
): Promise<{ files: CreatorFile[]; usage: { input: number; output: number } }> {
  const template = await loadCreatorPhasePrompt("assemble");
  const manifest = plan?.file_manifest
    ?.map((f) => `- ${f.path}: ${f.purpose}`)
    .join("\n") ?? "*No manifest.*";

  const prompt = injectVars(template, {
    file_manifest: manifest,
    approved_proposal_brief: `**${proposal.title}** [${proposal.domain}]: ${proposal.pitch}`,
    all_files: serializeFiles(allFiles),
  });

  const result = await callPhase<CreatorBuildResponse>(
    ctx, prompt, "creator-assemble", maxTokens, validateCreatorBuild, "creator-build",
  );
  return { files: result.data.files as CreatorFile[], usage: result.usage };
}
