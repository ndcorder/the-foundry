import type {
  FoundryConfig,
  ModelsConfig,
  CuratorFullResponse,
  ManifestoChange,
  ProjectDecision,
  StimuliAction,
  IdeatorProposal,
  StimuliConfig,
  StimuliRefreshState,
} from "../types/index.js";
import type { StatsTracker } from "../stats/index.js";
import { buildCuratorContext } from "../context/agent-context.js";
import { loadDomainsConfig } from "../context/config.js";
import { loadPrompt, injectVars } from "../agents/prompt.js";
import { callModel, type ModelCallResult } from "../model/index.js";
import { parseYaml, validateCuratorFull, buildCorrectionPrompt } from "../parser/index.js";
import { appendJournal } from "../files/journal.js";
import { getActiveProjects, updateProjectStatus } from "../files/projects.js";
import {
  refreshSource,
  writeSkillFile,
  loadStimuliConfig,
  summarizeStimuliRefreshHealth,
  type StimuliRefreshHealth,
} from "../stimuli/index.js";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "../root.js";

const MAX_YAML_RETRIES = 2;
const SAFE_STIMULI_TARGET = /^[a-z0-9][a-z0-9_-]*$/i;

function formatCriticRejectionPressure(statsTracker: StatsTracker): string {
  const window = statsTracker.getSnapshot().critic_rejection_window;
  if (window.length === 0) {
    return "0% (no artifact decisions yet).";
  }

  const rejected = window.filter((entry) => entry.rejected).length;
  const shipped = window.length - rejected;
  const percent = Math.round(statsTracker.getRejectionRate() * 100);
  const driftNote = percent > 40
    ? "Above 40%; reflect on whether Critic standards are drifting."
    : "At or below 40%; no standards-drift reflection required.";
  return `${percent}% over last ${window.length} artifact decisions (${rejected} killed, ${shipped} shipped). ${driftNote}`;
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatStimuliStaleness(stimuli: StimuliRefreshHealth): string {
  if (stimuli.sources === 0) {
    return "No configured stimuli sources.";
  }

  const lines = [
    `Stimuli sources: ${stimuli.sources} (${formatCount(stimuli.healthy, "healthy")}, ${formatCount(stimuli.due, "due")}, ${formatCount(stimuli.failing, "failing")}, ${formatCount(stimuli.disabled, "disabled")}).`,
  ];
  for (const entry of stimuli.entries) {
    const age = formatCount(entry.iterationsSinceRefresh, "iteration");
    const failures = entry.consecutiveFailures === 0
      ? "no failures"
      : formatCount(entry.consecutiveFailures, "failure");
    const due = entry.due ? ", due" : "";
    lines.push(
      `- ${entry.source}: ${entry.state}, ${entry.server}, last #${entry.lastRefreshIteration}, ${age} ago, every ${entry.refreshInterval} iterations, ${failures}${due}`,
    );
  }
  return lines.join("\n");
}

function projectDecisionsReferenceActiveProjects(
  response: CuratorFullResponse,
  activeProjectIds: ReadonlySet<string>,
): boolean {
  return response.project_decisions?.every((decision) => activeProjectIds.has(decision.project_id)) ?? true;
}

function proposalDomainIsAllowed(proposal: IdeatorProposal, allowedDomains: ReadonlySet<string>): boolean {
  return allowedDomains.has(proposal.domain);
}

function proposalProjectEstimateFitsConfig(proposal: IdeatorProposal, config: FoundryConfig): boolean {
  if (proposal.xl_mode !== "project" || !proposal.project) return true;
  return proposal.project.estimated_iterations <= config.projects.max_iterations_per_project;
}

function proposalProjectIdIsActive(proposal: IdeatorProposal, activeProjectIds: ReadonlySet<string>): boolean {
  return proposal.project_id === undefined || proposal.project_id === null || activeProjectIds.has(proposal.project_id);
}

function humanRedirectProposalFitsConfig(
  response: CuratorFullResponse,
  allowedDomains: ReadonlySet<string>,
  config: FoundryConfig,
  activeProjectIds: ReadonlySet<string>,
): boolean {
  const proposal = response.human_redirect?.proposal;
  if (!proposal) return true;
  return proposalDomainIsAllowed(proposal, allowedDomains) &&
    proposalProjectEstimateFitsConfig(proposal, config) &&
    proposalProjectIdIsActive(proposal, activeProjectIds);
}

function stimuliActionsFitConfig(response: CuratorFullResponse, stimuliConfig: StimuliConfig): boolean {
  return response.stimuli_actions?.every((action) => {
    if (!SAFE_STIMULI_TARGET.test(action.target)) return false;
    if (action.action === "refresh") return stimuliConfig.mcp[action.target] !== undefined;
    return typeof action.content === "string" && action.content.trim().length > 0;
  }) ?? true;
}

function curatorFullResponseFitsConfig(
  response: CuratorFullResponse,
  allowedDomains: ReadonlySet<string>,
  config: FoundryConfig,
  activeProjectIds: ReadonlySet<string>,
  stimuliConfig: StimuliConfig,
): boolean {
  return projectDecisionsReferenceActiveProjects(response, activeProjectIds) &&
    humanRedirectProposalFitsConfig(response, allowedDomains, config, activeProjectIds) &&
    stimuliActionsFitConfig(response, stimuliConfig);
}

export async function dispatchCuratorFull(
  config: FoundryConfig,
  models: ModelsConfig,
  iteration: number,
  statsTracker: StatsTracker,
  stimuliRefreshStates: Map<string, StimuliRefreshState> = new Map(),
): Promise<CuratorFullResponse> {
  const [context, activeProjects, domains, stimuliConfig] = await Promise.all([
    buildCuratorContext(config),
    getActiveProjects(),
    loadDomainsConfig(),
    loadStimuliConfig(),
  ]);
  const activeProjectIds = new Set(activeProjects.map((project) => project.project_id));
  const allowedDomains = new Set(domains.domains.map((domain) => domain.name));
  const template = await loadPrompt("curator");
  const stimuliStaleness = formatStimuliStaleness(
    summarizeStimuliRefreshHealth(
      stimuliConfig,
      stimuliRefreshStates,
      iteration,
      config.stimuli.enabled,
    ),
  );

  const prompt = injectVars(template, {
    shared_context_full: context.full,
    curator_interval: String(config.iteration.curator_interval),
    compression_cutoff: `entries before iteration ${iteration}`,
    domain_stats: statsTracker.getDomainStats(),
    critic_rejection_rate: formatCriticRejectionPressure(statsTracker),
    project_statuses: context.agentSpecific,
    stimuli_staleness: stimuliStaleness,
    requests_content: context.agentSpecific,
    kickstart_after: String(config.projects.kickstart_after ?? 15),
    max_iterations_per_project: String(config.projects.max_iterations_per_project),
  });

  const agentConfig = models.agents.curator;
  let totalUsage = { input: 0, output: 0 };
  let lastText = "";

  for (let attempt = 0; attempt <= MAX_YAML_RETRIES; attempt++) {
    const userMessage = attempt === 0
      ? "Begin."
      : buildCorrectionPrompt(lastText, "YAML validation failed — see above.", "curator-full");

    const result: ModelCallResult = await callModel(
      agentConfig,
      prompt,
      userMessage,
      iteration,
      `curator-full${attempt > 0 ? `-retry${attempt}` : ""}`,
    );

    totalUsage.input += result.usage.input;
    totalUsage.output += result.usage.output;
    lastText = result.text;

    try {
      const data = parseYaml<CuratorFullResponse>(result.text);
      if (
        validateCuratorFull(data) &&
        curatorFullResponseFitsConfig(data, allowedDomains, config, activeProjectIds, stimuliConfig)
      ) {
        return data;
      }
      console.warn(`[curator-full] YAML structurally invalid (attempt ${attempt + 1})`);
    } catch (err) {
      /* v8 ignore start */
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[curator-full] YAML parse error (attempt ${attempt + 1}): ${msg}`);
      /* v8 ignore stop */
    }
  }

  throw new Error(`[curator-full] Failed to get valid YAML after ${MAX_YAML_RETRIES + 1} attempts`);
}

export async function applyCuratorCycle(
  response: CuratorFullResponse,
  iteration: number,
  stimuliRefreshStates?: Map<string, StimuliRefreshState>,
): Promise<void> {
  // a. Retrospective → journal
  if (!response.retrospective.trim()) {
    console.warn("[curator] Retrospective is blank, skipping journal entry.");
  } else {
    try {
      await appendJournal(`[RETROSPECTIVE]\n\n${response.retrospective}`);
    } catch (err) {
      console.error(`[curator] Failed to append retrospective: ${err}`);
    }
  }

  // b. Compressed journal → overwrite
  if (!response.compressed_journal.trim()) {
    console.warn("[curator] Compressed journal is blank, preserving existing memory.");
  } else {
    try {
      await writeFile(
        resolve("identity", "journal-compressed.md"),
        response.compressed_journal,
        "utf-8",
      );
    } catch (err) {
      console.error(`[curator] Failed to write compressed journal: ${err}`);
    }
  }

  // c. Manifesto changes
  if (response.manifesto_changes?.length) {
    for (const change of response.manifesto_changes) {
      try {
        await applyManifestoChange(change);
        await appendJournal(
          `[MANIFESTO] Changed section "${change.section}": ${change.reason}`,
        );
      } catch (err) {
        console.error(`[curator] Failed to apply manifesto change "${change.section}": ${err}`);
      }
    }
  }

  // d. Domain recommendations
  try {
    await writeFile(
      resolve("curator-recommendations.md"),
      response.domain_recommendations ?? "",
      "utf-8",
    );
  } catch (err) {
    console.error(`[curator] Failed to write domain recommendations: ${err}`);
  }

  // e. Project decisions
  if (response.project_decisions?.length) {
    for (const decision of response.project_decisions) {
      try {
        await applyProjectDecision(decision);
        await appendJournal(
          `[PROJECT] ${decision.project_id}: ${decision.action} — ${decision.reason}`,
        );
      } catch (err) {
        console.error(`[curator] Failed to apply project decision ${decision.project_id}: ${err}`);
      }
    }
  }

  // f. Stimuli actions
  if (response.stimuli_actions?.length) {
    for (const action of response.stimuli_actions) {
      try {
        await applyStimuliAction(action, iteration, stimuliRefreshStates);
      } catch (err) {
        console.error(`[curator] Failed to apply stimuli action "${action.target}": ${err}`);
      }
    }
  }

  // g. Summary journal entry
  try {
    await appendJournal(`[CURATOR] Full cycle complete at iteration ${iteration}`);
  } catch (err) {
    console.error(`[curator] Failed to log summary: ${err}`);
  }
}

export function shouldRunCurator(
  iteration: number,
  lastCuratorRun: number,
  config: FoundryConfig,
): boolean {
  return iteration - lastCuratorRun >= config.iteration.curator_interval;
}

async function applyManifestoChange(change: ManifestoChange): Promise<void> {
  if (!change.section.trim() || !change.old.trim()) {
    console.warn(`[curator] Manifesto change has blank section or old text, skipping`);
    return;
  }
  const manifestoPath = resolve("identity", "manifesto.md");
  let content = await readFile(manifestoPath, "utf-8");
  if (!content.includes(change.old)) {
    console.warn(`[curator] Manifesto section "${change.section}" — old text not found, skipping`);
    return;
  }
  content = content.replace(change.old, change.new);
  await writeFile(manifestoPath, content, "utf-8");
}

async function applyProjectDecision(decision: ProjectDecision): Promise<void> {
  const now = new Date().toISOString();
  switch (decision.action) {
    case "complete":
      await updateProjectStatus(decision.project_id, {
        status: "complete",
        completed_at: now,
      });
      break;
    case "abandon":
      await updateProjectStatus(decision.project_id, {
        status: "abandoned",
        abandoned_reason: decision.reason,
      });
      break;
    case "continue":
    case "extend":
      break;
  }
}

function getStimuliRefreshState(
  states: Map<string, StimuliRefreshState>,
  source: string,
): StimuliRefreshState {
  return states.get(source) ?? {
    source,
    last_refresh_iteration: 0,
    consecutive_failures: 0,
    disabled: false,
  };
}

function markStimuliRefreshSuccess(
  states: Map<string, StimuliRefreshState> | undefined,
  source: string,
  iteration: number,
): void {
  if (!states) return;
  const state = getStimuliRefreshState(states, source);
  states.set(source, {
    ...state,
    last_refresh_iteration: iteration,
    consecutive_failures: 0,
    disabled: false,
  });
}

function markStimuliRefreshFailure(
  states: Map<string, StimuliRefreshState> | undefined,
  source: string,
): void {
  if (!states) return;
  const state = getStimuliRefreshState(states, source);
  const consecutiveFailures = state.consecutive_failures + 1;
  states.set(source, {
    ...state,
    consecutive_failures: consecutiveFailures,
    disabled: state.disabled || consecutiveFailures >= 3,
  });
}

async function applyStimuliAction(
  action: StimuliAction,
  iteration: number,
  stimuliRefreshStates?: Map<string, StimuliRefreshState>,
): Promise<void> {
  if (action.action === "refresh") {
    const stimuliConfig = await loadStimuliConfig();
    const sourceConfig = stimuliConfig.mcp[action.target];
    if (!sourceConfig) {
      console.warn(`[curator] Unknown stimuli source "${action.target}", skipping refresh`);
      return;
    }
    try {
      await refreshSource(action.target, sourceConfig);
      markStimuliRefreshSuccess(stimuliRefreshStates, action.target, iteration);
    } catch (err) {
      markStimuliRefreshFailure(stimuliRefreshStates, action.target);
      throw err;
    }
  } else if (action.action === "commission_skill") {
    if (!action.content) {
      console.warn(`[curator] commission_skill for "${action.target}" has no content, skipping`);
      return;
    }
    await writeSkillFile(action.target, action.content);
  }
}
