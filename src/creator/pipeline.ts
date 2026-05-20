import type {
  FoundryConfig,
  ModelsConfig,
  IdeatorProposal,
  CreatorResponse,
  CreatorFile,
} from "../types/index.js";
import { getComplexityProfile, type PhaseKind } from "./profiles.js";
import { dispatchCreator } from "../agents/index.js";
import {
  dispatchPlan,
  dispatchBuild,
  dispatchRevise,
  dispatchPolish,
  dispatchAssemble,
  type CreatorPlan,
} from "./phases.js";

interface PipelineContext {
  config: FoundryConfig;
  models: ModelsConfig;
  iteration: number;
}

interface PipelineResult {
  artifact: CreatorResponse;
  usage: { input: number; output: number };
  phasesRun: string[];
  phaseTokens: Record<string, number>;
}

export async function runCreatorPipeline(
  ctx: PipelineContext,
  proposal: IdeatorProposal,
  criticNotes: string,
  revisionNotes?: string,
): Promise<PipelineResult> {
  const profile = getComplexityProfile(proposal.complexity, ctx.config);

  // S complexity: delegate to existing single-shot Creator
  if (proposal.complexity === "S" || profile.phases.length === 1) {
    const result = await dispatchCreator(
      ctx.config, ctx.models, ctx.iteration, proposal, criticNotes, revisionNotes,
    );
    return {
      artifact: result.data,
      usage: result.usage,
      phasesRun: ["build"],
      phaseTokens: { build: result.usage.output },
    };
  }

  // M/L/XL: run phase pipeline
  const totalUsage = { input: 0, output: 0 };
  const phasesRun: string[] = [];
  const phaseTokens: Record<string, number> = {};
  let plan: CreatorPlan | null = null;
  let files: CreatorFile[] = [];
  let buildIndex = 0;

  for (const phase of profile.phases) {
    const phaseName = phase === "build" ? `build-${++buildIndex}` : phase;

    try {
      const result = await runPhase(
        ctx, phase, phaseName, proposal, criticNotes,
        plan, files, profile.maxTokensPerPhase, revisionNotes,
      );

      totalUsage.input += result.usage.input;
      totalUsage.output += result.usage.output;
      phasesRun.push(phaseName);
      phaseTokens[phaseName] = result.usage.output;

      if (result.plan) plan = result.plan;
      if (result.files.length > 0) files = mergeFiles(files, result.files);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  [creator-${phaseName}] Phase failed: ${msg}`);

      if (phase === "plan") {
        console.warn("  [creator] Plan phase failed — falling back to S-tier.");
        const fallback = await dispatchCreator(
          ctx.config, ctx.models, ctx.iteration, proposal, criticNotes, revisionNotes,
        );
        return {
          artifact: fallback.data,
          usage: { input: totalUsage.input + fallback.usage.input, output: totalUsage.output + fallback.usage.output },
          phasesRun: [...phasesRun, "build-fallback"],
          phaseTokens: { ...phaseTokens, "build-fallback": fallback.usage.output },
        };
      }
      // For non-plan phases, skip and continue
    }
  }

  // Budget warning
  const totalOutput = Object.values(phaseTokens).reduce((a, b) => a + b, 0);
  if (totalOutput > profile.budgetWarningThreshold) {
    console.warn(
      `  [creator] Budget warning: ${totalOutput} output tokens exceeds threshold of ${profile.budgetWarningThreshold}`,
    );
  }

  return {
    artifact: { title: proposal.title, files, notes: plan?.approach },
    usage: totalUsage,
    phasesRun,
    phaseTokens,
  };
}

async function runPhase(
  ctx: PipelineContext,
  phase: PhaseKind,
  _phaseName: string,
  proposal: IdeatorProposal,
  criticNotes: string,
  plan: CreatorPlan | null,
  currentFiles: CreatorFile[],
  maxTokens: number,
  revisionNotes?: string,
): Promise<{ plan?: CreatorPlan; files: CreatorFile[]; usage: { input: number; output: number } }> {
  switch (phase) {
    case "plan": {
      const r = await dispatchPlan(ctx, proposal, criticNotes, maxTokens);
      return { plan: r.plan, files: [], usage: r.usage };
    }
    case "build": {
      const r = await dispatchBuild(ctx, proposal, criticNotes, plan, currentFiles, maxTokens);
      return { files: r.files, usage: r.usage };
    }
    case "revise": {
      const r = await dispatchRevise(ctx, proposal, criticNotes, plan, currentFiles, maxTokens, revisionNotes);
      return { files: r.files, usage: r.usage };
    }
    case "polish": {
      const r = await dispatchPolish(ctx, plan, currentFiles, maxTokens);
      return { files: r.files, usage: r.usage };
    }
    case "assemble": {
      const r = await dispatchAssemble(ctx, proposal, plan, currentFiles, maxTokens);
      return { files: r.files, usage: r.usage };
    }
  }
}

function mergeFiles(existing: CreatorFile[], incoming: CreatorFile[]): CreatorFile[] {
  const merged = new Map<string, CreatorFile>();
  for (const f of existing) merged.set(f.path, f);
  for (const f of incoming) merged.set(f.path, f);
  return [...merged.values()];
}
