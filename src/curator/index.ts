import type {
  FoundryConfig,
  ModelsConfig,
  CuratorFullResponse,
  ManifestoChange,
  ProjectDecision,
  StimuliAction,
} from "../types/index.js";
import type { StatsTracker } from "../stats/index.js";
import { buildCuratorContext } from "../context/agent-context.js";
import { loadPrompt, injectVars } from "../agents/prompt.js";
import { callModel, type ModelCallResult } from "../model/index.js";
import { parseYaml, validateCuratorFull, buildCorrectionPrompt } from "../parser/index.js";
import { appendJournal } from "../files/journal.js";
import { updateProjectStatus } from "../files/projects.js";
import { refreshSource, writeSkillFile, loadStimuliConfig } from "../stimuli/index.js";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "../root.js";

const MAX_YAML_RETRIES = 2;

export async function dispatchCuratorFull(
  config: FoundryConfig,
  models: ModelsConfig,
  iteration: number,
  statsTracker: StatsTracker,
): Promise<CuratorFullResponse> {
  const context = await buildCuratorContext(config);
  const template = await loadPrompt("curator");

  const prompt = injectVars(template, {
    shared_context_full: context.full,
    curator_interval: String(config.iteration.curator_interval),
    compression_cutoff: `entries before iteration ${iteration}`,
    domain_stats: statsTracker.getDomainStats(),
    project_statuses: context.agentSpecific,
    stimuli_staleness: "see stimuli state in context",
    requests_content: context.agentSpecific,
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
      if (validateCuratorFull(data)) {
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
): Promise<void> {
  // a. Retrospective → journal
  try {
    await appendJournal(`[RETROSPECTIVE]\n\n${response.retrospective}`);
  } catch (err) {
    console.error(`[curator] Failed to append retrospective: ${err}`);
  }

  // b. Compressed journal → overwrite
  try {
    await writeFile(
      resolve("identity", "journal-compressed.md"),
      response.compressed_journal,
      "utf-8",
    );
  } catch (err) {
    console.error(`[curator] Failed to write compressed journal: ${err}`);
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
        await applyStimuliAction(action);
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

async function applyStimuliAction(action: StimuliAction): Promise<void> {
  if (action.action === "refresh") {
    const stimuliConfig = await loadStimuliConfig();
    const sourceConfig = stimuliConfig.mcp[action.target];
    if (!sourceConfig) {
      console.warn(`[curator] Unknown stimuli source "${action.target}", skipping refresh`);
      return;
    }
    await refreshSource(action.target, sourceConfig);
  } else if (action.action === "commission_skill") {
    if (!action.content) {
      console.warn(`[curator] commission_skill for "${action.target}" has no content, skipping`);
      return;
    }
    await writeSkillFile(action.target, action.content);
  }
}
