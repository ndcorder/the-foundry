# Configuration

All configuration lives in `config/` (core settings), `stimuli/stimuli.yml` (external input), and `prompts/` (agent prompt templates). Config is loaded once at startup — changes require a restart (except `requests.md` and `STOP`, which are checked every iteration). Run `foundry config doctor` before unattended runs to validate `foundry.yml`, `models.yml`, `domains.yml`, `stimuli.yml`, and prompt-template contracts; add `--json` for automation. `foundry start` also runs the prompt-template contract preflight at startup and halts before the autonomous loop if a required prompt file, placeholder, or split section is invalid. The validator checks required `foundry.yml` sections, runtime numeric bounds, integer count fields, boolean flags, complexity profile budgets, model agents, model token ceilings, temperatures, override windows, domain rows, safe unique domain slugs, positive domain weights, safe stimuli source names, supported stimuli backends, stimuli refresh settings, required prompt files, nonblank prompt bodies, required placeholders, missing or duplicate split prompt section markers, and unknown placeholder leaks before the loop starts. Config-doctor JSON includes a `summary` with total, ok, invalid, config-vs-prompt counts, invalid config-vs-prompt counts, and ambiguous prompt selector counts. Config-doctor JSON entries include `kind: "config"` or `kind: "prompt"` so automation can route failures without path parsing, and top-level `ambiguousPromptSelectors` lists selector collisions using `foundry prompts show` matching semantics. Add `--fail-on-ambiguous` to make the full config preflight fail after printing its report when prompt selector collisions exist. Prompt-template JSON failures include readable `errors` plus structured `diagnostics` with stable codes, affected placeholders, sections, and markers. Use `foundry prompts doctor --json` when you only need the prompt contract portion after editing templates; prompt-doctor JSON includes a `summary` with total, ok, invalid, and ambiguous selector counts plus top-level `ambiguousSelectors` details. Add `--fail-on-ambiguous` to make prompt-doctor fail after printing its report when selector collisions exist. Use `foundry prompts list --json` to inspect the registered prompt contract metadata, including accepted selectors, show-semantic ambiguous selector collisions, required placeholders, optional placeholders, and section markers; add `--fail-on-ambiguous` to make selector collisions a nonzero automation gate. Use `foundry prompts show <template> --json` or `foundry prompts show --json <template>` to inspect one contract plus that template's current validation status and accepted selector aliases; basename selectors must be unambiguous, selector failures emit a structured `{ status: "error", error: { code, message, selector, matches } }` JSON object with `selector: null` when no template was provided, and invalid selected templates exit nonzero after emitting JSON.

## foundry.yml

The main configuration file. Organized into sections. `foundry config doctor` rejects missing required sections, non-boolean flags, non-empty string violations, numeric values below their documented lower bound, and fractional values for count-like settings before the loop starts.

### `foundry`

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | string | `"The Foundry"` | System name. Used in logs and journal headers. |
| `version` | string | `"1.2.0"` | System version. Informational only. |

### `iteration`

Controls the per-iteration behavior. These are the most impactful tuning knobs.

| Option | Type | Default | Description |
|---|---|---|---|
| `max_idea_retries` | number | `10` | How many Ideator→Critic rounds before declaring a deadlock. Higher = more chances to find a good idea and more useful token burn on bad cycles. |
| `max_revision_rounds` | number | `20` | How many Creator→Critic Gate 2 revision loops. Furnace defaults favor repeated refinement over token conservation. |
| `max_test_fix_cycles` | number | `25` | How many Tester→Creator fix loops for code artifacts. High values let complex artifacts keep burning tokens until they are actually fixed. |
| `ideation_burst_count` | number | `3` | How many full-context Ideator calls to run in parallel per ideation attempt. Higher = more prompt fan-out, a larger Critic slate, and faster token throughput before creation starts. |
| `curator_interval` | number | `8` | Iterations between full Curator cycles. Lower = more reflection, bigger contexts, and more token burn; raise if Curator drains slow parallel runs too often. |
| `domain_cooldown` | number | `10` | The Ideator must propose at least one idea in a domain not used in the last N iterations. Prevents domain collapse. |
| `novelty_window` | number | `20` | The Ideator cannot propose ideas structurally identical to portfolio entries within this window. Larger = stricter novelty enforcement. |

`complexity_profiles` controls Creator phase output ceilings and soft warning thresholds:

| Tier | Default `max_tokens_per_phase` | Default `budget_warning_threshold` | Use |
|---|---:|---:|---|
| `S` | `32768` | `25000` | Small forms where brevity is the point. |
| `M` | `65536` | `120000` | Multi-file or substantial single-file artifacts. |
| `L` | `90000` | `400000` | Ambitious artifacts with several build batches. |
| `XL` | `180000` | `800000` | Massive standalone artifacts or project starters. |

### `projects`

Multi-iteration project settings.

| Option | Type | Default | Description |
|---|---|---|---|
| `max_active` | number | `4` | Maximum concurrent active projects. Higher values let the Ideator keep several large threads alive. |
| `max_iterations_per_project` | number | `30` | Hard cap on iterations per project. The Curator must extend with justification or close. |
| `allow_standalone_interrupts` | boolean | `true` | Whether standalone ideas can interrupt project work. Should stay true — variety matters. |
| `kickstart_after` | number | `15` | How many iterations without active projects before the Curator explicitly recommends starting one. |

### `streaks`

Continuation Greed settings. The runner persists streak state to `identity/streaks.yml`; context builders inject that state into Ideator and Creator prompts when a high-quality run is worth amplifying or when a broken streak needs a short pivot.

| Option | Type | Default | Description |
|---|---|---|---|
| `min_length_for_amplify` | number | `2` | How many related high-rated shipped artifacts are needed before the Ideator and Creator receive hot-streak guidance. |
| `cooldown_after_break` | number | `2` | How many iterations the Ideator should avoid a streak domain after a low-rated ship, kill, or hard domain shift breaks the streak. |
| `high_rating_threshold` | number | `3.5` | Minimum mean Critic rating for a shipped artifact to start or extend a streak. |
| `rating_break_threshold` | number | `3.0` | Mean Critic rating below which an active streak is broken and pivot guidance is emitted. |

### `complexity`

Adaptive Complexity ROI settings. The monitor analyzes shipped iterations, persists the latest bias to `identity/complexity-bias.yml`, and injects actionable guidance into Ideator prompts when one tier is producing better rating-per-token yield.

| Option | Type | Default | Description |
|---|---|---|---|
| `yield_window` | number | `20` | Number of recent iterations considered for complexity yield analysis. |
| `min_samples_for_confidence` | number | `3` | Minimum shipped artifacts in a tier before its rating-per-token ROI is considered actionable. |
| `high_confidence_samples` | number | `5` | Shipped sample count at which the favored tier's recommendation becomes high confidence. |

### `stoker`

Deterministic furnace-operator settings. After monitor checks, the Stoker reads recent outcomes, streak state, complexity ROI, mood, dream fuel, and recent token heat, then persists the next iteration's steering directive to `identity/stoker-directive.yml` and logs it to `logs/stoker.jsonl`. Directives are single-use pressure: the runner clears a consumed directive after its target iteration completes, defers the current directive to the next iteration when a human redirect preempts Ideator and Background Refinery work, and context, status, and Observatory telemetry suppress stale directives when rebuilding state from disk. Use `foundry stoker history --urgency high --rule refinery_fuel --iteration 41 --limit 20` to inspect recent directive decisions for a target iteration; add `--json` for automation.

`foundry status`, `foundry status --json`, and the Observatory Furnace State panel use this same interval to report the next completed iteration that will trigger a Stoker check, even when no directive is currently active. `foundry status --fail-on warning|critical` can turn monitor warnings and log-health state into a nonzero exit code for watchdog scripts.

When Background Refinery fuel is available and the configured gap has elapsed, Stoker still checks recent main-loop token spend before queueing a refinery job. If the last few iterations are already hot, it records a deferral rule and leaves refinery idle for that directive cycle. `foundry status`, `foundry status --json`, `/api/furnace`, and the Observatory Furnace State panel expose the same token-heat average, threshold, sample count, pressure state, threshold percentage, peak sampled usage, and remaining room before the hot threshold. The synthesized Refinery readiness status reports whether Stoker would queue work now or which cooldown, fuel, or heat blocker is active.

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Whether to generate next-iteration Stoker directives. |
| `run_interval` | number | `5` | Generate a directive after every N completed iterations. Lower values make steering more reactive; higher values make it steadier. |
| `refinery_token_heat_window` | number | `5` | Number of recent iterations Stoker averages when deciding whether main-loop token spend is too hot for extra refinery work. |
| `refinery_token_heat_threshold` | number | `200000` | Average input+output token count across the heat window that defers Background Refinery queueing for the directive cycle. |

Invalid Stoker numeric values are rejected when `config/foundry.yml` is loaded. `run_interval`, `refinery_token_heat_window`, and `refinery_token_heat_threshold` must all be finite numbers at or above their minimums.

### `speculative`

Speculative Pre-generation settings. After Critic Gate 1, the runner preserves unselected but salvageable ideas in `workspace/speculative.yml`; the next Ideator call sees them as warmed-up fuel before the file is refreshed. This fuel is only considered current for the immediately following iteration. `foundry status` and Observatory telemetry report both the current warmed-idea count and the stale ignored count after applying that same freshness rule.

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Whether to carry salvageable Gate 1 ideas forward. |
| `max_carried_ideas` | number | `2` | Maximum number of unselected ideas to keep for the next iteration. The default matches a 3-idea slate with one selected winner. |

### `refinery`

Background Refinery settings. The runner now reads Stoker directives for queued refinery work, selects viable second-pass targets from the dream journal and portfolio, dispatches them through `prompts/refinery.md` using Creator model settings with a lower-temperature refinement pass, verifies them with lightweight Tester review, and sends them through Critic Gate 2. Shipped refinery artifacts receive `[refined]` lineage in their README, a `Refined From` portfolio-index column, and an entry in `logs/refinery.jsonl`. During `foundry start`, queued jobs also write `foundry_refinery_start`, `foundry_refinery_complete`, and `foundry_refinery_failed` lifecycle events to `logs/events.jsonl` with source metadata, queue position, result, artifact context, token usage, duration, and skipped-attempt detail. Stoker reads that same log before queueing new refinement work, so the configured run gap is enforced from actual history. `foundry status`, `/api/furnace`, and the Observatory Furnace State panel report the last run, configured gap, next eligible iteration, remaining iterations, eligible fuel count, source-type mix, queue limit, next target preview, and combined readiness reason using that same history. Use `foundry refinery history --result shipped --source-type companion --iteration 41 --limit 20` to inspect recent shipped/killed/skipped attempts; add `--json` for automation. Source selection also avoids dreams that already shipped from refinery, artifacts that already produced a shipped companion/remaster, and artifacts that already have a refined descendant in the portfolio index.

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Whether queued refinery target discovery and execution are active. |
| `min_iterations_between_runs` | number | `5` | Minimum gap between recorded refinery runs before Stoker may queue another job. Source selection also avoids individual targets attempted in the last 10 iterations. |
| `max_refinery_queue` | number | `1` | Maximum number of refinery targets to select in one pass. |

### `monitor`

Operator health-window settings. Monitor logs always keep historical counts for auditability, while furnace health gates use the active window to decide which recent warnings still require attention. `foundry start` runs the anti-entropy monitor after completed iterations in both sequential and parallel modes; emergency Curator intervention is kept on the serialized sequential path, while parallel worker completions still write monitor warnings and complexity-bias updates. Use `foundry monitor history --severity warning --detector quality --iteration 41 --limit 20` to inspect recent entries from `logs/monitor.jsonl`; add `--json` for automation.

| Option | Type | Default | Description |
|---|---|---|---|
| `active_warning_window` | number | `10` | Completed-iteration window used by `foundry doctor`, `foundry status`, `/api/furnace`, and Observatory to decide which monitor warnings are still active. |

Invalid monitor numeric values are rejected when `config/foundry.yml` is loaded. `active_warning_window` must be a finite number greater than or equal to `0`.

Iteration records in `logs/iterations.jsonl` now include furnace audit fields when the loop reaches a terminal outcome: `source` (`ideator` or `human_redirect`), `stoker_directive_applied`, `stoker_directive_deferred`, `stoker_directive_deferred_to`, `stoker_directive_rules`, `stoker_directive_urgency`, `streak_state`, `speculative_ideas_carried`, `project_completed_iterations`, `project_estimated_iterations`, and `project_milestone_reached`. `foundry start` also writes a skipped terminal entry when the iteration runner or a parallel worker throws, so provider or runtime failures remain visible to recovery and telemetry instead of disappearing between checkpoints. If no checkpoint exists, `foundry status` and checkpoint-free startup rebuild shipped/killed/skipped totals, shipped domain counts, recent outcomes, token totals, and the rolling Critic artifact rejection window from this log. Use `foundry timeline --domain code-tool --iteration 41 --outcome killed --source human_redirect --limit 10` to inspect filtered recent iterations with related Critic, Tester, monitor, and token signals in one view. Use `foundry iterations history --domain code-tool --outcome shipped --source human_redirect --limit 20` to inspect recent terminal outcomes directly; add `--json` for automation.

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

Start lifecycle records in `logs/events.jsonl` use `phase: "lifecycle"` with `event: "foundry_start"`, `event: "foundry_iteration_start"`, `event: "foundry_iteration_complete"`, `event: "foundry_sequential_failure_warning"`, `event: "foundry_sequential_failure_breaker"`, `event: "foundry_sequential_failure_recovered"`, `event: "foundry_sequential_maintenance_start"`, `event: "foundry_sequential_maintenance_complete"`, `event: "foundry_git_commit_start"`, `event: "foundry_git_commit_complete"`, `event: "foundry_git_commit_failed"`, `event: "foundry_stoker_directive_load_start"`, `event: "foundry_stoker_directive_load_complete"`, `event: "foundry_stoker_directive_load_failed"`, `event: "foundry_stoker_directive_stale_cleared"`, `event: "foundry_stoker_directive_stale_clear_failed"`, `event: "foundry_stoker_directive_consumed_cleared"`, `event: "foundry_stoker_directive_consumed_clear_failed"`, `event: "foundry_precheck_start"`, `event: "foundry_precheck_complete"`, `event: "foundry_precheck_failed"`, `event: "foundry_request_poll_start"`, `event: "foundry_request_poll_complete"`, `event: "foundry_request_poll_failed"`, `event: "foundry_stoker_directive_deferred"`, `event: "foundry_stoker_directive_defer_failed"`, `event: "foundry_human_redirect_start"`, `event: "foundry_human_redirect_complete"`, `event: "foundry_human_redirect_failed"`, `event: "foundry_speculative_cleanup_start"`, `event: "foundry_speculative_cleanup_complete"`, `event: "foundry_speculative_cleanup_failed"`, `event: "foundry_speculative_carry_forward_start"`, `event: "foundry_speculative_carry_forward_complete"`, `event: "foundry_speculative_carry_forward_failed"`, `event: "foundry_streak_update_start"`, `event: "foundry_streak_update_complete"`, `event: "foundry_streak_update_failed"`, `event: "foundry_complexity_recommendation_applied"`, `event: "foundry_complexity_recommendation_ignored"`, `event: "foundry_lineage_rebuild_start"`, `event: "foundry_lineage_rebuild_complete"`, `event: "foundry_lineage_rebuild_failed"`, `event: "foundry_project_creation_start"`, `event: "foundry_project_creation_complete"`, `event: "foundry_project_creation_failed"`, `event: "foundry_ideation_start"`, `event: "foundry_ideation_complete"`, `event: "foundry_ideation_failed"`, `event: "foundry_idea_gate_start"`, `event: "foundry_idea_gate_complete"`, `event: "foundry_idea_gate_failed"`, `event: "foundry_deadlock_override_start"`, `event: "foundry_deadlock_override_complete"`, `event: "foundry_creator_phase_start"`, `event: "foundry_creator_phase_complete"`, `event: "foundry_creator_phase_failed"`, `event: "foundry_workspace_stage_start"`, `event: "foundry_workspace_stage_complete"`, `event: "foundry_workspace_stage_failed"`, `event: "foundry_tester_phase_start"`, `event: "foundry_tester_phase_complete"`, `event: "foundry_tester_phase_failed"`, `event: "foundry_artifact_gate_start"`, `event: "foundry_artifact_gate_complete"`, `event: "foundry_artifact_gate_failed"`, `event: "foundry_bookkeeping_start"`, `event: "foundry_bookkeeping_complete"`, `event: "foundry_bookkeeping_failed"`, `event: "foundry_stimuli_refresh_start"`, `event: "foundry_stimuli_refresh_complete"`, `event: "foundry_stimuli_refresh_failed"`, `event: "foundry_next_iteration_ready"`, `event: "foundry_cooldown_start"`, `event: "foundry_cooldown_complete"`, `event: "foundry_cooldown_skipped"`, `event: "foundry_cooldown_interrupted"`, `event: "foundry_parallel_request_guard"`, `event: "foundry_parallel_request_guard_released"`, `event: "foundry_curator_cycle_start"`, `event: "foundry_curator_cycle_complete"`, `event: "foundry_curator_cycle_failed"`, `event: "foundry_monitor_start"`, `event: "foundry_monitor_complete"`, `event: "foundry_monitor_failed"`, `event: "foundry_stoker_check_start"`, `event: "foundry_stoker_check_complete"`, `event: "foundry_stoker_check_failed"`, `event: "foundry_refinery_start"`, `event: "foundry_refinery_complete"`, `event: "foundry_refinery_failed"`, `event: "foundry_checkpoint_saved"`, `event: "foundry_checkpoint_failed"`, `event: "foundry_stop"`, or `event: "foundry_start_failed"`. The payload records mode, concurrency, providers, provider fallback count and affected agents, provider-validation skip state/reason, pending request file/preview at startup, start iteration, effective git automation (`git_auto_commit`, `git_auto_push`), configured model override count/windows plus `model_overrides_applied`, state provenance (`state_source: "checkpoint"` with `checkpoint_iteration`, or `state_source: "iteration_log"` with `last_logged_iteration`), per-iteration dispatch attempts with iteration number and worker slot, completed iteration attempts with outcome, duration, token usage, title/domain/source/reason when available, shipped project progress fields when applicable, repeated skipped-iteration warning, halt, and recovery state, sequential post-iteration maintenance start/complete state with current-run ledger, monitor warning counts, monitor failure state, emergency-Curator state, Stoker due/cadence/directive state, and durations, git automation attempts with iteration outcome, artifact context, auto-push state, commit message, push result, duration, and failure detail, iteration-start Stoker directive loaded/empty state, directive target iteration, urgency, fired rules, refinery queue, duration, non-fatal read failure detail, stale directive cleanup result, stale/current iteration, cleanup failure detail, consumed directive cleanup result, current directive iteration, duration, and cleanup failure detail, Phase 0 pre-check configured STOP file and disk floor, STOP detection result, disk-space result, mood snapshot, continue or halt result, duration, halt reason, and failure detail, request-file poll pending or empty state, request preview/length, duration, and read failure detail, human-redirect Stoker deferral source/target iterations, urgency, fired rules, refinery queue, request preview/length, and deferral failure detail, consumed human redirect request preview/length, approval or rejection result, selected proposal metadata, redirect token usage, duration, rejection detail, and translation/processing failure detail, consumed speculative fuel cleanup result, duration, and cleanup failure detail, speculative carry-forward selected title, proposal/evaluation counts, carried count, duration, and failure detail, terminal streak-update outcome metadata, current streak summary, cooldown state, duration, and failure detail, Gate 1 complexity recommendation source, title, original complexity, recommended complexity, applied/ignored result, and ignore reason, post-ship lineage artifact metadata, edge/constellation counts, duration, and failure detail, project starter metadata, effective build complexity, project ID, duration, and failure detail, Ideator retry attempt, burst count, retry context, Stoker directive metadata, proposal counts, partial burst failures, token usage, and duration, Critic Gate 1 source, attempt, proposal titles/counts, approval/rejection/revise counts, selected title, token usage, duration, and failure detail, ideation deadlock retry count, rejection-context preview, forced proposal metadata or failure detail, override token usage, and duration, Creator pass stage, proposal metadata, revision/fix-cycle markers, output file count, phase tokens, token usage, duration, and failure detail, workspace staging file paths, proposal/artifact metadata, revision/fix-cycle markers, duration, and failure detail, Tester pass mode, artifact metadata, revision/fix-cycle markers, verdict summary, issue/test counts, token usage, duration, and failure detail, Artifact Gate metadata, Tester verdict, revision/fix-cycle counts, decision, mean rating, ship-threshold status, token usage, duration, and failure detail, shipped/killed bookkeeping artifact ID, proposal/artifact metadata, gate decision, Tester verdict, rating or kill reason, token usage, duration, and failure detail, pre-iteration Stimuli refresh source counts, refreshed/failing/disabled counts, duration, and non-fatal failure detail, sequential next-iteration readiness, sequential cooldown start/complete/skipped/interruption timing, parallel request-guard activation with configured concurrency, active limit, request file, and compact request preview, guard release with restored concurrency and elapsed milliseconds, scheduled, project-milestone, quality-escalation, failure-escalation, and success-amplification Curator cycle start/complete/failure with trigger, previous/current Curator iteration pointers, project progress fields when applicable, and failure detail when applicable, anti-entropy monitor start/complete/failure with warning counts, critical warning counts, emergency-Curator state, duration, and non-fatal failure detail, Stoker check cadence, due state, skipped checks, directive metadata, and non-fatal failure detail, Background Refinery job source metadata, queue position, result, artifact context, token usage, duration, and skipped-attempt detail, successful and failed runtime checkpoints with checkpoint iteration, last Curator run, save reason, and failure detail, stop reason, elapsed `duration_ms`, last completed iteration, next iteration, derived `iterations_completed`, STOP-file path/preview for configured stop-file halts, iteration-returned halt detail, startup preflight or provider-validation failure details, and fatal runtime error details where applicable so unattended runs can be audited without scraping console output. Fatal post-start errors also append a best-effort note to `identity/journal.md`.

Configured sequential cooldown starts print a live watch line with the sleep duration, next iteration, configured STOP file, and configured request file. The matching `foundry_cooldown_start` event includes `next_iteration`, `cooldown_stop_file`, `cooldown_request_file`, `cooldown_interrupts_enabled`, and `cooldown_signal_watch`. Normal `foundry_cooldown_complete` events repeat the watch files, next iteration, completion flag, and current-run ledger with elapsed cooling time.

Zero-cooldown sequential handoffs use the same cooldown audit family through `foundry_cooldown_skipped`, preserving intentional immediate advances in `logs/events.jsonl` instead of leaving a silent gap between readiness and the next iteration.

Git automation failures during `foundry start` also append a best-effort note to `identity/journal.md`, including iteration, artifact context, and git error detail.

Project progress lifecycle records use `foundry_project_progress_start`, `foundry_project_progress_complete`, and `foundry_project_progress_failed` for shipped project artifact links and status updates, including project ID, artifact metadata, previous/current completed-iteration counts, duration, and failure detail.

Project bookkeeping failures after a shipped project artifact also write a best-effort journal note, so the artifact can ship while the project-link/status problem remains visible to operators.

Project milestone lifecycle records use `foundry_project_milestone_reached` when a shipped project continuation reaches its planned iteration count, including project ID, artifact metadata, previous/current/planned iteration counts, and the curator-decision result.

Project milestones also trigger an immediate Curator full cycle in sequential and parallel `foundry start`; parallel mode drains active workers before the Curator runs. Curator lifecycle records include `trigger: "project_milestone"` and the project progress fields for these cycles.

Project starter capacity lifecycle records use `foundry_project_creation_capped` when `projects.max_active` is full and `foundry start` builds an approved project starter as standalone, including active/max project counts, project name, and effective build complexity.

Invalid project starter lifecycle records use `foundry_project_creation_invalid` when `foundry start` rejects malformed starter metadata and builds standalone instead, including reason and build complexity.

Stale project continuation lifecycle records use `foundry_project_continuation_stale_cleared` when `foundry start` strips an inactive project ID and builds the proposal as standalone, including stale project ID, active project count, title, and domain.

Dream capture lifecycle records use `foundry_dream_capture_start`, `foundry_dream_capture_complete`, and `foundry_dream_capture_failed` for normal and Background Refinery killed-artifact dream journal writes, including artifact metadata, kill-reason preview, resurrection hint preview, duration, and failure detail.

Checkpoints also carry `streak_state` and restore it on resume, giving the streak loop a second recovery path beyond `identity/streaks.yml`.

### `stimuli`

External input pipeline settings.

When `foundry start` runs with `loop.concurrency` above `1`, worker iterations still pass through the same stale-source refresh step as sequential mode. Refreshes are serialized around checkpointed source state so parallel workers do not race while updating feed health.

| Option | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Master switch for the stimuli system. Disable if running offline or without MCP access. |
| `stimuli_ttl` | number | `30` | Max iterations before force-rotating live stimuli. Prevents stale external context. |
| `skills_per_context` | number | `8` | How many random skill files to include in each Ideator call. More = broader reference and a larger prompt. |
| `mcp_timeout_seconds` | number | `30` | Timeout for MCP/CLI calls during stimuli refresh. |

### `context`

Context window management. These control how much history each agent sees.

| Option | Type | Default | Description |
|---|---|---|---|
| `journal_compressed_max_tokens` | number | `24000` | Token budget for the compressed journal in shared context. Furnace mode keeps much more history in every call. |
| `portfolio_index_max_entries` | number | `120` | Max portfolio entries included in shared context (selected by recency + rating + project relevance). Increase for larger portfolios. |
| `critic_review_history` | number | `20` | How many Critic Gate 2 reviews the Creator sees. This is how the Creator learns quality standards — higher values mean more institutional learning and larger prompts. |
| `critic_gate1_history` | number | `12` | How many Gate 1 decisions the Ideator and Critic see. Helps the Ideator learn what gets approved. |

The Curator also receives the rolling Critic artifact rejection rate from checkpoint state. When the rate exceeds 40%, the prompt asks it to reflect on whether standards have drifted or the Creator is underperforming. `foundry status`, `foundry status --json`, `/api/furnace`, and the Observatory Furnace State panel expose the same pressure summary for operators and automation.

### `intervention`

| Option | Type | Default | Description |
|---|---|---|---|
| `requests_file` | string | `"requests.md"` | Path to the human redirect file. Checked every iteration. |
| `stop_file` | string | `"STOP"` | Path to the emergency halt file. Create to stop, delete to resume. |

`foundry stop` writes the configured stop file, and `foundry resume` removes it; both commands also support `--json` for automation. Add `--reason <text>` to record why the stop was requested. `foundry status` and `foundry doctor` read these configured paths when reporting intervention state. Status text and JSON show whether the stop file is pending, a compact stop-file preview, whether the request file contains a pending redirect, and a compact single-line request preview. A pending stop file raises doctor/status health gates to warning so `foundry preflight` and `--fail-on warning` automation catch a halt request before an unattended run starts. When `foundry start` begins, its lifecycle start audit records `request_file`, `request_pending_at_startup`, and `request_preview_at_startup` when a non-empty human redirect is already queued, and the console prints the same compact request cue. When `foundry start` halts on the configured stop file, it prints the configured stop-file path and compact preview, writes `stop_file` plus `stop_file_preview` when content exists into lifecycle audits and the journal halt note, and exits without calling agents for startup STOP halts after skipping provider health probes and model override activation, recording `provider_validation_skipped: true`, checkpointing restored state, and including `stop_file_present_at_startup: true`. Use `foundry request show|set|append|clear|history|stats|sources|restore|diff` or the `foundry requests` alias to inspect, write, extend, clear, audit, summarize, rank source files, restore, or compare the configured request file from automation; `request set --file <path>` and `request append --file <path>` load multiline redirect blocks from disk, every mutation is logged to `logs/requests.jsonl` for `foundry request history --restorable --source <path> --contains <text> --action set|append|clear --since <timestamp> --until <timestamp> --show-request`, `foundry request stats --source <path> --contains <text> --action set|append|clear --since <timestamp> --until <timestamp>`, or `foundry request sources --action set|append|clear --source <path> --contains <text> --since <timestamp> --until <timestamp> --limit <n>`, `foundry request diff --from <timestamp>` compares the current pending redirect with an exact restorable request-text audit entry, `foundry request diff --latest --source <path> --contains <text>` compares against the latest matching prior entry without copying its timestamp first, and `foundry request restore --from <timestamp> [--append] [--dry-run]` or `foundry request restore --latest --source <path> --contains <text> [--append] [--dry-run]` reuses that entry without regenerating it. During the loop, a non-empty request is translated by the Curator, clears the request file, and still requires Critic Gate 1 approval before creation.

### `logging`

| Option | Type | Default | Description |
|---|---|---|---|
| `log_all_prompts` | boolean | `true` | Log full prompts sent to models. Useful for debugging, costs disk space. |
| `log_token_usage` | boolean | `true` | Log per-call token counts. Essential for cost tracking. |
| `log_decisions` | boolean | `true` | Log all Critic gate decisions. Essential for understanding system behavior. |
| `log_test_reports` | boolean | `true` | Log all Tester verdicts. Useful for tracking code quality trends. |

The shared JSONL logger rotates active logs before they exceed the built-in rotation threshold. `foundry status`, `foundry status --json`, `/api/furnace`, and the Observatory panel expose aggregate log health plus recommended operator actions. `foundry forecast` condenses that same status payload into a next-iteration briefing with blockers, operator actions, and ordered furnace signals, and `foundry forecast --json` emits the same report for automation. `foundry spark` uses local status, domain config, recent outcomes, and manifesto values to print a redirect-ready creative spark; `--domain` pins the domain, `--count` prints a ranked spark deck, `--apply` writes one spark to the configured request file, `--append` adds one spark after an existing redirect, and `--json` exposes the card/deck plus write metadata for automation. Applied sparks are audited in `logs/spark.jsonl`, and `foundry spark history --domain poetry --mode append --replayable --since 2026-05-30T00:00:00.000Z --until 2026-05-31T00:00:00.000Z --show-request --limit 20` reads the restorable subset of that trail back for operator review with request text inline; add `--json` for automation. `foundry spark stats --domain poetry --mode append --replayable --since 2026-05-30T00:00:00.000Z --until 2026-05-31T00:00:00.000Z` summarizes that focused audit trail by original/replayed counts, replayable entries, mode, domain, and latest replay; add `--json` for automation. `foundry spark replay --domain poetry --mode append [--from timestamp] [--append] [--dry-run]` restores the latest matching replayable spark, or the exact timestamp match when `--from` is present, into the configured request file and logs the replay event; `--dry-run` previews the exact request content without writing. `foundry request stats --source ops/extra.md --contains "moon gear" --action append --since 2026-05-30T00:00:00.000Z --until 2026-05-31T00:00:00.000Z` summarizes `logs/requests.jsonl` by set/append/clear counts, source-backed entries, request-text entries, and latest mutation pointers for an exact source notes file and request-text substring; add `--json` for automation. `foundry request sources --action append --contains "moon gear" --since 2026-05-30T00:00:00.000Z --limit 10 --json` summarizes the matching source-backed subset of `logs/requests.jsonl` by notes file, action counts, request-text presence, and latest activity. `foundry request diff --from 2026-05-30T00:00:00.000Z` prints a read-only line diff between the current configured redirect file and an exact restorable request-text audit entry; `foundry request diff --latest --source ops/extra.md --contains "moon gear" --json` prints the same comparison for the latest matching restorable audit entry. `foundry request restore --latest --source ops/extra.md --contains "moon gear" [--append] [--dry-run]` restores the latest matching restorable audit entry back into the configured redirect file, while `foundry request restore --from 2026-05-30T00:00:00.000Z [--append] [--dry-run]` targets an exact timestamp; restore metadata is logged as a normal set or append mutation unless `--dry-run` is used. Monitor warning summaries keep all-time `counts` for auditability and separate `activeCounts` over the `monitor.active_warning_window` recent iteration window for health gates, so resolved historical warnings remain visible without forcing a permanent warning state. Use `foundry tokens history --agent creator --model glm-5.1 --iteration 41 --limit 20` to inspect recent per-call token spend from `logs/token-usage.jsonl`, `foundry decisions history --gate gate1 --decision reject --source human_redirect --iteration 41 --limit 20` to inspect recent Critic gate decisions from `logs/decisions.jsonl`, and `foundry tester history --outcome fail_fixable --artifact 0020 --iteration 41 --limit 20` to inspect Tester verdicts from `logs/test-reports.jsonl`; add `--json` for automation. `foundry doctor` condenses the shared furnace health level, reasons, actions, active monitor counts, historical monitor totals, and log summary into a scriptable preflight check; it defaults to failing only on `critical`, and `--fail-on warning` makes long-run watchdogs stricter. Add `--preflight` to also run `foundry config doctor` inside the top-level doctor report: invalid config or prompt files raise doctor health to `critical`, ambiguous prompt selectors raise it to `warning`, text output lists the failing preflight files and selector collisions, and JSON output includes the nested config-doctor report. `foundry preflight` is the strict shortcut for that combined report, with preflight enabled and `--fail-on warning` as its default. `foundry logs doctor` provides a narrower local JSONL scan with active/archive counts, rotation pressure, malformed active-log line details, and the same log action list. Add `--json` to emit machine-readable payloads for CI or watchdog scripts, and use `foundry logs doctor --fail-on healthy|watch|rotate-soon|malformed` to choose the log health state that should produce a nonzero exit code.

### `recovery`

| Option | Type | Default | Description |
|---|---|---|---|
| `checkpoint_every` | number | `1` | Save checkpoint every N iterations. 1 = maximum crash safety. Increase only if disk I/O is a bottleneck. |
| `resume_on_crash` | boolean | `true` | Load checkpoint on startup and resume. Disable for a fresh start. |

Successful Curator cycles save a checkpoint immediately, independent of `checkpoint_every`, so `last_curator_run` and any Curator-updated Stimuli source state survive a restart even when periodic checkpointing is sparse.

### `loop`

| Option | Type | Default | Description |
|---|---|---|---|
| `cooldown_seconds` | number | `0` | Pause between iterations in sequential mode. Furnace mode defaults to no pause; increase if you're hitting rate limits. |
| `concurrency` | number | `8` | Number of parallel iterations in pool mode. This is the main token-throughput lever. |
| `disk_space_min_gb` | number | `1` | Minimum free disk space (GB) before halting. Safety net against filling the disk with artifacts. |

`foundry start` checks `disk_space_min_gb` at startup, before each sequential iteration, and while scheduling parallel work. Startup failures halt before loading checkpoint state; runtime failures checkpoint the last completed iteration, write a journal halt entry, and stop before starting more work. In parallel mode, already-running workers drain before the final checkpoint.

In sequential mode, SIGINT during an iteration checkpoints and exits as soon as that iteration returns, before `cooldown_seconds` can delay operator shutdown. Signal-triggered lifecycle records, journal stop records, and live halt messages preserve the actual signal name (`SIGINT` or `SIGTERM`). The loop also re-checks the configured STOP file before entering cooldown, skips cooldown immediately when a human redirect is already queued, and polls STOP/signal/request state during cooldown, so halt requests created while the loop is sleeping checkpoint the completed iteration and stop without waiting through the full cooldown, while newly queued human redirects checkpoint the completed iteration, write the request handoff audit, and begin the next iteration early.

Sequential `foundry start` also trips a failure breaker after 3 consecutive skipped iteration failures. It writes `foundry_sequential_failure_breaker`, checkpoints the last skipped iteration, appends a journal halt note, and records a stop summary so a broken provider or runner does not spin forever.

Before that breaker threshold, sequential skipped iterations write `foundry_sequential_failure_warning` with the current failure streak, failures remaining before halt, retry-backoff milliseconds, and failure detail. The same warning prints in the live `foundry start` console so unattended logs show why the next loop is cooling down.

When a later non-skipped iteration clears a skipped-iteration streak, sequential `foundry start` writes `foundry_sequential_failure_recovered` with the prior streak length and recovery outcome so transient recovery is visible in lifecycle audits.

In parallel mode, STOP or signal shutdown drains already-running workers, saves the final checkpoint, and writes a journal halt entry with the reason, specific signal name when applicable, and last completed parallel iteration. A worker result of `halted` now follows the same stop contract: no new iterations are reserved, current workers drain, the final checkpoint uses the drained last-completed iteration, and the stop audit includes the halted worker iteration plus its detail. When the configured request file is non-empty while the pool is scheduling, `foundry start` temporarily caps new scheduling at one worker, writes `foundry_parallel_request_guard`, and writes `foundry_parallel_request_guard_released` with restored concurrency and elapsed milliseconds once the redirect file is empty.

## models.yml

Model assignments per agent. Each agent gets a model ID, temperature, and max output tokens.

`models.yml` must define `ideator`, `creator`, `tester`, `critic`, and `curator`. Each agent requires a non-empty `model`, numeric `temperature`, and integer `max_tokens >= 1`; optional `provider` and `reasoning_effort` values must be non-empty strings when present.

```yaml
agents:
  ideator:
    model: "glm-5.1"
    temperature: 0.9
    max_tokens: 180000
  creator:
    model: "glm-5.1"
    temperature: 0.7
    max_tokens: 180000
  tester:
    model: "glm-5.1"
    temperature: 0.2
    max_tokens: 180000
  critic:
    model: "glm-5.1"
    temperature: 0.3
    max_tokens: 180000
  curator:
    model: "glm-5.1"
    temperature: 0.5
    max_tokens: 180000
```

### Agent-specific guidance

| Agent | Temperature | Max Tokens | Rationale |
|---|---|---|---|
| Ideator | 0.9 (high) | 180000 | High creativity for divergent thinking. Furnace mode asks for richer proposal sets and leaves room for large YAML retries. |
| Creator | 0.7 (moderate) | 180000 | Balanced creativity with coherence. Needs the most tokens for long-form artifact creation. Use the strongest available model here — artifact quality is the system's output. |
| Tester | 0.2 (low) | 180000 | Deterministic verification. Large budgets let it write substantial plans, tests, and reports for large code artifacts. |
| Critic | 0.3 (low) | 180000 | Consistent, principled evaluation with room for large artifacts and full context. |
| Curator | 0.5 (moderate) | 180000 | Reflective analysis needs room for retrospectives, journal compression, project management, and stimuli work. |

### A/B Testing Overrides

You can test different models for specific agents over a range of iterations:

```yaml
overrides:
  - agent: ideator
    model: "glm-4.5"
    start_iteration: 51
    end_iteration: 70
    label: "ideator-glm45-test"
```

The harness logs when an override is active. Compare quality metrics (Critic ratings, ship rates) between the baseline and test windows. `foundry config doctor` validates override entries before the run starts: `agent` must be one of `ideator`, `creator`, `tester`, `critic`, or `curator`; `model` and `label` must be non-empty strings; `start_iteration` and `end_iteration` must be integer values `>= 0`; and `start_iteration` must be less than or equal to `end_iteration`.

## domains.yml

Defines the creative domains the system can work in.

`domains.yml` must contain a `domains` array. Each row requires a unique lowercase safe-slug `name`, a non-empty `description`, and a positive numeric `weight`. Domain names may contain lowercase letters, numbers, underscores, and hyphens, and must start with a letter or number.

The dispatcher also retries Ideator and Curator redirect YAML when a proposal domain is not one of the configured names, so model outputs cannot introduce ad hoc domain buckets.

```yaml
domains:
  - name: fiction
    description: "Short stories, flash fiction, novel chapters, vignettes"
    weight: 1.0
  - name: code-tool
    description: "CLI tools, utilities, scripts that solve a real problem"
    weight: 1.0
  - name: music
    description: "Compositions, sound design (Strudel.js, Tone.js, etc.)"
    weight: 0.5
```

### Fields

| Field | Type | Description |
|---|---|---|
| `name` | string | Unique safe-slug domain identifier. Used in proposals, portfolio paths, and stats. Domains starting with `code-` are treated as code artifacts (sandbox-tested). |
| `description` | string | Human-readable description. Included in agent context to guide the Ideator. |
| `weight` | number | Relative positive weight. Influences domain selection — lower weight means the domain appears less often. |

### Adding a new domain

1. Add an entry to `domains.yml`
2. The portfolio directory is auto-created when the first artifact ships (mapped via `domainDir()` in `src/files/portfolio.ts` — `code-*` domains map to `portfolio/code/`, others map to `portfolio/{name}/`)
3. If it's a code domain, prefix the name with `code-` so the Tester runs sandbox execution

### Current domains

| Domain | Weight | Code? |
|---|---|---|
| fiction | 1.0 | No |
| poetry | 0.8 | No |
| essay | 0.8 | No |
| code-tool | 1.0 | Yes |
| code-game | 0.8 | Yes |
| code-art | 0.7 | Yes |
| music | 0.5 | No |
| experiment | 0.6 | No |
| worldbuilding | 0.5 | No |

## stimuli/stimuli.yml

Configures external input sources. The stimuli system fetches live data via CLI tools (`firecrawl`, `ctx7`) and manages persistent reference material.

### `mcp`

MCP source configurations. Each key is a safe source slug that maps to a file in `stimuli/live/`.

```yaml
mcp:
  news:
    server: "tavily"
    query_template: "interesting unusual news today"
    max_items: 5
    refresh_interval: 15
```

| Field | Type | Description |
|---|---|---|
| `server` | `"tavily"` \| `"context7"` | Which backend to use. `tavily` uses `firecrawl search`; `context7` uses `npx ctx7@latest`. |
| `query_template` | string | Search query for single-query sources. Used with `firecrawl search`. |
| `queries` | string[] | Multiple queries (for sources like `cultural` that pull from several angles). Each query runs separately. |
| `strategy` | string | Source-specific strategy (e.g., `"random"` for context7's random article pulls). |
| `max_items` | number | Integer max results per query. Must be at least `1`. |
| `refresh_interval` | number | Integer iterations between refreshes. Must be at least `1`; higher = less API usage but staler content. |

### Top-level stimuli settings

| Option | Type | Default | Description |
|---|---|---|---|
| `stimuli_ttl` | number | `30` | Max iterations before force-rotating live stimuli, even if the source's own interval hasn't elapsed. |
| `skills_per_context` | number | `8` | How many random skill files from `stimuli/skills/` to include in each Ideator call. |

### Current sources

| Source | Server | Refresh | Description |
|---|---|---|---|
| `news` | tavily | Every 15 iterations | Current events and unusual news |
| `random_knowledge` | context7 | Every 10 iterations | Random Wikipedia/reference content |
| `cultural` | tavily | Every 20 iterations | Trending GitHub repos, discussed books |

### Failure handling

If a source fails 3 consecutive refreshes, it's auto-disabled until the next restart. This prevents a broken MCP server from blocking the iteration loop. The checkpoint stores each source's last refresh iteration, consecutive failure count, and disabled flag so resume does not immediately retry a broken source; older numeric checkpoint entries are still accepted as last-refresh iterations during upgrade. `foundry status`, `/api/furnace`, and the Observatory Furnace State panel expose the same source-health summary so failing, disabled, and due feeds are visible to operators. Failing or disabled feeds raise shared furnace health to `warning`, making `foundry doctor` and `foundry status --fail-on warning` catch stale external-input pipelines before long unattended runs.

Curator full-cycle prompts use the same source-health summary for `{stimuli_staleness}`. Each configured source is listed with server, last refresh iteration, age, refresh interval, failure count, due status, and disabled status so Curator refresh decisions stay aligned with runtime checkpoint state.

When the Curator chooses a `refresh` stimuli action, the result updates that same runtime checkpoint state: success records the current iteration and clears failures, while refresh errors increment the source failure count and can disable the source after the same 3-failure threshold.

Use `foundry stimuli status` for a focused source-health report without the rest of the furnace status payload. It lists failing, disabled, and due feeds, includes reset guidance for sources that need operator repair, supports `--json`, and can fail automation with `--fail-on warning`.

Use `foundry stimuli refresh <source>` to retry one configured source immediately. It validates the source against `stimuli/stimuli.yml`, writes the refreshed live stimulus file, clears that source's checkpointed failures on success, and records another checkpointed failure if the backend still fails. Add `--json` for watchdog or repair scripts.

Use `foundry stimuli reset <source>` after fixing a broken backend or source configuration when you want to clear failure pressure before the next scheduled retry. It validates the source against `stimuli/stimuli.yml`, clears only that source's checkpointed last refresh iteration, failure count, and disabled flag, and preserves all other checkpoint data. Add `--json` for watchdog or repair scripts.

Both manual repair commands append audit events to `logs/stimuli.jsonl`, including action, source, outcome, checkpoint update status, and previous/current source state when available. Use `foundry stimuli history [source] --action refresh --status failed --limit 20` to inspect recent repair events, optionally filtered to one source, action, or status; add `--json` for automation.
