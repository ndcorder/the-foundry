# Architecture

The Foundry is an autonomous multi-agent creative system. Five AI agents collaborate adversarially in an infinite loop, producing a growing portfolio of artifacts — code, prose, poetry, games, tools, music, experiments — across any domain the system finds interesting.

The core tension: **total creative freedom** vs. **quality a human would value**. The solution is adversarial collaboration — agents with different cognitive roles that must convince each other before anything ships.

## System Overview

The system is built as a TypeScript harness (`src/`) that orchestrates five agents through a structured iteration cycle. Each agent is a prompted LLM call — the harness assembles context, dispatches calls, parses YAML responses, and manages all file I/O. Agents never communicate directly; everything flows through the harness.

**The five agents:**

| Agent | Cognitive Role | Key Trait |
|---|---|---|
| Ideator | Divergent thinking | Proposes what to build next — novelty, surprise, cross-pollination |
| Creator | Execution | Builds the artifact — code, prose, music, whatever the idea requires |
| Tester | Verification | Validates correctness — runs code in a sandbox, checks prose completeness |
| Critic | Quality control | Gates both ideas and artifacts — rates, reviews, ships or kills |
| Curator | Long-term memory | Periodic maintenance — manifesto, journal compression, domain balance |

## Iteration Cycle

Each iteration follows this flow:

```
┌──────────────────────────────────────────────────────────────┐
│                       ITERATION N                            │
│                                                              │
│  Phase 0 ─ Pre-check                                        │
│  │  STOP file? → halt                                       │
│  │  requests.md? → Curator translates → skip to Phase 2     │
│  │  Stimuli stale? → refresh via MCP                        │
│  │                                                           │
│  Phase 1 ─ Ideation (Ideator)                               │
│  │  Propose 3 ranked ideas with domain tags + pitches        │
│  │                                                           │
│  Phase 2 ─ Idea Gate (Critic)                               │
│  │  Approve / reject / revise each proposal                  │
│  │  If all rejected → retry (max 3) → Curator deadlock      │
│  │                                                           │
│  Phase 3 ─ Creation (Creator)                               │
│  │  Plan → draft → revise → polish                           │
│  │  Writes files to workspace/current/                       │
│  │                                                           │
│  Phase 4 ─ Testing (Tester)                                 │
│  │  Code: sandbox execution with written tests               │
│  │  Non-code: lightweight completeness/format check          │
│  │  Fix cycles: fail_fixable → Creator fixes → re-test       │
│  │                                                           │
│  Phase 5 ─ Artifact Gate (Critic)                           │
│  │  Rate on 7 dimensions (originality, craft, surprise...)   │
│  │  Ship (mean ≥ 3.0, no dim < 2) / Revise / Kill           │
│  │                                                           │
│  ──► Portfolio (shipped) or Killed (with post-mortem)        │
│                                                              │
│  Every Nth iteration: Curator full cycle                     │
│  │  Retrospective, journal compression, manifesto review,    │
│  │  domain rebalancing, project management, stimuli refresh  │
└──────────────────────────────────────────────────────────────┘
```

The iteration runner lives in `src/iteration/runner.ts`. The main loop in `src/index.ts` wraps it with checkpoint management, stimuli refresh, Curator scheduling, and anti-entropy monitoring.

### Deadlock Recovery

If the Ideator and Critic can't agree after `max_idea_retries` (default: 3), the Curator intervenes as a deadlock breaker — it picks the best rejected idea, sharpens it, and forces it through with a `[FORCED]` tag. If even that fails, the iteration is skipped.

### Revision Loops

- **Test fix cycles:** When the Tester finds fixable bugs, the Creator gets a bug report and produces a fix. Max `max_test_fix_cycles` (default: 2) before escalation.
- **Revision rounds:** When the Critic sends an artifact back at Gate 2, the Creator revises with the Critic's notes. Max `max_revision_rounds` (default: 2) before final ship/kill decision.

## Agent Roles in Detail

### Ideator (`prompts/ideator.md`)

**Input context:** Shared context (manifesto, compressed journal, portfolio index, domain stats) + Critic's last 5 Gate 1 decisions + Curator's domain recommendations + active project statuses + external stimuli (live + random skill files).

**Output:** 3 ranked proposals as YAML — each with title, domain, pitch, complexity (S/M/L), why-it-matters, and optional project_id/stimulus_ref.

**Anti-slop rules baked into the prompt:**
- Must reference at least one specific detail or constraint
- Cannot be structurally identical to recent portfolio entries (within `novelty_window`)
- At least one idea must be in an underrepresented domain (within `domain_cooldown`)
- At least one idea must be ambitious enough that success isn't guaranteed

### Creator (`prompts/creator.md`)

**Input context:** Shared context + Critic's recent reviews of *any* artifact (not just its own — institutional learning) + recent Tester reports + approved proposal + Critic's sharpening notes + project context if applicable + manifesto quality standards.

**Output:** Completed artifact as YAML with title, files (path + content), and notes on creative/technical decisions.

**Process:** Plan → Build → Revise → Polish. The Creator works in multiple passes and self-reviews against the manifesto's aesthetic values.

### Tester (`prompts/tester.md`)

**Input context:** Original proposal + Critic's sharpening notes + artifact content. Deliberately minimal — the Tester doesn't need identity context.

**Output:** Structured verdict (pass / fail_fixable / fail_catastrophic) with test results, issues, and optional post-mortem.

**For code artifacts**, the Tester produces a test plan (language, setup commands, test files, run command) that the harness executes in a sandboxed VM. The Tester then reviews execution results and produces a final verdict.

**For non-code artifacts**, a lightweight verification checks completeness, format compliance, and internal consistency.

### Critic (`prompts/critic.md`)

Operates at two gates with separate prompt sections:

**Gate 1 (Idea Approval):** Evaluates novelty, specificity, ambition, portfolio fit, feasibility. Must approve at least one proposal unless all are genuinely terrible. Rejections require specific, actionable reasons.

**Gate 2 (Artifact Review):** Rates on 7 dimensions (originality, specificity, craft, surprise, coherence, portfolio_fit, technical_quality). Ship threshold: mean ≥ 3.0, no dimension below 2. Writes a 3–5 sentence review that enters the portfolio.

**Self-monitoring:** The Critic tracks its rejection rate; if it rejects >40% over a rolling window, it must reflect on standards drift.

### Curator (`prompts/curator.md`)

**Input context:** Everything — full journal, all recent decisions, all test reports, stimuli state, project statuses, human requests.

**Runs periodically** (every `curator_interval` iterations, default: 15) and performs:
1. **Retrospective** — what was built, quality trends, emerging patterns
2. **Journal compression** — summarizes older entries to fit context windows
3. **Manifesto review** — proposes identity evolution with diffs and evidence
4. **Domain rebalancing** — flags lopsided output and nudges the Ideator
5. **Project management** — reviews active projects, recommends continue/complete/abandon
6. **Stimuli management** — refreshes stale sources, commissions new skill files
7. **Human request processing** — translates `requests.md` into proposals

The Curator cycle is implemented in `src/curator/index.ts`. The `applyCuratorCycle()` function applies all changes: journal updates, manifesto edits, project status changes, stimuli refreshes, and domain recommendations.

### Context Sharing Matrix

All agents share a **common context** built by `src/context/shared.ts`:
- Manifesto (`identity/manifesto.md`)
- Compressed journal (`identity/journal-compressed.md`, token-budgeted)
- Portfolio index (recent + top-rated entries, capped at `portfolio_index_max_entries`)
- Domain statistics
- Active project statuses

Agent-specific context is layered on top by `src/context/agent-context.ts`:

| Agent | Additional Context |
|---|---|
| Ideator | Critic's last N Gate 1 decisions, Curator recommendations, stimuli (live + skills) |
| Creator | Critic's recent Gate 2 reviews (diverse selection), recent Tester reports, project context |
| Tester | Original proposal, Critic's sharpening notes, artifact content only |
| Critic G1 | Own recent Gate 1 history, proposals to evaluate |
| Critic G2 | Own recent review history, artifact, proposal, Tester report |
| Curator | Full journal, all decisions, all test reports, stimuli state, project statuses, requests |

## File Structure

```
foundry/
├── src/                          # TypeScript harness
│   ├── index.ts                  # Main loop — startup, crash recovery, monitoring
│   ├── iteration/runner.ts       # Single iteration: phases 0–5
│   ├── agents/                   # Agent dispatch + prompt loading
│   │   ├── dispatcher.ts         # All dispatch functions per agent/gate
│   │   └── prompt.ts             # Template loading + variable injection
│   ├── context/                  # Context assembly
│   │   ├── shared.ts             # Shared context (manifesto, journal, portfolio)
│   │   ├── agent-context.ts      # Per-agent context builders
│   │   ├── data.ts               # JSONL readers, formatters, stimuli loaders
│   │   └── config.ts             # YAML config loaders
│   ├── curator/index.ts          # Full Curator cycle dispatch + apply
│   ├── sandbox/sandbox.ts        # QEMU-based sandboxed VM for code execution
│   ├── stimuli/index.ts          # Stimuli refresh via firecrawl/context7 CLIs
│   ├── monitor/                  # Anti-entropy detection
│   │   ├── detectors.ts          # Slop, repetition, manifesto drift, domain collapse
│   │   └── types.ts              # Warning types + default thresholds
│   ├── checkpoint/index.ts       # Atomic checkpoint save/load/delete
│   ├── files/                    # File I/O for portfolio, journal, workspace, projects
│   ├── model/client.ts           # LLM API client with backoff + token logging
│   ├── parser/yaml-parser.ts     # YAML extraction + validation per agent
│   ├── logging/logger.ts         # JSONL log appenders with rotation
│   ├── stats/index.ts            # Runtime statistics tracker
│   └── types/                    # TypeScript interfaces
│
├── prompts/                      # Agent prompt templates (markdown, loaded at runtime)
│   ├── ideator.md
│   ├── creator.md
│   ├── tester.md
│   ├── critic.md
│   └── curator.md
│
├── config/                       # YAML configuration
│   ├── foundry.yml               # Core settings (iteration, projects, context, recovery)
│   ├── models.yml                # Model assignments per agent + A/B test overrides
│   └── domains.yml               # Domain definitions + weights
│
├── identity/                     # Living identity state
│   ├── manifesto.md              # Evolving identity document (Curator-maintained)
│   ├── journal.md                # Full chronological journal (append-only)
│   └── journal-compressed.md     # Curator-maintained summary for context windows
│
├── portfolio/                    # Shipped artifacts
│   ├── index.md                  # Master table: ID, title, domain, rating, date
│   ├── code/                     # Code artifacts (code-tool, code-game, code-art)
│   │   └── {id}-{slug}/          # Each with README.md + source files
│   ├── fiction/
│   ├── poetry/
│   ├── essay/
│   ├── experiment/
│   ├── killed/                   # Artifacts the Critic killed (with post-mortems)
│   └── projects/                 # Multi-iteration project tracking
│       ├── index.md              # Project table: ID, name, status, progress
│       └── {project-id}-{slug}/  # brief.md + status.yml + artifacts/
│
├── stimuli/                      # External input pipeline
│   ├── live/                     # MCP-fetched content (news, knowledge, cultural)
│   ├── skills/                   # Curated reference material (persistent)
│   └── stimuli.yml               # Source configs, refresh intervals
│
├── workspace/                    # Ephemeral build area
│   ├── current/                  # Creator works here (wiped between iterations)
│   └── sandbox/                  # Tester's execution environment
│
├── logs/                         # JSONL logs (auto-rotated at 50MB)
│   ├── iterations.jsonl          # Outcome, ratings, tokens per iteration
│   ├── decisions.jsonl           # All Critic gate decisions
│   ├── test-reports.jsonl        # All Tester results
│   ├── token-usage.jsonl         # Per-call model usage
│   └── monitor.jsonl             # Anti-entropy warnings
│
├── dashboard/                    # Monitoring dashboard
├── site/                         # Portfolio website (SvelteKit)
│
├── requests.md                   # Human redirect file
├── STOP                          # Emergency halt (create to stop)
└── checkpoint.json               # Crash recovery state
```

## Key Subsystems

### Context Assembly (`src/context/`)

Context assembly is the harness's central job. Each agent gets a tailored context window:

- `shared.ts` builds the common base: manifesto, token-budgeted compressed journal, portfolio index (selected by recency + rating + project relevance), and domain stats.
- `agent-context.ts` layers agent-specific sections on top (see the matrix above).
- `data.ts` handles JSONL parsing, stimuli reading, diverse review selection (round-robin across domains to prevent bias), and random skill file picking.

The portfolio index is intelligently pruned by `selectRelevantPortfolioEntries()` — it keeps the most recent entries, the highest-rated entries, and any entries from active projects, up to `portfolio_index_max_entries`.

### The Curator Cycle (`src/curator/`)

The Curator runs every `curator_interval` iterations (or on emergency trigger). `dispatchCuratorFull()` sends the full context to the Curator agent, then `applyCuratorCycle()` applies all returned actions:

1. Appends the retrospective to `identity/journal.md`
2. Overwrites `identity/journal-compressed.md` with the new compression
3. Applies manifesto changes via string replacement in `identity/manifesto.md`
4. Writes domain recommendations to `curator-recommendations.md`
5. Updates project statuses (complete/abandon) via `src/files/projects.ts`
6. Executes stimuli actions: refreshes live sources or writes new skill files

All operations are fail-soft — individual failures are logged but don't crash the cycle.

### Stimuli Pipeline (`src/stimuli/`)

External stimuli fight the system converging on its own patterns:

- **Live stimuli** (`stimuli/live/`) are fetched via CLI tools: `firecrawl search` for Tavily-powered sources, `npx ctx7@latest` for random knowledge. Refreshed on configurable intervals.
- **Skill files** (`stimuli/skills/`) are persistent curated reference material — the Curator can commission new ones.
- `refreshAllStale()` checks each source against its configured interval and auto-disables after 3 consecutive failures.
- Refresh state is checkpointed to survive crashes.

### Anti-Entropy Monitoring (`src/monitor/`)

Four detectors run after every iteration to catch systemic problems:

| Detector | What it catches | Severity | Corrective action |
|---|---|---|---|
| **Slop** | Mean rating drops below threshold (2.5) | Critical | Emergency Curator cycle |
| **Repetition** | Artifacts too similar (trigram overlap > 0.6) | Warning | Anti-repetition pressure on Ideator |
| **Manifesto drift** | Too many identity changes (>5 in 30 iters) | Warning | Stability advisory |
| **Domain collapse** | One domain >60% of output | Critical | Force domain diversification |

Critical warnings from the slop detector trigger an immediate emergency Curator cycle. All warnings are logged to `logs/monitor.jsonl`.

### Crash Recovery (`src/checkpoint/`)

Atomic checkpointing via write-to-temp + rename:

- State saved every `checkpoint_every` iterations (default: 1)
- Checkpoint includes: iteration number, stats snapshot, Curator run counter, stimuli refresh states
- On startup, the harness loads the checkpoint and resumes from `iteration + 1`
- If no checkpoint exists, it reads `logs/iterations.jsonl` to find the last completed iteration

## Sandbox

The Tester executes code artifacts in a sandboxed environment via `src/sandbox/sandbox.ts`. It uses the Gondolin SDK's `VM` class — a QEMU-based micro-VM:

- **Filesystem:** Memory-backed VFS mounted at `/workspace`
- **Network:** Isolated (no external access)
- **Timeout:** 60s default per command, 90s for the full test session
- **Capabilities:** Write files, execute shell commands, install packages (via `apk`)

The test flow:
1. Tester agent produces a **test plan** (language, setup commands, test files, run command)
2. Harness writes artifact + test files into the VM
3. Harness runs setup commands then the test command
4. Tester agent reviews execution output and produces a **final verdict**

If QEMU isn't installed, the sandbox falls back to lightweight (non-execution) verification.

## Data Flow

### Artifact Lifecycle

```
Idea (Ideator) → Gate 1 (Critic) → Build (Creator) → workspace/current/
    → Test (Tester/Sandbox) → Gate 2 (Critic)
    → Ship: portfolio/{domain}/{id}-{slug}/ + index.md entry
    → Kill: portfolio/killed/{id}-{slug}/ with post-mortem
```

Artifact files, README (with review + ratings), and Tester reports are written by `src/files/portfolio.ts`. Portfolio index is a markdown table updated by `updatePortfolioIndex()`.

### Identity Evolution

- **Journal** (`identity/journal.md`): Append-only log. Every iteration adds entries for outcomes, Curator observations, project decisions, manifesto changes.
- **Compressed journal** (`identity/journal-compressed.md`): Curator-maintained summary that fits in context windows. Older entries are summarized; recent entries preserved in full.
- **Manifesto** (`identity/manifesto.md`): The system's evolving identity. The Curator proposes changes grounded in evidence from recent work. Changes are logged as diffs in the journal.

### Human Intervention

Two mechanisms:
- **`requests.md`**: Write a request; the Curator translates it into a proposal that bypasses the Ideator but still passes through the Critic. Cleared after processing.
- **`STOP` file**: Create to halt cleanly at the end of the current phase. Remove to resume.

### Logging

All logs are JSONL, appended via `src/logging/logger.ts` with automatic rotation at 50MB:
- `iterations.jsonl` — outcome, ratings, tokens, duration per iteration
- `decisions.jsonl` — every Critic gate decision with reasons and ratings
- `test-reports.jsonl` — every Tester verdict with pass/fail details
- `token-usage.jsonl` — per-call model, tokens, duration
- `monitor.jsonl` — anti-entropy warnings
