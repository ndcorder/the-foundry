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
  CriticRatings,
  IterationResult,
} from "../types/index.js";
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
import { logIteration, logTestReport } from "../logging/index.js";
import { createSandbox, type SandboxSession } from "../sandbox/index.js";

interface IterationContext {
  config: FoundryConfig;
  models: ModelsConfig;
  iteration: number;
}

function serializeArtifact(files: Array<{ path: string; content: string }>): string {
  return files
    .map((f) => `### ${f.path}\n\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");
}

function proposalToYaml(p: IdeatorProposal): string {
  return yaml.stringify({ ideas: [p] });
}

function computeMeanRating(ratings: CriticRatings): string {
  const vals = Object.values(ratings).filter((v): v is number => v !== undefined);
  if (vals.length === 0) return "N/A";
  return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
}

// ────────────────────────────────────────────────────────────
// Phase 4 — Testing
// ────────────────────────────────────────────────────────────

async function runCodeTests(
  ctx: IterationContext,
  proposal: IdeatorProposal,
  criticNotes: string,
  artifact: CreatorResponse,
): Promise<{ report: TesterResponse; usage: { input: number; output: number } }> {
  const artifactContent = serializeArtifact(artifact.files);
  let totalUsage = { input: 0, output: 0 };

  // Phase A: Get test plan from Tester
  const planResult = await dispatchTesterTestPlan(
    ctx.config, ctx.models, ctx.iteration, proposal, criticNotes, artifactContent,
  );
  totalUsage.input += planResult.usage.input;
  totalUsage.output += planResult.usage.output;

  const testPlan = planResult.data.test_plan;
  if (!testPlan) {
    // Tester didn't provide a test plan — use its verdict as-is
    return { report: planResult.data, usage: totalUsage };
  }

  // Phase B: Execute tests in sandbox
  let sandbox: SandboxSession | null = null;
  let executionOutput: string;
  let sandboxUnavailable = false;
  try {
    sandbox = await createSandbox({ timeoutMs: 90_000 });

    // Write artifact files to sandbox
    for (const f of artifact.files) {
      await sandbox.writeFile(f.path, f.content);
    }

    // Write test files to sandbox
    for (const f of testPlan.files) {
      await sandbox.writeFile(f.path, f.content);
    }

    // Run setup commands
    for (const cmd of testPlan.setup_commands) {
      const setupResult = await sandbox.exec(cmd, 120_000);
      if (setupResult.exitCode !== 0) {
        executionOutput = `Setup command failed: ${cmd}\nExit code: ${setupResult.exitCode}\nStderr: ${setupResult.stderr}\nStdout: ${setupResult.stdout}`;
        // Don't bail entirely — let the Tester interpret the failure
        break;
      }
    }

    // Run tests
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

  // If sandbox infrastructure is missing, fall back to lightweight testing
  if (sandboxUnavailable) {
    console.warn("  ⚠ Sandbox unavailable (QEMU not installed) — falling back to lightweight verification.");
    return runLightweightTests(ctx, proposal, criticNotes, artifact);
  }

  // Phase C: Get final verdict from Tester
  const verdictResult = await dispatchTesterVerdict(
    ctx.config, ctx.models, ctx.iteration, proposal, artifactContent, executionOutput!,
  );
  totalUsage.input += verdictResult.usage.input;
  totalUsage.output += verdictResult.usage.output;

  return { report: verdictResult.data, usage: totalUsage };
}

async function runLightweightTests(
  ctx: IterationContext,
  proposal: IdeatorProposal,
  criticNotes: string,
  artifact: CreatorResponse,
): Promise<{ report: TesterResponse; usage: { input: number; output: number } }> {
  const artifactContent = serializeArtifact(artifact.files);

  const result = await dispatchTesterLightweight(
    ctx.config, ctx.models, ctx.iteration, proposal, criticNotes, artifactContent,
  );

  return { report: result.data, usage: result.usage };
}

// ────────────────────────────────────────────────────────────
// Main iteration
// ────────────────────────────────────────────────────────────

export async function runIteration(
  config: FoundryConfig,
  models: ModelsConfig,
  iteration: number,
): Promise<IterationResult> {
  const startMs = Date.now();
  let totalUsage = { input: 0, output: 0 };

  function addUsage(u: { input: number; output: number }): void {
    totalUsage.input += u.input;
    totalUsage.output += u.output;
  }

  const ctx: IterationContext = { config, models, iteration };

  console.log(`\n${"━".repeat(60)}`);
  console.log(`  Iteration ${iteration}`);
  console.log(`${"━".repeat(60)}\n`);

  // ── Phase 0: Pre-check ──────────────────────────────────────
  console.log("▶ Phase 0: Pre-check");

  if (await checkStopFile(config)) {
    console.log("  STOP file detected — halting.");
    await appendJournal(`**Iteration ${iteration}:** Halted by STOP file.`);
    return {
      iteration,
      outcome: "halted",
      reason: "STOP file detected",
      token_usage: totalUsage,
      duration_ms: Date.now() - startMs,
    };
  }

  // Check for human redirect
  let approvedProposal: IdeatorProposal | null = null;
  let approvedNotes = "";

  const requestContent = await readRequests(config);
  if (requestContent) {
    console.log("  Human redirect detected — translating via Curator.");
    const redirectResult = await dispatchCuratorRedirect(config, models, iteration, requestContent);
    addUsage(redirectResult.usage);
    approvedProposal = redirectResult.data.proposal;
    approvedNotes = "Human redirect — evaluate charitably.";
    await clearRequests(config);
    await appendJournal(
      `**Iteration ${iteration}:** Human redirect processed: "${requestContent.slice(0, 100)}" → ${approvedProposal.title}`,
    );
  }

  // ── Phase 1 & 2: Ideation + Idea Gate ───────────────────────
  if (!approvedProposal) {
    for (
      let ideaAttempt = 0;
      ideaAttempt < config.iteration.max_idea_retries;
      ideaAttempt++
    ) {
      // Phase 1: Ideation
      console.log(`\n▶ Phase 1: Ideation${ideaAttempt > 0 ? ` (retry ${ideaAttempt})` : ""}`);

      const rejectionContext = ideaAttempt > 0
        ? `All previous proposals were rejected. The Critic said: "${approvedNotes}". Propose 3 NEW ideas that address these concerns.`
        : undefined;

      const ideatorResult = await dispatchIdeator(config, models, iteration, rejectionContext);
      addUsage(ideatorResult.usage);

      const ideas = ideatorResult.data.ideas;
      console.log(`  Ideator proposed: ${ideas.map((i) => `"${i.title}" [${i.domain}]`).join(", ")}`);

      // Phase 2: Idea Gate
      console.log("\n▶ Phase 2: Idea Gate (Critic)");

      const proposalsYaml = yaml.stringify({ ideas });
      const gate1Result = await dispatchCriticGate1(config, models, iteration, proposalsYaml);
      addUsage(gate1Result.usage);

      const gate1 = gate1Result.data;
      for (const ev of gate1.evaluations) {
        const icon = ev.decision === "approve" ? "✓" : ev.decision === "reject" ? "✗" : "↻";
        console.log(`  ${icon} "${ev.title}": ${ev.decision}${ev.reasons ? " — " + ev.reasons.slice(0, 80) : ""}`);
      }

      // Find approved proposal
      const approved = gate1.evaluations.find((e) => e.decision === "approve");
      if (approved) {
        approvedProposal = ideas.find((i) => i.title === approved.title) ?? ideas[0];
        approvedNotes = approved.sharpening_notes || "";
        console.log(`  ✓ Selected: "${approvedProposal.title}"`);
        break;
      }

      // All rejected — collect reasons for retry
      const rejectionReasons = gate1.evaluations
        .map((e) => `"${e.title}": ${e.reasons || "no reason given"}`)
        .join("; ");
      approvedNotes = rejectionReasons;
      console.log(`  All proposals rejected. ${ideaAttempt < config.iteration.max_idea_retries - 1 ? "Retrying..." : "Deadlock."}`);
    }

    if (!approvedProposal) {
      // Deadlock after max retries
      console.log("\n  ⚠ Ideation deadlock — skipping iteration.");
      const reason = `Ideation deadlock after ${config.iteration.max_idea_retries} attempts. Last rejection reasons: ${approvedNotes}`;
      await appendJournal(`**Iteration ${iteration}:** Skipped. ${reason}`);
      await logIteration({
        timestamp: new Date().toISOString(),
        iteration,
        outcome: "skipped",
        reason,
        token_usage: totalUsage,
        duration_ms: Date.now() - startMs,
      });
      return {
        iteration,
        outcome: "skipped",
        reason,
        token_usage: totalUsage,
        duration_ms: Date.now() - startMs,
      };
    }
  }

  // From here, approvedProposal is guaranteed non-null
  const proposal = approvedProposal!;
  const criticNotes = approvedNotes;

  // ── Phase 3–5 loop: Create → Test → Review (with revision cycles) ──
  let artifact: CreatorResponse | null = null;
  let testerReport: TesterResponse | null = null;
  let gate2: CriticGate2Response | null = null;
  let artifactId = "";

  for (
    let revisionRound = 0;
    revisionRound <= config.iteration.max_revision_rounds;
    revisionRound++
  ) {
    // Phase 3: Creation
    console.log(`\n▶ Phase 3: Creation${revisionRound > 0 ? ` (revision ${revisionRound})` : ""}`);

    const revisionNotes = revisionRound > 0 && gate2?.revision_notes
      ? gate2.revision_notes
      : undefined;

    const creatorResult = await dispatchCreator(
      ctx.config, ctx.models, ctx.iteration, proposal, criticNotes, revisionNotes,
    );
    addUsage(creatorResult.usage);
    artifact = creatorResult.data;

    console.log(`  Created: "${artifact.title}" (${artifact.files.length} file${artifact.files.length > 1 ? "s" : ""})`);

    // Write to workspace
    await clearWorkspace();
    for (const f of artifact.files) {
      await writeWorkspaceFile(f.path, f.content);
    }

    // Phase 4: Testing
    const isCode = isCodeDomain(proposal.domain);
    console.log(`\n▶ Phase 4: Testing (${isCode ? "code sandbox" : "lightweight"})`);

    let testFixCycles = 0;
    while (true) {
      const testResult = isCode
        ? await runCodeTests(ctx, proposal, criticNotes, artifact)
        : await runLightweightTests(ctx, proposal, criticNotes, artifact);

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

      // fail_fixable — let Creator fix it
      testFixCycles++;
      if (testFixCycles >= config.iteration.max_test_fix_cycles) {
        console.log(`  ✗ Max fix cycles (${config.iteration.max_test_fix_cycles}) exhausted.`);
        break;
      }

      console.log(`  ↻ Fixable issues — sending back to Creator (fix cycle ${testFixCycles})`);
      const fixNotes = testerReport.issues
        ?.map((i) => `[${i.severity}] ${i.description} at ${i.location}${i.suggested_fix ? " — fix: " + i.suggested_fix : ""}`)
        .join("\n") || testerReport.summary;

      const fixResult = await dispatchCreator(
        ctx.config, ctx.models, ctx.iteration, proposal, criticNotes,
        `Fix these issues from the Tester:\n\n${fixNotes}`,
      );
      addUsage(fixResult.usage);
      artifact = fixResult.data;

      await clearWorkspace();
      for (const f of artifact.files) {
        await writeWorkspaceFile(f.path, f.content);
      }
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

    const gate2Result = await dispatchCriticGate2(
      ctx.config, ctx.models, ctx.iteration, proposal, artifactContent, testerReportText,
    );
    addUsage(gate2Result.usage);
    gate2 = gate2Result.data;

    const mean = computeMeanRating(gate2.ratings);
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
      // Force ship on final round if not killed
      gate2 = { ...gate2, decision: "ship" };
    }
  }

  // ── Phase 6: Bookkeeping ─────────────────────────────────────
  console.log("\n▶ Phase 6: Bookkeeping");

  artifactId = await getNextArtifactId();
  const durationMs = Date.now() - startMs;

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

    await logIteration({
      timestamp: new Date().toISOString(),
      iteration,
      outcome: "killed",
      artifact_id: artifactId,
      title: proposal.title,
      domain: proposal.domain,
      reason: gate2!.kill_reason || gate2!.review,
      token_usage: totalUsage,
      duration_ms: durationMs,
    });

    console.log(`  Killed artifact ${artifactId} written to portfolio/killed/`);

    return {
      iteration,
      outcome: "killed",
      artifact_id: artifactId,
      title: proposal.title,
      domain: proposal.domain,
      reason: gate2!.kill_reason || gate2!.review,
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

  const mean = computeMeanRating(gate2!.ratings);
  await updatePortfolioIndex(artifactId, proposal.title, proposal.domain, mean);

  await appendJournal(
    `**Iteration ${iteration} — SHIPPED:** "${proposal.title}" [${proposal.domain}] as ${artifactId}. ` +
    `Rating: ${mean}. Review: ${gate2!.review.slice(0, 200)}. ` +
    `Token usage: ${totalUsage.input}in/${totalUsage.output}out.`,
  );

  await logIteration({
    timestamp: new Date().toISOString(),
    iteration,
    outcome: "shipped",
    artifact_id: artifactId,
    title: proposal.title,
    domain: proposal.domain,
    ratings: gate2!.ratings,
    mean_rating: mean,
    review: gate2!.review,
    token_usage: totalUsage,
    duration_ms: durationMs,
  });

  await clearWorkspace();

  console.log(`\n  ✓ Shipped artifact ${artifactId}: "${proposal.title}" [${proposal.domain}] — rating ${mean}`);
  console.log(`  Duration: ${(durationMs / 1000).toFixed(1)}s | Tokens: ${totalUsage.input}in/${totalUsage.output}out`);

  return {
    iteration,
    outcome: "shipped",
    artifact_id: artifactId,
    title: proposal.title,
    domain: proposal.domain,
    ratings: gate2!.ratings,
    token_usage: totalUsage,
    duration_ms: durationMs,
  };
}
