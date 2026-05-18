import { readFile } from "node:fs/promises";
import path from "node:path";
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
} from "./data.js";
import { getActiveProjects } from "../files/projects.js";

function resolve(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}

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

  const projectSummary = activeProjects.length > 0
    ? activeProjects.map((p) =>
        `- **${p.project_id}** "${p.name}" — ${p.completed_iterations}/${p.estimated_iterations} iterations done`
      ).join("\n")
    : "*No active projects.*";

  const sections = [
    "## Critic's Recent Gate 1 Decisions\n",
    formatDecisions(gate1Decisions),
  ];

  if (curatorRecs.trim()) {
    sections.push("\n## Curator's Recommendations\n", curatorRecs);
  }

  sections.push(
    "\n## Active Projects\n",
    projectSummary,
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
