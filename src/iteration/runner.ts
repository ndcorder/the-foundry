import yaml from "yaml";
import type {
  FoundryConfig,
  ModelsConfig,
  IdeatorProposal,
  IdeatorResponse,
  CriticGate1Response,
  CreatorResponse,
  TesterResponse,
  CriticGate2Response,
  IterationResult,
} from "../types/index.js";
import { formatMeanCriticRating, meetsCriticShipThreshold } from "../critic/ratings.js";
import {
  dispatchIdeator,
  dispatchCriticGate1,
  dispatchCreator,
  dispatchTesterTestPlan,
  dispatchTesterLightweight,
  dispatchTesterVerdict,
  dispatchCriticGate2,
  dispatchCuratorRedirect,
} from "../agents/index.js";
import { runCreatorPipeline } from "../creator/index.js";
import {
  isCodeDomain,
  getNextArtifactId,
  writeArtifact,
  updatePortfolioIndex,
  writeKilledArtifact,
  clearWorkspace,
  writeWorkspaceFile,
} from "../files/index.js";
import { appendJournal } from "../files/journal.js";
import { checkStopFile, readRequests, clearRequests } from "../files/intervention.js";
import { logEvent, logIteration, logRefinery, logTestReport } from "../logging/index.js";
import { createSandbox, type SandboxSession } from "../sandbox/index.js";
import { Mutex } from "../pool/mutex.js";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { updateProjectStatus, linkArtifactToProject, getActiveProjects, countActiveProjects, createProject } from "../files/projects.js";
import { buildLineageGraph, saveLineageGraph } from "../lineage/index.js";
import { extractDreamFromKill, addDream } from "../dreams/index.js";
import { computeMood, saveMood } from "../mood/index.js";
import { loadStreakHistory, saveStreakHistory, updateStreakState, type StreakHistory, type StreakIterationResult } from "../streaks/index.js";
import { clearConsumedStokerDirective, loadStokerDirective, saveStokerDirective, type StokerDirective } from "../stoker/index.js";
import { buildSpeculativeIdeas, clearSpeculativeIdeas, saveSpeculativeIdeas, type SpeculativeIdea } from "../speculative/index.js";
import { dispatchRefinery, selectRefineryTargets, type RefineryTarget } from "../refinery/index.js";
import { readJsonlEntries } from "../context/data.js";
import { resolve } from "../root.js";

const execFile = promisify(execFileCb);
const portfolioBookkeepingMutex = new Mutex();
const COMPLEXITY_TIERS: ReadonlySet<IdeatorProposal["complexity"]> = new Set<IdeatorProposal["complexity"]>(["S", "M", "L", "XL"]);

interface IterationContext {
  config: FoundryConfig;
  models: ModelsConfig;
  iteration: number;
}

type IterationLifecycleMode = "sequential" | "parallel";

type IterationLifecycleEvent =
  | "foundry_precheck_start"
  | "foundry_precheck_complete"
  | "foundry_precheck_failed"
  | "foundry_request_poll_start"
  | "foundry_request_poll_complete"
  | "foundry_request_poll_failed"
  | "foundry_stoker_directive_deferred"
  | "foundry_stoker_directive_defer_failed"
  | "foundry_stoker_directive_load_start"
  | "foundry_stoker_directive_load_complete"
  | "foundry_stoker_directive_load_failed"
  | "foundry_stoker_directive_stale_cleared"
  | "foundry_stoker_directive_stale_clear_failed"
  | "foundry_stoker_directive_consumed_cleared"
  | "foundry_stoker_directive_consumed_clear_failed"
  | "foundry_speculative_cleanup_start"
  | "foundry_speculative_cleanup_complete"
  | "foundry_speculative_cleanup_failed"
  | "foundry_speculative_carry_forward_start"
  | "foundry_speculative_carry_forward_complete"
  | "foundry_speculative_carry_forward_failed"
  | "foundry_streak_update_start"
  | "foundry_streak_update_complete"
  | "foundry_streak_update_failed"
  | "foundry_complexity_recommendation_applied"
  | "foundry_complexity_recommendation_ignored"
  | "foundry_lineage_rebuild_start"
  | "foundry_lineage_rebuild_complete"
  | "foundry_lineage_rebuild_failed"
  | "foundry_project_creation_start"
  | "foundry_project_creation_complete"
  | "foundry_project_creation_failed"
  | "foundry_project_creation_capped"
  | "foundry_project_creation_invalid"
  | "foundry_project_progress_start"
  | "foundry_project_progress_complete"
  | "foundry_project_progress_failed"
  | "foundry_project_milestone_reached"
  | "foundry_project_continuation_stale_cleared"
  | "foundry_dream_capture_start"
  | "foundry_dream_capture_complete"
  | "foundry_dream_capture_failed"
  | "foundry_refinery_start"
  | "foundry_refinery_complete"
  | "foundry_refinery_failed"
  | "foundry_ideation_start"
  | "foundry_ideation_complete"
  | "foundry_ideation_failed"
  | "foundry_idea_gate_start"
  | "foundry_idea_gate_complete"
  | "foundry_idea_gate_failed"
  | "foundry_human_redirect_start"
  | "foundry_human_redirect_complete"
  | "foundry_human_redirect_failed"
  | "foundry_deadlock_override_start"
  | "foundry_deadlock_override_complete"
  | "foundry_creator_phase_start"
  | "foundry_creator_phase_complete"
  | "foundry_creator_phase_failed"
  | "foundry_tester_phase_start"
  | "foundry_tester_phase_complete"
  | "foundry_tester_phase_failed"
  | "foundry_artifact_gate_start"
  | "foundry_artifact_gate_complete"
  | "foundry_artifact_gate_failed"
  | "foundry_workspace_stage_start"
  | "foundry_workspace_stage_complete"
  | "foundry_workspace_stage_failed"
  | "foundry_bookkeeping_start"
  | "foundry_bookkeeping_complete"
  | "foundry_bookkeeping_failed";

export interface RunIterationOptions {
  lifecycle?: {
    mode: IterationLifecycleMode;
    concurrency: number;
    startIteration: number;
  };
}

type CreatorPipelineResult = Awaited<ReturnType<typeof runCreatorPipeline>>;
type IdeatorDispatchResult = Awaited<ReturnType<typeof dispatchIdeator>>;
type CriticGate1DispatchResult = Awaited<ReturnType<typeof dispatchCriticGate1>>;
type CriticGate2DispatchResult = Awaited<ReturnType<typeof dispatchCriticGate2>>;
type CreatorLifecycleStage = "creation" | "test_fix";
type WorkspaceStageReason = "creation" | "test_fix";
type TokenUsage = { input: number; output: number };
type TesterLifecycleMode = "code_sandbox" | "code_plan" | "lightweight" | "lightweight_fallback";
type PlannedTesterLifecycleMode = "code_sandbox" | "lightweight";

interface TesterPhaseResult {
  report: TesterResponse;
  usage: TokenUsage;
  testerMode: TesterLifecycleMode;
}

interface IdeationPhaseResult {
  ideatorResults: IdeatorDispatchResult[];
  ideas: IdeatorProposal[];
  usage: TokenUsage;
  burstFailures: string[];
}

type IdeaGateLifecycleSource = "ideator" | "human_redirect";

function serializeArtifact(files: Array<{ path: string; content: string }>): string {
  return files
    .map((f) => `### ${f.path}\n\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");
}

function proposalToYaml(p: IdeatorProposal): string {
  return yaml.stringify({ ideas: [p] });
}

function humanRedirectProposalToYaml(request: string, proposal: IdeatorProposal): string {
  return yaml.stringify({
    human_redirect: {
      request,
      critic_instruction: "Evaluate charitably because this came from a human redirect, but do not bypass Gate 1 quality control.",
    },
    ideas: [proposal],
  });
}

function refineryProposalToYaml(proposal: IdeatorProposal, target: RefineryTarget): string {
  return yaml.stringify({
    ideas: [proposal],
    refinery_source: {
      source_type: target.source_type,
      source_id: target.source_id,
      source_title: target.source_title,
      refinement_type: target.refinement_type,
      original_rating: target.original_rating ?? null,
    },
  });
}

function refinedTitle(title: string): string {
  return title.includes("[refined]") ? title : `${title} [refined]`;
}

function refineryProposalFromTarget(target: RefineryTarget): IdeatorProposal {
  const sourceLabel = `${target.source_type} #${target.source_id}`;
  return {
    title: refinedTitle(target.source_title),
    domain: target.source_domain,
    pitch: `Refinery ${target.refinement_type} pass for ${sourceLabel}: ${target.source_title}. ${target.resurrection_hint ?? "Use the source material and Critic hindsight to produce a stronger standalone artifact."}`,
    complexity: "M",
    why: `Stoker queued refinery fuel from ${sourceLabel}.`,
    project_id: null,
    stimulus_ref: `refinery:${target.source_type}:${target.source_id}`,
  };
}

function stokerDirectiveLogFields(
  directive: StokerDirective | null,
  iteration: number,
): Record<string, unknown> {
  const applied = directive?.for_iteration === iteration;
  return {
    stoker_directive_applied: applied,
    ...(applied ? {
      stoker_directive_rules: directive.rules_fired,
      stoker_directive_urgency: directive.urgency,
    } : {}),
  };
}

async function loadStokerDirectiveWithLifecycle(
  iteration: number,
  slot: number | undefined,
  lifecycle: RunIterationOptions["lifecycle"],
): Promise<StokerDirective | null> {
  const startedAtMs = Date.now();
  const lifecycleData = {
    iteration,
    slot: slot ?? null,
    stage: "stoker_directive_load",
  };
  await logIterationLifecycle(lifecycle, "foundry_stoker_directive_load_start", lifecycleData);

  try {
    const directive = await loadStokerDirective();
    await logIterationLifecycle(lifecycle, "foundry_stoker_directive_load_complete", {
      ...lifecycleData,
      result: directive ? "loaded" : "empty",
      directive_present: directive !== null,
      ...(directive ? {
        generated_iteration: directive.generated_iteration,
        for_iteration: directive.for_iteration,
        urgency: directive.urgency,
        rules_fired: directive.rules_fired,
        refinery_queue: directive.refinery_queue ?? 0,
      } : {}),
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });
    return directive;
  } catch (err) {
    await logIterationLifecycle(lifecycle, "foundry_stoker_directive_load_failed", {
      ...lifecycleData,
      result: "failed",
      detail: err instanceof Error ? err.message : String(err),
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });
    console.warn("  ⚠ Stoker directive read failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function clearStaleStokerDirectiveWithLifecycle(
  directive: StokerDirective | null,
  iteration: number,
  slot: number | undefined,
  lifecycle: RunIterationOptions["lifecycle"],
): Promise<boolean> {
  if (!directive || directive.for_iteration >= iteration) return false;

  const startedAtMs = Date.now();
  const lifecycleData = {
    iteration,
    slot: slot ?? null,
    stage: "stoker_directive_stale_cleanup",
    directive_for_iteration: directive.for_iteration,
    current_iteration: iteration,
    urgency: directive.urgency,
    rules_fired: directive.rules_fired,
    refinery_queue: directive.refinery_queue ?? 0,
  };

  try {
    await clearConsumedStokerDirective(iteration);
    await logIterationLifecycle(lifecycle, "foundry_stoker_directive_stale_cleared", {
      ...lifecycleData,
      result: "cleared",
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });
    console.log(`  Stale Stoker directive for iteration ${directive.for_iteration} cleared.`);
    return true;
  } catch (err) {
    await logIterationLifecycle(lifecycle, "foundry_stoker_directive_stale_clear_failed", {
      ...lifecycleData,
      result: "failed",
      detail: err instanceof Error ? err.message : String(err),
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });
    console.warn("  ⚠ Stale Stoker directive cleanup failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function logIterationLifecycle(
  lifecycle: RunIterationOptions["lifecycle"],
  event: IterationLifecycleEvent,
  data: Record<string, unknown>,
): Promise<void> {
  if (!lifecycle) return;

  try {
    await logEvent({
      ts: new Date().toISOString(),
      phase: "lifecycle",
      event,
      data: {
        mode: lifecycle.mode,
        concurrency: lifecycle.concurrency,
        start_iteration: lifecycle.startIteration,
        ...data,
      },
    });
  } catch (err) {
    console.warn("  ⚠ Iteration lifecycle event failed:", err instanceof Error ? err.message : String(err));
  }
}

function compactLifecyclePreview(raw: string, maxLength = 160): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function refineryLifecycleTargetData(
  iteration: number,
  slot: number | undefined,
  target: RefineryTarget,
  queueIndex: number,
  queuedJobs: number,
): Record<string, unknown> {
  return {
    iteration,
    slot: slot ?? null,
    queue_index: queueIndex,
    queued_jobs: queuedJobs,
    source_type: target.source_type,
    source_id: target.source_id,
    source_title: target.source_title,
    source_domain: target.source_domain,
    refinement_type: target.refinement_type,
    ...(target.original_rating !== undefined ? { original_rating: target.original_rating } : {}),
  };
}

function isComplexityTier(value: unknown): value is IdeatorProposal["complexity"] {
  return typeof value === "string" && COMPLEXITY_TIERS.has(value as IdeatorProposal["complexity"]);
}

function proposalMetadataIsConsistent(proposal: IdeatorProposal): boolean {
  const hasProjectBlock = proposal.project !== undefined && proposal.project !== null;

  if (proposal.xl_mode === "single") {
    return proposal.complexity === "XL" && !hasProjectBlock;
  }

  if (proposal.xl_mode === "project") {
    const hasStarterComplexity = proposal.complexity === "L" || proposal.complexity === "XL";
    const hasContinuationId = proposal.project_id !== undefined && proposal.project_id !== null;
    return hasStarterComplexity && !hasContinuationId && hasProjectBlock;
  }

  if (proposal.complexity === "XL") return false;
  return !hasProjectBlock;
}

function normalizeRecommendedComplexityProposal(proposal: IdeatorProposal): IdeatorProposal {
  if (proposal.complexity === "XL" && proposal.xl_mode === undefined && proposal.project === undefined) {
    return { ...proposal, xl_mode: "single" };
  }

  if (proposal.complexity !== "XL" && proposal.xl_mode === "single") {
    return { ...proposal, xl_mode: undefined };
  }

  return proposal;
}

function selectedGate1Approval(
  ideas: IdeatorProposal[],
  gate1: CriticGate1Response,
): { proposal: IdeatorProposal; evaluation: CriticGate1Response["evaluations"][number] } | null {
  const approvedEvaluations = gate1.evaluations.filter((e) => e.decision === "approve");
  const selectedTitle = typeof gate1.selected === "string" && gate1.selected.trim().length > 0
    ? gate1.selected.trim()
    : "";
  const approved = selectedTitle
    ? approvedEvaluations.find((e) => e.title === selectedTitle) ?? approvedEvaluations[0]
    : approvedEvaluations[0];

  if (!approved) return null;
  return {
    proposal: ideas.find((i) => i.title === approved.title) ?? ideas[0],
    evaluation: approved,
  };
}

function gate1RejectionReasons(gate1: CriticGate1Response): string {
  return gate1.evaluations
    .map((e) => `"${e.title}": ${e.reasons || "no reason given"}`)
    .join("; ");
}

function humanRedirectNotes(sharpeningNotes: string): string {
  const notes = sharpeningNotes.trim();
  return notes
    ? `Human redirect — evaluate charitably. ${notes}`
    : "Human redirect — evaluate charitably.";
}

function applyRecommendedComplexity(
  proposal: IdeatorProposal,
  recommended: unknown,
): { proposal: IdeatorProposal; applied: boolean; ignored: boolean } {
  if (!isComplexityTier(recommended) || recommended === proposal.complexity) {
    return { proposal, applied: false, ignored: false };
  }

  const candidate = normalizeRecommendedComplexityProposal({ ...proposal, complexity: recommended });
  if (!proposalMetadataIsConsistent(candidate)) {
    return { proposal, applied: false, ignored: true };
  }

  return { proposal: candidate, applied: true, ignored: false };
}

async function runIdeationPhaseWithLifecycle(input: {
  ctx: IterationContext;
  rejectionContext?: string;
  lifecycle?: RunIterationOptions["lifecycle"];
  slot?: number;
  ideaAttempt: number;
  maxAttempts: number;
  stokerLogFields: Record<string, unknown>;
}): Promise<IdeationPhaseResult> {
  const startedAtMs = Date.now();
  const burstCount = Math.max(1, input.ctx.config.iteration.ideation_burst_count ?? 1);
  const usage: TokenUsage = { input: 0, output: 0 };
  const lifecycleData: Record<string, unknown> = {
    iteration: input.ctx.iteration,
    slot: input.slot ?? null,
    stage: "ideation",
    attempt: input.ideaAttempt + 1,
    max_attempts: input.maxAttempts,
    retry: input.ideaAttempt > 0,
    burst_count: burstCount,
    ...(input.rejectionContext
      ? {
          rejection_context_preview: compactLifecyclePreview(input.rejectionContext),
          rejection_context_length: input.rejectionContext.length,
        }
      : {}),
    ...input.stokerLogFields,
  };

  await logIterationLifecycle(input.lifecycle, "foundry_ideation_start", lifecycleData);

  try {
    const settledIdeatorResults = await Promise.allSettled(
      Array.from({ length: burstCount }, (_, burstIndex) => {
        const burstDirection = burstCount > 1
          ? `Furnace ideation burst ${burstIndex + 1}/${burstCount}: generate a distinct full slate. Avoid duplicating obvious themes, domains, structures, or titles that sibling bursts are likely to produce. Bias toward L/XL work that can justify long planning, multiple build phases, testing, and review.`
          : undefined;
        return dispatchIdeator(
          input.ctx.config,
          input.ctx.models,
          input.ctx.iteration,
          input.rejectionContext,
          burstDirection,
        );
      }),
    );
    const ideatorResults: IdeatorDispatchResult[] = [];
    const burstFailures: string[] = [];

    for (const [burstIndex, result] of settledIdeatorResults.entries()) {
      if (result.status === "fulfilled") {
        ideatorResults.push(result.value);
        usage.input += result.value.usage.input;
        usage.output += result.value.usage.output;
      } else {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        burstFailures.push(`burst ${burstIndex + 1}/${burstCount}: ${msg}`);
        console.warn(`  [ideator] ${burstFailures[burstFailures.length - 1]}`);
      }
    }

    const ideas = ideatorResults.flatMap((result) => result.data.ideas);
    await logIterationLifecycle(input.lifecycle, "foundry_ideation_complete", {
      ...lifecycleData,
      result: ideas.length > 0 ? "proposed" : "empty",
      ideas_count: ideas.length,
      successful_bursts: ideatorResults.length,
      failed_bursts: burstFailures.length,
      ...(burstFailures.length > 0 ? { burst_failures: burstFailures } : {}),
      token_usage: { ...usage },
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });

    return { ideatorResults, ideas, usage, burstFailures };
  } catch (err) {
    await logIterationLifecycle(input.lifecycle, "foundry_ideation_failed", {
      ...lifecycleData,
      detail: err instanceof Error ? err.message : String(err),
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });
    throw err;
  }
}

async function runIdeaGateWithLifecycle(input: {
  ctx: IterationContext;
  ideas: IdeatorProposal[];
  proposalsYaml: string;
  source: IdeaGateLifecycleSource;
  lifecycle?: RunIterationOptions["lifecycle"];
  slot?: number;
  ideaAttempt?: number;
}): Promise<CriticGate1DispatchResult> {
  const startedAtMs = Date.now();
  const lifecycleData: Record<string, unknown> = {
    iteration: input.ctx.iteration,
    slot: input.slot ?? null,
    stage: "idea_gate",
    source: input.source,
    ...(input.ideaAttempt !== undefined ? { attempt: input.ideaAttempt + 1 } : {}),
    ideas_count: input.ideas.length,
    idea_titles: input.ideas.map((idea) => idea.title),
  };

  await logIterationLifecycle(input.lifecycle, "foundry_idea_gate_start", lifecycleData);

  try {
    const result = input.source === "human_redirect"
      ? await dispatchCriticGate1(input.ctx.config, input.ctx.models, input.ctx.iteration, input.proposalsYaml, "human_redirect")
      : await dispatchCriticGate1(input.ctx.config, input.ctx.models, input.ctx.iteration, input.proposalsYaml);
    const gate1 = result.data;
    const approved = selectedGate1Approval(input.ideas, gate1);
    const approvedCount = gate1.evaluations.filter((evaluation) => evaluation.decision === "approve").length;
    const rejectedCount = gate1.evaluations.filter((evaluation) => evaluation.decision === "reject").length;
    const reviseCount = gate1.evaluations.filter((evaluation) => evaluation.decision === "revise").length;

    await logIterationLifecycle(input.lifecycle, "foundry_idea_gate_complete", {
      ...lifecycleData,
      result: approved ? "approved" : "rejected",
      approved_count: approvedCount,
      rejected_count: rejectedCount,
      revise_count: reviseCount,
      selected_title: gate1.selected ?? approved?.proposal.title ?? null,
      token_usage: { ...result.usage },
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });

    return result;
  } catch (err) {
    await logIterationLifecycle(input.lifecycle, "foundry_idea_gate_failed", {
      ...lifecycleData,
      detail: err instanceof Error ? err.message : String(err),
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });
    throw err;
  }
}

async function runCreatorPipelineWithLifecycle(input: {
  ctx: IterationContext;
  proposal: IdeatorProposal;
  criticNotes: string;
  revisionNotes?: string;
  lifecycle?: RunIterationOptions["lifecycle"];
  slot?: number;
  stage: CreatorLifecycleStage;
  revisionRound: number;
  testFixCycle?: number;
}): Promise<CreatorPipelineResult> {
  const startedAtMs = Date.now();
  const trimmedRevisionNotes = input.revisionNotes?.trim() ?? "";
  const lifecycleData: Record<string, unknown> = {
    iteration: input.ctx.iteration,
    slot: input.slot ?? null,
    stage: input.stage,
    revision_round: input.revisionRound,
    title: input.proposal.title,
    domain: input.proposal.domain,
    complexity: input.proposal.complexity,
    project_id: input.proposal.project_id ?? null,
    revision_notes_present: trimmedRevisionNotes.length > 0,
    ...(input.testFixCycle !== undefined ? { test_fix_cycle: input.testFixCycle } : {}),
  };

  await logIterationLifecycle(input.lifecycle, "foundry_creator_phase_start", lifecycleData);

  try {
    const result = await runCreatorPipeline(
      { config: input.ctx.config, models: input.ctx.models, iteration: input.ctx.iteration },
      input.proposal,
      input.criticNotes,
      input.revisionNotes,
    );

    await logIterationLifecycle(input.lifecycle, "foundry_creator_phase_complete", {
      ...lifecycleData,
      artifact_title: result.artifact.title,
      file_count: result.artifact.files.length,
      phases_run: result.phasesRun,
      phase_tokens: result.phaseTokens,
      token_usage: { ...result.usage },
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });

    return result;
  } catch (err) {
    await logIterationLifecycle(input.lifecycle, "foundry_creator_phase_failed", {
      ...lifecycleData,
      detail: err instanceof Error ? err.message : String(err),
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });
    throw err;
  }
}

async function runTesterPhaseWithLifecycle(input: {
  ctx: IterationContext;
  proposal: IdeatorProposal;
  criticNotes: string;
  artifact: CreatorResponse;
  lifecycle?: RunIterationOptions["lifecycle"];
  slot?: number;
  testerMode: PlannedTesterLifecycleMode;
  revisionRound: number;
  testFixCycle: number;
}): Promise<TesterPhaseResult> {
  const startedAtMs = Date.now();
  const lifecycleData: Record<string, unknown> = {
    iteration: input.ctx.iteration,
    slot: input.slot ?? null,
    stage: "testing",
    tester_mode: input.testerMode,
    revision_round: input.revisionRound,
    test_fix_cycle: input.testFixCycle,
    title: input.proposal.title,
    domain: input.proposal.domain,
    complexity: input.proposal.complexity,
    project_id: input.proposal.project_id ?? null,
    artifact_title: input.artifact.title,
    file_count: input.artifact.files.length,
  };

  await logIterationLifecycle(input.lifecycle, "foundry_tester_phase_start", lifecycleData);

  try {
    const result = input.testerMode === "code_sandbox"
      ? await runCodeTests(input.ctx, input.proposal, input.criticNotes, input.artifact)
      : await runLightweightTests(input.ctx, input.proposal, input.criticNotes, input.artifact);

    await logIterationLifecycle(input.lifecycle, "foundry_tester_phase_complete", {
      ...lifecycleData,
      tester_mode: result.testerMode,
      verdict: result.report.verdict,
      summary_preview: compactLifecyclePreview(result.report.summary),
      tests_run_count: result.report.tests_run?.length ?? 0,
      issues_count: result.report.issues?.length ?? 0,
      token_usage: { ...result.usage },
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });

    return result;
  } catch (err) {
    await logIterationLifecycle(input.lifecycle, "foundry_tester_phase_failed", {
      ...lifecycleData,
      detail: err instanceof Error ? err.message : String(err),
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });
    throw err;
  }
}

async function runArtifactGateWithLifecycle(input: {
  ctx: IterationContext;
  proposal: IdeatorProposal;
  artifact: CreatorResponse;
  artifactContent: string;
  testerReport: TesterResponse | null;
  testerReportText: string;
  lifecycle?: RunIterationOptions["lifecycle"];
  slot?: number;
  revisionRound: number;
  testFixCycles: number;
}): Promise<CriticGate2DispatchResult> {
  const startedAtMs = Date.now();
  const lifecycleData: Record<string, unknown> = {
    iteration: input.ctx.iteration,
    slot: input.slot ?? null,
    stage: "artifact_gate",
    revision_round: input.revisionRound,
    test_fix_cycles: input.testFixCycles,
    title: input.proposal.title,
    domain: input.proposal.domain,
    complexity: input.proposal.complexity,
    project_id: input.proposal.project_id ?? null,
    artifact_title: input.artifact.title,
    file_count: input.artifact.files.length,
    tester_verdict: input.testerReport?.verdict ?? null,
  };

  await logIterationLifecycle(input.lifecycle, "foundry_artifact_gate_start", lifecycleData);

  try {
    const result = await dispatchCriticGate2(
      input.ctx.config,
      input.ctx.models,
      input.ctx.iteration,
      input.proposal,
      input.artifactContent,
      input.testerReportText,
    );
    const gate2 = result.data;

    await logIterationLifecycle(input.lifecycle, "foundry_artifact_gate_complete", {
      ...lifecycleData,
      decision: gate2.decision,
      mean_rating: formatMeanCriticRating(gate2.ratings),
      ship_threshold_met: meetsCriticShipThreshold(gate2.ratings),
      review_preview: compactLifecyclePreview(gate2.review),
      ...(gate2.kill_reason ? { kill_reason_preview: compactLifecyclePreview(gate2.kill_reason) } : {}),
      ...(gate2.revision_notes ? { revision_notes_preview: compactLifecyclePreview(gate2.revision_notes) } : {}),
      token_usage: { ...result.usage },
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });

    return result;
  } catch (err) {
    await logIterationLifecycle(input.lifecycle, "foundry_artifact_gate_failed", {
      ...lifecycleData,
      detail: err instanceof Error ? err.message : String(err),
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });
    throw err;
  }
}

async function stageArtifactWorkspaceWithLifecycle(input: {
  ctx: IterationContext;
  proposal: IdeatorProposal;
  artifact: CreatorResponse;
  lifecycle?: RunIterationOptions["lifecycle"];
  slot?: number;
  stageReason: WorkspaceStageReason;
  revisionRound: number;
  testFixCycle?: number;
}): Promise<void> {
  const startedAtMs = Date.now();
  const lifecycleData: Record<string, unknown> = {
    iteration: input.ctx.iteration,
    slot: input.slot ?? null,
    stage: "workspace_stage",
    stage_reason: input.stageReason,
    revision_round: input.revisionRound,
    ...(input.testFixCycle !== undefined ? { test_fix_cycle: input.testFixCycle } : {}),
    title: input.proposal.title,
    domain: input.proposal.domain,
    complexity: input.proposal.complexity,
    project_id: input.proposal.project_id ?? null,
    artifact_title: input.artifact.title,
    file_count: input.artifact.files.length,
    file_paths: input.artifact.files.map((file) => file.path),
  };

  await logIterationLifecycle(input.lifecycle, "foundry_workspace_stage_start", lifecycleData);

  try {
    await clearWorkspace(input.slot);
    for (const file of input.artifact.files) {
      await writeWorkspaceFile(file.path, file.content, input.slot);
    }
    await logIterationLifecycle(input.lifecycle, "foundry_workspace_stage_complete", {
      ...lifecycleData,
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });
  } catch (err) {
    await logIterationLifecycle(input.lifecycle, "foundry_workspace_stage_failed", {
      ...lifecycleData,
      detail: err instanceof Error ? err.message : String(err),
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });
    throw err;
  }
}

async function persistStreakResult(
  config: FoundryConfig,
  result: StreakIterationResult,
  input: {
    slot?: number;
    lifecycle?: RunIterationOptions["lifecycle"];
  } = {},
): Promise<StreakHistory | null> {
  const startedAtMs = Date.now();
  const lifecycleData = {
    iteration: result.iteration,
    slot: input.slot ?? null,
    stage: "streak_update",
    outcome: result.outcome,
    ...("artifact_id" in result && result.artifact_id ? { artifact_id: result.artifact_id } : {}),
    ...("title" in result && result.title ? { title: result.title } : {}),
    ...("domain" in result && result.domain ? { domain: result.domain } : {}),
    ...("mean_rating" in result ? { mean_rating: result.mean_rating } : {}),
    ...("reason" in result && result.reason ? { reason: compactLifecyclePreview(result.reason) } : {}),
  };
  await logIterationLifecycle(input.lifecycle, "foundry_streak_update_start", lifecycleData);

  try {
    const current = await loadStreakHistory();
    const next = updateStreakState(current, result, config.streaks);
    await saveStreakHistory(next);
    await logIterationLifecycle(input.lifecycle, "foundry_streak_update_complete", {
      ...lifecycleData,
      result: "saved",
      streak_current_domain: next.current?.domain ?? null,
      streak_current_length: next.current?.length ?? 0,
      cooldown_remaining: next.cooldown_remaining,
      cooldown_domains: next.cooldown_domains,
      recent_breaks: next.recent_breaks.length,
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });
    return next;
  } catch (err) {
    await logIterationLifecycle(input.lifecycle, "foundry_streak_update_failed", {
      ...lifecycleData,
      result: "failed",
      detail: err instanceof Error ? err.message : String(err),
      duration_ms: Math.max(0, Date.now() - startedAtMs),
    });
    console.warn("  ⚠ Streak update failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

async function clearConsumedDirective(
  iteration: number,
  input: {
    slot?: number;
    lifecycle?: RunIterationOptions["lifecycle"];
    directive?: StokerDirective | null;
  } = {},
): Promise<void> {
  const directive = input.directive ?? null;
  const auditCleanup = directive?.for_iteration === iteration;
  const startedAtMs = Date.now();
  const lifecycleData = auditCleanup ? {
    iteration,
    slot: input.slot ?? null,
    stage: "stoker_directive_consumed_cleanup",
    directive_for_iteration: directive.for_iteration,
    urgency: directive.urgency,
    rules_fired: directive.rules_fired,
    refinery_queue: directive.refinery_queue ?? 0,
  } : null;

  try {
    await clearConsumedStokerDirective(iteration);
    if (lifecycleData) {
      await logIterationLifecycle(input.lifecycle, "foundry_stoker_directive_consumed_cleared", {
        ...lifecycleData,
        result: "cleared",
        duration_ms: Math.max(0, Date.now() - startedAtMs),
      });
    }
  } catch (err) {
    if (lifecycleData) {
      await logIterationLifecycle(input.lifecycle, "foundry_stoker_directive_consumed_clear_failed", {
        ...lifecycleData,
        result: "failed",
        detail: err instanceof Error ? err.message : String(err),
        duration_ms: Math.max(0, Date.now() - startedAtMs),
      });
    }
    console.warn("  ⚠ Stoker directive cleanup failed:", err instanceof Error ? err.message : String(err));
  }
}

async function deferCurrentStokerDirective(
  directive: StokerDirective | null,
  iteration: number,
  input: {
    slot?: number;
    lifecycle?: RunIterationOptions["lifecycle"];
    requestContent: string;
    requestFile: string;
  },
): Promise<boolean> {
  if (!directive || directive.for_iteration !== iteration) return false;

  const lifecycleData = {
    iteration,
    slot: input.slot ?? null,
    stage: "stoker_directive",
    reason: "human_redirect",
    from_iteration: iteration,
    to_iteration: iteration + 1,
    urgency: directive.urgency,
    rules_fired: directive.rules_fired,
    refinery_queue: directive.refinery_queue ?? 0,
    request_file: input.requestFile,
    request_preview: compactLifecyclePreview(input.requestContent),
    request_length: input.requestContent.length,
  };

  try {
    await saveStokerDirective({
      ...directive,
      for_iteration: iteration + 1,
    });
    await logIterationLifecycle(input.lifecycle, "foundry_stoker_directive_deferred", {
      ...lifecycleData,
      result: "deferred",
    });
    console.log(`  Stoker directive deferred to iteration ${iteration + 1} while human redirect runs.`);
    return true;
  } catch (err) {
    await logIterationLifecycle(input.lifecycle, "foundry_stoker_directive_defer_failed", {
      ...lifecycleData,
      result: "failed",
      detail: err instanceof Error ? err.message : String(err),
    });
    console.warn("  ⚠ Stoker directive deferral failed:", err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function runQueuedRefineryJobs(
  ctx: IterationContext,
  slot: number | undefined,
  addUsage: (usage: { input: number; output: number }) => void,
  directive: StokerDirective | null,
  lifecycle?: RunIterationOptions["lifecycle"],
): Promise<void> {
  if (ctx.config.refinery?.enabled === false) return;

  if (!directive || directive.for_iteration !== ctx.iteration || !directive.refinery_queue || directive.refinery_queue <= 0) {
    return;
  }

  const targets = await selectRefineryTargets(ctx.iteration, ctx.config.refinery);
  const queue = Math.max(0, Math.min(directive.refinery_queue, targets.length));
  if (queue === 0) return;

  console.log(`\n▶ Background Refinery (${queue} queued)`);

  for (const [targetIndex, target] of targets.slice(0, queue).entries()) {
    const jobUsage = { input: 0, output: 0 };
    const addJobUsage = (usage: { input: number; output: number }): void => {
      jobUsage.input += usage.input;
      jobUsage.output += usage.output;
      addUsage(usage);
    };

    const proposal = refineryProposalFromTarget(target);
    let artifactId = "";
    const jobStartedAtMs = Date.now();
    const lifecycleTargetData = refineryLifecycleTargetData(ctx.iteration, slot, target, targetIndex + 1, queue);
    await logIterationLifecycle(lifecycle, "foundry_refinery_start", lifecycleTargetData);

    try {
      const refineryResult = await dispatchRefinery(ctx.config, ctx.models, ctx.iteration, target);
      addJobUsage(refineryResult.usage);
      const artifact: CreatorResponse = {
        ...refineryResult.artifact,
        title: refinedTitle(refineryResult.artifact.title || target.source_title),
      };
      const artifactContent = serializeArtifact(artifact.files);

      await clearWorkspace(slot);
      for (const f of artifact.files) {
        await writeWorkspaceFile(f.path, f.content, slot);
      }

      const testResult = await dispatchTesterLightweight(
        ctx.config,
        ctx.models,
        ctx.iteration,
        proposal,
        `Refinery source: ${target.source_type} #${target.source_id} — ${target.source_title}`,
        artifactContent,
      );
      addJobUsage(testResult.usage);

      await logTestReport({
        timestamp: new Date().toISOString(),
        iteration: ctx.iteration,
        artifact_id: "refinery-pending",
        outcome: testResult.data.verdict,
        summary: testResult.data.summary,
        tests_run: testResult.data.tests_run?.length ?? 0,
        tests_passed: testResult.data.tests_run?.filter((t) => t.result === "pass").length ?? 0,
        tests_failed: testResult.data.tests_run?.filter((t) => t.result === "fail").length ?? 0,
        details: testResult.data.tests_run?.map((t) => `${t.name}: ${t.result}`).join("; ") || "",
      });

      const testerReportText = yaml.stringify({
        verdict: testResult.data.verdict,
        summary: testResult.data.summary,
        tests_run: testResult.data.tests_run,
        issues: testResult.data.issues,
      });
      const gate2Result = await dispatchCriticGate2(
        ctx.config,
        ctx.models,
        ctx.iteration,
        proposal,
        artifactContent,
        testerReportText,
      );
      addJobUsage(gate2Result.usage);

      const releasePortfolioBookkeeping = await portfolioBookkeepingMutex.acquire();
      try {
        artifactId = await getNextArtifactId();
        const mean = formatMeanCriticRating(gate2Result.data.ratings);

        if (gate2Result.data.decision === "ship") {
          await writeArtifact({
            id: artifactId,
            title: artifact.title,
            domain: target.source_domain,
            files: artifact.files,
            review: gate2Result.data.review,
            ratings: gate2Result.data.ratings,
            testerReport: `**Verdict:** ${testResult.data.verdict}\n**Summary:** ${testResult.data.summary}`,
            proposal: refineryProposalToYaml(proposal, target),
            refinery: {
              source_type: target.source_type,
              source_id: target.source_id,
              source_title: target.source_title,
              refinement_type: target.refinement_type,
              original_rating: target.original_rating,
            },
          });
          await updatePortfolioIndex(
            artifactId,
            artifact.title,
            target.source_domain,
            mean,
            undefined,
            { refined_from: target.source_id },
          );
          await appendJournal(
            `**Iteration ${ctx.iteration} — REFINED:** "${artifact.title}" from ${target.source_type} #${target.source_id}. ` +
            `Rating: ${mean}. Review: ${gate2Result.data.review.slice(0, 200)}. ` +
            `Token usage: ${jobUsage.input}in/${jobUsage.output}out.`,
          );
          await logRefinery({
            timestamp: new Date().toISOString(),
            iteration: ctx.iteration,
            source_type: target.source_type,
            source_id: target.source_id,
            source_title: target.source_title,
            source_domain: target.source_domain,
            refinement_type: target.refinement_type,
            result: "shipped",
            artifact_id: artifactId,
            title: artifact.title,
            mean_rating: mean,
            token_usage: jobUsage,
          });
          await logIterationLifecycle(lifecycle, "foundry_refinery_complete", {
            ...lifecycleTargetData,
            result: "shipped",
            artifact_id: artifactId,
            title: artifact.title,
            mean_rating: mean,
            token_usage: { ...jobUsage },
            duration_ms: Math.max(0, Date.now() - jobStartedAtMs),
          });
          console.log(`  ✓ Refined ${target.source_id} → ${artifactId}: "${artifact.title}"`);
        } else {
          const reason = gate2Result.data.kill_reason || gate2Result.data.revision_notes || gate2Result.data.review;
          await writeKilledArtifact(
            artifactId,
            artifact.title,
            target.source_domain,
            reason,
            refineryProposalToYaml(proposal, target),
          );
          const dreamStartedAtMs = Date.now();
          const dreamLifecycleData = {
            ...lifecycleTargetData,
            stage: "dream_capture",
            source: "refinery",
            outcome: "killed",
            artifact_id: artifactId,
            title: artifact.title,
            domain: target.source_domain,
            kill_reason_preview: compactLifecyclePreview(reason),
          };
          await logIterationLifecycle(lifecycle, "foundry_dream_capture_start", dreamLifecycleData);

          try {
            const dream = extractDreamFromKill(
              artifactId,
              artifact.title,
              target.source_domain,
              proposal.pitch,
              reason,
              gate2Result.data.review,
              ctx.iteration,
            );
            await addDream(dream);
            await logIterationLifecycle(lifecycle, "foundry_dream_capture_complete", {
              ...dreamLifecycleData,
              result: "recorded",
              resurrection_hint_preview: compactLifecyclePreview(dream.resurrection_hint),
              duration_ms: Math.max(0, Date.now() - dreamStartedAtMs),
            });
          } catch (err) {
            await logIterationLifecycle(lifecycle, "foundry_dream_capture_failed", {
              ...dreamLifecycleData,
              result: "failed",
              detail: err instanceof Error ? err.message : String(err),
              duration_ms: Math.max(0, Date.now() - dreamStartedAtMs),
            });
            console.warn("  ⚠ Refinery dream write failed:", err instanceof Error ? err.message : String(err));
          }
          await logRefinery({
            timestamp: new Date().toISOString(),
            iteration: ctx.iteration,
            source_type: target.source_type,
            source_id: target.source_id,
            source_title: target.source_title,
            source_domain: target.source_domain,
            refinement_type: target.refinement_type,
            result: "killed",
            artifact_id: artifactId,
            reason,
            token_usage: jobUsage,
          });
          await logIterationLifecycle(lifecycle, "foundry_refinery_complete", {
            ...lifecycleTargetData,
            result: "killed",
            artifact_id: artifactId,
            reason,
            token_usage: { ...jobUsage },
            duration_ms: Math.max(0, Date.now() - jobStartedAtMs),
          });
          console.log(`  ✗ Refinery killed ${target.source_id}: ${reason.slice(0, 80)}`);
        }
      } finally {
        releasePortfolioBookkeeping();
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`  ⚠ Refinery skipped ${target.source_id}: ${reason}`);
      await logRefinery({
        timestamp: new Date().toISOString(),
        iteration: ctx.iteration,
        source_type: target.source_type,
        source_id: target.source_id,
        source_title: target.source_title,
        source_domain: target.source_domain,
        refinement_type: target.refinement_type,
        result: "skipped",
        reason,
        token_usage: jobUsage,
      });
      await logIterationLifecycle(lifecycle, "foundry_refinery_failed", {
        ...lifecycleTargetData,
        result: "skipped",
        reason,
        detail: reason,
        token_usage: { ...jobUsage },
        duration_ms: Math.max(0, Date.now() - jobStartedAtMs),
      });
    }
  }
}

// ────────────────────────────────────────────────────────────
// Disk space check
// ────────────────────────────────────────────────────────────

async function checkDiskSpace(minGb: number): Promise<boolean> {
  try {
    const { stdout } = await execFile("df", ["-k", "."]);
    const lines = stdout.trim().split("\n");
    if (lines.length < 2) return false;
    const cols = lines[1].split(/\s+/);
    const availableKb = parseInt(cols[3], 10);
    if (isNaN(availableKb)) return false;
    return availableKb >= minGb * 1024 * 1024;
  } catch {
    /* v8 ignore next */
    return false;
  }
}

// ────────────────────────────────────────────────────────────
// Curator deadlock override
// ────────────────────────────────────────────────────────────

async function dispatchCuratorDeadlockOverride(
  config: FoundryConfig,
  models: ModelsConfig,
  iteration: number,
  lastRejectionContext: string,
): Promise<
  | { proposal: IdeatorProposal; notes: string; usage: { input: number; output: number } }
  | { error: string }
> {
  try {
    const prompt = `## Your Role

You are the Curator intervening in an ideation deadlock. The Ideator and Critic have failed to agree on any proposal after ${config.iteration.max_idea_retries} rounds.

## Rejected Proposals and Reasons

${lastRejectionContext}

## Your Task

Pick the BEST rejected idea — the one closest to being viable. Sharpen it: fix the Critic's objections, tighten the pitch, raise the ambition. Force it through.

Tag the title with [FORCED] at the end.

## Output Format

Respond with ONLY valid YAML:

\`\`\`yaml
proposal:
  title: "... [FORCED]"
  domain: "..."
  pitch: "..."
  complexity: "S|M|L"
  why: "Curator override — ..."
  project_id: null
  stimulus_ref: null
\`\`\`
`;

    const result = await dispatchCuratorRedirect(config, models, iteration, prompt);
    const proposal = result.data.proposal;
    /* v8 ignore next 3 */
    if (!proposal.title.includes("[FORCED]")) {
      proposal.title = `${proposal.title} [FORCED]`;
    }
    return {
      proposal,
      notes: "Curator deadlock override — evaluate charitably.",
      usage: result.usage,
    };
  } catch (err) { /* v8 ignore start */
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("  ⚠ Curator deadlock override failed:", msg);
    return { error: msg };
    /* v8 ignore stop */
  }
}

// ────────────────────────────────────────────────────────────
// Phase 4 — Testing
// ────────────────────────────────────────────────────────────

async function runCodeTests(
  ctx: IterationContext,
  proposal: IdeatorProposal,
  criticNotes: string,
  artifact: CreatorResponse,
): Promise<TesterPhaseResult> {
  const artifactContent = serializeArtifact(artifact.files);
  let totalUsage = { input: 0, output: 0 };

  const planResult = await dispatchTesterTestPlan(
    ctx.config, ctx.models, ctx.iteration, proposal, criticNotes, artifactContent,
  );
  totalUsage.input += planResult.usage.input;
  totalUsage.output += planResult.usage.output;

  const testPlan = planResult.data.test_plan;
  if (!testPlan) {
    return { report: planResult.data, usage: totalUsage, testerMode: "code_plan" };
  }

  let sandbox: SandboxSession | null = null;
  let executionOutput: string;
  let sandboxUnavailable = false;
  try {
    sandbox = await createSandbox({ timeoutMs: 90_000 });

    for (const f of artifact.files) {
      await sandbox.writeFile(f.path, f.content);
    }

    for (const f of testPlan.files) {
      await sandbox.writeFile(f.path, f.content);
    }

    for (const cmd of testPlan.setup_commands) {
      const setupResult = await sandbox.exec(cmd, 120_000);
      if (setupResult.exitCode !== 0) {
        executionOutput = `Setup command failed: ${cmd}\nExit code: ${setupResult.exitCode}\nStderr: ${setupResult.stderr}\nStdout: ${setupResult.stdout}`;
        break;
      }
    }

    if (!executionOutput!) {
      const testResult = await sandbox.exec(testPlan.run_command, 60_000);
      executionOutput = [
        `Exit code: ${testResult.exitCode}`,
        testResult.timedOut ? "TIMED OUT" : "",
        `Stdout:\n${testResult.stdout.slice(0, 4000)}`,
        `Stderr:\n${testResult.stderr.slice(0, 2000)}`,
        `Duration: ${testResult.durationMs}ms`,
      ].filter(Boolean).join("\n");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    executionOutput = `Sandbox error: ${msg}`;
    if (msg.includes("QEMU") || msg.includes("sandbox VM") || msg.includes("Failed to create sandbox")) {
      sandboxUnavailable = true;
    }
  } finally {
    if (sandbox) await sandbox.close();
  }

  if (sandboxUnavailable) {
    console.warn("  ⚠ Sandbox unavailable (QEMU not installed) — falling back to lightweight verification.");
    const fallbackResult = await runLightweightTests(ctx, proposal, criticNotes, artifact);
    return { ...fallbackResult, testerMode: "lightweight_fallback" };
  }

  const verdictResult = await dispatchTesterVerdict(
    ctx.config, ctx.models, ctx.iteration, proposal, artifactContent, executionOutput!,
  );
  totalUsage.input += verdictResult.usage.input;
  totalUsage.output += verdictResult.usage.output;

  return { report: verdictResult.data, usage: totalUsage, testerMode: "code_sandbox" };
}

async function runLightweightTests(
  ctx: IterationContext,
  proposal: IdeatorProposal,
  criticNotes: string,
  artifact: CreatorResponse,
): Promise<TesterPhaseResult> {
  const artifactContent = serializeArtifact(artifact.files);

  const result = await dispatchTesterLightweight(
    ctx.config, ctx.models, ctx.iteration, proposal, criticNotes, artifactContent,
  );

  return { report: result.data, usage: result.usage, testerMode: "lightweight" };
}

// ────────────────────────────────────────────────────────────
// Main iteration
// ────────────────────────────────────────────────────────────

export async function runIteration(
  config: FoundryConfig,
  models: ModelsConfig,
  iteration: number,
  slot?: number,
  options: RunIterationOptions = {},
): Promise<IterationResult> {
  const startMs = Date.now();
  let totalUsage = { input: 0, output: 0 };
  let speculativeIdeasCarried = 0;
  let consumedSpeculativeIdeasCleared = false;

  function addUsage(u: { input: number; output: number }): void {
    totalUsage.input += u.input;
    totalUsage.output += u.output;
  }

  const ctx: IterationContext = { config, models, iteration };
  let currentStokerDirective = await loadStokerDirectiveWithLifecycle(iteration, slot, options.lifecycle);
  if (await clearStaleStokerDirectiveWithLifecycle(currentStokerDirective, iteration, slot, options.lifecycle)) {
    currentStokerDirective = null;
  }
  let stokerLogFields = stokerDirectiveLogFields(currentStokerDirective, iteration);

  const clearConsumedSpeculativeIdeas = async (): Promise<void> => {
    if (consumedSpeculativeIdeasCleared || config.speculative?.enabled === false) return;
    const cleanupStartedAtMs = Date.now();
    const cleanupLifecycleData = {
      iteration,
      slot: slot ?? null,
      stage: "speculative_cleanup",
    };
    await logIterationLifecycle(options.lifecycle, "foundry_speculative_cleanup_start", cleanupLifecycleData);

    try {
      await clearSpeculativeIdeas();
      consumedSpeculativeIdeasCleared = true;
      await logIterationLifecycle(options.lifecycle, "foundry_speculative_cleanup_complete", {
        ...cleanupLifecycleData,
        result: "cleared",
        duration_ms: Math.max(0, Date.now() - cleanupStartedAtMs),
      });
    } catch (err) {
      await logIterationLifecycle(options.lifecycle, "foundry_speculative_cleanup_failed", {
        ...cleanupLifecycleData,
        result: "failed",
        detail: err instanceof Error ? err.message : String(err),
        duration_ms: Math.max(0, Date.now() - cleanupStartedAtMs),
      });
      console.warn("  ⚠ Speculative idea cleanup failed:", err instanceof Error ? err.message : String(err));
    }
  };

  console.log(`\n${"━".repeat(60)}`);
  console.log(`  Iteration ${iteration}`);
  console.log(`${"━".repeat(60)}\n`);

  // ── Phase 0: Pre-check ──────────────────────────────────────
  console.log("▶ Phase 0: Pre-check");

  const precheckStartedAtMs = Date.now();
  const precheckLifecycleData = {
    iteration,
    slot: slot ?? null,
    stage: "precheck",
    stop_file: config.intervention.stop_file,
    disk_min_gb: config.loop?.disk_space_min_gb ?? null,
  };
  let stopFileDetected = false;
  let diskSpaceOk: boolean | null = null;
  let moodName: string | null = null;

  await logIterationLifecycle(options.lifecycle, "foundry_precheck_start", precheckLifecycleData);

  try {
    stopFileDetected = await checkStopFile(config);
    if (stopFileDetected) {
      console.log("  STOP file detected — halting.");
      await appendJournal(`**Iteration ${iteration}:** Halted by STOP file.`);
      await logIterationLifecycle(options.lifecycle, "foundry_precheck_complete", {
        ...precheckLifecycleData,
        result: "halted",
        reason: "STOP file detected",
        stop_file_detected: true,
        disk_space_ok: null,
        mood: moodName,
        duration_ms: Math.max(0, Date.now() - precheckStartedAtMs),
      });
      return {
        iteration,
        outcome: "halted",
        reason: "STOP file detected",
        token_usage: totalUsage,
        duration_ms: Date.now() - startMs,
      };
    }

    // Compute mood from recent iteration history
    try {
      const iterLog = await readJsonlEntries<{
        iteration: number; outcome: "shipped" | "killed" | "skipped" | "halted";
        domain?: string; mean_rating?: string; title?: string;
        token_usage: { input: number; output: number }; duration_ms: number;
      }>(resolve("logs", "iterations.jsonl"));
      const mood = await computeMood(iterLog, iteration);
      moodName = mood.dominant_mood;
      await saveMood(mood);
      console.log(`  Mood: ${mood.dominant_mood} — ${mood.creative_nudge.slice(0, 60)}`);
    } catch (err) {
      console.warn("  ⚠ Mood computation failed:", err instanceof Error ? err.message : String(err));
    }

    if (config.loop?.disk_space_min_gb) {
      diskSpaceOk = await checkDiskSpace(config.loop.disk_space_min_gb);
      if (!diskSpaceOk) {
        console.log("  ⚠ Disk space below threshold — halting.");
        await appendJournal(`**Iteration ${iteration}:** Halted — disk space below ${config.loop.disk_space_min_gb}GB.`);
        await logIterationLifecycle(options.lifecycle, "foundry_precheck_complete", {
          ...precheckLifecycleData,
          result: "halted",
          reason: "Low disk space",
          stop_file_detected: false,
          disk_space_ok: false,
          mood: moodName,
          duration_ms: Math.max(0, Date.now() - precheckStartedAtMs),
        });
        return {
          iteration,
          outcome: "halted",
          reason: "Low disk space",
          token_usage: totalUsage,
          duration_ms: Date.now() - startMs,
        };
      }
    }

    await logIterationLifecycle(options.lifecycle, "foundry_precheck_complete", {
      ...precheckLifecycleData,
      result: "continue",
      stop_file_detected: false,
      disk_space_ok: diskSpaceOk,
      mood: moodName,
      duration_ms: Math.max(0, Date.now() - precheckStartedAtMs),
    });
  } catch (err) {
    await logIterationLifecycle(options.lifecycle, "foundry_precheck_failed", {
      ...precheckLifecycleData,
      result: "failed",
      detail: err instanceof Error ? err.message : String(err),
      stop_file_detected: stopFileDetected,
      disk_space_ok: diskSpaceOk,
      mood: moodName,
      duration_ms: Math.max(0, Date.now() - precheckStartedAtMs),
    });
    throw err;
  }

  // Check for human redirect
  let approvedProposal: IdeatorProposal | null = null;
  let approvedNotes = "";
  let iterationSource: NonNullable<IterationResult["source"]> = "ideator";

  const requestPollStartedAtMs = Date.now();
  const requestPollLifecycleData = {
    iteration,
    slot: slot ?? null,
    stage: "request_poll",
    request_file: config.intervention.requests_file,
  };
  await logIterationLifecycle(options.lifecycle, "foundry_request_poll_start", requestPollLifecycleData);

  let requestContent = "";
  try {
    requestContent = await readRequests(config);
    const requestPending = requestContent.length > 0;
    await logIterationLifecycle(options.lifecycle, "foundry_request_poll_complete", {
      ...requestPollLifecycleData,
      result: requestPending ? "pending" : "empty",
      request_pending: requestPending,
      request_preview: requestPending ? compactLifecyclePreview(requestContent) : "",
      request_length: requestContent.length,
      duration_ms: Math.max(0, Date.now() - requestPollStartedAtMs),
    });
  } catch (err) {
    await logIterationLifecycle(options.lifecycle, "foundry_request_poll_failed", {
      ...requestPollLifecycleData,
      result: "failed",
      detail: err instanceof Error ? err.message : String(err),
      duration_ms: Math.max(0, Date.now() - requestPollStartedAtMs),
    });
    throw err;
  }

  if (requestContent) {
    const directiveDeferred = await deferCurrentStokerDirective(currentStokerDirective, iteration, {
      slot,
      lifecycle: options.lifecycle,
      requestContent,
      requestFile: config.intervention.requests_file,
    });
    if (directiveDeferred && currentStokerDirective) {
      stokerLogFields = {
        stoker_directive_applied: false,
        stoker_directive_deferred: true,
        stoker_directive_deferred_to: iteration + 1,
        stoker_directive_rules: currentStokerDirective.rules_fired,
        stoker_directive_urgency: currentStokerDirective.urgency,
      };
      currentStokerDirective = null;
    }
  } else {
    try {
      await runQueuedRefineryJobs(ctx, slot, addUsage, currentStokerDirective, options.lifecycle);
    } catch (err) {
      console.warn("  ⚠ Background refinery failed:", err instanceof Error ? err.message : String(err));
    }
  }

  if (requestContent) {
    iterationSource = "human_redirect";
    const redirectStartedAtMs = Date.now();
    const redirectUsage = { input: 0, output: 0 };
    const addRedirectUsage = (usage: { input: number; output: number }): void => {
      redirectUsage.input += usage.input;
      redirectUsage.output += usage.output;
      addUsage(usage);
    };
    const redirectLifecycleData = {
      iteration,
      slot: slot ?? null,
      request_file: config.intervention.requests_file,
      request_preview: compactLifecyclePreview(requestContent),
      request_length: requestContent.length,
    };
    await logIterationLifecycle(options.lifecycle, "foundry_human_redirect_start", redirectLifecycleData);

    try {
      console.log("  Human redirect detected — translating via Curator.");
      const redirectResult = await dispatchCuratorRedirect(config, models, iteration, requestContent);
      addRedirectUsage(redirectResult.usage);
      const redirectProposal = redirectResult.data.proposal;

      console.log("\n▶ Phase 2: Idea Gate (Critic — human redirect)");
      const redirectProposalsYaml = humanRedirectProposalToYaml(requestContent, redirectProposal);
      const gate1Result = await runIdeaGateWithLifecycle({
        ctx,
        ideas: [redirectProposal],
        proposalsYaml: redirectProposalsYaml,
        source: "human_redirect",
        lifecycle: options.lifecycle,
        slot,
      });
      addRedirectUsage(gate1Result.usage);

      const gate1 = gate1Result.data;
      for (const ev of gate1.evaluations) {
        const icon = ev.decision === "approve" ? "✓" : ev.decision === "reject" ? "✗" : "↻";
        console.log(`  ${icon} "${ev.title}": ${ev.decision}${ev.reasons ? " — " + ev.reasons.slice(0, 80) : ""}`);
      }

      await clearRequests(config);
      const selectedRedirect = selectedGate1Approval([redirectProposal], gate1);
      if (!selectedRedirect) {
        const reason = `Human redirect rejected by Critic Gate 1: ${gate1RejectionReasons(gate1)}`;
        await logIterationLifecycle(options.lifecycle, "foundry_human_redirect_complete", {
          ...redirectLifecycleData,
          result: "rejected",
          title: redirectProposal.title,
          domain: redirectProposal.domain,
          complexity: redirectProposal.complexity,
          reason,
          token_usage: { ...redirectUsage },
          duration_ms: Math.max(0, Date.now() - redirectStartedAtMs),
        });
        await appendJournal(
          `**Iteration ${iteration}:** Human redirect rejected: "${requestContent.slice(0, 100)}". ${reason}`,
        );
        await clearConsumedSpeculativeIdeas();
        const streakState = await persistStreakResult(config, {
          iteration,
          outcome: "skipped",
          reason,
        }, {
          slot,
          lifecycle: options.lifecycle,
        });
        await logIteration({
          timestamp: new Date().toISOString(),
          iteration,
          outcome: "skipped",
          source: iterationSource,
          reason,
          ...stokerLogFields,
          streak_state: streakState ?? undefined,
          speculative_ideas_carried: speculativeIdeasCarried,
          token_usage: totalUsage,
          duration_ms: Date.now() - startMs,
        });
        await clearConsumedDirective(iteration, {
          slot,
          lifecycle: options.lifecycle,
          directive: currentStokerDirective,
        });
        return {
          iteration,
          outcome: "skipped",
          source: iterationSource,
          reason,
          token_usage: totalUsage,
          duration_ms: Date.now() - startMs,
        };
      }

      approvedProposal = selectedRedirect.proposal;
      approvedNotes = humanRedirectNotes(selectedRedirect.evaluation.sharpening_notes || "");

      const rec = selectedRedirect.evaluation.recommended_complexity;
      const recommendation = applyRecommendedComplexity(approvedProposal, rec);
      if (recommendation.applied) {
        const fromComplexity = approvedProposal.complexity;
        console.log(`  ↑ Critic adjusted complexity: ${approvedProposal.complexity} → ${recommendation.proposal.complexity}`);
        approvedProposal = recommendation.proposal;
        await logIterationLifecycle(options.lifecycle, "foundry_complexity_recommendation_applied", {
          iteration,
          slot: slot ?? null,
          stage: "complexity_recommendation",
          source: "human_redirect",
          result: "applied",
          title: approvedProposal.title,
          from_complexity: fromComplexity,
          to_complexity: approvedProposal.complexity,
        });
      } else if (recommendation.ignored && rec) {
        console.log(`  ⚠ Ignored Critic complexity recommendation: ${approvedProposal.complexity} → ${rec} conflicts with proposal metadata.`);
        await logIterationLifecycle(options.lifecycle, "foundry_complexity_recommendation_ignored", {
          iteration,
          slot: slot ?? null,
          stage: "complexity_recommendation",
          source: "human_redirect",
          result: "ignored",
          reason: "metadata_conflict",
          title: approvedProposal.title,
          from_complexity: approvedProposal.complexity,
          to_complexity: rec,
        });
        await appendJournal(
          `**Iteration ${iteration}:** Ignored Gate 1 recommended complexity ${approvedProposal.complexity} → ${rec} for human redirect "${approvedProposal.title}" because it conflicts with proposal metadata.`,
        );
      }

      await logIterationLifecycle(options.lifecycle, "foundry_human_redirect_complete", {
        ...redirectLifecycleData,
        result: "approved",
        title: approvedProposal.title,
        domain: approvedProposal.domain,
        complexity: approvedProposal.complexity,
        token_usage: { ...redirectUsage },
        duration_ms: Math.max(0, Date.now() - redirectStartedAtMs),
      });

      await appendJournal(
        `**Iteration ${iteration}:** Human redirect processed: "${requestContent.slice(0, 100)}" → ${approvedProposal.title}`,
      );
      await clearConsumedSpeculativeIdeas();
    } catch (err) {
      await logIterationLifecycle(options.lifecycle, "foundry_human_redirect_failed", {
        ...redirectLifecycleData,
        result: "failed",
        detail: err instanceof Error ? err.message : String(err),
        token_usage: { ...redirectUsage },
        duration_ms: Math.max(0, Date.now() - redirectStartedAtMs),
      });
      throw err;
    }
  }

  // ── Phase 1 & 2: Ideation + Idea Gate ───────────────────────
  if (!approvedProposal) {
    for (
      let ideaAttempt = 0;
      ideaAttempt < config.iteration.max_idea_retries;
      ideaAttempt++
    ) {
      console.log(`\n▶ Phase 1: Ideation${ideaAttempt > 0 ? ` (retry ${ideaAttempt})` : ""}`);

      const rejectionContext = ideaAttempt > 0
        ? `All previous proposals were rejected. The Critic said: "${approvedNotes}". Propose 5 NEW ideas that address these concerns.`
        : undefined;

      const ideationResult = await runIdeationPhaseWithLifecycle({
        ctx,
        rejectionContext,
        lifecycle: options.lifecycle,
        slot,
        ideaAttempt,
        maxAttempts: config.iteration.max_idea_retries,
        stokerLogFields,
      });
      addUsage(ideationResult.usage);
      await clearConsumedSpeculativeIdeas();

      const ideas = ideationResult.ideas;
      if (ideas.length === 0) {
        approvedNotes = ideationResult.burstFailures.length > 0
          ? `All ideation bursts failed. ${ideationResult.burstFailures.join("; ")}`
          : "Ideator produced no proposals.";
        console.log(`  ${approvedNotes}${ideaAttempt < config.iteration.max_idea_retries - 1 ? " Retrying..." : " Deadlock."}`);
        continue;
      }
      console.log(`  Ideator proposed: ${ideas.map((i) => `"${i.title}" [${i.domain}, ${i.complexity}]`).join(", ")}`);

      console.log("\n▶ Phase 2: Idea Gate (Critic)");

      const proposalsYaml = yaml.stringify({ ideas });
      const gate1Result = await runIdeaGateWithLifecycle({
        ctx,
        ideas,
        proposalsYaml,
        source: "ideator",
        lifecycle: options.lifecycle,
        slot,
        ideaAttempt,
      });
      addUsage(gate1Result.usage);

      const gate1 = gate1Result.data;
      for (const ev of gate1.evaluations) {
        const icon = ev.decision === "approve" ? "✓" : ev.decision === "reject" ? "✗" : "↻";
        console.log(`  ${icon} "${ev.title}": ${ev.decision}${ev.reasons ? " — " + ev.reasons.slice(0, 80) : ""}`);
      }

      const approved = selectedGate1Approval(ideas, gate1);

      const persistSpeculative = async (chosenTitle: string | null): Promise<void> => {
        if (config.speculative?.enabled === false) return;
        const carryForwardStartedAtMs = Date.now();
        const carryForwardLifecycleData = {
          iteration,
          slot: slot ?? null,
          stage: "speculative_carry_forward",
          chosen_title: chosenTitle,
          ideas_count: ideas.length,
          evaluations_count: gate1.evaluations.length,
        };
        await logIterationLifecycle(
          options.lifecycle,
          "foundry_speculative_carry_forward_start",
          carryForwardLifecycleData,
        );

        try {
          const speculativeIdeas: SpeculativeIdea[] = buildSpeculativeIdeas(
            ideas,
            gate1.evaluations,
            chosenTitle,
            iteration,
            config.speculative,
          );
          speculativeIdeasCarried = speculativeIdeas.length;
          if (speculativeIdeas.length > 0) {
            await saveSpeculativeIdeas(speculativeIdeas);
          }
          await logIterationLifecycle(options.lifecycle, "foundry_speculative_carry_forward_complete", {
            ...carryForwardLifecycleData,
            result: speculativeIdeas.length > 0 ? "saved" : "empty",
            carried_count: speculativeIdeas.length,
            duration_ms: Math.max(0, Date.now() - carryForwardStartedAtMs),
          });
        } catch (err) {
          await logIterationLifecycle(options.lifecycle, "foundry_speculative_carry_forward_failed", {
            ...carryForwardLifecycleData,
            result: "failed",
            detail: err instanceof Error ? err.message : String(err),
            duration_ms: Math.max(0, Date.now() - carryForwardStartedAtMs),
          });
          console.warn("  ⚠ Speculative idea carry-forward failed:", err instanceof Error ? err.message : String(err));
        }
      };

      if (approved) {
        approvedProposal = approved.proposal;
        approvedNotes = approved.evaluation.sharpening_notes || "";

        // Apply Critic complexity override only when proposal metadata remains valid.
        const rec = approved.evaluation.recommended_complexity;
        const recommendation = applyRecommendedComplexity(approvedProposal, rec);
        if (recommendation.applied) {
          const fromComplexity = approvedProposal.complexity;
          console.log(`  ↑ Critic adjusted complexity: ${approvedProposal.complexity} → ${recommendation.proposal.complexity}`);
          approvedProposal = recommendation.proposal;
          await logIterationLifecycle(options.lifecycle, "foundry_complexity_recommendation_applied", {
            iteration,
            slot: slot ?? null,
            stage: "complexity_recommendation",
            source: "ideator",
            result: "applied",
            title: approvedProposal.title,
            from_complexity: fromComplexity,
            to_complexity: approvedProposal.complexity,
          });
        } else if (recommendation.ignored && rec) {
          console.log(`  ⚠ Ignored Critic complexity recommendation: ${approvedProposal.complexity} → ${rec} conflicts with proposal metadata.`);
          await logIterationLifecycle(options.lifecycle, "foundry_complexity_recommendation_ignored", {
            iteration,
            slot: slot ?? null,
            stage: "complexity_recommendation",
            source: "ideator",
            result: "ignored",
            reason: "metadata_conflict",
            title: approvedProposal.title,
            from_complexity: approvedProposal.complexity,
            to_complexity: rec,
          });
          await appendJournal(
            `**Iteration ${iteration}:** Ignored Gate 1 recommended complexity ${approvedProposal.complexity} → ${rec} for "${approvedProposal.title}" because it conflicts with proposal metadata.`,
          );
        }

        console.log(`  ✓ Selected: "${approvedProposal.title}" [${approvedProposal.complexity}]`);
        await persistSpeculative(approved.evaluation.title);
        break;
      }

      await persistSpeculative(null);

      approvedNotes = gate1RejectionReasons(gate1);
      console.log(`  All proposals rejected. ${ideaAttempt < config.iteration.max_idea_retries - 1 ? "Retrying..." : "Deadlock."}`);
    }

    if (!approvedProposal) {
      console.log("\n  ⚠ Ideation deadlock — invoking Curator override.");
      const deadlockStartedAtMs = Date.now();
      const deadlockLifecycleData = {
        iteration,
        slot: slot ?? null,
        max_idea_retries: config.iteration.max_idea_retries,
        rejection_context_preview: compactLifecyclePreview(approvedNotes),
        rejection_context_length: approvedNotes.length,
      };
      await logIterationLifecycle(options.lifecycle, "foundry_deadlock_override_start", deadlockLifecycleData);
      const curatorForced = await dispatchCuratorDeadlockOverride(config, models, iteration, approvedNotes);
      if ("proposal" in curatorForced) {
        approvedProposal = curatorForced.proposal;
        approvedNotes = curatorForced.notes;
        addUsage(curatorForced.usage);
        await logIterationLifecycle(options.lifecycle, "foundry_deadlock_override_complete", {
          ...deadlockLifecycleData,
          result: "forced",
          title: approvedProposal.title,
          domain: approvedProposal.domain,
          complexity: approvedProposal.complexity,
          token_usage: { ...curatorForced.usage },
          duration_ms: Math.max(0, Date.now() - deadlockStartedAtMs),
        });
        await appendJournal(`**Iteration ${iteration}:** [FORCED] Curator override after ideation deadlock. Forced: "${approvedProposal.title}"`);
        console.log(`  ✓ Curator forced: "${approvedProposal.title}"`);
      } else {
        await logIterationLifecycle(options.lifecycle, "foundry_deadlock_override_complete", {
          ...deadlockLifecycleData,
          result: "failed",
          detail: curatorForced.error,
          duration_ms: Math.max(0, Date.now() - deadlockStartedAtMs),
        });
      }
    }

    if (!approvedProposal) {
      console.log("\n  ⚠ Ideation deadlock — skipping iteration.");
      const reason = `Ideation deadlock after ${config.iteration.max_idea_retries} attempts. Curator override also failed. Last rejection reasons: ${approvedNotes}`;
      await appendJournal(`**Iteration ${iteration}:** Skipped. ${reason}`);
      const streakState = await persistStreakResult(config, {
        iteration,
        outcome: "skipped",
        reason,
      }, {
        slot,
        lifecycle: options.lifecycle,
      });
      await logIteration({
        timestamp: new Date().toISOString(),
        iteration,
        outcome: "skipped",
        source: iterationSource,
        reason,
        ...stokerLogFields,
        streak_state: streakState ?? undefined,
        speculative_ideas_carried: speculativeIdeasCarried,
        token_usage: totalUsage,
        duration_ms: Date.now() - startMs,
      });
      await clearConsumedDirective(iteration, {
        slot,
        lifecycle: options.lifecycle,
        directive: currentStokerDirective,
      });
      return {
        iteration,
        outcome: "skipped",
        source: iterationSource,
        reason,
        token_usage: totalUsage,
        duration_ms: Date.now() - startMs,
      };
    }
  }

  // From here, approvedProposal is guaranteed non-null
  const proposal = approvedProposal!;
  const criticNotes = approvedNotes;

  // Handle project starter proposals.
  let effectiveComplexity = proposal.complexity;
  if (proposal.xl_mode === "project" && proposal.project) {
    if (!proposal.project.name) {
      console.log("  ⚠ Project starter proposal missing name — falling back to single artifact.");
      await logIterationLifecycle(options.lifecycle, "foundry_project_creation_invalid", {
        iteration,
        slot: slot ?? null,
        stage: "project_creation",
        result: "standalone",
        reason: "missing_name",
        title: proposal.title,
        original_complexity: proposal.complexity,
        effective_complexity: effectiveComplexity,
      });
      await appendJournal(
        `**Iteration ${iteration}:** Project starter metadata missing name; building "${proposal.title}" as a standalone artifact.`,
      );
      proposal.project = undefined;
    } else {
      if (proposal.complexity === "XL") effectiveComplexity = "L";
      const activeProjectCount = await countActiveProjects();
      if (activeProjectCount >= config.projects.max_active) {
        console.log(`  ⚠ Project cap reached (${activeProjectCount}/${config.projects.max_active}) — building as standalone artifact.`);
        await logIterationLifecycle(options.lifecycle, "foundry_project_creation_capped", {
          iteration,
          slot: slot ?? null,
          stage: "project_creation",
          result: "standalone",
          title: proposal.title,
          project_name: proposal.project.name,
          active_projects: activeProjectCount,
          max_active_projects: config.projects.max_active,
          original_complexity: proposal.complexity,
          effective_complexity: effectiveComplexity,
        });
        await appendJournal(
          `**Iteration ${iteration}:** Project cap reached (${activeProjectCount}/${config.projects.max_active}); building "${proposal.title}" as a standalone artifact instead of starting "${proposal.project.name}".`,
        );
        proposal.project = undefined;
      } else {
        console.log(`\n  ▶ Creating project: "${proposal.project.name}"`);
        const projectCreationStartedAtMs = Date.now();
        const projectCreationLifecycleData = {
          iteration,
          slot: slot ?? null,
          stage: "project_creation",
          title: proposal.title,
          project_name: proposal.project.name,
          estimated_iterations: proposal.project.estimated_iterations,
          original_complexity: proposal.complexity,
          effective_complexity: effectiveComplexity,
        };
        await logIterationLifecycle(options.lifecycle, "foundry_project_creation_start", projectCreationLifecycleData);

        let projectId = "";
        try {
          projectId = await createProject(proposal.project, iteration);
          await logIterationLifecycle(options.lifecycle, "foundry_project_creation_complete", {
            ...projectCreationLifecycleData,
            result: "created",
            project_id: projectId,
            duration_ms: Math.max(0, Date.now() - projectCreationStartedAtMs),
          });
        } catch (err) {
          await logIterationLifecycle(options.lifecycle, "foundry_project_creation_failed", {
            ...projectCreationLifecycleData,
            result: "failed",
            detail: err instanceof Error ? err.message : String(err),
            duration_ms: Math.max(0, Date.now() - projectCreationStartedAtMs),
          });
          throw err;
        }
        proposal.project_id = projectId;
        await appendJournal(
          `**Iteration ${iteration}:** Started project ${projectId}: "${proposal.project.name}" (${proposal.project.estimated_iterations} iterations planned)`,
        );
      }
    }
  }
  if (proposal.project_id && !proposal.project) {
    const activeProjects = await getActiveProjects();
    const activeProject = activeProjects.find((p) => p.project_id === proposal.project_id);
    if (!activeProject) {
      const staleProjectId = proposal.project_id;
      console.log(`  ⚠ Project ${staleProjectId} is not active — building as standalone artifact.`);
      await logIterationLifecycle(options.lifecycle, "foundry_project_continuation_stale_cleared", {
        iteration,
        slot: slot ?? null,
        stage: "project_continuation_validation",
        result: "standalone",
        stale_project_id: staleProjectId,
        active_project_count: activeProjects.length,
        title: proposal.title,
        domain: proposal.domain,
      });
      await appendJournal(
        `**Iteration ${iteration}:** Project ${staleProjectId} is not active; building "${proposal.title}" as a standalone artifact instead of a project continuation.`,
      );
      proposal.project_id = null;
    }
  }

  // ── Phase 3–5 loop: Create → Test → Review (with revision cycles) ──
  let artifact: CreatorResponse | null = null;
  let testerReport: TesterResponse | null = null;
  let gate2: CriticGate2Response | null = null;
  let artifactId = "";
  let iterationPhaseData: { phasesRun: string[]; phaseTokens: Record<string, number> } | null = null;

  for (
    let revisionRound = 0;
    revisionRound <= config.iteration.max_revision_rounds;
    revisionRound++
  ) {
    // Phase 3: Creation
    const revisionNotes = revisionRound > 0 && gate2?.revision_notes
      ? gate2.revision_notes
      : undefined;

    const pipelineProposal = effectiveComplexity !== proposal.complexity
      ? { ...proposal, complexity: effectiveComplexity as any }
      : proposal;

    console.log(`\n▶ Phase 3: Creation [${pipelineProposal.complexity}]${revisionRound > 0 ? ` (revision ${revisionRound})` : ""}`);
    const pipelineResult = await runCreatorPipelineWithLifecycle({
      ctx,
      proposal: pipelineProposal,
      criticNotes,
      revisionNotes,
      lifecycle: options.lifecycle,
      slot,
      stage: "creation",
      revisionRound,
    });
    addUsage(pipelineResult.usage);
    artifact = pipelineResult.artifact;

    // Track phase data for logging
    if (!iterationPhaseData) {
      iterationPhaseData = { phasesRun: pipelineResult.phasesRun, phaseTokens: pipelineResult.phaseTokens };
    } else {
      iterationPhaseData.phasesRun.push(...pipelineResult.phasesRun);
      Object.assign(iterationPhaseData.phaseTokens, pipelineResult.phaseTokens);
    }

    console.log(`  Created: "${artifact.title}" (${artifact.files.length} file${artifact.files.length > 1 ? "s" : ""})`);

    // Write to workspace
    await stageArtifactWorkspaceWithLifecycle({
      ctx,
      proposal: pipelineProposal,
      artifact,
      lifecycle: options.lifecycle,
      slot,
      stageReason: "creation",
      revisionRound,
    });

    // Phase 4: Testing
    const isCode = isCodeDomain(proposal.domain);
    console.log(`\n▶ Phase 4: Testing (${isCode ? "code sandbox" : "lightweight"})`);

    let testFixCycles = 0;
    while (true) {
      const testResult = await runTesterPhaseWithLifecycle({
        ctx,
        proposal,
        criticNotes,
        artifact,
        lifecycle: options.lifecycle,
        slot,
        testerMode: isCode ? "code_sandbox" : "lightweight",
        revisionRound,
        testFixCycle: testFixCycles,
      });

      addUsage(testResult.usage);
      testerReport = testResult.report;

      console.log(`  Verdict: ${testerReport.verdict} — ${testerReport.summary}`);

      await logTestReport({
        timestamp: new Date().toISOString(),
        iteration,
        artifact_id: artifactId || "pending",
        outcome: testerReport.verdict,
        summary: testerReport.summary,
        tests_run: testerReport.tests_run?.length ?? 0,
        tests_passed: testerReport.tests_run?.filter((t) => t.result === "pass").length ?? 0,
        tests_failed: testerReport.tests_run?.filter((t) => t.result === "fail").length ?? 0,
        details: testerReport.tests_run?.map((t) => `${t.name}: ${t.result}`).join("; ") || "",
      });

      if (testerReport.verdict === "pass") break;

      if (testerReport.verdict === "fail_catastrophic") {
        console.log("  ✗ Catastrophic failure — forwarding to Critic with kill recommendation.");
        break;
      }

      testFixCycles++;
      if (testFixCycles >= config.iteration.max_test_fix_cycles) {
        console.log(`  ✗ Max fix cycles (${config.iteration.max_test_fix_cycles}) exhausted.`);
        break;
      }

      console.log(`  ↻ Fixable issues — sending back to Creator (fix cycle ${testFixCycles})`);
      const fixNotes = testerReport.issues
        ?.map((i) => `[${i.severity}] ${i.description} at ${i.location}${i.suggested_fix ? " — fix: " + i.suggested_fix : ""}`)
        .join("\n") || testerReport.summary;

      const fixResult = await runCreatorPipelineWithLifecycle({
        ctx,
        proposal: pipelineProposal,
        criticNotes,
        revisionNotes: `Fix these issues from the Tester:\n\n${fixNotes}`,
        lifecycle: options.lifecycle,
        slot,
        stage: "test_fix",
        revisionRound,
        testFixCycle: testFixCycles,
      });
      addUsage(fixResult.usage);
      artifact = fixResult.artifact;

      await stageArtifactWorkspaceWithLifecycle({
        ctx,
        proposal: pipelineProposal,
        artifact,
        lifecycle: options.lifecycle,
        slot,
        stageReason: "test_fix",
        revisionRound,
        testFixCycle: testFixCycles,
      });
    }

    // Phase 5: Artifact Gate
    console.log("\n▶ Phase 5: Artifact Gate (Critic)");

    const artifactContent = serializeArtifact(artifact!.files);
    const testerReportText = testerReport
      ? yaml.stringify({
          verdict: testerReport.verdict,
          summary: testerReport.summary,
          tests_run: testerReport.tests_run,
          issues: testerReport.issues,
        })
      : "";

    const gate2Result = await runArtifactGateWithLifecycle({
      ctx,
      proposal,
      artifact: artifact!,
      artifactContent,
      testerReport,
      testerReportText,
      lifecycle: options.lifecycle,
      slot,
      revisionRound,
      testFixCycles,
    });
    addUsage(gate2Result.usage);
    gate2 = gate2Result.data;

    const mean = formatMeanCriticRating(gate2.ratings);
    console.log(`  Decision: ${gate2.decision} (mean rating: ${mean})`);
    console.log(`  Review: ${gate2.review.slice(0, 120)}...`);

    if (gate2.decision === "ship") {
      break;
    }

    if (gate2.decision === "kill") {
      console.log(`  ✗ Killed: ${gate2.kill_reason || "no reason given"}`);
      break;
    }

    // "revise" — loop continues
    if (revisionRound < config.iteration.max_revision_rounds) {
      console.log(`  ↻ Revision requested: ${gate2.revision_notes?.slice(0, 100) || "see notes"}`);
    } else {
      console.log("  Max revision rounds reached — force ship-or-kill.");
      const finalMean = formatMeanCriticRating(gate2.ratings);
      if (!meetsCriticShipThreshold(gate2.ratings)) {
        gate2 = { ...gate2, decision: "kill", kill_reason: `Force-killed: ratings below ship threshold after max revisions (mean rating ${finalMean}; no rating may be below 2)` };
      } else {
        gate2 = { ...gate2, decision: "ship" };
      }
    }
  }

  // ── Phase 6: Bookkeeping ─────────────────────────────────────
  console.log("\n▶ Phase 6: Bookkeeping");

  const durationMs = Date.now() - startMs;
  let shippedMean = "N/A";
  const bookkeepingStartedAtMs = Date.now();
  const bookkeepingOutcome = gate2!.decision === "kill" ? "killed" : "shipped";
  const bookkeepingLifecycleData: Record<string, unknown> = {
    iteration,
    slot: slot ?? null,
    stage: "bookkeeping",
    outcome: bookkeepingOutcome,
    title: proposal.title,
    domain: proposal.domain,
    complexity: proposal.complexity,
    project_id: proposal.project_id ?? null,
    artifact_title: artifact?.title ?? proposal.title,
    file_count: artifact?.files.length ?? 0,
    gate_decision: gate2!.decision,
    tester_verdict: testerReport?.verdict ?? null,
    token_usage: { ...totalUsage },
  };
  await logIterationLifecycle(options.lifecycle, "foundry_bookkeeping_start", bookkeepingLifecycleData);

  let releasePortfolioBookkeeping: (() => void) | null = null;
  let projectCompletedIterations: number | undefined;
  let projectEstimatedIterations: number | undefined;
  let projectMilestoneReached = false;
  let projectIterationFields: {
    project_completed_iterations?: number;
    project_estimated_iterations?: number;
    project_milestone_reached?: boolean;
  } = {};

  try {
    releasePortfolioBookkeeping = await portfolioBookkeepingMutex.acquire();
    artifactId = await getNextArtifactId();

    if (gate2!.decision === "kill") {
      await writeKilledArtifact(
        artifactId,
        proposal.title,
        proposal.domain,
        gate2!.kill_reason || gate2!.review,
        proposalToYaml(proposal),
      );

      await appendJournal(
        `**Iteration ${iteration} — KILLED:** "${proposal.title}" [${proposal.domain}]. ` +
        `Reason: ${gate2!.kill_reason || "quality below threshold"}. ` +
        `Token usage: ${totalUsage.input}in/${totalUsage.output}out.`,
      );

      const streakState = await persistStreakResult(config, {
        iteration,
        outcome: "killed",
        artifact_id: artifactId,
        title: proposal.title,
        domain: proposal.domain,
        reason: gate2!.kill_reason || gate2!.review,
        project_id: proposal.project_id ?? null,
      }, {
        slot,
        lifecycle: options.lifecycle,
      });

      await logIteration({
        timestamp: new Date().toISOString(),
        iteration,
        outcome: "killed",
        source: iterationSource,
        artifact_id: artifactId,
        title: proposal.title,
        domain: proposal.domain,
        reason: gate2!.kill_reason || gate2!.review,
        complexity: proposal.complexity,
        project_id: proposal.project_id ?? null,
        ...stokerLogFields,
        streak_state: streakState ?? undefined,
        speculative_ideas_carried: speculativeIdeasCarried,
        phases_run: iterationPhaseData?.phasesRun,
        phase_tokens: iterationPhaseData?.phaseTokens,
        token_usage: totalUsage,
        duration_ms: durationMs,
      });

      await clearConsumedDirective(iteration, {
        slot,
        lifecycle: options.lifecycle,
        directive: currentStokerDirective,
      });

      const dreamStartedAtMs = Date.now();
      const killReason = gate2!.kill_reason || gate2!.review;
      const dreamLifecycleData = {
        iteration,
        slot: slot ?? null,
        stage: "dream_capture",
        outcome: "killed",
        artifact_id: artifactId,
        title: proposal.title,
        domain: proposal.domain,
        kill_reason_preview: compactLifecyclePreview(killReason),
      };
      await logIterationLifecycle(options.lifecycle, "foundry_dream_capture_start", dreamLifecycleData);

      try {
        const dream = extractDreamFromKill(
          artifactId, proposal.title, proposal.domain,
          proposal.pitch, killReason, gate2!.review, iteration,
        );
        await addDream(dream);
        await logIterationLifecycle(options.lifecycle, "foundry_dream_capture_complete", {
          ...dreamLifecycleData,
          result: "recorded",
          resurrection_hint_preview: compactLifecyclePreview(dream.resurrection_hint),
          duration_ms: Math.max(0, Date.now() - dreamStartedAtMs),
        });
        console.log(`  ☆ Dream recorded: "${proposal.title}" — ${dream.resurrection_hint.slice(0, 60)}`);
      } catch (err) {
        await logIterationLifecycle(options.lifecycle, "foundry_dream_capture_failed", {
          ...dreamLifecycleData,
          result: "failed",
          detail: err instanceof Error ? err.message : String(err),
          duration_ms: Math.max(0, Date.now() - dreamStartedAtMs),
        });
        console.warn("  ⚠ Dream journal write failed:", err instanceof Error ? err.message : String(err));
      }

      console.log(`  Killed artifact ${artifactId} written to portfolio/killed/`);

      await logIterationLifecycle(options.lifecycle, "foundry_bookkeeping_complete", {
        ...bookkeepingLifecycleData,
        artifact_id: artifactId,
        reason: gate2!.kill_reason || gate2!.review,
        duration_ms: Math.max(0, Date.now() - bookkeepingStartedAtMs),
      });

      return {
        iteration,
        outcome: "killed",
        source: iterationSource,
        artifact_id: artifactId,
        title: proposal.title,
        domain: proposal.domain,
        reason: gate2!.kill_reason || gate2!.review,
        complexity: proposal.complexity,
        project_id: proposal.project_id ?? null,
        token_usage: totalUsage,
        duration_ms: durationMs,
      };
    }

    // Ship it!
    const testerReportForReadme = testerReport
      ? [
          `**Verdict:** ${testerReport.verdict}`,
          `**Summary:** ${testerReport.summary}`,
          testerReport.tests_run?.length
            ? `**Tests:** ${testerReport.tests_run.filter((t) => t.result === "pass").length}/${testerReport.tests_run.length} passed`
            : "",
        ].filter(Boolean).join("\n")
      : "";

    await writeArtifact({
      id: artifactId,
      title: artifact!.title || proposal.title,
      domain: proposal.domain,
      files: artifact!.files,
      review: gate2!.review,
      ratings: gate2!.ratings,
      testerReport: testerReportForReadme,
      proposal: proposalToYaml(proposal),
    });

    shippedMean = formatMeanCriticRating(gate2!.ratings);
    await updatePortfolioIndex(artifactId, proposal.title, proposal.domain, shippedMean, proposal.project_id ?? undefined);

    // Project bookkeeping
    if (proposal.project_id) {
      const projectProgressStartedAtMs = Date.now();
      const projectProgressLifecycleData = {
        iteration,
        slot: slot ?? null,
        stage: "project_progress",
        project_id: proposal.project_id,
        artifact_id: artifactId,
        title: proposal.title,
        domain: proposal.domain,
      };
      await logIterationLifecycle(options.lifecycle, "foundry_project_progress_start", projectProgressLifecycleData);

      try {
        await linkArtifactToProject(proposal.project_id, artifactId, proposal.title);
        const activeProjects = await getActiveProjects();
        const projectStatus = activeProjects.find((p) => p.project_id === proposal.project_id);
        const previousCompletedIterations = projectStatus?.completed_iterations ?? 0;
        const completedIterations = previousCompletedIterations + 1;
        const estimatedIterations = projectStatus?.estimated_iterations;
        projectCompletedIterations = completedIterations;
        projectEstimatedIterations = estimatedIterations;
        await updateProjectStatus(proposal.project_id, {
          completed_iterations: completedIterations,
          last_iteration: iteration,
        });
        await appendJournal(`**Iteration ${iteration}:** Project ${proposal.project_id}: iteration ${iteration} completed.`);
        await logIterationLifecycle(options.lifecycle, "foundry_project_progress_complete", {
          ...projectProgressLifecycleData,
          result: "updated",
          previous_completed_iterations: previousCompletedIterations,
          completed_iterations: completedIterations,
          duration_ms: Math.max(0, Date.now() - projectProgressStartedAtMs),
        });
        if (
          estimatedIterations !== undefined &&
          previousCompletedIterations < estimatedIterations &&
          completedIterations >= estimatedIterations
        ) {
          projectMilestoneReached = true;
          await logIterationLifecycle(options.lifecycle, "foundry_project_milestone_reached", {
            iteration,
            slot: slot ?? null,
            stage: "project_milestone",
            result: "needs_curator_decision",
            project_id: proposal.project_id,
            artifact_id: artifactId,
            title: proposal.title,
            domain: proposal.domain,
            previous_completed_iterations: previousCompletedIterations,
            completed_iterations: completedIterations,
            estimated_iterations: estimatedIterations,
          });
          await appendJournal(
            `**Iteration ${iteration}:** Project ${proposal.project_id} reached its planned iteration count ` +
            `(${completedIterations}/${estimatedIterations}); Curator should decide whether to complete, extend, or continue it.`,
          );
        }
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        await logIterationLifecycle(options.lifecycle, "foundry_project_progress_failed", {
          ...projectProgressLifecycleData,
          result: "failed",
          detail,
          duration_ms: Math.max(0, Date.now() - projectProgressStartedAtMs),
        });
        try {
          await appendJournal(
            `**Iteration ${iteration}:** Project ${proposal.project_id} bookkeeping failed after shipping ${artifactId}: ${detail}`,
          );
        } catch (journalErr) {
          console.warn(
            `  ⚠ Project bookkeeping failure journal write failed for ${proposal.project_id}:`,
            journalErr instanceof Error ? journalErr.message : String(journalErr),
          );
        }
        console.warn(`  ⚠ Project bookkeeping failed for ${proposal.project_id}:`, detail);
      }
    }
    projectIterationFields = proposal.project_id
      ? {
          project_completed_iterations: projectCompletedIterations,
          project_estimated_iterations: projectEstimatedIterations,
          project_milestone_reached: projectMilestoneReached,
        }
      : {};

    await appendJournal(
      `**Iteration ${iteration} — SHIPPED:** "${proposal.title}" [${proposal.domain}] as ${artifactId}. ` +
      `Rating: ${shippedMean}. Review: ${gate2!.review.slice(0, 200)}. ` +
      `Token usage: ${totalUsage.input}in/${totalUsage.output}out.`,
    );

    const streakState = await persistStreakResult(config, {
      iteration,
      outcome: "shipped",
      artifact_id: artifactId,
      title: proposal.title,
      domain: proposal.domain,
      mean_rating: shippedMean,
      project_id: proposal.project_id ?? null,
    }, {
      slot,
      lifecycle: options.lifecycle,
    });

    await logIteration({
      timestamp: new Date().toISOString(),
      iteration,
      outcome: "shipped",
      source: iterationSource,
      artifact_id: artifactId,
      title: proposal.title,
      domain: proposal.domain,
      ratings: gate2!.ratings,
      mean_rating: shippedMean,
      review: gate2!.review,
      complexity: proposal.complexity,
      project_id: proposal.project_id ?? null,
      ...projectIterationFields,
      ...stokerLogFields,
      streak_state: streakState ?? undefined,
      speculative_ideas_carried: speculativeIdeasCarried,
      phases_run: iterationPhaseData?.phasesRun,
      phase_tokens: iterationPhaseData?.phaseTokens,
      token_usage: totalUsage,
      duration_ms: durationMs,
    });

    await clearConsumedDirective(iteration, {
      slot,
      lifecycle: options.lifecycle,
      directive: currentStokerDirective,
    });

    const lineageStartedAtMs = Date.now();
    const lineageLifecycleData = {
      iteration,
      slot: slot ?? null,
      stage: "lineage_rebuild",
      outcome: "shipped",
      artifact_id: artifactId,
      title: proposal.title,
      domain: proposal.domain,
    };
    await logIterationLifecycle(options.lifecycle, "foundry_lineage_rebuild_start", lineageLifecycleData);

    try {
      const lineageGraph = await buildLineageGraph();
      await saveLineageGraph(lineageGraph);
      console.log(`  ★ Lineage: ${lineageGraph.edges.length} connections, ${lineageGraph.constellations.length} constellations`);
      await logIterationLifecycle(options.lifecycle, "foundry_lineage_rebuild_complete", {
        ...lineageLifecycleData,
        result: "saved",
        edges: lineageGraph.edges.length,
        constellations: lineageGraph.constellations.length,
        duration_ms: Math.max(0, Date.now() - lineageStartedAtMs),
      });
    } catch (err) {
      await logIterationLifecycle(options.lifecycle, "foundry_lineage_rebuild_failed", {
        ...lineageLifecycleData,
        result: "failed",
        detail: err instanceof Error ? err.message : String(err),
        duration_ms: Math.max(0, Date.now() - lineageStartedAtMs),
      });
      console.warn("  ⚠ Lineage rebuild failed:", err instanceof Error ? err.message : String(err));
    }
    await logIterationLifecycle(options.lifecycle, "foundry_bookkeeping_complete", {
      ...bookkeepingLifecycleData,
      artifact_id: artifactId,
      mean_rating: shippedMean,
      duration_ms: Math.max(0, Date.now() - bookkeepingStartedAtMs),
    });
  } catch (err) {
    await logIterationLifecycle(options.lifecycle, "foundry_bookkeeping_failed", {
      ...bookkeepingLifecycleData,
      artifact_id: artifactId || null,
      detail: err instanceof Error ? err.message : String(err),
      duration_ms: Math.max(0, Date.now() - bookkeepingStartedAtMs),
    });
    throw err;
  } finally {
    releasePortfolioBookkeeping?.();
  }

  await clearWorkspace(slot);

  console.log(`\n  ✓ Shipped artifact ${artifactId}: "${proposal.title}" [${proposal.domain}] — rating ${shippedMean}`);
  console.log(`  Duration: ${(durationMs / 1000).toFixed(1)}s | Tokens: ${totalUsage.input}in/${totalUsage.output}out`);

  return {
    iteration,
    outcome: "shipped",
    source: iterationSource,
    artifact_id: artifactId,
    title: proposal.title,
    domain: proposal.domain,
    ratings: gate2!.ratings,
    mean_rating: shippedMean,
    complexity: proposal.complexity,
    project_id: proposal.project_id ?? null,
    ...projectIterationFields,
    token_usage: totalUsage,
    duration_ms: durationMs,
  };
}
