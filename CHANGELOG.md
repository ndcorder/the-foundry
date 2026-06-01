# Changelog

All notable changes to The Foundry are documented here.

This project follows [Semantic Versioning](https://semver.org/).

## [1.2.0] — 2026-06-01

### Added

- Continuation Greed now tracks high-rated creative streaks in `identity/streaks.yml`, injects hot-streak guidance into Ideator and Creator context, and applies short pivot pressure when a streak breaks.
- Adaptive Complexity ROI now computes recent rating-per-token yield by complexity tier, persists `identity/complexity-bias.yml`, and injects actionable tier guidance into Ideator prompts.
- Stoker directives now run on a configurable interval, persist `identity/stoker-directive.yml`, log to `logs/stoker.jsonl`, and steer the next Ideator call with urgency, domain pressure, mood, streak, refinery, and complexity signals.
- `foundry stoker history` now reads recent Stoker directives from `logs/stoker.jsonl`, with `--urgency`, `--rule`, target `--iteration`, `--limit`, and `--json` support for operator automation.
- Stoker now treats recent main-loop token spend as configurable refinery heat: if the last few iterations are already expensive, it defers queued Background Refinery work instead of stacking second-pass calls on top.
- Hot current-run token heat during `foundry start` now forces an immediate Stoker check for the next iteration, even when the normal Stoker cadence is not due, with `force_reason: "token_heat"` and cadence/heat metadata in lifecycle events.
- Checkpoint-free `foundry start` now primes cold persisted token histories with a high-urgency `startup_underburn` Stoker directive before the first loop iteration, steering the run toward a richer M-tier proposal instead of waiting for a tiny artifact to underburn.
- Sequential cooldown lifecycle events now include token-heat pressure metadata, and hot single-threaded cooldowns stretch proportionally up to 3x while printing the adjusted cooling cue before the next iteration sleep.
- Speculative Pre-generation now preserves salvageable unselected Gate 1 ideas in `workspace/speculative.yml`, injects them into the next Ideator prompt, and logs how many warmed-up ideas were carried forward.
- Speculative fuel now expires after the immediately following iteration across Ideator context, `foundry status`, and Observatory telemetry, preventing old `workspace/speculative.yml` files from acting like live warmed ideas.
- Speculative fuel cleanup during `foundry start` now writes lifecycle start, completion, and failure events after warmed ideas have been available to the current iteration.
- Speculative carry-forward during `foundry start` now writes lifecycle start, completion, and failure events with proposal/evaluation counts, selected title, carried count, duration, and failure detail.
- Background Refinery now discovers second-pass targets from killed-artifact dreams, recent high-rated companion candidates, and old low-rated artifacts; Stoker queues refinery jobs using real `logs/refinery.jsonl` history and the configured run gap; source selection skips artifacts that already have shipped refined descendants; the runner executes jobs through Refinery → lightweight Tester → Critic Gate 2; shipped refinery artifacts get `[refined]` lineage and refinery log entries.
- `foundry refinery history` now reads recent Background Refinery attempts from `logs/refinery.jsonl`, with `--result`, `--source-type`, exact `--iteration`, `--limit`, and `--json` support for operator automation.
- Background Refinery also skips dreams that already produced a shipped resurrection, preventing older successful dream attempts from re-entering the target pool after cooldown.
- `foundry status` now surfaces live furnace signals: Stoker urgency, queued refinery work, complexity guidance, streak/cooldown state, speculative warmed-idea fuel, and the last recorded Refinery run.
- `foundry status --json` now emits the full status and furnace payload as a single JSON object for automation.
- `foundry forecast` now condenses status telemetry into a next-iteration briefing with blockers, operator actions, and ordered furnace signals, with `--json` support for automation.
- `foundry spark` now generates deterministic, redirect-ready creative sparks from local furnace state, configured domains, recent outcomes, and manifesto values, with `--domain`, `--count`, `--apply`, `--append`, and `--json` support; applied sparks are audited in `logs/spark.jsonl`, readable through `foundry spark history --replayable --since <timestamp> --until <timestamp> --show-request`, summarized through time-windowed `foundry spark stats`, and safely previewable/restorable through `foundry spark replay --from <timestamp> --dry-run`.
- `foundry status --fail-on warning|critical` now exits nonzero when monitor warnings or log-health state cross the requested watchdog threshold.
- Parallel `foundry start` now runs the anti-entropy monitor pass after worker completions, writing `logs/monitor.jsonl` warnings and complexity-bias updates like sequential mode while leaving emergency Curator intervention to the serialized loop path.
- `foundry timeline` now combines recent iteration outcomes with related Critic decisions, Tester reports, monitor warnings, and token usage for one iteration-centered audit view, with `--outcome`, `--source`, `--domain`, and exact `--iteration` filters for focused run audits.
- `foundry iterations history` now reads recent terminal iteration outcomes from `logs/iterations.jsonl`, with `--outcome`, `--source`, `--domain`, `--limit`, and `--json` support for operator automation.
- `foundry tokens history` now reads recent per-call model token usage from `logs/token-usage.jsonl`, with `--agent`, `--model`, exact `--iteration`, `--limit`, and `--json` support for operator automation.
- `foundry decisions history` now reads recent Critic gate decisions from `logs/decisions.jsonl`, with `--gate`, `--decision`, `--source`, exact `--iteration`, `--limit`, and `--json` support for operator automation.
- `foundry tester history` now reads recent Tester reports from `logs/test-reports.jsonl`, with `--outcome`, `--artifact`, exact `--iteration`, `--limit`, and `--json` support for operator automation.
- `foundry monitor history` now reads recent monitor warnings from `logs/monitor.jsonl`, with `--severity`, `--detector`, exact `--iteration`, `--limit`, and `--json` support for operator automation.
- `foundry status`, `foundry doctor`, and `foundry preflight` now expose configured intervention files, including pending stop state and compact request previews; pending stop files raise warning-level readiness health.
- `foundry stop` now honors `intervention.stop_file`, and `foundry resume` removes the configured stop file with JSON output for automation.
- `foundry stop --reason <text>` now records why the halt was requested, and status/doctor intervention output includes a compact stop-file preview.
- `foundry request show|set|append|clear` now manages the configured human redirect file directly, with a `requests` alias and JSON output for automation.
- `foundry request history` now reads manual human-redirect mutations from `logs/requests.jsonl`, with `--action`, `--restorable`, `--source`, `--contains`, `--since`, `--until`, `--show-request`, `--limit`, and `--json` support; `foundry request stats` summarizes the same filtered trail by action counts, source-backed entries, request-text entries, and latest mutation pointers, with matching `--source` and `--contains` filtering for source notes files and request text; `foundry request sources` ranks source notes files by latest steering activity with per-action counts and the same action/source/content/time filters; `foundry request diff --from <timestamp>` compares the current redirect file against an exact prior request-text entry, and `foundry request diff --latest --source <path> --contains <text>` compares against the latest matching prior entry; `foundry request restore --from <timestamp> [--append] [--dry-run]` restores exact prior request-text entries, and `foundry request restore --latest --source <path> --contains <text> [--append] [--dry-run]` restores the latest matching prior request-text entry from that audit trail; request `set`, `append`, `clear`, and restore operations write audit entries with request file, source, content preview, length metadata, and restore source metadata when applicable.
- `foundry request set --file <path>` now loads multiline human redirect requests from disk for richer operator guidance.
- `foundry request append <text>` and `append --file <path>` now extend pending human redirects without overwriting the existing request.
- Human redirects now pass through Critic Gate 1 after Curator translation, so requests redirect ideation without bypassing quality control.
- Human-redirect Gate 1 decisions are now tagged in `logs/decisions.jsonl` and formatted history as `[human redirect]`, keeping operator steering distinct from ordinary Ideator proposals.
- Stoker directive loading at iteration start now writes lifecycle start, completion, and failure events with loaded/empty state, target iteration, urgency, fired rules, refinery queue, duration, and non-fatal read failure detail.
- Stale Stoker directives discovered at iteration start are now cleared before Phase 0 precheck work, with lifecycle events for successful and failed cleanup.
- Consumed Stoker directives are now cleared after terminal `foundry start` outcomes with lifecycle events that preserve directive iteration, urgency, fired rules, refinery queue, duration, and cleanup failure detail.
- Pending human redirects during `foundry start` now defer the current Stoker directive to the next iteration before any Background Refinery target selection, so operator steering owns the main loop first; successful and failed deferrals are audited with lifecycle events.
- Terminal streak-state updates during `foundry start` now write lifecycle start, completion, and failure events with outcome metadata, current streak summary, cooldown state, duration, and failure detail.
- Gate 1 complexity recommendations applied or ignored during `foundry start` now write lifecycle events with source, title, original complexity, recommended complexity, and ignore reason when metadata would become invalid.
- Post-ship lineage rebuilds during `foundry start` now write lifecycle start, completion, and failure events with artifact metadata, edge/constellation counts, duration, and failure detail.
- Project starter creation during `foundry start` now writes lifecycle start, completion, and failure events with project metadata, effective build complexity, project ID, duration, and failure detail.
- Project starter capacity fallbacks during `foundry start` now write `foundry_project_creation_capped` lifecycle events when `projects.max_active` is full, including active/max project counts, project name, and effective build complexity.
- Invalid project starter metadata during `foundry start` now writes `foundry_project_creation_invalid` lifecycle events and a journal note before falling back to standalone creation, including reason and build complexity.
- Shipped project progress during `foundry start` now writes lifecycle start, completion, and failure events around project artifact links and status updates, including project ID, artifact metadata, previous/current completed-iteration counts, duration, and failure detail.
- Project bookkeeping failures after a shipped project artifact now write a best-effort journal note in addition to `foundry_project_progress_failed`, so operators can see the project-link/status problem in the run journal.
- Shipped project continuations that reach their planned iteration count during `foundry start` now write `foundry_project_milestone_reached` lifecycle events and journal notes so the Curator/operator can decide whether to complete, extend, or continue the project.
- Terminal shipped iteration records for project continuations now include `project_completed_iterations`, `project_estimated_iterations`, and `project_milestone_reached`, making project progress visible through iteration history and timeline workflows.
- Scheduler-level `foundry_iteration_complete` lifecycle events now preserve those project progress fields when `foundry start` finishes a project continuation.
- Project milestones now trigger an immediate Curator full cycle in sequential and parallel `foundry start`; parallel mode drains workers first, and Curator lifecycle events include `trigger: "project_milestone"` plus project progress fields.
- Live `foundry start` iteration summaries now tag artifact IDs, parallel worker slots, human-redirected outcomes, compact terminal reasons, duration/token metrics, token-heat pressure, and shipped project progress plus milestone state, for example `#0001`, `slot 2`, `human redirect`, `reason: Gate rejected`, `1.0s, 100in/50out`, `heat hot 115%`, and `project P001 3/3, milestone`.
- `foundry start` now writes `foundry_token_heat_snapshot` lifecycle events after terminal iteration completions, reporting current-run token pressure, rolling average, peak spend, threshold percentage, and hot/warm/cool state for unattended run audits.
- `foundry_start` lifecycle records now include `startup_token_heat` reconstructed from existing iteration logs when starting without a checkpoint, so resumed unattended sessions begin with visible persisted token pressure.
- Checkpoint-free `foundry start` now prints persisted startup token heat in the live banner when previous iteration logs have token samples.
- `foundry_stop` lifecycle records now include a current-run summary with terminal outcome counts, input/output/total token usage, and final token-heat pressure so a completed `foundry start` session has a compact run ledger.
- `foundry start` now prints that current-run summary at shutdown whenever at least one iteration completed in the session.
- `foundry_checkpoint_saved` lifecycle records now include the same current-run outcome, token, and heat summary, so periodic checkpoints in long starts are self-describing.
- Sequential `foundry start` now writes `foundry_next_iteration_ready` after post-iteration maintenance and before cooldown/advance, capturing the next iteration, cooldown plan, token heat, and current-run ledger.
- Sequential `foundry start` now forces an immediate Curator quality-escalation cycle after marginal shipped artifacts whose mean Critic rating is below `streaks.high_rating_threshold`, spending extra Curator tokens, writing the rating gap into the journal, and forcing the next Stoker handoff before cooldown.
- Sequential `foundry start` now forces the same extra Curator/Stoker pressure after killed artifacts, journaling the kill reason and handing the failure mode to the next Ideator call before cooldown.
- Sequential `foundry start` now also spends an immediate Curator/Stoker amplification pass after excellent shipped artifacts, preserving the rating win and feeding a concrete success pattern into the next Ideator prompt before cooldown.
- Forced Stoker handoffs now include concrete escalation context in the generated directive: quality escalations carry title/domain/rating/threshold, failure escalations carry title/domain/reason, success amplifications carry title/domain/rating/threshold, and token-heat handoffs carry heat pressure so the next Ideator prompt gets a specific recovery constraint.
- Sequential `foundry start` now adds skipped-iteration retry backoff into that handoff cooldown plan, starting at 1s per consecutive skipped iteration and capping at 5s, while still letting queued human redirects take the next iteration immediately.
- Sequential skipped-iteration backoff now checkpoints before the intentional wait or redirect handoff, preserving failed-loop state if the process exits during recovery cooling.
- Git automation during `foundry start` now writes `foundry_git_commit_start`, `foundry_git_commit_complete`, and `foundry_git_commit_failed` lifecycle events with iteration outcome, artifact context, auto-push state, commit message, duration, push result, and failure detail.
- Git automation failures during `foundry start` now append a best-effort journal note with iteration, artifact context, and git error detail.
- Stale project continuation fallbacks during `foundry start` now write `foundry_project_continuation_stale_cleared` lifecycle events before building standalone, including stale project ID, active project count, title, and domain.
- Project status updates now refresh `portfolio/projects/index.md`, so `foundry start` progress increments and Curator status changes keep the project index current; newly created projects no longer duplicate their own index row.
- Killed-artifact dream capture during `foundry start`, including Background Refinery kills, now writes lifecycle start, completion, and failure events with artifact metadata, kill-reason preview, resurrection hint preview, duration, and failure detail.
- Phase 0 pre-checks during `foundry start` now write lifecycle start, completion, and failure events with STOP-file state, disk-floor result, mood snapshot, duration, halt reason, and failure detail.
- Request-file polling during `foundry start` now writes lifecycle start, completion, and failure events with pending/empty state, request preview/length, duration, and read failure detail.
- Human redirects consumed during `foundry start` now write lifecycle start, completion, and failure events with request preview/length, worker slot, approval or rejection result, selected proposal metadata, token usage, duration, rejection detail, and translation/processing failure detail.
- Iteration results, `logs/iterations.jsonl`, checkpoints, and status recent-outcome text now carry human-redirect source markers for redirected terminal outcomes.
- Ideator proposal generation during `foundry start` now writes lifecycle start, completion, and failure events around each retry attempt, including burst counts, retry context, Stoker directive metadata, proposal counts, partial burst failures, token usage, and duration.
- Critic Gate 1 during `foundry start` now writes lifecycle start, completion, and failure events for normal Ideator proposals and human redirects, including source, attempt, proposal titles/counts, approval/rejection/revise counts, selected title, token usage, duration, and failure detail.
- Ideation deadlocks during `foundry start` now write lifecycle events around Curator override attempts, including retry count, rejection-context preview, forced proposal metadata or failure detail, duration, and override token usage.
- Curator deadlock override token usage is now included in the iteration's total token accounting instead of being recorded as zero.
- Creator phases during `foundry start` now write lifecycle start, completion, and failure events for normal creation and Tester fix-cycle passes, including proposal metadata, revision/fix-cycle markers, file count, phase tokens, token usage, duration, and failure detail.
- Workspace staging during `foundry start` now writes lifecycle start, completion, and failure events when Creator output or Tester fix-cycle rewrites are materialized into `workspace/`, including file paths, proposal/artifact metadata, revision/fix-cycle markers, duration, and failure detail.
- Tester phases during `foundry start` now write lifecycle start, completion, and failure events for lightweight, code-plan, sandbox, and sandbox-fallback validation paths, including artifact metadata, revision/fix-cycle markers, verdict summary, issue/test counts, token usage, duration, and failure detail.
- Artifact Gate reviews during `foundry start` now write lifecycle start, completion, and failure events around Critic Gate 2, including artifact metadata, Tester verdict, revision/fix-cycle counts, decision, mean rating, ship-threshold status, token usage, duration, and failure detail.
- Artifact bookkeeping during `foundry start` now writes lifecycle start, completion, and failure events around shipped/killed portfolio finalization, including artifact ID, proposal/artifact metadata, gate decision, Tester verdict, token usage, rating or kill reason, duration, and failure detail.
- Stimuli checkpoints now preserve each source's consecutive failure count and disabled flag, while still reading legacy last-refresh-only records.
- `foundry status`, `/api/furnace`, and the Furnace State panel now expose Stimuli source health from checkpoint state, including failing, disabled, and due feeds.
- Failing or disabled Stimuli feeds now raise shared furnace health to warning so status/doctor health gates catch broken external-input pipelines.
- Curator full-cycle prompts now receive deterministic Stimuli source health for `{stimuli_staleness}`, replacing the previous placeholder text with per-source refresh age, failure, due, and disabled state.
- Curator-triggered Stimuli refresh actions now update the same runtime/checkpoint source state, resetting failures on success and preserving failure/disabled state on refresh errors.
- Parallel `foundry start` now runs the same pre-iteration Stimuli refresh as sequential mode, serialized around checkpointed source state so pool workers get current external inputs without racing each other.
- Pre-iteration Stimuli refresh during `foundry start` now writes lifecycle start, completion, and failure events in sequential and parallel mode, including tracked source counts, refreshed/failing/disabled counts, duration, and non-fatal failure detail.
- `foundry stimuli status` now provides a focused Stimuli source-health report with text/JSON output, reset guidance, and `--fail-on warning` automation support.
- `foundry stimuli refresh <source>` now retries one configured Stimuli source immediately and updates checkpointed source health on success or backend failure.
- `foundry stimuli reset <source>` now clears one checkpointed Stimuli source's refresh age, failure count, and disabled flag, with `--json` output for operator automation.
- Manual Stimuli refresh/reset operations now write structured repair audit entries to `logs/stimuli.jsonl`.
- `foundry stimuli history [source]` now reads recent Stimuli repair audit events from `logs/stimuli.jsonl`, with `--action`, `--status`, `--limit`, and `--json` support for operator automation.
- `foundry status` now reconstructs iteration counts and recent outcome history from `logs/iterations.jsonl` when no checkpoint is present, preserving human-redirect source markers.
- Checkpoint-free startup now hydrates shipped/killed/skipped counts, shipped domain counts, recent outcomes, source markers, and token totals from `logs/iterations.jsonl` before saving the next checkpoint.
- `foundry start` now enforces `loop.disk_space_min_gb` before entering the loop, before each sequential iteration, and while scheduling parallel work, failing early at startup or checkpointing and halting once current work drains when the workspace drops below the configured disk floor.
- `foundry start` now writes lifecycle audit events to `logs/events.jsonl`, recording `foundry_start`, `foundry_stop`, startup preflight failures, and fatal post-start runtime errors with mode, concurrency, providers, start iteration, stop reason, elapsed duration, last completed iteration, and next iteration.
- `foundry start` now writes `foundry_iteration_start` lifecycle events before each sequential or parallel iteration dispatch, preserving an audit trail for attempts that begin but never reach a terminal iteration log.
- `foundry start` now writes `foundry_iteration_complete` lifecycle events after sequential and parallel iteration attempts finish, including outcome, duration, token usage, worker slot, and available artifact context.
- Scheduled Curator full cycles during `foundry start` now write lifecycle start, completion, and failure events in sequential and parallel mode, including duration and previous/current Curator iteration pointers.
- Anti-entropy monitor passes during `foundry start` now write lifecycle start, completion, and failure events in sequential and parallel mode, including warning counts, critical warning counts, emergency-Curator state, duration, and non-fatal failure detail.
- Deterministic Stoker checks during `foundry start` now write lifecycle start, completion, and failure events in sequential and parallel mode, including cadence, due state, skipped checks, directive metadata, duration, and non-fatal failure detail.
- Background Refinery jobs queued during `foundry start` now write lifecycle start, completion, and failure events in sequential and parallel mode, including source metadata, queue position, result, artifact context, token usage, duration, and skipped-attempt detail.
- `foundry start` now writes `foundry_checkpoint_saved` lifecycle events after successful runtime checkpoint writes, including checkpoint iteration, last Curator run, and save reason.
- Failed runtime checkpoint writes during `foundry start` now write `foundry_checkpoint_failed` lifecycle events before rethrowing, including checkpoint iteration, save reason, last Curator run, and failure detail.
- `foundry_stop` lifecycle events now include derived `iterations_completed` so operators do not need to calculate run length from start and last-completed iteration fields.
- `foundry_start` lifecycle events now record whether runtime state came from a checkpoint or from iteration-log reconstruction, including the checkpoint iteration or last logged iteration.
- `foundry_start` lifecycle events now record configured model override count and windows, making A/B model periods auditable from `logs/events.jsonl`.
- `foundry_start` lifecycle events now distinguish configured model override windows from actually applied overrides, and startup STOP runs skip override activation.
- `foundry_start` lifecycle events now record when provider validation was skipped because the configured STOP file was already present at startup.
- `foundry_start` lifecycle events now record the configured request file, whether a human redirect was pending at startup, and a compact startup request preview when present.
- `foundry start` now prints a compact startup cue when it begins with a pending human redirect.
- Parallel `foundry start` now temporarily limits scheduling to one worker while a human redirect is pending, writes a `foundry_parallel_request_guard` lifecycle event with the request preview, and writes `foundry_parallel_request_guard_released` with restored concurrency and elapsed milliseconds after the redirect file clears.
- `foundry_start` lifecycle events now record effective git automation mode, including whether auto-commit and auto-push are active for the run.
- `foundry_start` lifecycle events now record provider fallback metadata, including the unavailable provider, fallback provider, fallback model, and affected agents.
- Fatal post-start `foundry start` errors now append a best-effort journal note before rethrowing, keeping `identity/journal.md` aligned with lifecycle error audits.
- Provider-validation exceptions during `foundry start` now write `foundry_start_failed` lifecycle audit entries before the command exits.
- `foundry start` failures now write skipped terminal entries to `logs/iterations.jsonl` in both sequential and parallel modes, preserving failed-loop history for checkpoint-free recovery, Stoker inputs, status counts, and timeline audits.
- Sequential `foundry start` now honors SIGINT immediately after the current iteration, checkpointing and exiting before Curator, monitor, Stoker, or cooldown work can delay shutdown.
- Signal-triggered `foundry start` shutdown now records the specific signal name (`SIGINT` or `SIGTERM`) in lifecycle stop events, journal halt entries, and live console halt messages.
- Sequential `foundry start` now re-checks the configured STOP file before entering cooldown, checkpointing and exiting immediately after completed post-iteration maintenance when an operator halt appears mid-cycle.
- Sequential `foundry start` cooldown is now interruptible: STOP or signal requests observed while sleeping checkpoint the completed iteration, record `cooldown_interrupted: true`, and halt without waiting through the full cooldown.
- Sequential `foundry start` cooldown now also wakes early when a human redirect appears in the configured request file, recording a cooldown interruption with request preview and starting the next iteration immediately.
- Sequential `foundry start` now skips cooldown immediately when a human redirect is already queued before sleeping, recording a zero-elapsed cooldown interruption before starting the next iteration.
- Sequential `foundry start` cooldown now writes lifecycle audit events for cooldown start, completion, and interruption, including configured cooldown milliseconds, elapsed time, and interrupt reason.
- Sequential `foundry start` now writes `foundry_sequential_maintenance_start` and `foundry_sequential_maintenance_complete` around post-iteration Curator, checkpoint, monitor, and Stoker work before STOP/cooldown decisions.
- Sequential maintenance completion now carries monitor warning counts, critical-warning counts, failure state, emergency-Curator state, and monitor duration so one event summarizes the health check result.
- Sequential maintenance completion now also carries Stoker due/cadence state, force-trigger state, directive-written state, directive target, urgency, rules fired, refinery queue, duration, and failure detail when applicable.
- Sequential maintenance start and completion now include the current-run outcome, token, and token-heat ledger so the post-iteration envelope is self-contained even when STOP halts before cooldown.
- Sequential `foundry start` now prints a compact maintenance summary after post-iteration checks, including checkpoint status, monitor warning count, Stoker action, duration, and token heat.
- Sequential `foundry start` now halts after 3 consecutive skipped iteration failures, writing `foundry_sequential_failure_breaker`, checkpointing, and recording a stop summary instead of spinning indefinitely on a broken runner or provider.
- Sequential `foundry start` now writes `foundry_sequential_failure_warning` before the skipped-iteration breaker threshold, including the current streak, remaining failures before halt, retry-backoff milliseconds, and failure detail.
- Sequential skipped-iteration warnings now also print a live `foundry start` console cue with the streak, remaining failures before halt, and retry-backoff duration.
- Sequential `foundry start` now prints a live next-iteration handoff summary before cooldown, including the next iteration, cooldown/backoff, token heat, current-run iteration count, token total, and queued Stoker directive when one was written.
- `foundry_next_iteration_ready` now includes queued Stoker directive handoff fields in sequential mode, including directive-written state, target iteration, urgency, fired rules, and refinery queue when available.
- `foundry_next_iteration_ready` now includes queued request-file handoff fields in sequential mode, including the request file, pending state, compact preview, and fail-soft read failure detail; the live handoff line also calls out queued human redirects before cooldown or immediate advance.
- Queued request-file handoffs now checkpoint the completed iteration before bypassing a configured sequential cooldown, and readiness plus cooldown-interruption lifecycle events report the checkpoint coverage and reason.
- Request-file redirects detected during an active sequential cooldown now checkpoint the completed iteration, append a fail-soft journal note with the request preview, and report checkpoint coverage on `foundry_cooldown_interrupted` before starting the next iteration early.
- Transient request-file read failures during active sequential cooldown no longer abort `foundry start`; cooldown completion or interruption events now carry request-poll failure count, detail, elapsed window, and request-file path.
- Transient STOP-file read failures during active sequential cooldown no longer abort `foundry start`; cooldown completion or interruption events now carry STOP-poll failure count, detail, elapsed window, and configured stop-file path.
- Recovered sequential cooldown polling failures now append a fail-soft journal note with the failed STOP/request file, count, latest detail, and next iteration so operators can spot transient intervention-file issues without opening lifecycle JSONL.
- Recovered sequential cooldown polling failures now also print a compact live console line before the next iteration starts, making transient STOP/request-file read recovery visible while watching `foundry start`.
- Configured sequential cooldown starts now print an active watch line and include the next iteration, configured STOP/request files, and interrupt/signal watch flags in `foundry_cooldown_start`.
- Sequential cooldown completion now prints a compact live handoff line with elapsed cooling time and the next iteration before the loop advances.
- Zero-cooldown sequential handoffs now write `foundry_cooldown_skipped` with the no-configured-cooldown reason, cooldown plan, token heat, and current-run ledger before immediately advancing.
- The live sequential next-iteration handoff line now reports queued-request checkpoint coverage when a redirect handoff saved state before skipping cooldown.
- Sequential `foundry start` now appends a fail-soft journal note when an already queued human redirect skips cooldown, preserving the request preview and early next iteration in the file-based run record.
- Sequential `foundry start` now checkpoints and skips configured cooldown immediately when post-iteration maintenance writes a high-urgency Stoker directive for the next iteration, preserving the handoff and spending the next prompt without idle delay.
- `foundry_next_iteration_ready` now includes a sequential handoff health signal derived from monitor and Stoker maintenance results, and the live handoff line calls out warning or critical attention before the next iteration starts.
- Sequential `foundry start` now checkpoints critical handoff attention before cooldown or advance when the same maintenance phase has not already saved state, preserving the last completed iteration before a risky next turn.
- Critical sequential handoffs now surface checkpoint coverage in `foundry_next_iteration_ready` and in the live handoff line, including whether a checkpoint was required, whether one covered the handoff, and the save reason.
- Critical sequential handoffs now also append a fail-soft journal note with the attention reasons and checkpoint coverage, keeping the file-based run record readable without opening lifecycle logs.
- Sequential `foundry start` now writes `foundry_sequential_failure_recovered` when a successful non-skipped iteration clears a skipped-iteration streak, including the prior streak length and recovery outcome.
- `foundry start` now skips provider health probes and model override activation when the configured STOP file already exists at startup, checkpointing and exiting without spending network calls or mutating model state for a run that is already halted; the lifecycle stop audit includes `stop_file_present_at_startup: true`.
- STOP-file halts during `foundry start` now record the configured stop-file path and a compact stop-file preview in lifecycle stop audits and journal halt notes, so `foundry stop --reason` survives into unattended-run audit trails.
- STOP-file halt messages in sequential and parallel `foundry start` now include the configured stop-file path and compact preview in the live console output.
- Iteration-returned `halted` outcomes during `foundry start` now preserve the iteration's halt reason as lifecycle stop `detail`.
- Parallel `foundry start` now stops reserving new work when any worker returns `halted`, skips normal post-iteration maintenance for that halted result, drains already-running iterations, checkpoints the drained last-completed iteration, and records the halted worker iteration in lifecycle and journal output.
- Parallel `foundry start` now writes a journal halt entry when STOP or signal shutdown stops new scheduling after the worker pool drains, matching the disk-preflight halt trail.
- `foundry start` now prints its provider mode banner from the post-validation active provider set, so invalid custom providers that fall back to `zai` no longer remain in the startup banner.
- Parallel `foundry start` now detaches its renderer and signal listeners in a teardown path even if the final checkpoint save fails after the worker pool exits.
- Checkpoints now record a rolling Critic artifact rejection window from shipped/killed outcomes, and checkpoint-free startup rebuilds that window from `logs/iterations.jsonl`.
- Successful `foundry start` Curator cycles now save a checkpoint immediately in sequential and parallel modes, preserving `last_curator_run` and refreshed Stimuli state even when the next periodic checkpoint is far away.
- Curator full-cycle prompts now include the rolling Critic artifact rejection rate and request a standards-drift reflection when recent kills exceed 40% of artifact decisions.
- `foundry status` text and JSON now expose Critic artifact rejection pressure from that rolling checkpoint/log window.
- The Observatory `/api/furnace` payload and Furnace State panel now expose Critic artifact rejection pressure from recent shipped/killed outcomes.
- `foundry status`, `/api/furnace`, and the Furnace State panel now report Refinery cooldown eligibility, including the configured gap, next eligible iteration, and iterations remaining.
- The Observatory dashboard now exposes `/api/furnace` and renders a Furnace State panel with Stoker, complexity ROI, streak, speculative fuel, and Refinery telemetry.
- Stoker directives now behave as single-use pressure: consumed directives are cleared after their target iteration completes, and context assembly suppresses directives whose target iteration has already passed.
- Status and Observatory telemetry now suppress stale Stoker directive files using the same target-iteration check, so leftover `identity/stoker-directive.yml` data cannot look like active pressure after its iteration has passed.
- `foundry status` now reports Stoker cadence, including the next completed iteration that will trigger a deterministic Stoker check and how many iterations remain.
- The Observatory `/api/furnace` payload and Furnace State panel now expose the same Stoker cadence, keeping dashboard and CLI operator views aligned.
- `foundry status`, `/api/furnace`, and the Furnace State panel now expose Stoker token heat: recent average token spend, configured threshold, sample count, and whether refinery queueing is hot or cool.
- Stoker token heat now includes pressure state, threshold percentage, sampled total, peak sampled usage, and remaining room before the hot threshold across status, `/api/furnace`, and Observatory.
- `foundry status`, `/api/furnace`, and the Furnace State panel now expose a Background Refinery fuel gauge with total eligible second-pass targets, source-type counts, queue limit, and a preview of the next candidate.
- `foundry status`, `/api/furnace`, and the Furnace State panel now synthesize Refinery readiness from cooldown, fuel, and token heat gates so operators can see whether Stoker would queue work now or which blocker is active.
- `foundry status`, `/api/furnace`, and the Furnace State panel now report how many speculative warmed ideas were ignored as stale, making expired fuel visible without letting it influence ideation.
- Iteration logs now record applied Stoker directive metadata plus the resulting streak snapshot, giving future monitor and dashboard work a stronger audit trail for furnace steering.
- Checkpoints now carry and restore `streak_state`, so Continuation Greed survives crash recovery even if the identity file needs to be reconstructed from the latest checkpoint.
- `foundry logs doctor` now scans active JSONL logs, reports rotation and malformed-line health, supports `--json` plus configurable `--fail-on` thresholds for automation, and exits nonzero when log health crosses the chosen operator threshold.
- JSONL log health now includes recommended operator actions, and the Observatory Furnace panel renders them when log health needs attention.
- `foundry doctor` now provides a compact top-level furnace health preflight with shared reasons/actions, JSON output, and configurable `--fail-on warning|critical` exit thresholds.
- `foundry doctor --preflight` now folds config and prompt-template readiness into top-level doctor health, treating invalid preflight files as critical and ambiguous prompt selectors as warning-level health.
- `foundry doctor --preflight` text output now lists invalid preflight files and ambiguous prompt selectors directly, making the combined preflight actionable without switching to JSON.
- `foundry preflight` now runs the strict combined readiness gate directly, with config/prompt preflight enabled and warning-level failures enabled by default.
- `foundry start` now runs prompt-template contract preflight before entering the autonomous loop, failing early when required prompt files, placeholders, or split sections are invalid.
- `foundry config doctor` now validates `foundry.yml`, `models.yml`, `domains.yml`, and `stimuli.yml` with text and JSON output, exiting nonzero when any config file is missing or invalid.
- `foundry config doctor` now validates prompt-template contracts too, catching missing prompt files, blank templates, missing required placeholders, and unknown placeholder leaks before unattended runs.
- Prompt-template validation now checks split runtime prompt sections, catching missing `## GATE 2` critic markers and placeholders assigned to the wrong critic gate before dispatch can leak raw template tokens.
- Prompt-template config-doctor JSON now preserves structured diagnostics with stable codes, affected placeholders, sections, and markers instead of forcing automation to parse joined error strings.
- Config-doctor output now includes aggregate summary counts for total, ok, invalid, config, prompt, invalid config, and invalid prompt checks before the per-file report.
- Config-doctor JSON entries now include `kind: "config"` or `kind: "prompt"`, letting watchdogs route failures without parsing file paths.
- `foundry config doctor --fail-on-ambiguous` now exits nonzero after printing the full preflight report when prompt selector aliases collide, and config-doctor JSON includes `ambiguousPromptSelectors` details.
- `foundry prompts doctor` now runs the prompt-template contract preflight directly, with text and JSON output plus nonzero exits for invalid prompt files.
- Prompt-doctor JSON now includes summary counts, and text output prints total, ok, and invalid prompt-template counts before per-file details.
- `foundry prompts doctor --fail-on-ambiguous` now exits nonzero after printing the report when prompt selector aliases collide, and prompt-doctor JSON includes `ambiguousSelectors` details for automation.
- `foundry prompts list` now prints registered prompt-template contracts, including required placeholders, optional placeholders, and split-section markers, with JSON output for tooling.
- `foundry prompts list` now reports selector aliases that would be ambiguous for `foundry prompts show`, including structured `ambiguousSelectors` JSON for automation.
- Prompt-list ambiguity reporting now follows `foundry prompts show` matching semantics, covering duplicate exact names/paths without flagging exact selectors that intentionally shadow basename shortcuts.
- `foundry prompts list --fail-on-ambiguous` now exits nonzero after printing the report when selector collisions exist, giving CI and watchdog scripts a strict prompt-alias gate.
- `foundry prompts list` and `foundry prompts show <template>` now expose accepted selector aliases for each prompt contract so operators can discover exact names, relative paths, and basename shortcuts.
- `foundry prompts show <template>` now focuses on one prompt contract and its live validation status, accepting contract names, relative paths, basenames, and `--json` before or after the selector; JSON mode exits nonzero when the selected template is invalid.
- `foundry prompts show <template>` now rejects ambiguous basename selectors with the matching prompt contracts instead of validating whichever contract happened to be registered first.
- `foundry prompts show <template> --json` now emits structured selector-error JSON for unknown or ambiguous templates before exiting nonzero.
- `foundry prompts show --json` now emits structured selector-error JSON when the template selector is omitted, with `selector: null` for automation.
- Prompt-template contract validation now rejects duplicate split-section markers such as repeated Critic Gate 2 headers, preventing ambiguous prompt slicing before an unattended loop starts.
- `foundry.yml` loading now validates required runtime sections, scalar bounds, boolean flags, and complexity profile budgets before malformed loop settings reach autonomous runs.
- Count-like config values now reject fractional numbers, covering iteration windows, queue sizes, context history limits, token ceilings, model override windows, and stimuli refresh limits.
- `stimuli.yml` loading now validates safe MCP source slugs, supported servers, numeric refresh settings, and query lists before source names reach `stimuli/live/` file paths.
- `models.yml` and `domains.yml` loading now validates required agents, model token limits, model temperatures, domain rows, and positive domain weights with nested error messages.
- `domains.yml` loading now rejects unsafe or duplicate domain names before they can reach portfolio paths, prompts, and domain-balance telemetry.
- Ideator validation now trims proposal titles and rejects blank or duplicate titles before Gate 1 selection can become ambiguous.
- Ideator and Curator redirect validation now reject blank proposal domain, pitch, and rationale fields before hollow ideas can enter Gate 1 or human-redirect routing.
- Ideator validation now enforces the prompt's exact five-proposal slate before Gate 1 receives a shortened or overlong idea set.
- Ideator validation now enforces the prompt's ambition floor: at least four M-or-higher proposals and at least three L/XL proposals per slate.
- Ideator proposal validation now requires XL ideas to declare `xl_mode`, and requires a project block when `xl_mode: project`.
- Ideator and Curator redirect validation now require XL project blocks to include non-empty project metadata, positive integer iteration estimates, and non-empty structure maps with non-blank descriptions before project creation consumes them.
- Ideator and Curator redirect retry schemas now mark proposal metadata, optional refs, and project starter descriptions as containing non-whitespace text, matching runtime validation.
- Ideator and Curator redirect validation now reject inconsistent project starter metadata, including ignored project blocks, nested project starters, malformed optional refs, M-or-lower project starters, and non-XL `single` modes.
- Approved L project starters now create portfolio projects instead of shipping as standalone artifacts with ignored project metadata.
- Project starter handling now enforces `projects.max_active`: capped starters are built as standalone artifacts, and Ideator context reports active project slot usage plus at-capacity guidance.
- Creator dispatch now injects existing project context for project continuations, and stale continuation IDs are stripped before creation/bookkeeping so they ship as standalone artifacts instead of failing after the fact.
- Ideator and Curator redirect dispatch now reject project starters whose estimated iteration count exceeds `projects.max_iterations_per_project`, and prompts surface that configured cap before retry.
- Ideator and Curator redirect dispatch now reject project continuations whose `project_id` is not currently active, and Curator redirect prompts include the active project list.
- Ideator and Curator redirect dispatch now reject out-of-config proposal domains and retry, preventing model outputs from creating ad hoc portfolio buckets.
- Critic Gate 1 dispatch now rejects evaluations or selected approvals that reference titles outside the current proposal slate and retries, preventing hallucinated approvals from falling back to the first idea.
- Critic Gate 1 normalization now rejects non-object evaluation entries without throwing, keeping malformed model output inside the YAML retry path.
- Critic Gate 1 validation now trims `selected` metadata and rejects selections that do not match an approved evaluation in the same response.
- Critic Gate 1 validation now rejects ambiguous multi-approval responses without an explicit `selected` winner, while normalizing single-approval responses to their approved title.
- Critic Gate 1 dispatch now retries when an evaluation omits any proposal from the current slate, enforcing the prompt rule that every proposal is evaluated exactly once.
- Critic Gate 1 validation now requires non-empty reasons for `reject` and `revise` evaluations before their feedback reaches retry and speculative-idea context.
- Critic Gate 1 validation and retry schemas now reserve `recommended_complexity` for approved evaluations only, preventing rejected or revise-only ideas from carrying executable build-tier overrides.
- Critic Gate 1 validation now trims evaluation titles and rejects blank or duplicate titles before selection, logging, and speculative carry-forward consume them.
- Critic Gate 1 retry schemas now mark evaluation titles as containing non-whitespace text, matching runtime title trimming and validation.
- Critic Gate 1 retry schemas now conditionally require nonblank `reasons` for `reject` and `revise` evaluations while leaving approved ideas free to omit rationale.
- Critic Gate 1 retry schemas now advertise the exact `approve|reject|revise` decision enum, aligning correction prompts with runtime validation.
- YAML validators now reject out-of-enum Gate 1 decisions, Tester verdicts, and Gate 2 decisions before malformed model outputs reach the runner.
- Ideator YAML validation now rejects missing or unsupported proposal complexity tiers before malformed plans reach Creator routing.
- Curator redirect validation now enforces the same proposal contract as Ideator output, including pitch, rationale, and S/M/L/XL complexity tiers.
- Curator full-cycle validation now rejects malformed non-null `human_redirect` payloads and its prompt/retry schema document the full proposal wrapper shape.
- Curator full-cycle validation now checks optional side-effect arrays when present, rejecting malformed manifesto changes, project decisions, and stimuli actions before they reach filesystem/status updates.
- Curator full-cycle validation and retry schemas now require `domain_recommendations` to be a string, preserving the Ideator guidance file contract even when the recommendation text is intentionally empty.
- Curator full-cycle validation and retry schemas now require side-effect arrays plus explicit `human_redirect: null`, matching the prompt and TypeScript response shape for no-op curator outputs.
- Curator side-effect retry schemas now mark manifesto anchors, project decision IDs/reasons, and stimuli targets/content as containing non-whitespace text, matching runtime validation.
- Curator stimuli-action retry schemas now conditionally require nonblank `content` for `commission_skill` actions while keeping refresh-only actions lightweight.
- Creator plan validation now rejects empty or malformed file manifests and malformed optional planning arrays before build batching and revision prompts consume them.
- Creator output validation now rejects empty, absolute, traversal, backslash-separated, and duplicate artifact file paths before workspace, sandbox, or portfolio writes consume them.
- Creator output validation and retry schemas now reject malformed optional file `language` metadata instead of allowing non-string or blank values into artifact records.
- Creator plan validation now applies the same safe relative-path rules to file manifests, rejects duplicate manifest paths, and requires explicit build-order paths to reference manifest entries.
- Creator output and plan retry schemas now state that artifact and manifest file paths must be unique, matching runtime duplicate-path rejection before writes and build scheduling.
- Creator plan retry schemas now mark each `build_order` batch as `uniqueItems: true`, matching runtime duplicate-path rejection inside a build pass.
- Creator and Tester retry schemas now expose safe relative-path patterns for artifact files, plan manifests, build-order entries, and generated test-plan files, matching filesystem and sandbox path validation.
- Creator and Tester retry schemas now advertise NUL-byte path rejection in their shared safe relative-path contract, matching runtime file-path validation.
- Creator and Tester path validation now rejects embedded control characters, preventing tab or newline-bearing artifact paths from reaching sandbox writes, logs, or shell commands.
- Tester validation now checks optional test results, issues, and sandbox test plans when present, rejecting malformed enums, unsafe test-file paths, and non-array command/file payloads before sandbox execution.
- Tester validation and retry schemas now require `tests_run` and `issues` arrays on every report, matching the prompt format and TypeScript response shape while still allowing empty arrays.
- Tester validation and retry schemas now reject `pass` reports that include failed checks or open issues, keeping verdicts consistent with their evidence.
- Tester validation and retry schemas now require `fail_fixable` reports to include at least one issue, preventing repair loops from receiving a fixable verdict with no actionable problem.
- Tester validation and retry schemas now require every `fail_fixable` issue to include non-empty `suggested_fix` guidance, while reserving that field for fixable reports only.
- Tester validation now rejects provided sandbox test plans that contain no generated test files, and the retry schema marks test-plan files as `minItems: 1`.
- Tester test-plan retry schemas now mark generated test files as `uniqueItems: true`, matching runtime duplicate-path rejection for sandbox file writes.
- Tester test-plan retry schemas now state that generated test file paths must be unique, matching runtime duplicate-path rejection beyond exact object duplication.
- Tester issue retry schemas now allow `suggested_fix: null` while still requiring non-whitespace text when fix guidance is present, matching runtime optional-field handling.
- Tester validation and retry schemas now require a non-empty `post_mortem` only for `fail_catastrophic` reports, while accepting `null` or omission for pass and fixable outcomes.
- Critic Gate 1 validation now rejects invalid `recommended_complexity` overrides while preserving `null` and S/M/L/XL values for legitimate complexity corrections.
- Critic Gate 2 validation now requires all core rating dimensions to be numeric 1-5 values, with optional `technical_quality` also range-checked when present.
- Critic Gate 2 validation now rejects `ship` decisions below the documented quality threshold, including low optional `technical_quality` ratings when present.
- Critic Gate 2 validation now requires non-empty portfolio reviews before artifact memory, ratings history, or future Creator context consume the critique.
- Critic Gate 2 validation now requires non-empty revision notes for `revise` decisions and non-empty kill reasons for `kill` decisions before the runner acts on them.
- Critic Gate 2 retry schemas now conditionally require nonblank `revision_notes` for `revise` and nonblank `kill_reason` for `kill`, matching runtime decision handling.
- Critic Gate 2 retry schemas now mark reviews, revision notes, and kill reasons as containing non-whitespace text, matching the runtime non-blank checks.
- Critic Gate 2 retry schemas now list all required rating dimensions plus the 1-5 numeric range, making rating repair prompts match runtime validation.
- Critic Gate 2 rating semantics now live in a shared helper used by parser validation, revision fallback, portfolio writes, and auto-commit rating summaries.
- Critic rating helpers are now exported through the root package and `the-foundry/critic` subpath for downstream tooling.
- CLI help now lists `stimuli.yml` in `foundry config doctor` coverage, matching the actual preflight validator.
- `foundry status --fail-on` now prefers active monitor warning counts when using fallback health data, so historical resolved warnings do not trip watchdog exits.
- `foundry doctor` now synthesizes fallback reasons and monitor actions when older status payloads lack the shared furnace-health object.
- Model tier override entries now validate agent names, non-empty labels/models, and iteration windows before A/B tests can silently no-op.
- Monitor warning summaries now expose active recent counts separately from historical totals, and furnace health uses the active counts so old resolved warnings do not keep `foundry doctor` in warning state forever.
- `monitor.active_warning_window` now configures how long monitor warnings remain active for status, doctor, `/api/furnace`, and Observatory health gates.
- `config/foundry.yml` loading now validates Stoker token-heat and monitor active-window settings with clear errors before bad values reach status or health calculations.

### Fixed

- `foundry init` now copies only the source Astro site scaffold and skips generated `site/node_modules`, `site/dist`, `.astro`, and artifact output, keeping initialized portfolios fast and clean even when the package checkout has local build artifacts.
- Rejected human redirects now clear consumed speculative fuel before returning a skipped iteration, preserving the one-iteration freshness rule during `foundry start`.
- Auto-commit now stages `logs/` as a directory, keeping optional Stoker, Refinery, monitor, token-usage, and future logs with commits without failing on missing optional log files.
- Stoker audit writes now use the shared JSONL logger, giving `logs/stoker.jsonl` the same directory creation and rotation behavior as the other furnace logs.
- Monitor warning writes now use the shared JSONL logger too, so `logs/monitor.jsonl` is recreated instead of being silently dropped when the log directory is missing.
- Parallel pool events now use the shared JSONL logger, so `logs/events.jsonl` rotates like the rest of the observability logs.
- The shared JSONL logger now re-ensures `logs/` when the Foundry root changes, preventing writes from failing after root switches in tests or embedded callers.
- JSONL rotation now checks the active file before every append, preventing fast-growing logs from overshooting the rotation threshold for up to a minute.
- JSONL archive names now add a numeric suffix on timestamp collision, avoiding archive loss when multiple rotations happen in the same millisecond.
- Rotated JSONL readers now order same-timestamp archives by numeric suffix, preserving production order when context assembly reads archived logs.
- `foundry status`, `/api/furnace`, and the Furnace State panel now expose JSONL log health: active log count, archive count, active bytes, and the largest active log.
- JSONL log health now includes rotation threshold, largest-log percentage, and bytes remaining before the next rotation.
- JSONL log health now classifies rotation pressure as `clear`, `watch`, or `rotate-soon` for faster operator scanning.
- JSONL log health now counts malformed lines in active logs and reports which active log files contain malformed JSONL.
- JSONL log health now derives an operator-facing `healthState` (`healthy`, `watch`, `rotate-soon`, or `malformed`) and surfaces it in status, API, and dashboard views.
- JSONL log health now includes per-file malformed-line details with the first bad line number, so operators can jump straight to the damaged active log entry.
- JSONL log health now reports archived log bytes, total log bytes, and the largest rotated archive, making long-running disk growth visible from status and Observatory views.
- The anti-entropy monitor now turns malformed active JSONL logs and near-rotation active logs into `log_health` warnings in `logs/monitor.jsonl`.
- `foundry status`, `/api/furnace`, and the Furnace State panel now summarize recent monitor warnings by severity and show the latest warning.
- Speculative warmed-idea fuel is now cleared only after the Ideator has had access to it, instead of being deleted before Phase 1 context assembly.
- The live Ideator dispatcher now applies the same one-iteration freshness filter as status/context views, so stale `workspace/speculative.yml` fuel cannot leak into later model calls.
- Gate 1 complexity recommendations are now applied only when the resulting proposal metadata stays consistent, preventing project starters from being silently converted into invalid lower-tier project artifacts.
- Max-revision fallback now uses the documented Critic Gate 2 ship threshold before force-shipping, so exhausted revision loops cannot sneak sub-threshold artifacts into the portfolio.
- Portfolio artifact writes now enforce the current Critic Gate 2 rating scale and ship threshold, preventing direct file writes from preserving impossible shipped scores.
- Curator full-cycle dispatch now rejects project decisions for inactive project IDs and retries before any invalid project status mutation reaches disk.
- Curator full-cycle `human_redirect` proposals now get the same configured-domain, project-cap, and active-project checks as direct human redirects before they can steer a future iteration.
- Curator full-cycle stimuli actions now retry when refresh targets are not configured sources or commissioned skills omit safe targets/content, preventing no-op curation from being accepted.
- Curator manifesto changes now require non-empty section, old-text anchor, and reason fields, and blank anchors are skipped defensively so manifesto updates cannot prepend accidental text.
- Curator project decisions and stimuli actions now reject blank IDs, targets, reasons, and commissioned-skill content at YAML validation time.
- Curator full-cycle responses now require non-empty retrospective and compressed-journal text, and blank retrospective/compressed memory is skipped defensively instead of polluting journal files.
- Tester responses now require a non-empty summary, keeping verification reports from passing the parser without any evidence-bearing explanation.
- Tester result and issue details now require non-empty evidence fields, so reports cannot satisfy the schema with blank check names, observations, issue descriptions, or locations.
- Tester report retry schemas now mark summaries, test evidence, issue locations, and suggested fixes as containing non-whitespace text, matching runtime validation.
- Tester code-artifact test plans now reject blank runtime names, setup commands, and generated test file contents before sandbox execution planning.
- Tester test-plan retry schemas now mark runtime names, setup commands, generated file contents, and run commands as containing non-whitespace text, matching runtime validation.
- Creator artifact responses now require a non-empty title before workspace, testing, review, or portfolio handling can consume them.
- Creator artifact file contents now have to be non-empty, preventing blank files from passing YAML validation as complete work.
- Creator artifact retry schemas now mark titles and output file contents as containing non-whitespace text, matching the runtime non-blank checks.
- Creator plan responses now reject blank approaches, file purposes, key decisions, and challenge entries before phased building starts.
- Creator plan retry schemas now mark approaches, manifest purposes, key decisions, and challenges as containing non-whitespace text, matching runtime validation.
- Creator plan `build_order` batches now have to contain at least one file path, avoiding no-op phased build passes.
- Creator plan `build_order` now rejects duplicate file paths across all batches, preventing redundant phased build scheduling.

## [1.1.2] — 2026-05-27

### Added

- Ideation can now run multiple full-context bursts per attempt, giving the Critic a broader slate and increasing throughput.
- Ideator context now includes lineage, mood, and dream-journal signals so new proposals can riff on past work, avoid repetition, and revive promising killed ideas.

### Fixed

- Parallel worker failures are now recorded as skipped iterations instead of crashing the whole pool.
- Pool drains now run normal completion bookkeeping for in-flight iterations before curator cycles or shutdown.
- Artifact and commissioned skill writes now reject path traversal attempts from model-controlled filenames.
- Killed artifacts now reserve artifact IDs, preventing future shipped work from reusing their IDs.
- Critic Gate 1 now honors its explicit selected proposal when multiple ideas are approved.
- Lineage graph rebuilds now run inside serialized portfolio bookkeeping to avoid stale writes during parallel shipping.
- The packaged dashboard command now includes the dashboard sources in the npm package.
- Default config version now stays aligned with the package version.

## [1.1.0] — 2026-05-27

### Fixed

- GitHub CI now runs automatically for both package repos and initialized portfolio workdirs.
- GitHub Pages deploys workdir portfolio sites from `main` or `master` pushes.
- Interactive artifact workdirs now publish their HTML, JavaScript, CSS, and sibling assets into the Pages build.
- Portfolio links and embedded artifacts now respect GitHub Pages project base paths.

## [1.0.0] — 2026-05-27

First stable release. Five adversarial agents collaborate to produce an ever-growing portfolio of creative artifacts across any domain.

### Added

- **Core iteration engine** — Ideator → Creator → Tester → Critic pipeline with automatic git commit/push after each iteration
- **Multi-phase Creator pipeline** — Complexity profiles (S/M/L/XL) with planning, drafting, revision, and polish phases
- **Concurrent iterations** — Worker pool runs multiple iterations in parallel with mutex-protected git, event bus, and slot-prefixed console rendering
- **Multi-provider model client** — Route agents to different LLM providers (Z.ai, Codex, any OpenAI-compatible endpoint) with health checks and automatic fallback
- **Curator system** — Periodic manifesto maintenance, journal compression, portfolio-wide curation, and standards evolution
- **Constellation Map** — Tracks creative lineage between artifacts, detects thematic clusters (constellations), and maps creative DNA
- **Dream Journal** — Killed artifacts are preserved with best ideas, failure analysis, and resurrection hints fed back to the Ideator
- **Mood Engine** — Dynamic creative state based on quality trends, domain diversity, and rejection rates; influences ideation with contextual nudges
- **External stimuli pipeline** — Live feeds (news, trending repos, random knowledge) and curated skill files inject material the system couldn't generate from its own context
- **Monitor system** — Four detectors watch for quality crisis (slop), repetition, manifesto drift, and domain collapse; triggers emergency Curator when needed
- **Observatory dashboard** — Real-time web dashboard with live stats, quality trends, constellation visualization, and evolution timeline
- **CLI** (`foundry`) — `init`, `start`, `stop`, `status`, `version`, `upgrade`, `dashboard` commands with `--workdir` support
- **`foundry init`** — Scaffolds a new portfolio repo with config, prompts, site, GitHub Actions workflow, and optional GitHub Pages setup
- **Auto-upgrade** — Detects version mismatch between CLI and project directory, syncs managed files automatically
- **Portfolio site** — Astro-based static site with GitHub Pages deployment workflow for showcasing artifacts
- **Checkpoint and recovery** — Saves state periodically; resumes from checkpoint after interruption
- **Graceful shutdown** — Handles SIGINT/SIGTERM, drains in-flight iterations before stopping
- **Comprehensive test suite** — 645 tests with vitest covering all modules
- **Configuration** — YAML-based config for iteration rules (`foundry.yml`), model selection per agent (`models.yml`), and creative domains with weights (`domains.yml`)
- **Project abstraction** — Multi-iteration projects with XL complexity tier for ambitious, long-running creative work
- **Complexity distribution tracking** — Shared context tracks complexity tiers across iterations to maintain ambition balance
- **6 creative reference skill files** — Writing techniques, sound design, speculative design, constraint art, and more

### Fixed

- Shell injection in CLI commands — all `git` and `gh` calls now use `execFileSync` (no shell interpolation)
- Path traversal in dashboard static file serving — uses `path.resolve` with strict prefix check
- Dashboard binds to `127.0.0.1` instead of all interfaces
- Consistent `execFileSync` usage in `autoCommitAndPush` (no shell metacharacter risk)
- Symlink resolution in CLI `isDirectRun` check
- Explicit `git push origin HEAD` to prevent silent push failures
- `stimuli.yml` copied correctly during `foundry init`
- Tester prompt tightened to prevent YAML parse failures
- Complexity scaling enforced in Ideator and Critic prompts

### Documentation

- [README](README.md) — Full project overview with agent descriptions, creative intelligence features, quickstart, and project structure
- [ARCHITECTURE.md](ARCHITECTURE.md) — System design, agent communication, context assembly
- [CONFIGURATION.md](CONFIGURATION.md) — Complete YAML config schema reference
- [CUSTOMIZATION.md](CUSTOMIZATION.md) — Guide to writing your own manifesto, adding domains, tuning agents
- [LESSONS.md](LESSONS.md) — Lessons learned running autonomous creation at scale
- [CONTRIBUTING.md](CONTRIBUTING.md) — Contribution guide with testing instructions
- [FOUNDRY-SPEC.md](FOUNDRY-SPEC.md) — Full system specification

[1.2.0]: https://github.com/ndcorder/the-foundry/releases/tag/v1.2.0
[1.1.2]: https://github.com/ndcorder/the-foundry/releases/tag/v1.1.2
[1.1.0]: https://github.com/ndcorder/the-foundry/releases/tag/v1.1.0
[1.0.0]: https://github.com/ndcorder/the-foundry/releases/tag/v1.0.0
