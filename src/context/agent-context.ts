import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type {
  FoundryConfig,
  ContextBlock,
  DecisionLogEntry,
  TestReportEntry,
} from "../types/index.js";
import { buildSharedContext } from "./shared.js";

function resolve(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

async function readJsonlEntries<T>(filePath: string): Promise<T[]> {
  const raw = await safeRead(filePath);
  if (!raw.trim()) return [];
  const entries: T[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as T);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

async function readDecisions(): Promise<DecisionLogEntry[]> {
  return readJsonlEntries<DecisionLogEntry>(resolve("logs", "decisions.jsonl"));
}

async function readTestReports(): Promise<TestReportEntry[]> {
  return readJsonlEntries<TestReportEntry>(resolve("logs", "test-reports.jsonl"));
}

function formatDecisions(entries: DecisionLogEntry[]): string {
  if (entries.length === 0) return "*No decisions recorded yet.*";
  return entries
    .map((d) => {
      const label = d.proposal_title || d.artifact_id || "unknown";
      const detail = d.review || d.reasons || d.sharpening_notes || "";
      return `- **${d.gate} / ${d.decision}** — ${label}${detail ? ": " + detail : ""}`;
    })
    .join("\n");
}

function formatTestReports(entries: TestReportEntry[]): string {
  if (entries.length === 0) return "*No test reports yet.*";
  return entries
    .map((r) => {
      return `- **${r.artifact_id}** [${r.outcome}] — ${r.summary} (${r.tests_passed}/${r.tests_run} passed)`;
    })
    .join("\n");
}

function assembleBlock(shared: string, agentSpecific: string): ContextBlock {
  return {
    shared,
    agentSpecific,
    full: shared + "\n\n" + agentSpecific,
  };
}

async function readLiveStimuli(): Promise<string> {
  const liveDir = resolve("stimuli", "live");
  let files: string[];
  try {
    files = await readdir(liveDir);
  } catch {
    return "*No live stimuli available.*";
  }
  const contents: string[] = [];
  for (const file of files.sort()) {
    if (!file.endsWith(".md")) continue;
    const text = await safeRead(path.join(liveDir, file));
    if (text.trim()) contents.push(text.trim());
  }
  return contents.length > 0 ? contents.join("\n\n---\n\n") : "*No live stimuli available.*";
}

async function pickRandomSkills(count: number): Promise<string> {
  const skillsDir = resolve("stimuli", "skills");
  let files: string[];
  try {
    files = (await readdir(skillsDir)).filter((f) => f.endsWith(".md"));
  } catch {
    return "*No skill files available.*";
  }
  if (files.length === 0) return "*No skill files available.*";

  const picked: string[] = [];
  const pool = [...files];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }

  const contents: string[] = [];
  for (const file of picked) {
    const text = await safeRead(path.join(skillsDir, file));
    if (text.trim()) contents.push(`### ${file}\n\n${text.trim()}`);
  }
  return contents.length > 0 ? contents.join("\n\n") : "*No skill files available.*";
}

export async function buildIdeatorContext(
  shared: string,
  config: FoundryConfig
): Promise<ContextBlock> {
  const [decisions, liveStimuli, skills] = await Promise.all([
    readDecisions(),
    readLiveStimuli(),
    pickRandomSkills(config.stimuli.skills_per_context),
  ]);

  const gate1Decisions = decisions
    .filter((d) => d.gate === "gate1")
    .slice(-config.context.critic_gate1_history);

  const sections = [
    "## Critic's Recent Gate 1 Decisions\n",
    formatDecisions(gate1Decisions),
    "\n## External Stimuli\n",
    "### Live\n",
    liveStimuli,
    "\n### Reference Skills\n",
    skills,
  ];

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

  const recentReviews = decisions
    .filter((d) => d.gate === "gate2")
    .slice(-config.context.critic_review_history);

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
