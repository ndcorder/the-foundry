import type {
  FoundryConfig,
  ModelsConfig,
  AgentRole,
  IdeatorResponse,
  CriticGate1Response,
  CreatorResponse,
  TesterResponse,
  CriticGate2Response,
  CuratorRedirectResponse,
  IdeatorProposal,
  DecisionLogEntry,
} from "../types/index.js";
import { callModel, type ModelCallResult } from "../model/index.js";
import {
  parseYaml,
  buildCorrectionPrompt,
  validateIdeator,
  validateCriticGate1,
  validateCreator,
  validateTester,
  validateCriticGate2,
  validateCuratorRedirect,
  type Validator,
} from "../parser/index.js";
import { logDecision } from "../logging/index.js";
import {
  buildSharedContext,
  loadDomainsConfig,
  readDecisions,
  readTestReports,
  readLiveStimuli,
  pickRandomSkills,
  formatDecisions,
  formatTestReports,
  selectDiverseReviews,
  safeRead,
  getComplexityDistribution,
  formatComplexityDistribution,
  readLineageContext,
  readMoodContext,
  readDreamsContext,
  readJsonlEntries,
} from "../context/index.js";
import { loadPrompt, loadCriticGate1Prompt, loadCriticGate2Prompt, injectVars } from "./prompt.js";
import { resolve } from "../root.js";
import { formatStreakContext, loadStreakHistory } from "../streaks/index.js";
import { formatComplexityBias, loadComplexityBias } from "../complexity/index.js";
import { formatStokerDirective, loadStokerDirective } from "../stoker/index.js";
import { filterCurrentSpeculativeIdeas, formatSpeculativeIdeas, loadSpeculativeIdeas } from "../speculative/index.js";
import { getActiveProjects, getProjectContext } from "../files/projects.js";

interface DispatchResult<T> {
  data: T;
  usage: { input: number; output: number };
  rawText: string;
}

const MAX_YAML_RETRIES = 2;

function proposalDomainsAreAllowed(proposals: IdeatorProposal[], allowedDomains: ReadonlySet<string>): boolean {
  return proposals.every((proposal) => allowedDomains.has(proposal.domain));
}

function proposalProjectEstimateFitsConfig(proposal: IdeatorProposal, config: FoundryConfig): boolean {
  if (proposal.xl_mode !== "project" || !proposal.project) return true;
  return proposal.project.estimated_iterations <= config.projects.max_iterations_per_project;
}

function proposalProjectEstimatesFitConfig(proposals: IdeatorProposal[], config: FoundryConfig): boolean {
  return proposals.every((proposal) => proposalProjectEstimateFitsConfig(proposal, config));
}

function proposalProjectIdIsActive(proposal: IdeatorProposal, activeProjectIds: ReadonlySet<string>): boolean {
  return proposal.project_id === undefined || proposal.project_id === null || activeProjectIds.has(proposal.project_id);
}

function proposalProjectIdsAreActive(proposals: IdeatorProposal[], activeProjectIds: ReadonlySet<string>): boolean {
  return proposals.every((proposal) => proposalProjectIdIsActive(proposal, activeProjectIds));
}

function ideatorValidatorForConfig(
  allowedDomains: ReadonlySet<string>,
  config: FoundryConfig,
  activeProjectIds: ReadonlySet<string>,
): Validator<IdeatorResponse> {
  return (data: unknown): data is IdeatorResponse =>
    validateIdeator(data) &&
    proposalDomainsAreAllowed(data.ideas, allowedDomains) &&
    proposalProjectEstimatesFitConfig(data.ideas, config) &&
    proposalProjectIdsAreActive(data.ideas, activeProjectIds);
}

function curatorRedirectValidatorForConfig(
  allowedDomains: ReadonlySet<string>,
  config: FoundryConfig,
  activeProjectIds: ReadonlySet<string>,
): Validator<CuratorRedirectResponse> {
  return (data: unknown): data is CuratorRedirectResponse =>
    validateCuratorRedirect(data) &&
    proposalDomainsAreAllowed([data.proposal], allowedDomains) &&
    proposalProjectEstimateFitsConfig(data.proposal, config) &&
    proposalProjectIdIsActive(data.proposal, activeProjectIds);
}

function extractProposalTitles(proposalsYaml: string): ReadonlySet<string> {
  try {
    const data = parseYaml<unknown>(proposalsYaml);
    if (!data || typeof data !== "object" || !Array.isArray((data as { ideas?: unknown }).ideas)) {
      return new Set();
    }

    return new Set(
      (data as { ideas: Array<{ title?: unknown }> }).ideas
        .map((idea) => idea.title)
        .filter((title): title is string => typeof title === "string" && title.trim().length > 0)
        .map((title) => title.trim()),
    );
  } catch {
    return new Set();
  }
}

function criticGate1ReferencesProposalSlate(
  data: CriticGate1Response,
  proposalTitles: ReadonlySet<string>,
): boolean {
  if (proposalTitles.size === 0) return true;
  if (data.evaluations.some((evaluation) => !proposalTitles.has(evaluation.title))) return false;
  const evaluationTitles = new Set(data.evaluations.map((evaluation) => evaluation.title));
  if (evaluationTitles.size !== proposalTitles.size) return false;
  for (const title of proposalTitles) {
    if (!evaluationTitles.has(title)) return false;
  }

  const selected = typeof data.selected === "string" ? data.selected.trim() : "";
  if (!selected) return true;
  return proposalTitles.has(selected)
    && data.evaluations.some((evaluation) => evaluation.title === selected && evaluation.decision === "approve");
}

function criticGate1ValidatorForProposals(proposalTitles: ReadonlySet<string>): Validator<CriticGate1Response> {
  return (data: unknown): data is CriticGate1Response =>
    validateCriticGate1(data) && criticGate1ReferencesProposalSlate(data, proposalTitles);
}

async function loadProjectContextForProposal(proposal: IdeatorProposal): Promise<string> {
  if (!proposal.project_id) return "*No project context (standalone artifact).*";
  const projectContext = await getProjectContext(proposal.project_id);
  return projectContext.trim() || `*Project context unavailable for ${proposal.project_id}; treat as a standalone artifact.*`;
}

async function dispatchWithRetry<T>(
  config: FoundryConfig,
  models: ModelsConfig,
  role: AgentRole,
  systemPrompt: string,
  iteration: number,
  validator: Validator<T>,
): Promise<DispatchResult<T>> {
  const agentConfig = models.agents[role];
  let totalUsage = { input: 0, output: 0 };
  let lastText = "";

  for (let attempt = 0; attempt <= MAX_YAML_RETRIES; attempt++) {
    const userMessage = attempt === 0
      ? "Begin."
      : buildCorrectionPrompt(lastText, "YAML validation failed — see above.", role);

    const result: ModelCallResult = await callModel(
      agentConfig,
      systemPrompt,
      userMessage,
      iteration,
      `${role}${attempt > 0 ? `-retry${attempt}` : ""}`,
    );

    totalUsage.input += result.usage.input;
    totalUsage.output += result.usage.output;
    lastText = result.text;

    try {
      const data = parseYaml<T>(result.text);
      if (validator(data)) {
        if (attempt > 0) console.log(`  [${role}] YAML recovered on attempt ${attempt + 1}`);
        return { data, usage: totalUsage, rawText: result.text };
      }
      const keys = data ? Object.keys(data as any).join(", ") : "null";
      console.warn(`  [${role}] YAML parsed but structurally invalid (attempt ${attempt + 1}). Keys: ${keys}`);
      console.warn(`  [${role}] First 200 chars: ${result.text.slice(0, 200).replace(/\n/g, "\\n")}`);
    } catch (err) {
      /* v8 ignore start */
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  [${role}] YAML parse error (attempt ${attempt + 1}): ${msg}`);
      console.warn(`  [${role}] First 200 chars: ${result.text.slice(0, 200).replace(/\n/g, "\\n")}`);
      /* v8 ignore stop */
    }
  }

  throw new Error(`[${role}] Failed to get valid YAML after ${MAX_YAML_RETRIES + 1} attempts`);
}

// ── Ideator ──────────────────────────────────────────────────────

export async function dispatchIdeator(
  config: FoundryConfig,
  models: ModelsConfig,
  iteration: number,
  rejectionContext?: string,
  additionalDirection?: string,
): Promise<DispatchResult<IdeatorResponse>> {
  const [shared, domains, activeProjects] = await Promise.all([
    buildSharedContext(config),
    loadDomainsConfig(),
    getActiveProjects(),
  ]);
  const activeProjectIds = new Set(activeProjects.map((project) => project.project_id));
  const decisions = await readDecisions();
  const gate1 = decisions
    .filter((d) => d.gate === "gate1")
    .slice(-config.context.critic_gate1_history);
  const [
    liveStimuli,
    skills,
    lineageContext,
    moodContext,
    dreamsContext,
    streakHistory,
    complexityBias,
    stokerDirective,
    speculativeIdeas,
    iterationEntries,
  ] = await Promise.all([
    readLiveStimuli(),
    pickRandomSkills(config.stimuli.skills_per_context),
    readLineageContext(),
    readMoodContext(),
    readDreamsContext(3),
    loadStreakHistory(),
    loadComplexityBias(),
    loadStokerDirective(),
    loadSpeculativeIdeas(),
    readJsonlEntries<{ outcome?: string }>(resolve("logs", "iterations.jsonl")),
  ]);
  const streakContext = formatStreakContext(streakHistory, "ideator", config.streaks);
  const complexityBiasContext = formatComplexityBias(complexityBias);
  const stokerContext = formatStokerDirective(stokerDirective, iteration);
  const currentSpeculativeIdeas = filterCurrentSpeculativeIdeas(speculativeIdeas, iteration);
  const speculativeContext = formatSpeculativeIdeas(currentSpeculativeIdeas, { last_outcome: iterationEntries.at(-1)?.outcome });

  const template = await loadPrompt("ideator");
  const prompt = injectVars(template, {
    shared_context: shared,
    stimuli_live: liveStimuli,
    stimuli_skills: skills,
    lineage_context: lineageContext,
    mood_context: moodContext,
    dreams_context: dreamsContext,
    streak_context: streakContext,
    complexity_bias: complexityBiasContext,
    stoker_directive: stokerContext,
    speculative_ideas: speculativeContext,
    critic_gate1_history: formatDecisions(gate1),
    domain_list: domains.domains.map((d) => d.name).join(", "),
    domain_cooldown: String(config.iteration.domain_cooldown),
    novelty_window: String(config.iteration.novelty_window),
    max_iterations_per_project: String(config.projects.max_iterations_per_project),
  });

  let systemPrompt = prompt;
  const adaptiveGuidance = [stokerContext, speculativeContext, streakContext, complexityBiasContext]
    .filter((section) => {
      const trimmed = section.trim();
      return trimmed && !prompt.includes(trimmed);
    })
    .join("\n\n");
  if (adaptiveGuidance) {
    systemPrompt += "\n\n" + adaptiveGuidance;
  }
  if (rejectionContext) {
    systemPrompt += "\n\n## Previous Rejection\n\n" + rejectionContext;
  }
  if (additionalDirection) {
    systemPrompt += "\n\n## Additional Direction\n\n" + additionalDirection;
  }

  return dispatchWithRetry<IdeatorResponse>(
    config,
    models,
    "ideator",
    systemPrompt,
    iteration,
    ideatorValidatorForConfig(new Set(domains.domains.map((domain) => domain.name)), config, activeProjectIds),
  );
}

// ── Critic Gate 1 ────────────────────────────────────────────────

export async function dispatchCriticGate1(
  config: FoundryConfig,
  models: ModelsConfig,
  iteration: number,
  proposals: string,
  source?: DecisionLogEntry["source"],
): Promise<DispatchResult<CriticGate1Response>> {
  const shared = await buildSharedContext(config);
  const decisions = await readDecisions();
  const gate1 = decisions
    .filter((d) => d.gate === "gate1")
    .slice(-config.context.critic_gate1_history);

  // Complexity distribution for ambition scaling
  const complexityDist = await getComplexityDistribution(config.iteration.novelty_window);
  const complexityDistStr = formatComplexityDistribution(complexityDist);

  const template = await loadCriticGate1Prompt();
  const prompt = injectVars(template, {
    shared_context: shared,
    ideator_proposals: proposals,
    critic_gate1_history: formatDecisions(gate1),
    complexity_distribution: complexityDistStr,
  });

  const result = await dispatchWithRetry<CriticGate1Response>(
    config,
    models,
    "critic",
    prompt,
    iteration,
    criticGate1ValidatorForProposals(extractProposalTitles(proposals)),
  );

  // Log each evaluation as a decision
  for (const ev of result.data.evaluations) {
    await logDecision({
      timestamp: new Date().toISOString(),
      iteration,
      gate: "gate1",
      agent: "critic",
      decision: ev.decision,
      proposal_title: ev.title,
      ...(source ? { source } : {}),
      sharpening_notes: ev.sharpening_notes || undefined,
      reasons: ev.reasons || undefined,
      recommended_complexity: ev.recommended_complexity || undefined,
    });
  }

  return result;
}

// ── Creator ──────────────────────────────────────────────────────

export async function dispatchCreator(
  config: FoundryConfig,
  models: ModelsConfig,
  iteration: number,
  proposal: IdeatorProposal,
  criticNotes: string,
  revisionNotes?: string,
): Promise<DispatchResult<CreatorResponse>> {
  const shared = await buildSharedContext(config);
  const decisions = await readDecisions();
  const testReports = await readTestReports();
  const gate2Reviews = decisions.filter((d) => d.gate === "gate2");
  const recentReviews = selectDiverseReviews(
    gate2Reviews,
    config.context.critic_review_history,
  );
  const recentTests = testReports.slice(-config.context.critic_review_history);

  const manifesto = await safeRead(resolve("identity", "manifesto.md"));
  const qualitySection = extractQualityStandards(manifesto);
  const streakContext = formatStreakContext(await loadStreakHistory(), "creator", config.streaks);
  const projectContext = await loadProjectContextForProposal(proposal);

  const proposalYaml = [
    `**${proposal.title}** [${proposal.domain}, ${proposal.complexity}]`,
    "",
    proposal.pitch,
    "",
    `Why: ${proposal.why}`,
  ].join("\n");

  const template = await loadPrompt("creator");
  const prompt = injectVars(template, {
    shared_context: shared,
    critic_review_history: formatDecisions(recentReviews),
    approved_proposal: proposalYaml,
    critic_sharpening_notes: criticNotes || "*No sharpening notes.*",
    project_context: projectContext,
    manifesto_quality_standards: qualitySection,
    streak_context: streakContext,
  });

  const basePrompt = streakContext ? prompt + "\n\n" + streakContext : prompt;
  const systemPrompt = revisionNotes
    ? basePrompt + "\n\n## Revision Required\n\n" + revisionNotes
    : basePrompt;

  return dispatchWithRetry<CreatorResponse>(
    config, models, "creator", systemPrompt, iteration, validateCreator,
  );
}

function extractQualityStandards(manifesto: string): string {
  const sections = ["What We Value", "What We Avoid", "Our Aesthetic"];
  const lines = manifesto.split("\n");
  const extracted: string[] = [];
  let capturing = false;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      capturing = sections.some((s) => line.includes(s));
    }
    if (capturing) extracted.push(line);
  }

  return extracted.length > 0 ? extracted.join("\n") : manifesto;
}

// ── Tester (code) ────────────────────────────────────────────────

export async function dispatchTesterTestPlan(
  config: FoundryConfig,
  models: ModelsConfig,
  iteration: number,
  proposal: IdeatorProposal,
  criticNotes: string,
  artifactContent: string,
): Promise<DispatchResult<TesterResponse>> {
  const template = await loadPrompt("tester");
  const proposalText = `**${proposal.title}** [${proposal.domain}]: ${proposal.pitch}`;

  const prompt = injectVars(template, {
    approved_proposal: proposalText,
    critic_sharpening_notes: criticNotes || "*No sharpening notes.*",
    artifact_content: artifactContent,
  });

  const codePrompt = prompt + `\n\nIMPORTANT: This is a CODE artifact. In addition to the standard YAML fields, you MUST include a \`test_plan\` block:

\`\`\`yaml
test_plan:
  language: "non-empty runtime name, e.g. node|python|go|rust"
  setup_commands:
    - "non-empty setup command, or use [] when no setup is needed"
  files:
    - path: "test_main.js"
      content: |
        // non-empty test code here
  run_command: "node test_main.js"
verdict: "pass|fail_fixable|fail_catastrophic"
summary: "non-empty 1-2 sentence overall assessment with evidence"
tests_run:
  - name: "non-empty test/check name"
    result: "pass|fail"
    details: "non-empty evidence: command output, observed behavior, or checked structure"
issues: []
post_mortem: null
\`\`\`
`;

  return dispatchWithRetry<TesterResponse>(
    config, models, "tester", codePrompt, iteration, validateTester,
  );
}

// ── Tester (non-code lightweight) ───────────────────────────────

export async function dispatchTesterLightweight(
  config: FoundryConfig,
  models: ModelsConfig,
  iteration: number,
  proposal: IdeatorProposal,
  criticNotes: string,
  artifactContent: string,
): Promise<DispatchResult<TesterResponse>> {
  const template = await loadPrompt("tester");
  const proposalText = `**${proposal.title}** [${proposal.domain}]: ${proposal.pitch}`;

  const prompt = injectVars(template, {
    approved_proposal: proposalText,
    critic_sharpening_notes: criticNotes || "*No sharpening notes.*",
    artifact_content: artifactContent,
  });

  return dispatchWithRetry<TesterResponse>(
    config, models, "tester", prompt, iteration, validateTester,
  );
}

// ── Tester verdict after sandbox execution ──────────────────────

export async function dispatchTesterVerdict(
  config: FoundryConfig,
  models: ModelsConfig,
  iteration: number,
  proposal: IdeatorProposal,
  artifactContent: string,
  executionResults: string,
): Promise<DispatchResult<TesterResponse>> {
  const prompt = `## Your Role

You are the Tester. You previously wrote tests for an artifact. The harness executed them in a sandbox. Review the results and produce your final verdict.

## Original Proposal

**${proposal.title}** [${proposal.domain}]: ${proposal.pitch}

## Artifact

${artifactContent.slice(0, 8000)}

## Sandbox Execution Results

${executionResults}

## Output Format

Respond with ONLY valid YAML:

\`\`\`yaml
verdict: "pass|fail_fixable|fail_catastrophic"
summary: "non-empty 1-2 sentence overall assessment with evidence"
tests_run:
  - name: "non-empty test/check name"
    result: "pass|fail"
    details: "non-empty evidence: command output, observed behavior, or checked structure"
issues:
  - severity: "critical|major|minor"
    description: "non-empty issue description"
    location: "non-empty file:line or section reference"
    suggested_fix: "non-empty fix guidance; required for fail_fixable, omit or null otherwise"
post_mortem: null
\`\`\`
`;

  return dispatchWithRetry<TesterResponse>(
    config, models, "tester", prompt, iteration, validateTester,
  );
}

// ── Critic Gate 2 ────────────────────────────────────────────────

export async function dispatchCriticGate2(
  config: FoundryConfig,
  models: ModelsConfig,
  iteration: number,
  proposal: IdeatorProposal,
  artifactContent: string,
  testerReport: string,
): Promise<DispatchResult<CriticGate2Response>> {
  const shared = await buildSharedContext(config);
  const decisions = await readDecisions();
  const recentReviews = decisions
    .filter((d) => d.gate === "gate2")
    .slice(-config.context.critic_review_history);

  const template = await loadCriticGate2Prompt();
  const proposalText = `**${proposal.title}** [${proposal.domain}]: ${proposal.pitch}`;

  const prompt = injectVars(template, {
    shared_context: shared,
    critic_review_history: formatDecisions(recentReviews),
    artifact_content: artifactContent,
    approved_proposal: proposalText,
    tester_report: testerReport || "*No tester report (non-code artifact).*",
  });

  const result = await dispatchWithRetry<CriticGate2Response>(
    config, models, "critic", prompt, iteration, validateCriticGate2,
  );

  await logDecision({
    timestamp: new Date().toISOString(),
    iteration,
    gate: "gate2",
    agent: "critic",
    decision: result.data.decision,
    proposal_title: proposal.title,
    ratings: result.data.ratings,
    review: result.data.review,
    reasons: result.data.revision_notes || result.data.kill_reason || undefined,
  });

  return result;
}

// ── Curator redirect ─────────────────────────────────────────────

export async function dispatchCuratorRedirect(
  config: FoundryConfig,
  models: ModelsConfig,
  iteration: number,
  humanRequest: string,
): Promise<DispatchResult<CuratorRedirectResponse>> {
  const [domains, activeProjects] = await Promise.all([
    loadDomainsConfig(),
    getActiveProjects(),
  ]);
  const activeProjectIds = new Set(activeProjects.map((project) => project.project_id));
  const domainList = domains.domains.map((d) => d.name).join(", ");
  const activeProjectList = activeProjects.length > 0
    ? activeProjects.map((project) => `- ${project.project_id}: ${project.name}`).join("\n")
    : "*No active projects.*";

  const prompt = `## Your Role

You are the Curator handling a human redirect. A human has written a request that should completely replace this iteration's Ideation phase. Translate their request into a single well-formed proposal.

## Human Request

${humanRequest}

## Available Domains

${domainList}

## Active Projects

${activeProjectList}

## Output Format

If this redirect should start a project, use \`xl_mode: project\` and keep \`project.estimated_iterations\` at or below ${config.projects.max_iterations_per_project}. Otherwise leave \`xl_mode\` and \`project\` null.
If this redirect should continue a project, use only a \`project_id\` listed in Active Projects.

Respond with ONLY valid YAML:

\`\`\`yaml
proposal:
  title: "..."
  domain: "..."
  pitch: "..."
  complexity: "S|M|L|XL"
  why: "Responding to human redirect."
  project_id: null
  stimulus_ref: null
  xl_mode: null
  project: null
\`\`\`
`;

  return dispatchWithRetry<CuratorRedirectResponse>(
    config,
    models,
    "curator",
    prompt,
    iteration,
    curatorRedirectValidatorForConfig(new Set(domains.domains.map((domain) => domain.name)), config, activeProjectIds),
  );
}
