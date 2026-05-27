# Configuration

All configuration lives in `config/` (core settings) and `stimuli/stimuli.yml` (external input). Config is loaded once at startup — changes require a restart (except `requests.md` and `STOP`, which are checked every iteration).

## foundry.yml

The main configuration file. Organized into sections:

### `foundry`

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | string | `"The Foundry"` | System name. Used in logs and journal headers. |
| `version` | string | `"0.3.0"` | System version. Informational only. |

### `iteration`

Controls the per-iteration behavior. These are the most impactful tuning knobs.

| Option | Type | Default | Description |
|---|---|---|---|
| `max_idea_retries` | number | `10` | How many Ideator→Critic rounds before declaring a deadlock. Higher = more chances to find a good idea and more useful token burn on bad cycles. |
| `max_revision_rounds` | number | `20` | How many Creator→Critic Gate 2 revision loops. Furnace defaults favor repeated refinement over token conservation. |
| `max_test_fix_cycles` | number | `25` | How many Tester→Creator fix loops for code artifacts. High values let complex artifacts keep burning tokens until they are actually fixed. |
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

### `stimuli`

External input pipeline settings.

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

### `intervention`

| Option | Type | Default | Description |
|---|---|---|---|
| `requests_file` | string | `"requests.md"` | Path to the human redirect file. Checked every iteration. |
| `stop_file` | string | `"STOP"` | Path to the emergency halt file. Create to stop, delete to resume. |

### `logging`

| Option | Type | Default | Description |
|---|---|---|---|
| `log_all_prompts` | boolean | `true` | Log full prompts sent to models. Useful for debugging, costs disk space. |
| `log_token_usage` | boolean | `true` | Log per-call token counts. Essential for cost tracking. |
| `log_decisions` | boolean | `true` | Log all Critic gate decisions. Essential for understanding system behavior. |
| `log_test_reports` | boolean | `true` | Log all Tester verdicts. Useful for tracking code quality trends. |

### `recovery`

| Option | Type | Default | Description |
|---|---|---|---|
| `checkpoint_every` | number | `1` | Save checkpoint every N iterations. 1 = maximum crash safety. Increase only if disk I/O is a bottleneck. |
| `resume_on_crash` | boolean | `true` | Load checkpoint on startup and resume. Disable for a fresh start. |

### `loop`

| Option | Type | Default | Description |
|---|---|---|---|
| `cooldown_seconds` | number | `0` | Pause between iterations in sequential mode. Furnace mode defaults to no pause; increase if you're hitting rate limits. |
| `concurrency` | number | `8` | Number of parallel iterations in pool mode. This is the main token-throughput lever. |
| `disk_space_min_gb` | number | `1` | Minimum free disk space (GB) before halting. Safety net against filling the disk with artifacts. |

## models.yml

Model assignments per agent. Each agent gets a model ID, temperature, and max output tokens.

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

The harness logs when an override is active. Compare quality metrics (Critic ratings, ship rates) between the baseline and test windows.

## domains.yml

Defines the creative domains the system can work in.

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
| `name` | string | Domain identifier. Used in proposals, portfolio paths, and stats. Domains starting with `code-` are treated as code artifacts (sandbox-tested). |
| `description` | string | Human-readable description. Included in agent context to guide the Ideator. |
| `weight` | number | Relative weight (0.0–1.0). Influences domain selection — lower weight means the domain appears less often. |

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

MCP source configurations. Each key is a source name that maps to a file in `stimuli/live/`.

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
| `max_items` | number | Max results per query. |
| `refresh_interval` | number | Iterations between refreshes. Higher = less API usage but staler content. |

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

If a source fails 3 consecutive refreshes, it's auto-disabled until the next restart. This prevents a broken MCP server from blocking the iteration loop. State is tracked in `StimuliRefreshState` and checkpointed.
