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
} from "../context/index.js";
import { loadPrompt, loadCriticGate1Prompt, loadCriticGate2Prompt, injectVars } from "./prompt.js";
import { resolve } from "../root.js";

interface DispatchResult<T> {
  data: T;
  usage: { input: number; output: number };
  rawText: string;
}

const MAX_YAML_RETRIES = 2;

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
): Promise<DispatchResult<IdeatorResponse>> {
  const shared = await buildSharedContext(config);
  const domains = await loadDomainsConfig();
  const decisions = await readDecisions();
  const gate1 = decisions
    .filter((d) => d.gate === "gate1")
    .slice(-config.context.critic_gate1_history);
  const [liveStimuli, skills] = await Promise.all([
    readLiveStimuli(),
    pickRandomSkills(config.stimuli.skills_per_context),
  ]);

  const template = await loadPrompt("ideator");
  const prompt = injectVars(template, {
    shared_context: shared,
    stimuli_live: liveStimuli,
    stimuli_skills: skills,
    critic_gate1_history: formatDecisions(gate1),
    domain_list: domains.domains.map((d) => d.name).join(", "),
    domain_cooldown: String(config.iteration.domain_cooldown),
    novelty_window: String(config.iteration.novelty_window),
  });

  const systemPrompt = rejectionContext
    ? prompt + "\n\n## Previous Rejection\n\n" + rejectionContext
    : prompt;

  return dispatchWithRetry<IdeatorResponse>(
    config, models, "ideator", systemPrompt, iteration, validateIdeator,
  );
}

// ── Critic Gate 1 ────────────────────────────────────────────────

export async function dispatchCriticGate1(
  config: FoundryConfig,
  models: ModelsConfig,
  iteration: number,
  proposals: string,
): Promise<DispatchResult<CriticGate1Response>> {
  const shared = await buildSharedContext(config);
  const decisions = await readDecisions();
  const gate1 = decisions
    .filter((d) => d.gate === "gate1")
    .slice(-config.context.critic_gate1_history);

  const template = await loadCriticGate1Prompt();
  const prompt = injectVars(template, {
    shared_context: shared,
    ideator_proposals: proposals,
    critic_gate1_history: formatDecisions(gate1),
  });

  const result = await dispatchWithRetry<CriticGate1Response>(
    config, models, "critic", prompt, iteration, validateCriticGate1,
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
      sharpening_notes: ev.sharpening_notes || undefined,
      reasons: ev.reasons || undefined,
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
    project_context: "*No project context (standalone artifact).*",
    manifesto_quality_standards: qualitySection,
  });

  const systemPrompt = revisionNotes
    ? prompt + "\n\n## Revision Required\n\n" + revisionNotes
    : prompt;

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
// Two-phase for code: first call produces test plan, second interprets results.

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

  // Append code-specific test plan output format
  const codePrompt = prompt + `\n\nIMPORTANT: This is a CODE artifact. In addition to the standard YAML fields, you MUST include a \`test_plan\` block:

\`\`\`yaml
test_plan:
  language: "node|python|go|rust|..."
  setup_commands:
    - "npm install"  # or equivalent
  files:
    - path: "test_main.js"
      content: |
        // test code here
  run_command: "node test_main.js"
verdict: "pass|fail_fixable|fail_catastrophic"
summary: "..."
tests_run:
  - name: "..."
    result: "pass|fail"
    details: "..."
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
summary: "1-2 sentence overall assessment"
tests_run:
  - name: "..."
    result: "pass|fail"
    details: "..."
issues:
  - severity: "critical|major|minor"
    description: "..."
    location: "..."
    suggested_fix: "..."
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
  /* v8 ignore start */
  const shared = await buildSharedContext(config);
  const decisions = await readDecisions();
  const recentReviews = decisions
    .filter((d) => d.gate === "gate2")
    .slice(-config.context.critic_review_history);
  /* v8 ignore stop */

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
  const domains = await loadDomainsConfig();
  const domainList = domains.domains.map((d) => d.name).join(", ");

  const prompt = `## Your Role

You are the Curator handling a human redirect. A human has written a request that should completely replace this iteration's Ideation phase. Translate their request into a single well-formed proposal.

## Human Request

${humanRequest}

## Available Domains

${domainList}

## Output Format

Respond with ONLY valid YAML:

\`\`\`yaml
proposal:
  title: "..."
  domain: "..."
  pitch: "..."
  complexity: "S|M|L"
  why: "Responding to human redirect."
  project_id: null
  stimulus_ref: null
\`\`\`
`;

  return dispatchWithRetry<CuratorRedirectResponse>(
    config, models, "curator", prompt, iteration, validateCuratorRedirect,
  );
}
