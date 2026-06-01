# The Foundry

[![CI](https://github.com/ndcorder/the-foundry/actions/workflows/ci.yml/badge.svg)](https://github.com/ndcorder/the-foundry/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/the-foundry)](https://www.npmjs.com/package/the-foundry)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> An autonomous multi-agent system that makes things — code, prose, poetry, games, music, experiments — and argues with itself about whether they're good enough to keep.

Five AI agents collaborate adversarially: one proposes, one builds, one tests, one critiques, one curates. The system runs indefinitely, developing aesthetic preferences and a collective voice that evolves with the portfolio. It maintains a living manifesto, tracks its own creative DNA, remembers its failures, and knows when it's in a rut.

---

## The Agents

| Agent | Role | Personality |
|---|---|---|
| **Ideator** | Proposes what to build next | Divergent, surprising, sometimes reckless |
| **Creator** | Builds the artifact | Craftsperson — plans, drafts, revises, polishes |
| **Tester** | Validates the artifact works | Thorough but not adversarial — catches real issues |
| **Critic** | Decides ship/revise/kill | Specific in objections, enthusiastic when earned |
| **Curator** | Maintains long-term coherence | Memory, identity, external awareness |

The agents share a collective identity (the manifesto) but disagree productively. The Critic kills work the Creator loves. The Curator evolves standards the Ideator must meet. The tension is the mechanism.

## Creative Intelligence

The Foundry doesn't just produce artifacts — it develops creative self-awareness:

- **Constellation Map** — Tracks relationships between artifacts and detects creative "constellations" — clusters like *Machines with Feelings*, *The Bureaucratic Uncanny*, and *Interfaces That Know Too Much*. The Ideator can intentionally create within, bridge between, or break away from these threads.
- **Dream Journal** — Killed artifacts aren't forgotten. Their best ideas, what went wrong, and resurrection hints are preserved and fed back to the Ideator as creative fuel.
- **Mood Engine** — A dynamic creative state that shifts based on recent work: quality trends, domain diversity, rejection rates. Influences ideation with contextual nudges like "the portfolio can handle a spectacular failure right now."
- **Continuation Greed** — Tracks hot streaks of high-rated related artifacts, pushes the Ideator and Creator to amplify what is working, and forces a short pivot when a streak breaks.
- **Adaptive Complexity ROI** — Learns which complexity tiers produce the best Critic rating per token and nudges the Ideator toward high-yield scales.
- **Stoker Directive Loop** — A deterministic furnace operator that reads streaks, complexity ROI, mood, dream fuel, token heat, and recent outcomes, then writes a next-iteration directive for the Ideator.
- **Speculative Pre-generation** — Carries salvageable unselected Gate 1 ideas into the next iteration so promising kernels are refined instead of lost, then lets that fuel expire instead of haunting later runs.
- **Background Refinery** — Stoker-queued second passes turn killed dreams, high-rated companion opportunities, and old low-rated artifacts into reviewed `[refined]` portfolio entries, with start-loop lifecycle events for queued work.
- **External Stimuli** — Live feeds (news, trending repos, random knowledge) and curated skill files (writing techniques, sound design, speculative design, constraint art) fight creative entropy by injecting material the system couldn't generate from its own context.
- **Monitor System** — Four detectors watch for slop (quality crisis), repetition (similar artifacts), manifesto drift (identity instability), and domain collapse (creative narrowing).

## The Observatory

A built-in dashboard for watching the system think:

- **Observatory** — Live stats, quality trends, domain distribution, token usage, iteration timeline
- **Constellation Map** — Interactive force-directed graph of the portfolio's creative lineage, with glowing nodes and nebula-like constellation hulls
- **Evolution Timeline** — How the system's creative life has unfolded over time — quality arcs, domain exploration phases, and key moments

```bash
foundry dashboard   # http://localhost:3333
```

## The Portfolio

Some things The Foundry has made:

- *codefeels* — A debugger that shows you what your code is feeling (loops that run too long are "anxious", unreachable code is "lonely")
- *The Performance Review of a Lighthouse Keeper, Annotated by the Light* — A bureaucratic evaluation where the lighthouse fights for its keeper in the margins
- *A MIDI File Composed from a Production Server Log* — Six movements following a database outage, where you can hear the connection pool saturate
- *A Filing System for a Town That Classifies Residents by What They'd Do If No One Was Watching* — Municipal horror through bureaucratic classification
- *A Password Strength Meter That Grades Your Emotional Vulnerability* — Security mechanisms as emotional tests

## Quickstart

```bash
npm install -g the-foundry
foundry init my-portfolio
foundry start --workdir my-portfolio
```

`foundry init` creates a git repo with the site, config, prompts, and GitHub Actions workflow. Requires Node.js >= 22 and an OpenAI-compatible API endpoint.

Default configuration uses [Z.ai](https://z.ai) GLM. Point at any compatible provider via `config/models.yml`.

## Project Structure

```
foundry/
├── src/                    # Core engine
│   ├── agents/             # Agent dispatch and prompt assembly
│   ├── complexity/         # Rating-per-token complexity yield analysis
│   ├── context/            # Context building per agent role
│   ├── creator/            # Multi-phase creation pipeline
│   ├── curator/            # Periodic curation and manifesto maintenance
│   ├── dreams/             # Dream journal — killed artifact memory
│   ├── iteration/          # Main iteration runner
│   ├── lineage/            # Constellation map and creative DNA
│   ├── model/              # LLM client abstraction
│   ├── monitor/            # Quality and pattern detectors
│   ├── mood/               # Dynamic creative state engine
│   ├── parser/             # YAML response parsing and validation
│   ├── pool/               # Concurrent iteration worker pool
│   ├── refinery/           # Second-pass target discovery and dispatch
│   ├── sandbox/            # Docker/Firejail code execution
│   ├── speculative/        # Salvageable Gate 1 idea carry-forward
│   ├── stats/              # Statistics tracking
│   ├── stoker/             # Deterministic next-iteration directive loop
│   ├── streaks/            # Hot streak detection and pivot pressure
│   └── stimuli/            # External input pipeline
├── config/                 # YAML configuration
├── dashboard/              # Observatory web dashboard
├── identity/               # Manifesto, journal, lineage, mood, streak, complexity, and stoker state
├── portfolio/              # Shipped and killed artifacts
├── prompts/                # Agent prompt templates
├── stimuli/                # External stimuli and skill files
├── site/                   # Astro-based portfolio website
└── tests/                  # Vitest test suite
```

## Configuration

| File | Purpose |
|---|---|
| `config/foundry.yml` | Iteration limits, project rules, stimuli settings |
| `config/models.yml` | Model selection per agent, temperature, token limits |
| `config/domains.yml` | Creative domains with descriptions and weights |

See [CONFIGURATION.md](CONFIGURATION.md) for the full schema.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — System design, agent communication, context assembly
- [CONFIGURATION.md](CONFIGURATION.md) — YAML config schema, model selection, domain setup
- [CUSTOMIZATION.md](CUSTOMIZATION.md) — Writing your own manifesto, adding domains, tuning agents
- [LESSONS.md](LESSONS.md) — What we learned running autonomous creation at scale
- [FOUNDRY-SPEC.md](FOUNDRY-SPEC.md) — The full specification
- [CONTRIBUTING.md](CONTRIBUTING.md) — How to contribute

## Development

```bash
pnpm install                # Install dependencies
pnpm test                   # Run test suite (600+ tests)
pnpm run dev                # Run the Foundry locally
pnpm run dashboard          # Start the Observatory dashboard
```

`foundry status` reports the current furnace signals alongside iteration counts: Stoker urgency and queued refinery work, the next Stoker check, token heat with pressure percentage and peak usage, complexity-tier guidance, active streak or cooldown state, current and stale speculative warmed-idea fuel, Stimuli source health, Refinery cooldown eligibility, current Refinery fuel pool, synthesized Refinery readiness, Critic artifact rejection pressure, and the configured intervention files. Pending `STOP` and non-empty `requests.md` state are visible in text and JSON output, including a compact request preview. Recent outcomes are tagged when they came from a human redirect, and both status plus checkpoint-free startup reconstruct counts, token totals, recent outcomes, and the Critic artifact rejection window from `logs/iterations.jsonl` if no checkpoint exists; `foundry start` writes skipped entries for thrown sequential or parallel-worker failures so those failed loop attempts are included too. Use `foundry status --json --fail-on warning` for a scriptable health gate over monitor warnings, Stimuli source failures, log-health state, and pending stop files. Use `foundry forecast --json` for a shorter next-iteration briefing that turns the same telemetry into blockers, operator actions, and ordered furnace signals. Use `foundry spark --domain poetry --json` to generate a deterministic, redirect-ready creative spark from local furnace state, recent outcomes, configured domains, and manifesto values; add `--count 3` for a ranked spark deck, `--apply` to write a single spark to the configured request file, or `--append` to add it after an existing redirect. Applied sparks are audited in `logs/spark.jsonl`; use `foundry spark history --domain poetry --mode append --replayable --since 2026-05-30T00:00:00.000Z --show-request --limit 20` to inspect restorable sparks with request text, `foundry spark stats --domain poetry --mode append --replayable --since 2026-05-30T00:00:00.000Z --json` to summarize a focused time window, or `foundry spark replay --domain poetry --mode append --from 2026-05-30T00:00:00.000Z --dry-run` to preview or restore a specific matching spark without regenerating it. Use `foundry timeline --domain code-tool --iteration 41 --outcome killed --source human_redirect --limit 10 --json` for an iteration-centered audit view that combines filtered iteration outcomes, gate decisions, Tester reports, monitor warnings, and token usage. Use `foundry iterations history --domain code-tool --outcome shipped --source human_redirect --limit 20 --json` to inspect iteration outcomes from `logs/iterations.jsonl`, `foundry tokens history --agent creator --model glm-5.1 --iteration 41 --limit 20 --json` to inspect per-call token spend from `logs/token-usage.jsonl`, `foundry decisions history --gate gate1 --decision reject --source human_redirect --iteration 41 --limit 20 --json` to inspect Critic decisions from `logs/decisions.jsonl`, `foundry tester history --outcome fail_fixable --artifact 0020 --iteration 41 --limit 20 --json` to inspect Tester reports from `logs/test-reports.jsonl`, `foundry monitor history --severity warning --detector quality --iteration 41 --limit 20 --json` to inspect recent warnings from `logs/monitor.jsonl`, `foundry stoker history --urgency high --rule refinery_fuel --iteration 41 --limit 20 --json` to inspect recent Stoker steering directives from `logs/stoker.jsonl`, and `foundry refinery history --result shipped --source-type companion --iteration 41 --limit 20 --json` to inspect recent Background Refinery attempts from `logs/refinery.jsonl`.

Project continuation entries in `logs/iterations.jsonl` include `project_completed_iterations`, `project_estimated_iterations`, and `project_milestone_reached` after `foundry start` ships a project artifact, so iteration history and timeline output can surface project progress without joining lifecycle events.

The live `foundry start` iteration summary tags artifact IDs, parallel worker slots, human-redirected outcomes, compact terminal reasons, duration/token metrics, token-heat pressure, and project progress for shipped project artifacts, including milestone state when a project reaches its planned count.

After each terminal iteration completion, `foundry start` writes a `foundry_token_heat_snapshot` lifecycle record scoped to the current run. It reports iteration tokens, rolling samples, average and peak token spend, configured heat threshold, threshold percentage, remaining tokens to threshold, and hot/warm/cool pressure so unattended runs can audit token load without recomputing status.

Hot current-run token heat also pulls the Stoker forward during `foundry start`: if an iteration crosses the heat threshold before the normal Stoker cadence is due, the loop writes a Stoker directive for the next iteration with `force_reason: "token_heat"` in the lifecycle check payload.

Sequential cooldown lifecycle records include the current token-heat pressure, threshold percentage, sample count, peak sampled tokens, configured base sleep, and heat-adjusted sleep. If the loop is hot when a configured cooldown starts, single-threaded `foundry start` stretches that cooldown proportionally, capped at 3x, and prints the adjusted cooling cue before sleeping.

When `foundry start` reconstructs state from existing iteration logs instead of a checkpoint, the `foundry_start` lifecycle record includes `startup_token_heat` with the persisted rolling heat state, and the live banner prints that pressure when samples exist.

When a `foundry start` session stops, its `foundry_stop` lifecycle record also includes a current-run ledger: terminal outcome counts, input/output/total token usage, and the final token-heat state. Non-empty sessions print the same compact summary at shutdown, making a stopped run inspectable from the console or one event without replaying the whole log.

Runtime checkpoint lifecycle records include the same current-run outcome, token, and heat summary, so periodic checkpoints in long starts are self-describing.

Sequential `foundry start` writes `foundry_sequential_maintenance_start` and `foundry_sequential_maintenance_complete` around the post-iteration maintenance phase before STOP and cooldown decisions. These events summarize the completed iteration, Curator trigger, periodic checkpoint state, monitor warning counts, monitor failure/emergency-Curator state, Stoker due/cadence/directive state, token heat, current-run ledger, failure streak, and maintenance duration so a single-threaded run shows where time went between artifact completion and the next handoff. The same phase now prints a compact `Maintenance:` line with checkpoint, monitor, Stoker, duration, and heat state for live operators.

Sequential `foundry start` also treats marginal shipped artifacts as a quality-escalation trigger: when a shipped result has a mean Critic rating below the configured high-rating threshold (`streaks.high_rating_threshold`, default 3.5), the loop runs an immediate Curator full cycle before cooldown even if the scheduled Curator interval is not due. The escalation appends a journal note naming the artifact and rating gap, writes `trigger: "quality_escalation"` in Curator lifecycle events, checkpoints with reason `quality escalation curator`, forces the next Stoker handoff with `force_reason: "quality_escalation"`, and gives the next iteration stronger reflective context at the cost of an extra Curator model call. Forced Stoker handoffs carry the title, domain, rating, and threshold into the directive so the next Ideator prompt receives a concrete recovery instruction instead of a generic cadence cue.

Killed artifacts trigger the same single-threaded escalation path with `trigger: "failure_escalation"`: the loop journals the killed artifact and reason, checkpoints the Curator pass with reason `failure escalation curator`, and forces the next Stoker handoff with `force_reason: "failure_escalation"` so the following Ideator call sees the failure mode before proposing again. The forced directive includes the artifact title/domain and compact kill reason, then pushes the next proposal toward S-tier, testable recovery work.

Excellent shipped artifacts now get the same reflective treatment in the positive direction. When a shipped artifact meets the success-amplification threshold (`streaks.high_rating_threshold + 0.5`, capped at 5.0), sequential `foundry start` runs an immediate Curator cycle with `trigger: "success_amplification"`, journals the rating win, checkpoints with reason `success amplification curator`, and forces the next Stoker handoff with `force_reason: "success_amplification"` so the next Ideator prompt can amplify the winning pattern while still making something meaningfully new.

Sequential `foundry start` writes `foundry_next_iteration_ready` after post-iteration maintenance and before cooldown or immediate advance, capturing the next iteration, cooldown plan, token heat, current-run ledger, queued Stoker directive details when a directive was written for the handoff, queued request-file handoff state with checkpoint coverage, and a handoff health signal derived from monitor/Stoker maintenance results. The loop also prints a live next-iteration handoff summary with cooldown/backoff, token heat, run count, total tokens, queued Stoker directive when present, queued human redirect preview when `requests.md` is already populated, request checkpoint coverage when a queued redirect handoff saved state, and warning/critical attention when the next iteration is starting under maintenance pressure. Critical handoff health checkpoints the last completed iteration before cooldown or advance when the same maintenance phase has not already saved state, and the readiness event plus live handoff line report the checkpoint coverage and save reason. Critical handoffs also append a fail-soft journal note with attention reasons and checkpoint coverage. Skipped iterations add retry backoff to that cooldown plan at 1s per consecutive skip, capped at 5s, and checkpoint before the intentional wait or redirect handoff. Human redirects queued before cooldown checkpoint the completed iteration before bypassing a configured cooldown, record that coverage in readiness and cooldown-interruption lifecycle events, and append a fail-soft journal note explaining the cooldown skip. Redirects discovered while cooldown is already sleeping also checkpoint the completed iteration, record checkpoint coverage on `foundry_cooldown_interrupted`, append a fail-soft journal note with the request preview, and start the next iteration early. Transient request-file or STOP-file read failures during an active cooldown no longer abort the loop; cooldown completion or interruption events summarize the failure count, latest detail, elapsed window, and configured file path for each failed poll type, recovered polling prints a compact live recovery line plus appends a fail-soft journal note before the next iteration starts, normal cooldown completion prints elapsed cooling time before the next iteration begins, and zero-cooldown immediate advances write `foundry_cooldown_skipped` with reason `no configured cooldown`, cooldown-plan metadata, token heat, and the current-run ledger.

`foundry start` also writes lifecycle audit entries to `logs/events.jsonl`: `foundry_start` records mode, concurrency, providers, provider fallbacks, provider-validation skip state, pending request file/preview at startup, start iteration, git automation mode, configured model override windows plus whether they were applied, and whether state came from a checkpoint or iteration-log reconstruction, `foundry_iteration_start` records each dispatched sequential or parallel iteration with its mode, concurrency, iteration number, and worker slot, `foundry_iteration_complete` records completed iteration attempts with outcome, duration, token usage, title/domain/source/reason when available, worker slot, and shipped project progress fields when applicable, `foundry_sequential_failure_warning` records skipped-streak warnings before the breaker threshold, `foundry_sequential_failure_breaker` records repeated skipped-iteration halts, `foundry_sequential_failure_recovered` records skipped-streak recovery, `foundry_sequential_maintenance_start|complete` records single-thread post-iteration maintenance, `foundry_git_commit_start|complete|failed` records git automation attempts with iteration outcome, artifact context, auto-push state, commit message, push result, duration, and failure detail, `foundry_stoker_directive_load_start|complete|failed` records iteration-start Stoker directive reads with loaded/empty state, target iteration, urgency, fired rules, refinery queue, duration, and non-fatal read failure detail, `foundry_stoker_directive_stale_cleared|stale_clear_failed` records stale directive cleanup before Phase 0 precheck with stale/current iteration, urgency, fired rules, refinery queue, duration, and failure detail, `foundry_stoker_directive_consumed_cleared|consumed_clear_failed` records terminal cleanup of current-iteration Stoker directives with directive iteration, urgency, fired rules, refinery queue, duration, and failure detail, `foundry_precheck_start|complete|failed` records each iteration's Phase 0 STOP/disk pre-check with configured files/floors, continue or halt result, mood snapshot, duration, and failure detail, `foundry_request_poll_start|complete|failed` records the configured request-file poll with pending/empty state, request preview/length, duration, and read failure detail, `foundry_stoker_directive_deferred|defer_failed` records human-redirect deferrals of current Stoker directives with source/target iterations, urgency, fired rules, refinery queue, request preview, and failure detail, `foundry_human_redirect_start|complete|failed` records consumed redirect requests with request preview/length, worker slot, approval or rejection result, selected proposal metadata, redirect token usage, duration, rejection detail, and translation/processing failure detail, `foundry_speculative_cleanup_start|complete|failed` records consumed warmed-idea cleanup after Ideator or human redirect access with duration and cleanup failure detail, `foundry_speculative_carry_forward_start|complete|failed` records speculative fuel persistence after Gate 1 with selected title, proposal/evaluation counts, carried count, duration, and failure detail, `foundry_streak_update_start|complete|failed` records terminal streak-state persistence with outcome metadata, current streak summary, cooldown state, duration, and failure detail, `foundry_complexity_recommendation_applied|ignored` records Gate 1 build-tier corrections with source, title, original complexity, recommended complexity, applied/ignored result, and ignore reason, `foundry_lineage_rebuild_start|complete|failed` records post-ship lineage graph refreshes with artifact metadata, edge/constellation counts, duration, and failure detail, `foundry_project_creation_start|complete|failed` records project starter creation with project metadata, effective build complexity, project ID, duration, and failure detail, `foundry_project_progress_start|complete|failed` records shipped project artifact links and status updates with project ID, artifact metadata, previous/current completed-iteration counts, duration, and failure detail, `foundry_project_milestone_reached` records shipped project continuations that reach their planned iteration count with project ID, artifact metadata, previous/current/planned iteration counts, and curator-decision result, `foundry_ideation_start|complete|failed` records Ideator proposal-generation attempts with retry index, burst count, retry context, Stoker directive metadata, proposal counts, partial burst failures, token usage, and duration, `foundry_idea_gate_start|complete|failed` records Critic Gate 1 reviews for Ideator and human-redirect proposals with source, attempt, proposal titles/counts, decision counts, selected title, token usage, duration, and failure detail, `foundry_deadlock_override_start|complete` records ideation deadlock recovery with retry count, rejection-context preview, forced proposal metadata or failure detail, duration, and override token usage, `foundry_creator_phase_start|complete|failed` records Creator passes during normal creation and Tester fix cycles with proposal metadata, revision/fix-cycle markers, file count, phase tokens, token usage, duration, and failure detail, `foundry_workspace_stage_start|complete|failed` records workspace materialization for Creator output and Tester fix-cycle rewrites with file paths, proposal/artifact metadata, revision/fix-cycle markers, duration, and failure detail, `foundry_tester_phase_start|complete|failed` records lightweight, code-plan, sandbox, and sandbox-fallback validation passes with artifact metadata, revision/fix-cycle markers, verdict summary, issue/test counts, token usage, and failure detail, `foundry_artifact_gate_start|complete|failed` records Critic Gate 2 reviews with artifact metadata, Tester verdict, revision/fix-cycle counts, decision, mean rating, ship-threshold status, token usage, duration, and failure detail, `foundry_bookkeeping_start|complete|failed` records shipped/killed portfolio finalization with artifact ID, proposal/artifact metadata, gate decision, Tester verdict, token usage, rating or kill reason, duration, and failure detail, `foundry_stimuli_refresh_start|complete|failed` records pre-iteration Stimuli refresh attempts with tracked source counts, refreshed/failing/disabled counts, duration, and non-fatal failure detail, `foundry_next_iteration_ready` records sequential next-iteration handoff state, `foundry_cooldown_start|complete|skipped|interrupted` records sequential cooldown timing, zero-cooldown skips, and interrupt reason, `foundry_parallel_request_guard|released` records when parallel scheduling temporarily drops to one worker for a pending human redirect and when configured concurrency is restored, `foundry_curator_cycle_start|complete|failed` records scheduled, project-milestone, quality-escalation, failure-escalation, and success-amplification Curator maintenance attempts with trigger, outcomes, duration, previous/current Curator iteration pointers, and project progress fields when applicable, `foundry_monitor_start|complete|failed` records anti-entropy monitor passes, warning counts, emergency-Curator eligibility, and non-fatal monitor failures, `foundry_stoker_check_start|complete|failed` records deterministic Stoker check cadence, skipped checks, directive metadata, and non-fatal failures, `foundry_refinery_start|complete|failed` records Stoker-queued Background Refinery jobs with source metadata, queue position, result, artifact context, token usage, and skipped-attempt detail, `foundry_checkpoint_saved|failed` records runtime checkpoint saves with the checkpoint iteration, last Curator run, save reason, and failure detail when a write fails, `foundry_stop` records the stop reason, elapsed `duration_ms`, last completed iteration, next iteration, derived `iterations_completed`, STOP-file path/preview when a halt came from the configured stop file, and halt detail when an iteration returns its own halt reason, and `foundry_start_failed` records startup preflight or provider-validation failures before the loop begins. When a human redirect is already queued, startup also prints its configured request file and compact preview. Fatal errors after startup append a journal note and emit `foundry_stop` with `reason: "error"` and the thrown error detail so unattended runs do not end with an open lifecycle record.

Configured sequential cooldown starts print a live watch line with the sleep duration, next iteration, configured STOP file, and configured request file. The matching `foundry_cooldown_start` event includes `next_iteration`, `cooldown_stop_file`, `cooldown_request_file`, `cooldown_interrupts_enabled`, and `cooldown_signal_watch`. Normal `foundry_cooldown_complete` events repeat the watch files, next iteration, completion flag, and current-run ledger with elapsed cooling time.

Zero-cooldown sequential handoffs use the same cooldown audit family through `foundry_cooldown_skipped`, preserving intentional immediate advances in `logs/events.jsonl` instead of leaving a silent gap between readiness and the next iteration.

Git automation failures during `foundry start` also append a best-effort note to `identity/journal.md`, including iteration, artifact context, and git error detail.

Project progress lifecycle records use `foundry_project_progress_start`, `foundry_project_progress_complete`, and `foundry_project_progress_failed` for shipped project artifact links and status updates, including project ID, artifact metadata, previous/current completed-iteration counts, duration, and failure detail.

Project bookkeeping failures after a shipped project artifact also write a best-effort journal note, so the artifact can ship while the project-link/status problem remains visible to operators.

Project milestone lifecycle records use `foundry_project_milestone_reached` when a shipped project continuation reaches its planned iteration count, including project ID, artifact metadata, previous/current/planned iteration counts, and the curator-decision result.

Project milestones also trigger an immediate Curator full cycle in sequential and parallel `foundry start`; parallel mode drains active workers before the Curator runs. Curator lifecycle records include `trigger: "project_milestone"` and the project progress fields for these cycles.

Project status updates refresh `portfolio/projects/index.md`, keeping project progress current after `foundry start` advances a project and after Curator status changes.

Project starter capacity lifecycle records use `foundry_project_creation_capped` when `projects.max_active` is full and `foundry start` builds an approved project starter as standalone, including active/max project counts, project name, and effective build complexity.

Invalid project starter lifecycle records use `foundry_project_creation_invalid` when `foundry start` rejects malformed starter metadata and builds standalone instead, including reason and build complexity.

Stale project continuation lifecycle records use `foundry_project_continuation_stale_cleared` when `foundry start` strips an inactive project ID and builds the proposal as standalone, including stale project ID, active project count, title, and domain.

Dream capture lifecycle records use `foundry_dream_capture_start`, `foundry_dream_capture_complete`, and `foundry_dream_capture_failed` for normal and Background Refinery killed-artifact dream journal writes, including artifact metadata, kill-reason preview, resurrection hint preview, duration, and failure detail.

Curator cycles now see that same rolling Critic artifact rejection rate. If kills exceed 40% of recent artifact decisions, the Curator prompt asks for a standards-drift reflection instead of letting rejection pressure stay as hidden telemetry.

`foundry stop` writes the configured emergency stop file and `foundry resume` removes it. Both commands honor `intervention.stop_file`, so custom halt paths work consistently across the loop, status, doctor, and automation; `--json` is available for scripts. Add `--reason <text>` when stopping to record why the run was halted; status and doctor reports show a compact stop-file preview.

During sequential `foundry start`, SIGINT now means the current iteration is the last unit of work: the runner checkpoints and exits immediately after it returns instead of waiting through Curator, monitor, Stoker, or cooldown work. Signal-triggered lifecycle records, journal stop records, and live halt messages preserve the actual signal name (`SIGINT` or `SIGTERM`). The runner also re-checks the configured STOP file before cooldown, skips cooldown immediately when a human redirect is already queued, and polls STOP/signal/request state during cooldown, so halt requests made while the loop is sleeping checkpoint the completed iteration and stop early, while newly queued human redirects checkpoint that completed iteration, write the request handoff audit, and start the next iteration without waiting through the full sleep interval.

Sequential `foundry start` also trips a failure breaker after 3 consecutive skipped iteration failures. It writes `foundry_sequential_failure_breaker`, checkpoints the last skipped iteration, appends a journal halt note, and records a stop summary so a broken provider or runner does not spin forever.

Before that breaker threshold, sequential skipped iterations write `foundry_sequential_failure_warning` with the current failure streak, failures remaining before halt, retry-backoff milliseconds, and failure detail. The same warning prints in the live `foundry start` console so unattended logs show why the next loop is cooling down.

When a later non-skipped iteration clears a skipped-iteration streak, sequential `foundry start` writes `foundry_sequential_failure_recovered` with the prior streak length and recovery outcome so transient recovery is visible in lifecycle audits.

If the configured STOP file already exists when `foundry start` begins, the runner skips provider health probes and model override activation, records `provider_validation_skipped: true` on the start event, restores enough state to checkpoint, prints the configured stop file and compact preview in the live halt message, writes the lifecycle stop record with `stop_file_present_at_startup: true`, `stop_file`, and a compact `stop_file_preview` when the file contains a reason, and exits without calling any agents. STOP-file halt messages in parallel mode include the same configured file detail after active workers drain.

During parallel `foundry start`, STOP or signal shutdown drains current workers, saves the final checkpoint, and writes the halt reason into the journal with the last completed parallel iteration, STOP-file detail when applicable, and the specific signal name when applicable. If a worker returns `halted`, the pool stops reserving new iterations, drains any in-flight workers, and records the halted iteration plus its detail in lifecycle and journal output. If `requests.md` is non-empty while the pool is scheduling, the runner temporarily limits new scheduling to one worker until that redirect has a single consumer, logs the guard activation, then logs release timing when the configured concurrency is restored.

`foundry request show|set|append|clear|history|stats|sources|restore|diff` manages and audits the configured human redirect file without opening it manually. `show --json` reports whether a redirect is pending plus the current content, `set <text>` writes a trimmed redirect with a trailing newline, `set --file <path>` loads a multiline redirect from a file, `append <text>` or `append --file <path>` adds another block to a pending redirect, and `clear` empties the file. Mutations are written to `logs/requests.jsonl`; use `foundry request history --restorable --source ops/extra.md --contains "moon gear" --action append --since 2026-05-30T00:00:00.000Z --show-request --limit 20` to inspect recent manual steering changes that still have matching request text from a source notes file, `foundry request stats --source ops/extra.md --contains "moon gear" --action append --since 2026-05-30T00:00:00.000Z --json` to summarize the same audit trail by action, source usage, request-text presence, and latest events, `foundry request sources --action append --contains "moon gear" --since 2026-05-30T00:00:00.000Z --limit 10 --json` to rank source notes files by latest matching steering activity, `foundry request diff --from 2026-05-30T00:00:00.000Z` to compare the current pending redirect with an exact prior request-text entry, `foundry request diff --latest --source ops/extra.md --contains "moon gear"` to compare against the latest matching prior entry without copying its timestamp first, `foundry request restore --from 2026-05-30T00:00:00.000Z --dry-run` to preview restoring an exact prior entry, or `foundry request restore --latest --source ops/extra.md --contains "moon gear" --dry-run` to preview restoring the latest matching restorable entry. The `requests` plural alias works the same way for scripts that prefer the filename terminology. At runtime, a pending request replaces Ideator for that iteration, defers any current Stoker directive to the next iteration before Background Refinery target selection, and still passes the Curator-translated proposal through Critic Gate 1 before anything is built.

`foundry doctor` prints a compact furnace health report with shared reasons and recommended actions, defaulting to a nonzero exit only for critical health. Monitor warnings are split into active recent counts and historical totals, using `monitor.active_warning_window` for the default 10-iteration active window, so old warnings stay visible without keeping the health gate yellow forever. A pending stop file raises doctor health to warning and shows the configured file path so unattended-run checks catch halt requests before launch. Add `--preflight` to fold in the full config/prompt preflight: invalid config or prompt files become critical doctor health, and ambiguous prompt selectors become warning health. Text output lists invalid preflight files and selector collisions directly; JSON output includes the nested config-doctor report. Use `foundry doctor --json --preflight --fail-on warning` for stricter watchdogs before unattended runs.

`foundry preflight` is the strict shortcut for unattended-run readiness. It runs the same combined health/config/prompt report as `foundry doctor --preflight`, includes nested preflight JSON with `--json`, and defaults to failing on warning-level health so prompt selector collisions and runtime warnings block the run unless you choose `--fail-on critical`.

`foundry start` runs startup guards before entering the autonomous loop. Invalid prompt files, missing required placeholders, broken split-section markers, or insufficient free disk space for `loop.disk_space_min_gb` fail at startup instead of surfacing after an agent dispatch or partial iteration. Sequential runs re-check the disk floor before each iteration, and parallel runs check before scheduling more work; if the workspace drops below the floor, the runner checkpoints and halts after current work drains.

`foundry logs doctor` scans active JSONL logs, reports rotation pressure, malformed-line details, and recommended actions, and exits nonzero when active logs are damaged. Use `foundry logs doctor --json --fail-on watch` for stricter automation before long unattended runs or when monitor `log_health` warnings appear.

`foundry config doctor` validates `config/foundry.yml`, `config/models.yml`, `config/domains.yml`, `stimuli/stimuli.yml`, and prompt-template contracts without starting the loop. It prints aggregate total/ok/invalid counts plus per-file status, and exits nonzero when any config file or prompt template is missing, blank, missing required placeholders, carrying unknown placeholders, missing split-section markers, or duplicating split-section markers; use `--json` for CI or watchdog scripts. JSON output includes a `summary` object with total, ok, invalid, total config-vs-prompt counts, invalid config-vs-prompt counts, and ambiguous prompt selector counts. JSON entries include `kind: "config"|"prompt"`, and top-level `ambiguousPromptSelectors` lists selector collisions using the same matching semantics as `foundry prompts show`. Add `--fail-on-ambiguous` to make the full preflight exit nonzero when prompt selector aliases collide. Prompt failures include both readable `errors` and structured `diagnostics` with stable codes such as `missing_placeholder`, `unknown_placeholder`, `missing_section_marker`, and `duplicate_section_marker`.

`foundry prompts doctor` runs only the prompt-template contract checks and supports the same `--json` structured diagnostics. Text output includes total/ok/invalid prompt counts, and JSON output includes a `summary` object with those counts plus ambiguous selector counts for watchdog scripts. Add `--fail-on-ambiguous` to make selector collisions a nonzero prompt-specific preflight gate after editing prompt markdown.

`foundry prompts list` prints the registered prompt-template contracts without reading prompt files, including accepted selectors, ambiguous selector collisions, required placeholders, optional placeholders, and split-section markers; add `--json` to feed contract metadata into tooling. Ambiguity reporting follows the same exact-name and relative-path precedence used by `foundry prompts show`. Add `--fail-on-ambiguous` to exit nonzero after printing the report when selector collisions exist.

`foundry prompts show <template>` focuses on one prompt contract and runs its live validation status. The template selector can be the contract name, relative path, or an unambiguous basename, such as `prompts/critic.md`, `critic.md`, or `critic`; add `--json` before or after the selector for automation. Text and JSON reports include the accepted selector aliases for the selected contract. Ambiguous basename selectors exit nonzero with the matching contracts so operators can rerun with a full name or path. In JSON mode, missing, unknown, or ambiguous selectors emit `{ status: "error", error: { code, message, selector, matches } }` before exiting nonzero; `selector` is `null` when no template was provided. Invalid selected templates exit nonzero after printing the report.

The Observatory dashboard includes the same furnace telemetry in a live Furnace State panel, including Stoker cadence, token pressure, Critic artifact rejection pressure, Stimuli source health, speculative stale-fuel counts, Refinery fuel, Refinery readiness, log-health actions, and the next Refinery-eligible iteration, and exposes it as JSON at `/api/furnace` for local tooling.

Curator full-cycle prompts receive that same Stimuli source-health summary, including per-source age, refresh interval, failure count, due state, and disabled state, so refresh and skill-commission decisions are grounded in concrete pipeline telemetry instead of a vague staleness placeholder.

Curator-triggered Stimuli refreshes update the same runtime and checkpoint source state as scheduled refreshes, so a successful manual refresh clears failure pressure and records the current iteration instead of being treated as stale again immediately.

Operators can inspect the feed layer directly with `foundry stimuli status`, using `--json` and `--fail-on warning` for watchdog scripts that only care about external-input health. To repair one feed immediately, use `foundry stimuli refresh <source>`; it refreshes the live file and updates the same checkpointed source state, clearing failures on success or recording another failure if the backend still breaks. After fixing a broken backend or source configuration, `foundry stimuli reset <source>` clears only that source's checkpointed refresh age, failure count, and disabled flag, leaving the rest of the checkpoint intact so the next run can retry the feed normally. Manual Stimuli refresh/reset actions are appended to `logs/stimuli.jsonl` with before/after checkpoint state for later repair audits, and `foundry stimuli history [source] --action refresh --status failed --limit 20 --json` reads that audit trail back for focused post-repair inspection.

## License

MIT
