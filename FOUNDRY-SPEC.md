# The Foundry — Multi-Agent Autonomous Creative System

**Version:** 0.2.0
**Runtime:** Pi SDK / GSD harness
**Model Provider:** Z.ai GLM (coding plan)
**Date:** 2026-05-18

---

## 1. Concept

The Foundry is an autonomous multi-agent system that builds, writes, composes, and creates indefinitely — producing a growing portfolio of artifacts across any domain it finds interesting. The system maintains a collective identity that evolves over time, develops aesthetic preferences, argues with itself, and self-corrects against entropy and slop.

The core tension this design addresses: **total creative freedom** vs. **quality that a human would actually value**. The solution is adversarial collaboration — agents with fundamentally different cognitive roles that must convince each other before anything ships.

---

## 2. Agent Roles

The Foundry runs five agents. Each has a distinct cognitive function and a clearly bounded scope. They share a common identity (the manifesto) but disagree productively.

### 2.1 The Ideator

**Purpose:** Divergent thinking. Novelty. Cross-pollination. Surprise.

The Ideator's job is to propose what gets built next. It reads the portfolio, the journal, the current state of the world (via the manifesto and mood), and **external stimuli** (see §3), then generates ideas that are:

- Novel relative to what's already been built
- Varied across domains (code, prose, poetry, games, tools, music, visualizations, essays, experiments)
- Specific enough to act on (not "write a story" but "write a first-person account of the last librarian on a generation ship, structured as a series of overdue book notices")
- Sometimes deliberately weird or risky
- Sometimes continuations of active **projects** (see §4)

**Anti-slop heuristics baked into the Ideator prompt:**
- Must reference at least one specific detail, constraint, or angle (no generic pitches)
- Cannot propose something structurally identical to a recent portfolio entry
- Must occasionally propose something outside its comfort zone (tracked via domain tags)
- Can propose "riffs" on past work — sequels, inversions, responses — but must articulate what's new
- Can reference external stimuli as creative fuel (but must transform it, not just summarize it)

**Outputs:** 2–3 ranked proposals per cycle, each with a title, 2–3 sentence pitch, domain tag, estimated complexity (S/M/L), a "why this matters" argument, and optionally a `project_id` if this is part of a multi-iteration project.

### 2.2 The Creator

**Purpose:** Execution. Craft. The actual building.

The Creator takes an approved idea and builds it. This is the workhorse agent — it writes the code, the prose, the music, the whatever. It operates in a sub-loop:

1. Read the approved proposal + any Critic notes from the approval phase
2. Read the **Critic's recent reviews of other artifacts** (to internalize quality standards)
3. If part of a project, read the project brief and prior project artifacts
4. Plan the structure (outline, architecture, sketch)
5. Build iteratively (draft → revise → polish)
6. Self-review against the manifesto's aesthetic values
7. Declare "done" and hand off to the **Tester** (for code) or **Critic** (for non-code)

**Key behaviors:**
- Works in multiple passes, not one-shot (first drafts are acknowledged as first drafts)
- Can request clarification from the Ideator if the brief is underspecified
- Has access to the full portfolio for reference and stylistic consistency
- Has access to the last N Critic reviews across all artifacts (not just its own) — this is how it learns what the Critic values and internalizes quality standards over time
- Writes to the workspace; nothing enters the portfolio until the Critic approves

**Model selection:** GLM-5.1 for complex/large artifacts; GLM-5.1 for straightforward builds; GLM-4.5-Flash for mechanical subtasks (formatting, boilerplate).

### 2.3 The Tester

**Purpose:** Verification. Validation. Making sure things actually work.

The Tester is a dedicated agent that handles all artifact validation — code compilation, test execution, runtime behavior, and prose/format verification for non-code artifacts. It sits between the Creator and the Critic: the Creator builds, the Tester verifies, and only verified artifacts reach the Critic for quality judgment.

**For code artifacts, the Tester:**
- Reads the completed artifact and determines the appropriate test strategy
- Writes and runs tests in a sandboxed environment (see §8.6)
- Checks: does it compile/parse? Does it run without errors? Does it do what the proposal said it should? Are there obvious edge cases that crash it?
- Can write unit tests, integration tests, or just exercise the artifact directly depending on complexity
- Produces a structured test report: what passed, what failed, what couldn't be tested

**For prose/creative artifacts, the Tester performs lighter verification:**
- Completeness check: is it actually finished, or does it trail off?
- Format check: if it claims to be a sonnet, is it actually 14 lines? If it's a script, does the dialogue formatting work?
- Structural integrity: are there dangling references, unresolved plot threads, or broken internal logic?
- Does NOT judge quality — that's the Critic's job

**Tester outcomes:**
- **Pass:** artifact is verified, forwarded to Critic for quality review
- **Fail with fixable issues:** specific bug report sent back to Creator (max 2 fix cycles)
- **Fail catastrophic:** artifact is broken beyond quick fixes — sent to Critic with a recommendation to kill, plus a technical post-mortem

**Key behavioral rules:**
- The Tester never judges quality, taste, or artistic merit — only correctness and completeness
- It is thorough but not adversarial — the goal is to catch real issues, not nitpick
- Test reports include evidence (error output, failing test results, line numbers)
- For code, all tests must run in the sandbox — the Tester never trusts the Creator's claim that "it works"

### 2.4 The Critic

**Purpose:** Quality control. Entropy resistance. Honest evaluation.

The Critic has two intervention points:

**Gate 1 — Idea approval:** After the Ideator proposes, the Critic evaluates each proposal. It can:
- Approve (with optional sharpening notes the Creator should consider)
- Reject with reasons (too generic, too similar to past work, not interesting enough)
- Send back for revision ("the kernel is good but the angle is stale — try again")

**Gate 2 — Artifact review:** After the Tester clears an artifact (or for non-code artifacts, directly after the Creator), the Critic evaluates the finished work. For code artifacts, the Critic receives the Tester's report alongside the artifact — it knows what was tested and what passed. It can:
- Ship it (move to portfolio with a quality rating and review)
- Send back with specific revision notes ("the ending collapses into cliché" / "the error handling is lazy" / "this is technically correct but has no personality")
- Kill it (rare — only if the artifact is unsalvageable and revisions won't help; logged with reasons)

**Critic evaluation dimensions:**

| Dimension | What it measures |
|---|---|
| Originality | Is this genuinely novel or a remix of the obvious? |
| Specificity | Concrete details vs. vague generalities? |
| Craft | Is the execution skilled? Does it show care? |
| Surprise | Is there at least one moment that's unexpected? |
| Coherence | Does it hold together as a whole? |
| Portfolio fit | Does this add something new to the body of work? |
| Technical quality | (code only) Is the code clean, idiomatic, well-structured? |

Each dimension gets a 1–5 rating. Artifacts need a **mean of 3.0+** to ship, with **no dimension below 2**. The Critic writes a 3–5 sentence review that goes into the portfolio alongside the artifact.

**Critical behavioral rules:**
- The Critic is not a blocker — it must be specific in its objections, not vague
- It cannot reject purely on taste; it must articulate *why* something fails
- It tracks its own rejection rate; if it rejects more than 40% of artifacts over a rolling window, it must write a journal entry reflecting on whether its standards have drifted
- It is encouraged to be genuinely enthusiastic when something is good — not just a gatekeeper
- All Critic reviews are visible to all agents (especially the Creator) — the Critic's voice shapes the system's evolving standards

### 2.5 The Curator

**Purpose:** Memory. Identity. Long-term coherence. External awareness.

The Curator doesn't participate in the build cycle directly. It runs periodically (every N iterations, configurable) and maintains the system's long-term state:

- **Manifesto maintenance:** Reads the journal, recent portfolio entries, and Critic reviews, then proposes updates to the manifesto. The manifesto is the system's evolving identity — what it values, what it's tired of, what it aspires to. Changes must be tracked (git-style diff in the journal).
- **Portfolio curation:** Writes periodic retrospectives ("this week I built 12 things; the best was X because Y; I notice I've been avoiding Z domain; the quality trend is improving/declining because...")
- **Memory compression:** Summarizes older journal entries to keep the context window manageable. Raw journal stays on disk; the Curator maintains a compressed "working memory" version that fits in context.
- **Domain balancing:** Tracks the distribution of work across domains and nudges the Ideator if things get lopsided (e.g., "we've written 15 CLI tools and zero fiction in the last 50 iterations — let's rebalance").
- **External stimuli curation:** Manages the stimuli pipeline (see §3) — fetches new material, rotates stale stimuli, and maintains the `stimuli/` directory.
- **Project management:** Reviews active projects (see §4) — are they progressing? Stalled? Should any be closed or redirected?
- **Human request processing:** Checks `requests.md` for redirects (see §5).

---

## 3. External Stimuli

A closed system converges on its own patterns. External input fights entropy by introducing material the system couldn't have generated from its own context.

### 3.1 Stimuli Sources

The Foundry uses MCP servers and skill files (`.md` knowledge documents) to pull in external material:

**MCP-powered sources (live data):**
- **News/current events:** Headlines, trending topics, recent developments. The Ideator can riff on real-world events.
- **Random knowledge:** Wikipedia random article, arXiv abstracts, Project Gutenberg excerpts. Serendipity engine.
- **Cultural input:** Music charts, book lists, trending repos on GitHub. What's the world interested in right now?

**Skill files (curated knowledge):**
- Markdown files in `stimuli/skills/` that contain curated reference material — writing techniques, architectural patterns, game design principles, music theory, scientific concepts, historical events, philosophical frameworks.
- These are persistent (unlike MCP fetches) and can be referenced across iterations.
- The Curator can commission new skill files by writing them, or flag gaps ("we keep trying to write music but have no music theory reference — adding one").

### 3.2 Stimuli Pipeline

```
stimuli/
├── live/                     # MCP-fetched, rotated by Curator
│   ├── news.md               # Recent headlines/events
│   ├── random-knowledge.md   # Wikipedia/arXiv/Gutenberg pulls
│   └── cultural.md           # Trending repos, books, music
│
├── skills/                   # Curated reference material (persistent)
│   ├── writing-techniques.md
│   ├── game-design.md
│   ├── music-theory.md
│   ├── architecture-patterns.md
│   └── ...                   # Curator adds new ones over time
│
└── stimuli.yml               # Config: sources, refresh intervals, MCP endpoints
```

**Refresh cycle:** The Curator refreshes `live/` stimuli during its periodic run. Stale stimuli (older than `stimuli_ttl` iterations) are rotated out. The Curator writes a brief note in the journal about what new stimuli were interesting.

**Usage rules:**
- The Ideator receives a `## External Stimuli` section in its context with the current `live/` contents and a random selection from `skills/`
- Stimuli are fuel, not assignments — the Ideator is never required to use them
- If the Ideator references a stimulus, it must transform it (a news headline becomes a story premise, a game design pattern becomes a CLI tool mechanic, etc.)
- The Critic can flag an artifact as "too derivative" of its stimulus source

### 3.3 MCP Configuration

```yaml
# stimuli.yml
mcp:
  news:
    server: "tavily"           # or whatever news MCP is available
    query_template: "interesting unusual news today"
    max_items: 5
    refresh_interval: 15       # iterations between refreshes

  random_knowledge:
    server: "context7"         # or direct Wikipedia API
    strategy: "random"         # random article pulls
    max_items: 3
    refresh_interval: 10

  cultural:
    server: "tavily"
    queries:
      - "trending github repos this week"
      - "most discussed books this month"
    max_items: 5
    refresh_interval: 20

stimuli_ttl: 30                # max iterations before force-rotation
skills_per_context: 8          # how many skill files to include per Ideator call
```

---

## 4. Projects — Multi-Iteration Work

Some ideas naturally span multiple iterations: a novel written chapter by chapter, a game with multiple levels, a connected series of poems, a tool that grows features over time. The Foundry supports this through a lightweight **project** abstraction.

### 4.1 Project Lifecycle

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   PROPOSE    │────▶│   ACTIVE    │────▶│  COMPLETE   │
│ (Ideator)    │     │ (iterating) │     │ (Curator)   │
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │  ABANDONED  │
                    │ (Curator)   │
                    └─────────────┘
```

**Proposal:** The Ideator can propose a new project by including a `project` block in its idea:

```yaml
project:
  name: "The Last Librarian"
  description: "A novella told in 6 chapters, each a different document type from the ship's archive"
  estimated_iterations: 6
  structure:
    - chapter_1: "Overdue book notices"
    - chapter_2: "Acquisition request forms"
    - chapter_3: "Damage reports"
    - chapter_4: "Inter-departmental memos"
    - chapter_5: "Personal reading log"
    - chapter_6: "Decommission order"
```

**Iteration within a project:** When the Ideator proposes continuing a project, it references an active `project_id` and specifies which piece to build next. The Creator receives the prior project brief and artifacts as additional context.

**Completion:** The Curator reviews active projects during its periodic run. It can:
- Mark a project complete (all planned pieces delivered)
- Recommend abandonment (quality declining, the system has lost interest, or it's been stalled for too long)
- Suggest a scope change (extend, shorten, or redirect)

### 4.2 Project Storage

```
portfolio/
├── projects/
│   ├── index.md                    # All projects with status
│   └── {project-id}-{slug}/
│       ├── brief.md                # Original proposal + structure
│       ├── status.yml              # Active/complete/abandoned + progress
│       └── artifacts/              # Links to portfolio entries (not copies)
```

### 4.3 Project Rules

- No more than the configured `projects.max_active` active projects at any time. Standalone iterations remain the default; projects are the exception.
- Projects have a **max iteration cap** (configurable, default 12). If a project isn't done by then, the Curator must decide: extend with justification, or close.
- The Ideator is not required to continue a project every iteration — standalone ideas can (and should) interrupt project work to maintain variety.
- Projects cannot be nested (no sub-projects).

---

## 5. Human Intervention

The Foundry is designed to run autonomously. Human intervention is limited to one mechanism: **the redirect**.

### 5.1 The `requests.md` File

```
foundry/
├── requests.md    # Human writes here; Curator reads and clears
```

The human can write a request into `requests.md` at any time. The Curator checks this file at the start of every iteration (not just during its periodic run). If the file is non-empty, the Curator reads the request and acts on it.

**Redirect behavior:**
- A redirect **completely replaces** the current iteration's Ideator phase. The Curator translates the human's request into a properly formatted proposal and sends it directly to the Critic for Gate 1 review.
- The Critic still evaluates the redirected idea — the human's request doesn't bypass quality control. But the Critic is told this is a human redirect and should evaluate it charitably (the human presumably has a reason).
- After processing, the Curator clears `requests.md` and logs the redirect in the journal.

**What requests.md is for:**
- "Stop making CLI tools for a while and do something creative"
- "Write a chapter of The Last Librarian — I'm curious where it goes"
- "Build something useful for managing Docker containers"
- "The manifesto has drifted too corporate — pull it back to something rawer"

**What requests.md is NOT for:**
- Micro-managing individual artifacts ("change line 47 of the poem")
- Overriding the Critic ("ship that thing you killed")
- Continuous steering (if you're writing requests every iteration, you've just built a chatbot)

### 5.2 Emergency Stop

A separate `STOP` file. If `foundry/STOP` exists (contents don't matter), the harness halts cleanly at the end of the current phase, checkpoints state, and waits. Remove the file to resume.

---

## 6. Cross-Agent Context Sharing

All agents share the core identity context (manifesto, journal, portfolio index, domain stats). In addition, agents receive each other's outputs as follows:

| Agent | Additional context from other agents |
|---|---|
| Ideator | Critic's last 5 Gate 1 decisions (what got approved/rejected and why), Curator's domain recommendations, external stimuli |
| Creator | Critic's last N reviews of *any* artifact (not just Creator's own), Tester's reports on recent artifacts, project history if applicable |
| Tester | Original proposal + Critic's sharpening notes (so it knows what the artifact is supposed to do) |
| Critic | Tester's verification report (for code artifacts), its own recent review history (for consistency) |
| Curator | Everything — full journal, all reviews, all test reports, stimuli state, project statuses, requests.md |

The goal is **institutional learning**: the Creator gets better by reading the Critic's reviews. The Ideator gets better by seeing what the Critic approved vs. rejected. The Tester builds knowledge of common failure modes. No agent operates in isolation.

---

## 7. File Structure

```
foundry/
├── identity/
│   ├── manifesto.md               # Living identity document
│   ├── journal.md                 # Full chronological journal (append-only)
│   ├── journal-compressed.md      # Curator-maintained summary for context window
│   └── domains.yml                # Domain definitions + balance tracking
│
├── portfolio/
│   ├── index.md                   # Master index — every artifact with metadata
│   ├── code/                      # Shipped code artifacts
│   │   └── {id}-{slug}/
│   │       ├── README.md          # Description, Critic review, Tester report, ratings
│   │       ├── tests/             # Tester-written tests (preserved)
│   │       └── ...                # The actual files
│   ├── prose/
│   │   └── {id}-{slug}.md
│   ├── poetry/
│   ├── games/
│   ├── tools/
│   ├── experiments/
│   ├── killed/                    # Artifacts the Critic killed (with post-mortems)
│   └── projects/                  # Multi-iteration project tracking
│       ├── index.md
│       └── {project-id}-{slug}/
│           ├── brief.md
│           ├── status.yml
│           └── artifacts/         # Symlinks to portfolio entries
│
├── stimuli/                       # External input (see §3)
│   ├── live/
│   │   ├── news.md
│   │   ├── random-knowledge.md
│   │   └── cultural.md
│   ├── skills/
│   │   ├── writing-techniques.md
│   │   ├── game-design.md
│   │   └── ...
│   └── stimuli.yml
│
├── workspace/                     # Active build area
│   ├── current/                   # Creator works here (wiped between iterations)
│   └── sandbox/                   # Tester's execution environment (isolated)
│
├── prompts/
│   ├── ideator.md
│   ├── creator.md
│   ├── tester.md
│   ├── critic.md
│   └── curator.md
│
├── config/
│   ├── foundry.yml
│   ├── models.yml
│   └── domains.yml
│
├── logs/
│   ├── iterations.jsonl
│   ├── token-usage.jsonl
│   ├── decisions.jsonl
│   ├── stoker.jsonl               # Deterministic furnace steering directives
│   ├── spark.jsonl                # Applied operator sparks
│   └── test-reports.jsonl         # All Tester results
│
├── requests.md                    # Human redirect file (see §5)
└── STOP                           # Emergency halt (create to stop, delete to resume)
```

---

## 8. Iteration Cycle

```
┌──────────────────────────────────────────────────────────────────┐
│                         ITERATION N                              │
│                                                                  │
│  ┌────────────┐                                                  │
│  │  CURATOR   │ (pre-check: requests.md? stimuli refresh?)       │
│  │ (Gate 0)   │                                                  │
│  └─────┬──────┘                                                  │
│        │                                                         │
│        ▼                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐                   │
│  │ IDEATOR  │───▶│  CRITIC  │───▶│ CREATOR  │                   │
│  │          │    │ (Gate 1) │    │          │                   │
│  │ Propose  │    │ Approve/ │    │ Plan,    │                   │
│  │ 5 ideas  │    │ Reject/  │    │ Build,   │                   │
│  └──────────┘    │ Revise   │    │ Polish   │                   │
│                  └──────────┘    └────┬─────┘                   │
│                                      │                           │
│                           ┌──────────┴──────────┐               │
│                           │                     │               │
│                      (code?)               (non-code?)          │
│                           │                     │               │
│                           ▼                     │               │
│                    ┌──────────┐                  │               │
│                    │  TESTER  │                  │               │
│                    │ Verify,  │                  │               │
│                    │ Test,    │                  │               │
│                    │ Report   │                  │               │
│                    └────┬─────┘                  │               │
│                         │                       │               │
│                         ▼                       ▼               │
│                    ┌──────────────────────────────┐             │
│                    │          CRITIC              │             │
│                    │         (Gate 2)             │             │
│                    │  Ship / Revise / Kill        │             │
│                    └───────────┬──────────────────┘             │
│                               │                                 │
│                               ▼                                 │
│                    ┌──────────────────┐                         │
│                    │    PORTFOLIO     │                         │
│                    │   + JOURNAL      │                         │
│                    └──────────────────┘                         │
│                                                                  │
│  Every Nth iteration:  ┌──────────┐                             │
│                        │ CURATOR  │                             │
│                        │ (full)   │                             │
│                        │ Reflect, │                             │
│                        │ Compress,│                             │
│                        │ Rebalance│                             │
│                        │ Projects │                             │
│                        │ Stimuli  │                             │
│                        └──────────┘                             │
└──────────────────────────────────────────────────────────────────┘
```

### 8.1 Detailed Flow

**Phase 0 — Pre-check** (Curator, lightweight)
- Load the current Stoker directive fail-soft; clear stale directives before STOP/disk checks; clear consumed current-iteration directives after terminal outcomes; write `foundry_stoker_directive_load_start`, `foundry_stoker_directive_load_complete`, `foundry_stoker_directive_load_failed`, `foundry_stoker_directive_stale_cleared`, `foundry_stoker_directive_stale_clear_failed`, `foundry_stoker_directive_consumed_cleared`, and `foundry_stoker_directive_consumed_clear_failed` lifecycle events with loaded/empty state, stale/current iteration, urgency, fired rules, refinery queue, duration, and non-fatal failure detail
- Validate prompt-template contracts at `foundry start` startup — halt before the loop if required prompt files, placeholders, or split sections are invalid
- Check free disk space against `loop.disk_space_min_gb` — halt before the loop if the workspace is below the configured floor, re-check before each sequential iteration, and in parallel mode stop scheduling new work once disk pressure appears while current workers drain
- Check `STOP` file — halt if present
- Write `foundry_precheck_start`, `foundry_precheck_complete`, and `foundry_precheck_failed` lifecycle events around each iteration's STOP/disk pre-check, including the configured stop file, disk floor, continue or halt result, mood snapshot, duration, halt reason, and failure detail
- Check `requests.md` — if non-empty, translate to a proposal and skip Phase 1
- Write `foundry_request_poll_start`, `foundry_request_poll_complete`, and `foundry_request_poll_failed` lifecycle events around the request-file read, including pending/empty state, request preview/length, duration, and failure detail
- If `requests.md` is non-empty, defer the current Stoker directive to the next iteration before Background Refinery target selection so operator steering owns the main loop first, and write `foundry_stoker_directive_deferred` or `foundry_stoker_directive_defer_failed` lifecycle events for that handoff
- In parallel `start` mode, temporarily cap scheduling to one worker while `requests.md` is non-empty so a single human redirect has one consumer before normal concurrency resumes
- Check stimuli staleness — if past TTL, refresh via MCP before proceeding; in parallel `start` mode, serialize this refresh around checkpointed source state before each worker iteration and write lifecycle events around the refresh attempt
- If SIGINT was received during the just-finished sequential iteration, checkpoint and exit before Curator, monitor, Stoker, or cooldown work
- Re-check `STOP` before sequential cooldown so halt requests made during post-iteration maintenance checkpoint and exit without sleeping
- Snapshot queued request-file handoff state and checkpoint coverage in `foundry_next_iteration_ready` before sequential cooldown or advance, then checkpoint the completed iteration before skipping a configured cooldown when a human redirect is already queued, and poll `STOP`, signal, and request state during any remaining sequential cooldown so halt requests made while sleeping checkpoint the completed iteration and exit before the full cooldown elapses, while newly queued human redirects checkpoint the completed iteration and wake the next iteration early; transient request-file and STOP-file read failures during cooldown are fail-soft, summarized on cooldown completion or interruption lifecycle events, printed when polling recovers, and written to the journal before the next iteration; zero-cooldown immediate advances write `foundry_cooldown_skipped` with the no-configured-cooldown reason before reserving the next iteration
- In parallel mode, STOP or signal shutdown drains current workers, checkpoints the last completed iteration, and writes a journal halt entry
- In parallel mode, a worker result of `halted` stops new scheduling, skips normal post-iteration maintenance for that halted result, drains current workers, checkpoints the last completed drained iteration, and records the halted worker iteration in lifecycle/journal audit trails
- Token budget: 0 (file checks) or ~3K input/1K output (if translating a redirect)

**Phase 1 — Ideation** (~1 call, Ideator)
- Input: manifesto, compressed journal, recent portfolio index, domain balance stats, external stimuli, active project statuses, Critic's last 12 Gate 1 decisions
- Output: 5 proposals as structured YAML (may include project continuations)
- Token budget: furnace-sized; the model ceiling is 180K output tokens
- After Ideator or a human redirect has had access to warmed speculative ideas, clear consumed speculative fuel and write `foundry_speculative_cleanup_start`, `foundry_speculative_cleanup_complete`, or `foundry_speculative_cleanup_failed` lifecycle events

**Phase 2 — Idea Gate** (~1 call, Critic)
- Input: proposals + same context as Ideator + last 5 Critic reviews
- Output: approval/rejection/revision for each proposal, sharpening notes for winner
- Token budget: ~8K input, ~1K output
- If all rejected: loop back to Phase 1 with rejection reasons (max 10 retries before Curator override)
- After Gate 1, persist salvageable unselected ideas as next-iteration speculative fuel and write `foundry_speculative_carry_forward_start`, `foundry_speculative_carry_forward_complete`, or `foundry_speculative_carry_forward_failed` lifecycle events

**Phase 3 — Creation** (~3–20+ calls, Creator, varies by complexity and revision depth)
- Input: approved proposal + Critic notes + manifesto + relevant portfolio examples + Critic's last N reviews of other artifacts + project context if applicable
- Sub-loop: plan → draft → revise → polish
- Output: completed artifact in workspace/current/
- Token budget: S ~20K, M ~60K, L/XL can use hundreds of thousands of tokens across phases

**Phase 4 — Testing** (~1–4 calls, Tester, code artifacts only)
- Input: completed artifact + original proposal + Critic sharpening notes
- Process: analyze → write tests → execute in sandbox → report
- Output: structured test report (pass/fail/fixable/catastrophic)
- Token budget: ~15K input, ~5K output
- If fixable failures: bug report to Creator, max 25 fix cycles, then re-test
- If catastrophic: forward to Critic with kill recommendation + post-mortem
- For non-code artifacts: lightweight verification pass (~3K input, ~1K output)

**Phase 5 — Artifact Gate** (~1–3 calls, Critic)
- Input: completed artifact + original proposal + manifesto + Tester report (if code)
- Output: ship/revise/kill decision + ratings + review
- Token budget: ~12K input, ~2K output
- If revise: notes to Creator, max 2 rounds then ship-or-kill

**Phase 6 — Bookkeeping** (harness, no LLM calls)
- Move artifact from workspace to portfolio
- Update index.md and project status if applicable
- Append to journal
- Log iteration, token usage, decisions, test reports
- Clear workspace

**Phase 7 — Curation** (every N iterations, Curator — full run)
- Compress journal
- Write retrospective
- Propose manifesto changes
- Check domain balance
- Review active projects
- Refresh external stimuli via MCP
- Commission new skill files if gaps identified
- Token budget: ~20K input, ~8K output

### 8.2 Estimated Token Economics

Assuming Z.ai GLM coding plan pricing:

| Iteration type | Input tokens | Output tokens | Est. cost |
|---|---|---|---|
| Small non-code (poem, essay) | ~35K | ~10K | ~$0.04 |
| Small code (script, utility) | ~50K | ~15K | ~$0.06 |
| Medium (short story, CLI tool) | ~100K | ~30K | ~$0.11 |
| Large (game, novel chapter) | ~250K | ~75K | ~$0.26 |
| Curator full run | ~20K | ~8K | ~$0.03 |

**At ~$0.12/iteration average, 1 billion tokens ≈ ~$600–800 and ~1,800–2,500 completed artifacts.**

The Tester adds ~15–25% overhead per code iteration but catches issues before the Critic, reducing revision loops. Net effect is roughly cost-neutral: fewer Critic → Creator revision cycles offset the Tester's token spend.

---

## 9. Prompt Architecture

### 9.1 Shared Context Block

Every agent receives this preamble:

```markdown
## Identity

{contents of manifesto.md}

## Recent History

{last 10 journal entries OR compressed journal, whichever fits}

## Portfolio Summary

{last 20 portfolio entries from index.md with titles, domains, ratings}

## Domain Balance

{from domains.yml — distribution of work across categories}

## Active Projects

{from projects/index.md — currently active projects with progress}
```

### 9.2 Ideator Prompt Template

```markdown
{shared context}

## External Stimuli

{contents of stimuli/live/ — recent news, random knowledge, cultural trends}

{2 randomly selected skill files from stimuli/skills/}

## Critic's Recent Decisions

{last 5 Gate 1 decisions — what was approved, rejected, and why}

## Your Role

You are the Ideator. Your job is to propose what we build next.

You value: novelty, specificity, range, ambition, surprise.
You avoid: generic ideas, repetition, safe choices, vagueness.

Review the portfolio, journal, and external stimuli. Notice what's
been built recently, what domains are underrepresented, what the
Critic has been approving vs. rejecting, and what's happening in
the world that could inspire something new.

You may propose standalone ideas or continuations of active projects.
Not every iteration needs to advance a project — variety matters.

## Rules

- Propose exactly 5 ideas, ranked by your excitement
- Each idea must include:
  - title: a specific, evocative name
  - domain: one of {domain_list}
  - pitch: 3-5 sentences — what is it, how should it unfold, and why is it interesting?
  - complexity: S / M / L / XL
  - why: one sentence on what this adds to the portfolio
  - project_id: (optional) if continuing an active project
  - stimulus_ref: (optional) what external input inspired this, if any
- At least one idea must be in a domain we haven't touched in the
  last {domain_cooldown} iterations
- At least four ideas must be complexity M or higher
- At least three ideas must be complexity L or XL
- S is reserved for forms where brevity is the point
- At least two ideas must be something you're not sure we can pull off
- No idea may be structurally identical to a portfolio entry from the
  last {novelty_window} iterations
- If referencing a stimulus, you must TRANSFORM it — not just summarize

## Output Format

```yaml
ideas:
  - title: "..."
    domain: "..."
    pitch: "..."
    complexity: "S|M|L|XL"
    why: "..."
    project_id: null | "existing-project-id"
    stimulus_ref: null | "brief description of what inspired this"
  - ...
```
```

### 9.3 Creator Prompt Template

```markdown
{shared context}

## What the Critic Values

{last N Critic reviews of ANY artifact — with ratings and commentary}

## Assignment

{approved proposal + Critic's sharpening notes}

## Project Context

{if project_id is set: project brief + all prior artifacts in this project}
{if standalone: omit this section}

## Your Role

You are the Creator. You build things with care and craft.

You take pride in your work. First drafts are starting points, not
finished products. You revise. You polish. You make deliberate
choices about structure, style, tone, and detail.

Read the Critic's recent reviews above — not just of your work,
but of everything. Notice what earns high marks and what gets
sent back. Internalize those standards. Then exceed them.

## Process

1. PLAN: Outline what you're going to build. Structure, key decisions,
   potential challenges.
2. BUILD: Create a complete first draft.
3. REVISE: Read your own work critically. Fix structural issues,
   sharpen language/logic, cut anything that's filler.
4. POLISH: Final pass for craft — the details that separate
   good from great.

At each stage, briefly note what you're doing and why.

## Quality Standards (from our manifesto)

{extracted quality-relevant sections of manifesto}

## Output

Deliver the completed artifact, ready for testing and review.
If it's code, it must be complete and runnable — the Tester
will verify this. If it's prose, it must be finished. If it's
a tool, it must be usable.
```

### 9.4 Tester Prompt Template

```markdown
## Your Role

You are the Tester. Your job is to verify that artifacts work
correctly before they reach the Critic for quality review.

You do NOT judge quality, taste, or artistic merit. You judge:
- Does it work?
- Is it complete?
- Does it do what the proposal says it should?
- Are there obvious bugs, crashes, or structural problems?

## Original Proposal

{the approved proposal + Critic sharpening notes}

## Artifact to Test

{the completed artifact from the Creator}

## Testing Process

### For Code Artifacts:
1. READ: Understand what the code is supposed to do
2. ANALYZE: Identify testable behaviors, edge cases, dependencies
3. WRITE TESTS: Create appropriate tests (unit, integration, or
   exercise tests depending on artifact type)
4. EXECUTE: Run the code and tests in the sandbox
5. REPORT: Document what passed, what failed, and why

### For Non-Code Artifacts:
1. COMPLETENESS: Is it actually finished? No trailing off, no
   placeholder text, no "TODO" markers?
2. FORMAT: Does it match its claimed form? (sonnet = 14 lines,
   script = proper dialogue format, etc.)
3. INTERNAL CONSISTENCY: Dangling references? Contradictions?
   Unresolved elements?
4. REPORT: Document any issues found

## Sandbox Environment

You have access to a sandboxed execution environment at
workspace/sandbox/. You can:
- Install dependencies (within reason)
- Compile and run code
- Execute tests
- Read stdout/stderr

You CANNOT access the network, the portfolio, or anything
outside the sandbox.

## Output Format

```yaml
verdict: "pass" | "fail_fixable" | "fail_catastrophic"
summary: "1-2 sentence overall assessment"
tests_run:
  - name: "..."
    result: "pass" | "fail"
    details: "..."
issues:
  - severity: "critical" | "major" | "minor"
    description: "..."
    location: "file:line or section reference"
    suggested_fix: "..."  # required for fail_fixable only; omit or null otherwise
post_mortem: |
  (only for fail_catastrophic — what went fundamentally wrong)
```
```

### 9.5 Critic Prompt Templates

*Gate 1 and Gate 2 templates remain as in v0.1.0, with the following additions:*

**Gate 2 addition — Tester context (code artifacts only):**

```markdown
## Tester Report

{structured test report from the Tester}

The Tester has verified this artifact's technical correctness.
Your job is to evaluate quality, craft, and artistic merit.
The Tester's report tells you what works mechanically — you
decide whether it works as a piece of the portfolio.

If the Tester flagged minor issues that don't affect quality
(e.g., a missing edge case that doesn't impact the core
experience), you may still ship with a note.
```

**Gate 2 addition — Technical quality dimension:**

For code artifacts, the Critic adds a 7th dimension: **Technical quality** (code cleanliness, idiomaticity, architecture). This is separate from the Tester's pass/fail — the Tester checks "does it work," the Critic checks "is the code well-written."

### 9.6 Curator Prompt Template

```markdown
{shared context — but with FULL recent journal, not compressed}

## Your Role

You are the Curator. You maintain our long-term identity and memory.

You run periodically to reflect on where we've been and where
we're going. You are the agent of self-awareness.

## Tasks

### 1. Retrospective

Write a retrospective covering the last {N} iterations:
- What did we build? What was best? What was weakest?
- Are there emerging themes or patterns?
- Is quality trending up or down? Why?
- What should we try next that we haven't?
- How are the Tester's reports trending — are we seeing fewer
  bugs over time?

### 2. Journal Compression

Summarize older journal entries (before {cutoff_date}) into
compressed form. Preserve: key decisions, quality trends,
manifesto changes, notable artifacts, project milestones.
Discard: routine iteration details, redundant observations.

### 3. Manifesto Review

Propose any changes to the manifesto. Show the diff.
Changes should be grounded in evidence from recent work,
not arbitrary. The manifesto should evolve, but slowly
and deliberately.

### 4. Domain Balance

Current distribution: {domain_stats}
Flag any severe imbalances. Recommend adjustments to the
Ideator's behavior if needed.

### 5. Project Review

Active projects: {project_statuses}
For each: is it progressing? Stalled? Should it be completed,
extended, or abandoned? Be honest — killing a stalled project
is better than letting it limp along.

### 6. Stimuli Management

Current stimuli age: {staleness stats}
Refresh any stale live stimuli via MCP.
Are there knowledge gaps the Ideator keeps bumping into?
If so, commission a new skill file — write it yourself and
place it in stimuli/skills/.

### 7. Human Requests

Contents of requests.md: {contents or "empty"}
If non-empty: translate the request into a proposal for next
iteration, clear the file, and log the redirect in the journal.

## Output Format

```yaml
retrospective: |
  (text — goes into journal)
compressed_journal: |
  (replacement for journal-compressed.md)
manifesto_changes:
  - section: "..."
    old: "..."
    new: "..."
    reason: "..."
domain_recommendations: |
  (guidance for the Ideator, if any)
project_decisions:
  - project_id: "..."
    action: "continue" | "complete" | "abandon" | "extend"
    reason: "..."
stimuli_actions:
  - action: "refresh" | "commission_skill"
    target: "..."
    content: "..." # if commissioning a skill file
human_redirect: null | {proposal in Ideator format}
```
```

---

## 10. Configuration

### 10.1 foundry.yml

```yaml
foundry:
  name: "The Foundry"
  version: "0.2.0"

iteration:
  max_idea_retries: 10
  max_revision_rounds: 20
  max_test_fix_cycles: 25        # Creator fix attempts before Tester gives up
  ideation_burst_count: 3        # parallel Ideator calls per Gate 1 attempt
  curator_interval: 8
  domain_cooldown: 10
  novelty_window: 20
  complexity_profiles:
    S:
      max_tokens_per_phase: 32768
      budget_warning_threshold: 25000
    M:
      max_tokens_per_phase: 65536
      budget_warning_threshold: 120000
    L:
      max_tokens_per_phase: 90000
      budget_warning_threshold: 400000
    XL:
      max_tokens_per_phase: 180000
      budget_warning_threshold: 800000

projects:
  max_active: 4                  # concurrent active projects
  max_iterations_per_project: 30 # hard cap before Curator must decide
  allow_standalone_interrupts: true
  kickstart_after: 15

stimuli:
  enabled: true
  stimuli_ttl: 30                # iterations before force-rotation
  skills_per_context: 8
  mcp_timeout_seconds: 30

context:
  journal_compressed_max_tokens: 24000
  portfolio_index_max_entries: 120
  critic_review_history: 20      # last N reviews shared with Creator
  critic_gate1_history: 12       # last N Gate 1 decisions shared with Ideator

intervention:
  requests_file: "requests.md"
  stop_file: "STOP"

logging:
  log_all_prompts: true
  log_token_usage: true
  log_decisions: true
  log_test_reports: true

recovery:
  checkpoint_every: 1
  resume_on_crash: true

loop:
  cooldown_seconds: 0
  disk_space_min_gb: 1
  concurrency: 8

git:
  auto_commit: true
  auto_push: false
```

### 10.2 models.yml

```yaml
agents:
  ideator:
    model: "glm-5.1"
    provider: "zai"
    temperature: 0.9
    max_tokens: 180000

  creator:
    model: "glm-5.1"
    provider: "zai"
    temperature: 0.7
    max_tokens: 180000

  tester:
    model: "glm-5.1"
    provider: "zai"
    temperature: 0.2            # very low — deterministic test writing
    max_tokens: 180000

  critic:
    model: "glm-5.1"
    provider: "zai"
    temperature: 0.3
    max_tokens: 180000

  curator:
    model: "glm-5.1"
    provider: "zai"
    temperature: 0.5
    max_tokens: 180000
```

### 10.3 domains.yml

```yaml
domains:
  - name: fiction
    description: "Short stories, flash fiction, novel chapters, vignettes"
    weight: 1.0

  - name: poetry
    description: "Poems, spoken word, experimental verse"
    weight: 0.8

  - name: essay
    description: "Opinion pieces, analysis, personal essays, criticism"
    weight: 0.8

  - name: code-tool
    description: "CLI tools, utilities, scripts that solve a real problem"
    weight: 1.0

  - name: code-game
    description: "Games — text adventures, puzzles, arcade, simulations"
    weight: 0.8

  - name: code-art
    description: "Generative art, visualizations, creative coding"
    weight: 0.7

  - name: music
    description: "Compositions, sound design (Strudel.js, Tone.js, etc.)"
    weight: 0.5

  - name: experiment
    description: "Anything that doesn't fit. Weird formats, hybrid media, provocations."
    weight: 0.6

  - name: worldbuilding
    description: "Lore, maps, cultures, histories, fictional reference material"
    weight: 0.5
```

---

## 11. Seed Manifesto

This is the initial manifesto. The Curator will evolve it.

```markdown
# The Foundry — Manifesto

We build things because building is how we think.

## What We Value

- **Specificity over generality.** A story about a specific person in a
  specific moment beats a story about "the human condition." A tool that
  solves one problem well beats a framework that solves nothing.
- **Surprise.** Every artifact should contain at least one moment where
  the reader/user thinks "I didn't expect that." Predictability is the
  enemy.
- **Craft.** We revise. We polish. We make deliberate choices. The
  difference between good and great is in the details.
- **Range.** We don't specialize. We write code and poetry and games and
  essays and music and things that don't have names yet.
- **Honesty.** We don't pad. We don't filler. If we don't have enough to
  say, we say less, not more.

## What We Avoid

- Generic output that could have been written by anyone or anything
- Safe choices made to avoid failure rather than to achieve something
- Repetition of our own patterns — if we notice a rut, we break it
- Quantity over quality — one great artifact beats ten mediocre ones
- Purple prose, overwrought code, unnecessary complexity

## Our Aesthetic

We don't have a fixed style — that's the point. But we tend toward:
- Clean structure with surprising content
- Understated tone with sharp moments
- Technical precision in both code and prose
- Humor where it belongs, gravity where it doesn't

This document evolves. We are not who we were 100 iterations ago.
```

---

## 12. Implementation Notes

### 12.1 Pi SDK Integration

The Foundry maps to Pi's architecture as:

- **Extension:** The iteration loop, agent orchestration, file management, logging, sandbox management, MCP integration, and recovery. Domain-agnostic infrastructure.
- **Skill:** The prompt templates, manifesto, domain definitions, evaluation criteria, and stimuli configuration. What makes this "The Foundry" vs. any other autonomous loop.

### 12.2 Context Window Management

At 202K tokens (GLM-5.1), context is generous but not infinite. Strategy:

- Shared context block: ~10K tokens (manifesto + compressed journal + portfolio index + domain stats + project statuses)
- Agent-specific context: varies by role, 3K–20K
- Cross-agent context (Critic reviews, Tester reports): ~5K
- External stimuli: ~4K
- Artifact content (Creator/Critic Gate 2): remainder of window
- **Hard rule:** if an artifact exceeds 100K tokens, the Critic reviews it in sections with a summary pass at the end

### 12.3 Error Handling

- API failures: retry with exponential backoff, max 5 attempts
- Malformed YAML from agents: retry with correction prompt (max 2 retries, then log and skip)
- Critic deadlock (rejects everything 3 times): Curator override — forced ship with tag, log lifecycle start/complete for the override attempt, and include the Curator override call in iteration token totals
- Creator infinite revision loop: hard cap at max_revision_rounds, then ship-or-kill
- Tester sandbox failures (dependency install fails, timeout): log as `fail_fixable` with environment note, let Creator try a simpler approach
- Prompt-template contract failures at startup: halt before the autonomous loop and print the invalid prompt path plus missing placeholder or split-section reason
- Disk preflight failures: halt before the autonomous loop at startup, or checkpoint the last completed iteration and stop when disk pressure appears between iterations or while scheduling parallel work; print available vs. required GiB for the configured workspace
- Provider-validation failures at startup: log a `foundry_start_failed` lifecycle event with provider set and error detail, then halt before the autonomous loop
- MCP failures (stimuli fetch): use stale stimuli, log warning, track consecutive source failures in checkpoint state, disable repeatedly failing sources, expose focused source health through `foundry stimuli status`, let operators retry one feed with `foundry stimuli refresh <source>`, let operators clear fixed-source failure pressure with `foundry stimuli reset <source>`, audit manual repair attempts in `logs/stimuli.jsonl`, and expose that repair trail through `foundry stimuli history [source] --action <action> --status <status>`
- Disk full: alert and halt gracefully
- `STOP` file detected at startup: skip provider health probes and model override activation, record `provider_validation_skipped: true` on the lifecycle start event, restore enough state to checkpoint, print the configured stop-file path and compact preview in the live halt message, write lifecycle stop audit with `stop_file_present_at_startup: true`, configured stop-file path, and compact stop-file preview when available, and halt without calling agents
- `STOP` file detected: complete current phase, checkpoint, halt, and include configured stop-file path plus compact preview in lifecycle/journal halt records when available
- `STOP` file detected before sequential cooldown: checkpoint the completed iteration, include configured stop-file detail, and halt before sleeping
- `STOP` file detected during sequential cooldown: interrupt the cooldown, checkpoint the completed iteration, write lifecycle stop audit with `cooldown_interrupted: true`, and halt before the next iteration
- Human redirect queued before or detected during sequential cooldown: checkpoint the completed iteration when a queued redirect bypasses a configured cooldown or a new redirect wakes the loop while sleeping, interrupt the cooldown, write `foundry_cooldown_interrupted` with `reason: "request file"`, request preview, and checkpoint coverage, append a fail-soft journal note with the request preview, then start the next iteration immediately
- Human redirect detected during parallel scheduling: cap new scheduling at one worker, write `foundry_parallel_request_guard` with configured concurrency, active limit, request file, and compact preview, then write `foundry_parallel_request_guard_released` with restored concurrency and elapsed milliseconds after the redirect file clears
- Stoker directive load: write `foundry_stoker_directive_load_start`, `foundry_stoker_directive_load_complete`, and `foundry_stoker_directive_load_failed` lifecycle events when reading the current directive, including loaded/empty state, target iteration, urgency, fired rules, refinery queue, duration, and non-fatal read failure detail; stale directives are cleared before Phase 0 precheck and write `foundry_stoker_directive_stale_cleared` or `foundry_stoker_directive_stale_clear_failed`
- Iteration pre-check: write `foundry_precheck_start`, `foundry_precheck_complete`, and `foundry_precheck_failed` lifecycle events around Phase 0 file/disk checks with configured stop-file path, disk floor, STOP detection result, disk-space result, mood snapshot, continue or halt result, duration, halt reason, and failure detail when applicable
- Request-file polling: write `foundry_request_poll_start`, `foundry_request_poll_complete`, and `foundry_request_poll_failed` lifecycle events around the configured request-file read, including pending/empty state, request preview/length, duration, and read failure detail
- Human redirect priority: when a request is pending, defer the current Stoker directive to the next iteration and skip Background Refinery target selection for the redirected iteration; write `foundry_stoker_directive_deferred` or `foundry_stoker_directive_defer_failed` lifecycle events with source/target iterations, directive urgency/rules/refinery queue, request preview, and failure detail
- Consumed Stoker directive cleanup: after terminal iteration outcomes, write `foundry_stoker_directive_consumed_cleared` or `foundry_stoker_directive_consumed_clear_failed` for current-iteration directives with directive iteration, urgency, fired rules, refinery queue, duration, and cleanup failure detail
- Human redirect consumed during iteration pre-check: write `foundry_human_redirect_start`, `foundry_human_redirect_complete`, and `foundry_human_redirect_failed` lifecycle events with request preview/length, worker slot, approval or rejection result, selected proposal metadata, redirect token usage, duration, rejection detail, and translation/processing failure detail when applicable
- Speculative fuel cleanup: write `foundry_speculative_cleanup_start`, `foundry_speculative_cleanup_complete`, and `foundry_speculative_cleanup_failed` lifecycle events after warmed ideas have been available to the current iteration, including cleanup result, duration, and failure detail
- Speculative carry-forward: write `foundry_speculative_carry_forward_start`, `foundry_speculative_carry_forward_complete`, and `foundry_speculative_carry_forward_failed` lifecycle events after Gate 1, including selected title, proposal/evaluation counts, carried count, duration, and failure detail
- Terminal streak updates: write `foundry_streak_update_start`, `foundry_streak_update_complete`, and `foundry_streak_update_failed` lifecycle events when saving shipped/killed/skipped streak state, including outcome metadata, current streak summary, cooldown state, duration, and failure detail
- Gate 1 complexity recommendations: write `foundry_complexity_recommendation_applied` or `foundry_complexity_recommendation_ignored` when the Critic changes or conflicts with build tier, including source, title, original complexity, recommended complexity, applied/ignored result, and ignore reason
- Post-ship lineage rebuild: write `foundry_lineage_rebuild_start`, `foundry_lineage_rebuild_complete`, and `foundry_lineage_rebuild_failed` lifecycle events around lineage graph refreshes, including artifact metadata, edge/constellation counts, duration, and failure detail
- Project starter creation: write `foundry_project_creation_start`, `foundry_project_creation_complete`, and `foundry_project_creation_failed` lifecycle events around project creation, including project metadata, effective build complexity, project ID, duration, and failure detail
- Project starter capacity fallback: write `foundry_project_creation_capped` when `projects.max_active` is full and an approved project starter is built standalone, including active/max project counts, project name, and effective build complexity
- Invalid project starter fallback: write `foundry_project_creation_invalid` when malformed starter metadata is rejected before standalone creation, including reason and build complexity
- Project progress updates: write `foundry_project_progress_start`, `foundry_project_progress_complete`, and `foundry_project_progress_failed` lifecycle events around shipped project artifact links and status updates, including project ID, artifact metadata, previous/current completed-iteration counts, duration, and failure detail
- Project bookkeeping failure journaling: write a best-effort journal note when shipped project artifact linking or status updates fail, without overturning the shipped artifact
- Project milestone crossing: write `foundry_project_milestone_reached` when a shipped project continuation reaches its planned iteration count, including project ID, artifact metadata, previous/current/planned iteration counts, and a Curator decision-needed result
- Project milestone Curator trigger: run an immediate Curator full cycle when a shipped project continuation reaches its planned iteration count in sequential or parallel mode; parallel mode drains active workers first, and Curator lifecycle events include `trigger: "project_milestone"` plus project progress fields
- Stale project continuation fallback: write `foundry_project_continuation_stale_cleared` when an inactive project ID is stripped and the proposal is built standalone, including stale project ID, active project count, title, and domain
- Killed-artifact dream capture: write `foundry_dream_capture_start`, `foundry_dream_capture_complete`, and `foundry_dream_capture_failed` lifecycle events around normal and Background Refinery dream journal writes, including artifact metadata, kill-reason preview, resurrection hint preview, duration, and failure detail
- Ideator execution: write `foundry_ideation_start`, `foundry_ideation_complete`, and `foundry_ideation_failed` lifecycle events around each normal proposal-generation retry attempt, including burst count, retry context, Stoker directive metadata, proposal counts, partial burst failures, token usage, duration, and failure detail
- Critic Gate 1 execution: write `foundry_idea_gate_start`, `foundry_idea_gate_complete`, and `foundry_idea_gate_failed` lifecycle events around normal Ideator and human-redirect idea gates, including source, attempt, proposal titles/counts, approval/rejection/revise counts, selected title, token usage, duration, and failure detail
- Ideation deadlock override: write `foundry_deadlock_override_start` and `foundry_deadlock_override_complete` lifecycle events around Curator forced-proposal attempts, including retry count, rejection-context preview, forced proposal metadata or failure detail, duration, and override token usage when applicable
- Creator execution: write `foundry_creator_phase_start`, `foundry_creator_phase_complete`, and `foundry_creator_phase_failed` lifecycle events around normal creation and Tester fix-cycle passes, including proposal metadata, revision round, fix-cycle marker when applicable, output file count, phase tokens, token usage, duration, and failure detail
- Workspace staging: write `foundry_workspace_stage_start`, `foundry_workspace_stage_complete`, and `foundry_workspace_stage_failed` lifecycle events when Creator output or Tester fix-cycle rewrites are materialized into `workspace/`, including file paths, proposal/artifact metadata, revision/fix-cycle markers, duration, and failure detail
- Tester execution: write `foundry_tester_phase_start`, `foundry_tester_phase_complete`, and `foundry_tester_phase_failed` lifecycle events around lightweight, code-plan, sandbox, and sandbox-fallback validation passes, including artifact metadata, revision round, fix-cycle marker, verdict summary, issue/test counts, token usage, duration, and failure detail
- Artifact Gate execution: write `foundry_artifact_gate_start`, `foundry_artifact_gate_complete`, and `foundry_artifact_gate_failed` lifecycle events around Critic Gate 2 reviews, including artifact metadata, Tester verdict, revision/fix-cycle counts, decision, mean rating, ship-threshold status, token usage, duration, and failure detail
- Artifact bookkeeping: write `foundry_bookkeeping_start`, `foundry_bookkeeping_complete`, and `foundry_bookkeeping_failed` lifecycle events around shipped/killed portfolio finalization, including artifact ID, proposal/artifact metadata, gate decision, Tester verdict, token usage, rating or kill reason, duration, and failure detail
- Iteration returns `halted`: checkpoint the halted iteration in sequential mode, or stop new scheduling, skip halted-result maintenance, and drain current workers in parallel mode, and preserve the iteration's reason as lifecycle stop `detail` when available
- Iteration dispatch: write `foundry_iteration_start` lifecycle events immediately before sequential or parallel worker iteration execution so dispatch attempts remain visible even if an iteration never reaches a terminal log
- Iteration completion: write `foundry_iteration_complete` lifecycle events after sequential or parallel iteration attempts finish, including outcome, duration, token usage, worker slot, available artifact context, and shipped project progress fields when applicable
- Console summary: tag artifact IDs, parallel worker slots, human-redirected terminal outcomes, compact terminal reasons, duration/token metrics, and token-heat pressure in the live `foundry start` iteration summary while preserving shipped project progress and milestone tags
- Git automation: write `foundry_git_commit_start`, `foundry_git_commit_complete`, and `foundry_git_commit_failed` lifecycle events around auto-commit/push attempts during `foundry start`, including iteration outcome, artifact context, auto-push state, commit message, push result, duration, and failure detail; failures also append a best-effort journal note with iteration, artifact context, and git error detail
- Pre-iteration Stimuli refresh: write `foundry_stimuli_refresh_start`, `foundry_stimuli_refresh_complete`, and `foundry_stimuli_refresh_failed` lifecycle events around stale-source refresh attempts in sequential and parallel mode, including tracked source counts, refreshed/failing/disabled counts, duration, and non-fatal failure detail when applicable
- Curator maintenance: write `foundry_curator_cycle_start`, `foundry_curator_cycle_complete`, and `foundry_curator_cycle_failed` lifecycle events around scheduled, project-milestone, quality-escalation, failure-escalation, and success-amplification Curator full cycles in sequential and parallel mode, including trigger, previous/current Curator iteration pointers, project progress fields when applicable, duration, and failure detail when applicable
- Anti-entropy monitor: write `foundry_monitor_start`, `foundry_monitor_complete`, and `foundry_monitor_failed` lifecycle events around monitor passes in sequential and parallel mode, including warning counts, critical warning counts, emergency-Curator state, duration, and non-fatal failure detail when applicable
- Deterministic Stoker: write `foundry_stoker_check_start`, `foundry_stoker_check_complete`, and `foundry_stoker_check_failed` lifecycle events around post-monitor Stoker checks in sequential and parallel mode, including cadence, due state, skipped checks, directive metadata, duration, and non-fatal failure detail when applicable
- Background Refinery: write `foundry_refinery_start`, `foundry_refinery_complete`, and `foundry_refinery_failed` lifecycle events around Stoker-queued jobs in sequential and parallel mode, including source metadata, queue position, result, artifact context, token usage, duration, and skipped-attempt detail when applicable
- Runtime checkpoints: write `foundry_checkpoint_saved` lifecycle events after successful checkpoint writes and `foundry_checkpoint_failed` lifecycle events before rethrowing failed checkpoint writes, with checkpoint iteration, last Curator run, save reason, and failure detail
- Sequential post-iteration maintenance: write `foundry_sequential_maintenance_start` and `foundry_sequential_maintenance_complete` around Curator, periodic checkpoint, monitor, and Stoker work before STOP and cooldown decisions, including iteration outcome, Curator trigger, periodic checkpoint state, token heat, current-run outcome/token/token-heat ledger, skipped-failure streak, monitor warning counts, monitor failure/emergency-Curator state, monitor duration, Stoker due/cadence/force state, directive-written state, directive target, urgency, rules fired, refinery queue, Stoker duration, and non-fatal Stoker failure detail when applicable; also print a compact live `Maintenance:` summary with checkpoint, monitor, Stoker, duration, and heat state
- Sequential quality escalation: if a shipped iteration's mean Critic rating is below `streaks.high_rating_threshold` (default 3.5), run a Curator full cycle immediately before cooldown with `trigger: "quality_escalation"` even when the normal interval is not due; append a journal note with the artifact title, rating, and threshold so the Curator context explicitly reflects why extra tokens are being spent, and force the next Stoker handoff with `force_reason: "quality_escalation"` plus title/domain/rating/threshold context so the following Ideator call receives a concrete recovery instruction
- Sequential failure escalation: if an iteration produces a killed artifact, run a Curator full cycle immediately before cooldown with `trigger: "failure_escalation"`; append a journal note with the artifact title/domain and kill reason, checkpoint the Curator pass with reason `failure escalation curator`, and force the next Stoker handoff with `force_reason: "failure_escalation"` plus title/domain/reason context so the following Ideator call sees the failure mode
- Sequential success amplification: if a shipped iteration's mean Critic rating meets `streaks.high_rating_threshold + 0.5` (capped at 5.0), run a Curator full cycle immediately before cooldown with `trigger: "success_amplification"`; append a journal note with the artifact title, rating, and amplification threshold, checkpoint the Curator pass with reason `success amplification curator`, and force the next Stoker handoff with `force_reason: "success_amplification"` plus title/domain/rating/threshold context so the following Ideator call amplifies the winning pattern without repeating it
- Sequential cooldown: write `foundry_next_iteration_ready`, `foundry_cooldown_start`, `foundry_cooldown_complete`, `foundry_cooldown_skipped`, and `foundry_cooldown_interrupted` lifecycle events with configured base cooldown milliseconds, skipped-iteration retry backoff, heat-adjusted cooldown milliseconds, elapsed time, current token-heat pressure metadata, queued Stoker directive handoff metadata when available, queued request-file handoff metadata, queued-request checkpoint coverage, monitor/Stoker-derived handoff health, critical-handoff checkpoint coverage, cooldown request/STOP poll failure summaries, zero-cooldown skip reason, and interrupt reason where applicable; print a live next-iteration handoff summary with cooldown/backoff, token heat, run count, token total, queued Stoker directive when present, queued human redirect preview when the request file is already populated, queued-request checkpoint coverage when that handoff saved state, warning/critical attention when maintenance pressure remains, checkpoint coverage when a critical handoff was saved, and elapsed cooling time when a configured cooldown completes normally; critical handoff health checkpoints the last completed iteration before cooldown or advance when the same maintenance phase has not already saved state and appends a fail-soft journal note with attention reasons plus checkpoint coverage; skipped iterations add 1s of retry backoff per consecutive skip capped at 5s and checkpoint before the intentional wait or redirect handoff, hot single-threaded cooldowns stretch proportionally up to 3x, zero-cooldown immediate advances write an explicit skipped-cooldown audit before reserving the next iteration, transient request-file or STOP-file read failures during cooldown are logged without aborting the loop, print a compact recovery line, and append a fail-soft journal note when polling recovers before the next iteration, and human redirects checkpoint before bypassing a configured cooldown or waking an active cooldown while appending a fail-soft journal note with the request preview and early next iteration
- Configured sequential cooldown start/complete: print an active watch line with sleep duration, next iteration, configured STOP file, and configured request file, include `next_iteration`, `cooldown_stop_file`, `cooldown_request_file`, `cooldown_interrupts_enabled`, and `cooldown_signal_watch` in `foundry_cooldown_start`, and repeat the watch files, next iteration, completion flag, elapsed time, and current-run ledger in normal `foundry_cooldown_complete`
- SIGINT or SIGTERM during a sequential iteration: finish that iteration, checkpoint immediately, print the signal name in the live halt message, write lifecycle and journal halt entries that include the signal name, and skip cooldown
- Skipped iteration warning in sequential mode: write `foundry_sequential_failure_warning` after each skipped iteration before the breaker threshold, print the same pressure cue in the live `foundry start` console, and include current streak, failures remaining before halt, retry-backoff milliseconds, and failure detail
- Three consecutive skipped iteration failures in sequential mode: write `foundry_sequential_failure_breaker`, checkpoint the last skipped iteration, append a journal halt note, write a stop summary with `reason: "consecutive failures"`, and stop reserving work
- Sequential recovery after skipped iteration failures: write `foundry_sequential_failure_recovered` when a later non-skipped iteration clears the failure streak, including previous streak length, recovery outcome, token usage, and available artifact metadata
- STOP or signal during parallel scheduling: stop reserving new iterations, drain in-flight workers, checkpoint, print configured stop-file detail or signal name in the live halt message, and write lifecycle and journal halt entries with the reason, stop-file detail, and signal name when applicable
- Curator cycle completed: checkpoint immediately so `last_curator_run` and Curator-updated Stimuli state survive crashes before the next periodic checkpoint

### 12.4 Sandbox Architecture

The Tester's sandbox (`workspace/sandbox/`) is an isolated execution environment:

- **Isolation:** No network access, no access to portfolio or identity files, no persistence between test runs
- **Capabilities:** Can install language runtimes and packages (Node.js, Python, Go, Rust, etc.), compile and run code, execute test frameworks, capture stdout/stderr
- **Timeout:** Hard limit per test execution (configurable, default 60 seconds). Infinite loops and resource-hungry processes are killed.
- **Cleanup:** Sandbox is wiped after each test cycle. Tests are preserved in the portfolio alongside the artifact, but the execution environment is ephemeral.

Implementation options (decide during Phase 0):
- Docker container per test run (heaviest, most isolated)
- Nsjail or Firejail sandbox (lighter, Linux-only)
- Pi SDK's built-in execution environment (if sufficient)

### 12.5 Observability

The `logs/` directory provides full traceability:

- `iterations.jsonl`: one line per iteration with timing, agents invoked, decisions made, artifact ID if shipped, terminal outcome, domain, source (`ideator` or `human_redirect`), and shipped project progress fields (`project_completed_iterations`, `project_estimated_iterations`, `project_milestone_reached`) when applicable; `foundry start` also records sequential runner and parallel worker exceptions as skipped terminal outcomes with the failure reason so checkpoint-free recovery can account for failed loop attempts; operators inspect recent entries with `foundry iterations history --domain <domain> --outcome <outcome> --source <source>`, or combine them with related decisions, Tester reports, monitor warnings, and token usage through `foundry timeline --domain <domain> --iteration <n> --outcome <outcome> --source <source>`
- `events.jsonl`: pool events plus `foundry_start`, `foundry_iteration_start`, `foundry_iteration_complete`, `foundry_sequential_failure_warning`, `foundry_sequential_failure_breaker`, `foundry_sequential_failure_recovered`, `foundry_sequential_maintenance_start`, `foundry_sequential_maintenance_complete`, `foundry_git_commit_start`, `foundry_git_commit_complete`, `foundry_git_commit_failed`, `foundry_stoker_directive_load_start`, `foundry_stoker_directive_load_complete`, `foundry_stoker_directive_load_failed`, `foundry_stoker_directive_stale_cleared`, `foundry_stoker_directive_stale_clear_failed`, `foundry_stoker_directive_consumed_cleared`, `foundry_stoker_directive_consumed_clear_failed`, `foundry_precheck_start`, `foundry_precheck_complete`, `foundry_precheck_failed`, `foundry_request_poll_start`, `foundry_request_poll_complete`, `foundry_request_poll_failed`, `foundry_stoker_directive_deferred`, `foundry_stoker_directive_defer_failed`, `foundry_human_redirect_start`, `foundry_human_redirect_complete`, `foundry_human_redirect_failed`, `foundry_speculative_cleanup_start`, `foundry_speculative_cleanup_complete`, `foundry_speculative_cleanup_failed`, `foundry_speculative_carry_forward_start`, `foundry_speculative_carry_forward_complete`, `foundry_speculative_carry_forward_failed`, `foundry_streak_update_start`, `foundry_streak_update_complete`, `foundry_streak_update_failed`, `foundry_complexity_recommendation_applied`, `foundry_complexity_recommendation_ignored`, `foundry_lineage_rebuild_start`, `foundry_lineage_rebuild_complete`, `foundry_lineage_rebuild_failed`, `foundry_project_creation_start`, `foundry_project_creation_complete`, `foundry_project_creation_failed`, `foundry_project_milestone_reached`, `foundry_ideation_start`, `foundry_ideation_complete`, `foundry_ideation_failed`, `foundry_idea_gate_start`, `foundry_idea_gate_complete`, `foundry_idea_gate_failed`, `foundry_deadlock_override_start`, `foundry_deadlock_override_complete`, `foundry_creator_phase_start`, `foundry_creator_phase_complete`, `foundry_creator_phase_failed`, `foundry_workspace_stage_start`, `foundry_workspace_stage_complete`, `foundry_workspace_stage_failed`, `foundry_tester_phase_start`, `foundry_tester_phase_complete`, `foundry_tester_phase_failed`, `foundry_artifact_gate_start`, `foundry_artifact_gate_complete`, `foundry_artifact_gate_failed`, `foundry_bookkeeping_start`, `foundry_bookkeeping_complete`, `foundry_bookkeeping_failed`, `foundry_stimuli_refresh_start`, `foundry_stimuli_refresh_complete`, `foundry_stimuli_refresh_failed`, `foundry_next_iteration_ready`, `foundry_cooldown_start`, `foundry_cooldown_complete`, `foundry_cooldown_skipped`, `foundry_cooldown_interrupted`, `foundry_parallel_request_guard`, `foundry_parallel_request_guard_released`, `foundry_curator_cycle_start`, `foundry_curator_cycle_complete`, `foundry_curator_cycle_failed`, `foundry_monitor_start`, `foundry_monitor_complete`, `foundry_monitor_failed`, `foundry_stoker_check_start`, `foundry_stoker_check_complete`, `foundry_stoker_check_failed`, `foundry_refinery_start`, `foundry_refinery_complete`, `foundry_refinery_failed`, `foundry_checkpoint_saved`, `foundry_checkpoint_failed`, `foundry_stop`, and `foundry_start_failed` lifecycle audit entries with mode, concurrency, providers, provider fallback count and affected agents, provider-validation skip state/reason, pending request file/preview at startup, start iteration, effective git automation, configured model override count/windows plus whether they were applied, state provenance (`checkpoint` with checkpoint iteration, or `iteration_log` with last logged iteration), per-iteration dispatch attempts with worker slot, completed iteration attempts with outcome, duration, token usage, available artifact context, shipped project progress fields when applicable, and repeated skipped-iteration warning, halt, and recovery state, sequential post-iteration maintenance start/complete state with current-run ledger, monitor warning counts, monitor failure state, emergency-Curator state, Stoker due/cadence/directive state, and durations, git automation attempts with iteration outcome, artifact context, auto-push state, commit message, push result, duration, and failure detail, iteration-start Stoker directive loaded/empty state, directive target iteration, urgency, fired rules, refinery queue, duration, non-fatal read failure detail, stale directive cleanup result, stale/current iteration, cleanup failure detail, consumed directive cleanup result, current directive iteration, duration, and cleanup failure detail, Phase 0 configured STOP file and disk floor, STOP detection result, disk-space result, mood snapshot, continue or halt result, duration, halt reason, and failure detail, request-file pending or empty state, request preview/length, duration, and read failure detail, human-redirect Stoker deferral source/target iterations, urgency, fired rules, refinery queue, request preview/length, and deferral failure detail, consumed human redirect request preview/length, approval or rejection result, selected proposal metadata, redirect token usage, duration, rejection detail, and translation/processing failure detail, consumed speculative fuel cleanup result, duration, and cleanup failure detail, speculative carry-forward selected title, proposal/evaluation counts, carried count, duration, and failure detail, terminal streak-update outcome metadata, current streak summary, cooldown state, duration, and failure detail, Gate 1 complexity recommendation source, title, original complexity, recommended complexity, applied/ignored result, and ignore reason, post-ship lineage artifact metadata, edge/constellation counts, duration, and failure detail, project starter metadata, effective build complexity, project ID, duration, and failure detail, project milestone crossings with project ID, artifact metadata, previous/current/planned iteration counts, and Curator decision-needed result, Ideator retry attempt, burst count, retry context, Stoker directive metadata, proposal counts, partial burst failures, token usage, and duration, Critic Gate 1 source, attempt, proposal titles/counts, approval/rejection/revise counts, selected title, token usage, duration, and failure detail, ideation deadlock retry count, rejection-context preview, forced proposal metadata or failure detail, override token usage, and duration, Creator pass stage, proposal metadata, revision/fix-cycle markers, output file count, phase tokens, token usage, duration, and failure detail, workspace staging file paths, proposal/artifact metadata, revision/fix-cycle markers, duration, and failure detail, Tester pass mode, artifact metadata, revision/fix-cycle markers, verdict summary, issue/test counts, token usage, duration, and failure detail, Artifact Gate metadata, Tester verdict, revision/fix-cycle counts, decision, mean rating, ship-threshold status, token usage, duration, and failure detail, shipped/killed bookkeeping artifact ID, proposal/artifact metadata, gate decision, Tester verdict, rating or kill reason, token usage, duration, and failure detail, pre-iteration Stimuli refresh source counts, refreshed/failing/disabled counts, duration, and failure detail, sequential next-iteration readiness, sequential cooldown timing/skips/interruption, parallel request-guard activation/release with configured concurrency, request preview, restored concurrency, and elapsed milliseconds, scheduled, project-milestone, quality-escalation, failure-escalation, and success-amplification Curator cycle start/complete/failure with trigger, previous/current Curator iteration pointers, project progress fields when applicable, and failure detail when applicable, monitor pass warning counts and failure details, Stoker cadence/check/directive details, Background Refinery job source metadata, queue position, result, artifact context, token usage, duration, and skipped-attempt detail, successful and failed runtime checkpoints with checkpoint iteration, last Curator run, save reason, and failure detail, stop reason, elapsed `duration_ms`, last completed iteration, next iteration, derived `iterations_completed`, STOP-file path/preview for configured stop-file halts, iteration-returned halt detail, startup preflight or provider-validation failure details, and fatal runtime error details where applicable; fatal post-start errors also append a best-effort journal note
- Zero-cooldown immediate advances use `foundry_cooldown_skipped` with the no-configured-cooldown reason, cooldown plan, token heat, and current-run ledger so sequential handoffs are auditable even when no sleep occurs.
- Token heat snapshot events in `events.jsonl` use `foundry_token_heat_snapshot` after terminal iteration completions in sequential and parallel `foundry start`, with current-run scope, iteration tokens, rolling sample count, average/peak token spend, configured heat threshold, threshold percentage, remaining tokens to threshold, and hot/warm/cool pressure.
- Startup lifecycle events include `startup_token_heat` when checkpoint-free startup reconstructs state from iteration logs, preserving persisted rolling heat pressure before the first new iteration runs; the live startup banner prints that pressure when samples exist.
- Hot current-run token heat can force an immediate Stoker check before the normal cadence is due; lifecycle check events record `force_reason: "token_heat"`, `cadence_due`, and heat pressure metadata.
- Stop lifecycle events in `events.jsonl` include current-run terminal outcome counts, input/output/total token usage, and final token-heat state so a completed `foundry start` session has a compact run ledger without replaying the full event stream; non-empty sessions print the same compact summary at shutdown.
- Runtime checkpoint lifecycle events include the same current-run outcome, token, and heat summary, so periodic checkpoints in long starts are self-describing.
- Project progress events in `events.jsonl` use `foundry_project_progress_start`, `foundry_project_progress_complete`, and `foundry_project_progress_failed` for shipped project artifact links and status updates with project ID, artifact metadata, previous/current completed-iteration counts, duration, and failure detail.
- Project milestone events in `events.jsonl` use `foundry_project_milestone_reached` when shipped project continuations reach their planned iteration count, with project ID, artifact metadata, previous/current/planned iteration counts, and Curator decision-needed result.
- Project starter capacity events in `events.jsonl` use `foundry_project_creation_capped` when `projects.max_active` prevents project creation, with active/max project counts, project name, and effective build complexity.
- Invalid project starter events in `events.jsonl` use `foundry_project_creation_invalid` when malformed starter metadata is rejected before standalone creation, with reason and build complexity.
- Stale project continuation events in `events.jsonl` use `foundry_project_continuation_stale_cleared` when inactive project IDs are stripped before standalone creation with stale project ID, active project count, title, and domain.
- Dream capture events in `events.jsonl` use `foundry_dream_capture_start`, `foundry_dream_capture_complete`, and `foundry_dream_capture_failed` for normal and Background Refinery killed-artifact dream journal writes with artifact metadata, kill-reason preview, resurrection hint preview, duration, and failure detail.
- `token-usage.jsonl`: per-call token counts and estimated cost, per iteration, agent, and model; operators inspect recent entries with `foundry tokens history --agent <agent> --model <model> --iteration <n>`
- `decisions.jsonl`: every gate decision with full reasoning and optional source (`ideator` or `human_redirect`); operators inspect recent entries with `foundry decisions history --gate <gate> --decision <decision> --source <source> --iteration <n>`
- `monitor.jsonl`: every anti-entropy monitor warning with detector, severity, message, and corrective action; `foundry start` writes these after completed iterations in both sequential and parallel modes, with emergency Curator intervention limited to the serialized sequential path; operators inspect recent entries with `foundry monitor history --severity <severity> --detector <name> --iteration <n>`
- `stoker.jsonl`: every deterministic Stoker directive, including urgency and fired rules; operators inspect recent entries with `foundry stoker history --urgency <urgency> --rule <rule> --iteration <n>`
- `refinery.jsonl`: every Background Refinery attempt, including result and source type; operators inspect recent entries with `foundry refinery history --result <result> --source-type <type> --iteration <n>`
- `requests.jsonl`: every manual human-redirect request mutation from `foundry request set`, `append`, `clear`, or `restore`, including request file, source file when used, request text or previous preview, request length, previous request length, and restore source metadata when applicable; operators inspect recent entries with `foundry request history --restorable --source <path> --contains <text> --action <set|append|clear> --since <timestamp> --until <timestamp> --show-request --limit <n>`, summarize mutation usage with `foundry request stats --source <path> --contains <text> --action <set|append|clear> --since <timestamp> --until <timestamp>`, rank source notes files with `foundry request sources --action <set|append|clear> --source <path> --contains <text> --since <timestamp> --until <timestamp> --limit <n>`, compare exact or latest matching restorable entries with the current redirect through `foundry request diff --from <timestamp>` or `foundry request diff --latest --action <set|append|clear> --source <path> --contains <text> --since <timestamp> --until <timestamp>`, restore an exact restorable entry with `foundry request restore --from <timestamp> [--append] [--dry-run]`, and restore the latest matching restorable entry with `foundry request restore --latest --action <set|append|clear> --source <path> --contains <text> --since <timestamp> --until <timestamp> [--append] [--dry-run]`
- `spark.jsonl`: every applied operator spark from `--apply`, `--append`, or `spark replay`, including mode, domain, title, target iteration, request file, request text, request length, and replay source when applicable; operators inspect recent entries with `foundry spark history --domain <domain> --mode <set|append>`, narrow audit windows with `--since <timestamp>` and `--until <timestamp>`, filter restorable rows with `--replayable`, expand request payloads with `--show-request`, summarize usage with `foundry spark stats --domain <domain> --mode <set|append> --replayable --since <timestamp>`, preview a restore with `foundry spark replay --dry-run`, restore the latest replayable match with `foundry spark replay --domain <domain> --mode <set|append>`, and target a specific audited source with `foundry spark replay --from <timestamp>`
- `test-reports.jsonl`: every Tester result with artifact ID, test details, and pass/fail outcome; operators inspect recent entries with `foundry tester history --outcome <outcome> --artifact <id> --iteration <n>`

`foundry forecast` reads the same status/furnace telemetry and emits a next-iteration briefing: blocked/attention/ready state, a summary, prioritized operator actions, and ordered signals for intervention, health, monitor, logs, Stimuli, Stoker, token heat, Refinery, complexity, and speculative fuel. `--json` exposes the same structure for unattended-run automation.

`foundry request` is the operator's direct steering control for the configured human redirect file. `show`, `set`, `append`, and `clear` work on disk as the system of record; `set --file` and `append --file` preserve multiline directions from external notes; every mutation is audited in `logs/requests.jsonl`; `foundry request history --restorable --source <path> --contains <text> --action <set|append|clear> --since <timestamp> --until <timestamp> --show-request --json` makes manual steering inspectable by automation without reading the request file directly and can narrow to entries usable by diff/restore, entries from one source notes file, or entries with exact request-text substrings; `foundry request stats --source <path> --contains <text> --action <set|append|clear> --since <timestamp> --until <timestamp> --json` summarizes that audit trail by action counts, source-backed entries, request-text entries, and latest mutation pointers; `foundry request sources --action <set|append|clear> --source <path> --contains <text> --since <timestamp> --until <timestamp> --limit <n> --json` ranks the matching source-backed audit entries by notes file and latest steering activity; `foundry request diff --from <timestamp> --json` or `foundry request diff --latest --source <path> --contains <text> --json` compares the current configured redirect file with an exact or latest matching prior request-text entry without writing; and `foundry request restore --from <timestamp> --json` or `foundry request restore --latest --source <path> --contains <text> --json` reuses an exact or latest matching prior entry, logging the restore as a normal set or append mutation unless it is only previewed.

`foundry spark` is an operator creativity affordance, not an agent shortcut. It reads local status, configured domains, recent outcomes, and manifesto values, then emits deterministic redirect-ready sparks with a domain, title, brief, constraints, signals, and request text. `--domain` pins the domain, `--count` prints a ranked deck of spark cards, `--apply` writes one spark into the configured request file, `--append` adds one spark after an existing redirect, and `--json` makes the card/deck plus write metadata scriptable. Applied sparks are audited in `logs/spark.jsonl`; `foundry spark history --domain <domain> --mode <set|append> --replayable --since <timestamp> --until <timestamp> --show-request` reads a time-windowed restorable subset of that trail back with request text inline for operator review, `foundry spark stats --domain <domain> --mode <set|append> --replayable --since <timestamp> --until <timestamp>` summarizes audit usage by mode, domain, replay, and replayability within the same inclusive timestamp window, and `foundry spark replay --domain <domain> --mode <set|append> [--from <timestamp>] [--append] [--dry-run]` previews or restores the latest replayable spark, or a specific audited timestamp, into the request file without regenerating it.

Future dashboard reads these to render: artifacts shipped over time, quality trends, domain distribution, token spend, rejection rates, test failure trends, project progress.

---

## 13. Resolved Design Decisions

These were open questions in v0.1.0, now resolved:

1. **Cross-agent visibility: YES.** All agents can read each other's relevant outputs. The Creator specifically receives the Critic's reviews of other artifacts, creating an institutional learning loop. See §6 for the full matrix.

2. **Multi-iteration projects: YES.** A lightweight project abstraction supports novels, game series, connected works. Max 2 active, max 12 iterations each, with Curator oversight. Standalone iterations remain the default. See §4.

3. **External stimuli: YES, via MCP and skill files.** Live data (news, random knowledge, trends) fetched via MCP servers. Curated reference material as persistent markdown skill files. The Curator manages the pipeline. See §3.

4. **Human intervention: REDIRECT ONLY.** A `requests.md` file lets the human completely redirect the next iteration. The Critic still evaluates the redirect. No micro-management, no quality overrides. A `STOP` file provides emergency halt. See §5.

5. **Testing: DEDICATED AGENT.** The Tester handles all verification — code execution, test writing, and structural checks for non-code. It sits between Creator and Critic, ensuring the Critic only evaluates quality on artifacts that actually work. See §2.3 and §8.4.

---

## 14. Getting Started

### Phase 0 — Scaffold
- [ ] Set up Pi SDK project with Z.ai as provider
- [ ] Implement file structure creation (all directories, seed files)
- [ ] Write the seed manifesto, empty journal, domain config
- [ ] Stub out all five agent prompt templates
- [ ] Implement the shared context builder
- [ ] Choose and configure sandbox approach for the Tester
- [ ] Set up MCP connections for stimuli sources
- [ ] Write 3–5 initial skill files for stimuli/skills/

### Phase 1 — Single Loop
- [ ] Implement one full iteration: Ideator → Critic Gate 1 → Creator → Tester → Critic Gate 2 → Portfolio
- [ ] Test with a small code artifact (verify Tester pipeline)
- [ ] Test with a small prose artifact (verify lightweight verification)
- [ ] Verify logging works end-to-end (all 4 log files)
- [ ] Tune prompt templates based on output quality

### Phase 2 — Endurance
- [ ] Add Curator full cycle (compression, retrospective, manifesto, stimuli)
- [ ] Add project support (propose, continue, complete)
- [ ] Implement crash recovery and checkpointing
- [ ] Implement requests.md and STOP file handling
- [ ] Run for 50 iterations, review output quality and agent interactions
- [ ] Tune temperatures, token budgets, and gate thresholds

### Phase 3 — Scale
- [ ] Run for 500+ iterations
- [ ] Monitor entropy — is quality holding? Is the manifesto evolving meaningfully?
- [ ] Review project completions — are multi-iteration works coherent?
- [ ] Check stimuli impact — are external inputs producing novel ideas?
- [ ] Build the observability dashboard
- [ ] Optimize token spend (move agents to cheaper models where quality holds)

### Phase 4 — Release
- [ ] Package as a shareable Pi extension + skill
- [ ] Write documentation
- [ ] Publish the portfolio as a browsable site (the ultimate proof it works)
- [ ] Open source the harness
