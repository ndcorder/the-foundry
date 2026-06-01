import type {
  FoundryConfig,
  ContextBlock,
} from "../types/index.js";
import { buildSharedContext } from "./shared.js";
import {
  safeRead,
  readDecisions,
  readTestReports,
  formatDecisions,
  formatTestReports,
  readLiveStimuli,
  pickRandomSkills,
  selectDiverseReviews,
  readJsonlEntries,
} from "./data.js";
import { getActiveProjects } from "../files/projects.js";
import { loadLineageGraph } from "../lineage/index.js";
import { getDreamsForIdeator } from "../dreams/index.js";
import { loadMood } from "../mood/index.js";
import { formatStreakContext, loadStreakHistory } from "../streaks/index.js";
import { formatComplexityBias, loadComplexityBias } from "../complexity/index.js";
import { formatStokerDirective, loadStokerDirective } from "../stoker/index.js";
import {
  filterCurrentSpeculativeIdeas,
  formatSpeculativeIdeas,
  loadSpeculativeIdeas,
} from "../speculative/index.js";
import { resolve } from "../root.js";

function assembleBlock(shared: string, agentSpecific: string): ContextBlock {
  return {
    shared,
    agentSpecific,
    full: shared + "\n\n" + agentSpecific,
  };
}

export async function buildIdeatorContext(
  shared: string,
  config: FoundryConfig
): Promise<ContextBlock> {
  const [decisions, liveStimuli, skills, curatorRecs, activeProjects] = await Promise.all([
    readDecisions(),
    readLiveStimuli(),
    pickRandomSkills(config.stimuli.skills_per_context),
    safeRead(resolve("curator-recommendations.md")),
    getActiveProjects(),
  ]);

  const gate1Decisions = decisions
    .filter((d) => d.gate === "gate1")
    .slice(-config.context.critic_gate1_history);

  const projectSlotStatus = activeProjects.length >= config.projects.max_active
    ? "At capacity; do not propose new project starters."
    : "Starter slots available.";
  const projectSummary = [
    `Project slots: ${activeProjects.length}/${config.projects.max_active} active. ${projectSlotStatus}`,
    activeProjects.length > 0
      ? activeProjects.map((p) =>
          `- **${p.project_id}** "${p.name}" — ${p.completed_iterations}/${p.estimated_iterations} iterations done`
        ).join("\n")
      : "*No active projects.*",
  ].join("\n");

  const sections = [
    "## Critic's Recent Gate 1 Decisions\n",
    formatDecisions(gate1Decisions),
  ];

  if (curatorRecs.trim()) {
    sections.push("\n## Curator's Recommendations\n", curatorRecs);
  }

  let constellationContext = "*No lineage data yet.*";
  try {
    const lineage = await loadLineageGraph();
    if (lineage && lineage.constellations.length > 0) {
      const constellationLines = lineage.constellations
        .slice(0, 6)
        .map((c) => `- **${c.name}** (${c.artifact_ids.length} works): ${c.description}`);
      const dnaLines = lineage.creative_dna.technique_signatures
        .slice(0, 5)
        .map((t) => `- ${t}`);
      const unexplored = lineage.creative_dna.unexplored_territory
        .slice(0, 4)
        .map((t) => `- ${t}`);
      constellationContext = [
        "### Active Constellations\n",
        ...constellationLines,
        "\n### Our Creative DNA\n",
        ...dnaLines,
        "\n### Unexplored Territory\n",
        ...unexplored,
      ].join("\n");
    }
  } catch { /* lineage not available yet */ }

  let dreamsContext = "*No fallen artifacts yet.*";
  try {
    dreamsContext = await getDreamsForIdeator(3);
  } catch { /* dreams not available */ }

  let moodContext = "*Mood not yet computed.*";
  try {
    const mood = await loadMood();
    if (mood) {
      const axesSummary = Object.entries(mood.axes)
        .filter(([, v]) => Math.abs(v as number) > 0.2)
        .map(([k, v]) => `${k}: ${(v as number) > 0 ? "+" : ""}${(v as number).toFixed(1)}`)
        .join(", ");
      moodContext = [
        `**Current mood:** ${mood.dominant_mood}`,
        `**Creative nudge:** ${mood.creative_nudge}`,
        axesSummary ? `**Axes:** ${axesSummary}` : "",
      ].filter(Boolean).join("\n");
    }
  } catch { /* mood not available */ }

  let iterationEntries: Array<{ iteration?: number; outcome?: string }> = [];
  let lastOutcome: string | undefined;
  let nextIteration: number | undefined;
  try {
    iterationEntries = await readJsonlEntries<{ iteration?: number; outcome?: string }>(resolve("logs", "iterations.jsonl"));
    lastOutcome = iterationEntries.at(-1)?.outcome;
    const iterations = iterationEntries
      .map((entry) => entry.iteration)
      .filter((iteration): iteration is number => Number.isFinite(iteration));
    if (iterations.length > 0) nextIteration = Math.max(...iterations) + 1;
  } catch { /* iteration log not available yet */ }

  const streakContext = formatStreakContext(await loadStreakHistory(), "ideator", config.streaks);
  const complexityContext = formatComplexityBias(await loadComplexityBias());
  const stokerContext = formatStokerDirective(await loadStokerDirective(), nextIteration);
  const speculativeIdeas = filterCurrentSpeculativeIdeas(await loadSpeculativeIdeas(), nextIteration);
  const speculativeContext = formatSpeculativeIdeas(speculativeIdeas, { last_outcome: lastOutcome });

  sections.push(
    "\n## Creative Lineage\n",
    constellationContext,
    "\n## Creative Mood\n",
    moodContext,
    "\n## The Dream Journal (Fallen Artifacts Worth Revisiting)\n",
    dreamsContext,
    speculativeContext ? "\n" : "",
    speculativeContext,
    "\n## Active Projects\n",
    projectSummary,
    stokerContext ? "\n" : "",
    stokerContext,
    streakContext ? "\n" : "",
    streakContext,
    complexityContext ? "\n" : "",
    complexityContext,
    "\n## External Stimuli\n",
    "### Live\n",
    liveStimuli,
    "\n### Reference Skills\n",
    skills,
  );

  return assembleBlock(shared, sections.join("\n"));
}

export async function buildCreatorContext(
  shared: string,
  config: FoundryConfig,
  proposal: string,
  projectContext?: string
): Promise<ContextBlock> {
  const [decisions, testReports] = await Promise.all([
    readDecisions(),
    readTestReports(),
  ]);

  const gate2Reviews = decisions.filter((d) => d.gate === "gate2");
  const recentReviews = selectDiverseReviews(
    gate2Reviews,
    config.context.critic_review_history,
  );

  const recentTests = testReports.slice(-config.context.critic_review_history);

  const sections = [
    "## Approved Proposal\n",
    proposal,
    "\n## Critic's Recent Reviews\n",
    formatDecisions(recentReviews),
    "\n## Recent Test Reports\n",
    formatTestReports(recentTests),
  ];

  if (projectContext) {
    sections.push("\n## Project Context\n", projectContext);
  }

  const streakContext = formatStreakContext(await loadStreakHistory(), "creator", config.streaks);
  if (streakContext) {
    sections.push("\n", streakContext);
  }

  return assembleBlock(shared, sections.join("\n"));
}

export function buildTesterContext(
  proposal: string,
  criticNotes: string,
  artifactContent: string
): ContextBlock {
  const sections = [
    "## Original Proposal\n",
    proposal,
    "\n## Critic's Sharpening Notes\n",
    criticNotes || "*No sharpening notes provided.*",
    "\n## Artifact to Test\n",
    artifactContent,
  ];

  const agentSpecific = sections.join("\n");
  return {
    shared: "",
    agentSpecific,
    full: agentSpecific,
  };
}

export async function buildCriticGate1Context(
  shared: string,
  config: FoundryConfig,
  proposals: string
): Promise<ContextBlock> {
  const decisions = await readDecisions();

  const recentGate1 = decisions
    .filter((d) => d.gate === "gate1")
    .slice(-config.context.critic_gate1_history);

  const sections = [
    "## Your Recent Gate 1 History\n",
    formatDecisions(recentGate1),
    "\n## Proposals to Evaluate\n",
    proposals,
  ];

  return assembleBlock(shared, sections.join("\n"));
}

export async function buildCriticGate2Context(
  shared: string,
  config: FoundryConfig,
  artifact: string,
  proposal: string,
  testerReport: string
): Promise<ContextBlock> {
  const decisions = await readDecisions();

  const recentReviews = decisions
    .filter((d) => d.gate === "gate2")
    .slice(-config.context.critic_review_history);

  const sections = [
    "## Your Recent Review History\n",
    formatDecisions(recentReviews),
    "\n## Original Proposal\n",
    proposal,
    "\n## Tester Report\n",
    testerReport || "*No tester report (non-code artifact).*",
    "\n## Artifact to Review\n",
    artifact,
  ];

  return assembleBlock(shared, sections.join("\n"));
}

export async function buildCuratorContext(
  config: FoundryConfig
): Promise<ContextBlock> {
  const [
    shared,
    fullJournal,
    decisions,
    testReports,
    liveStimuli,
    requestsContent,
    projectsIndex,
  ] = await Promise.all([
    buildSharedContext(config),
    safeRead(resolve("identity", "journal.md")),
    readDecisions(),
    readTestReports(),
    readLiveStimuli(),
    safeRead(resolve(config.intervention.requests_file)),
    safeRead(resolve("portfolio", "projects", "index.md")),
  ]);

  const sections = [
    "## Full Journal\n",
    fullJournal || "*No journal entries yet.*",
    "\n## All Recent Decisions\n",
    formatDecisions(decisions.slice(-20)),
    "\n## All Recent Test Reports\n",
    formatTestReports(testReports.slice(-20)),
    "\n## Current Stimuli State\n",
    liveStimuli,
    "\n## Project Statuses\n",
    projectsIndex || "*No active projects.*",
    "\n## Human Requests\n",
    requestsContent.trim() || "*No pending requests.*",
  ];

  return assembleBlock(shared, sections.join("\n"));
}
