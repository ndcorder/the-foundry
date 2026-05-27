# The Foundry

## What This Is

The Foundry is a multi-agent autonomous creative system built on the Pi SDK. It runs indefinitely, producing a growing portfolio of artifacts (code, prose, poetry, games, tools, music, experiments) across any domain it finds interesting. Five agents collaborate adversarially: Ideator, Creator, Tester, Critic, and Curator.

## Spec

The full specification is in `FOUNDRY-SPEC.md` at the project root. **Read it before making any architectural decisions.** It defines:

- Agent roles and prompt templates (§2, §9)
- External stimuli system via MCP and skill files (§3)
- Multi-iteration project abstraction (§4)
- Human intervention model (§5)
- Cross-agent context sharing matrix (§6)
- File structure (§7)
- Iteration cycle and flow (§8)
- Configuration schema (§10)
- Seed manifesto (§11)
- Implementation notes including sandbox architecture (§12)

## Tech Stack

- **Runtime:** Pi SDK (TypeScript)
- **Model Provider:** Z.ai GLM via OpenAI-compatible API
  - Endpoint: `https://api.z.ai/api/anthropic` (configured externally)
  - Models: GLM-5.1 (Creator, Tester, Critic), GLM-5.1 (Ideator, Curator)
- **MCP Servers:** tavily (news/cultural), context7 (knowledge) — for stimuli pipeline
- **Sandbox:** Docker or Firejail for Tester execution (decide during scaffold)
- **Config format:** YAML (foundry.yml, models.yml, domains.yml, stimuli.yml)
- **Logging:** JSONL (iterations, token-usage, decisions, test-reports)

## Architecture Principles

- The harness (extension) is domain-agnostic loop infrastructure. The skill is what makes it The Foundry.
- All agent communication goes through the harness — agents never call each other directly.
- YAML is the structured output format for all agent responses. The harness parses and validates.
- Context assembly is the harness's job. Each agent gets a tailored context window built from shared + role-specific sources per the matrix in §6.
- Files are the system of record. Portfolio, journal, manifesto — everything is on disk as markdown/YAML. No database.
- Crash recovery via Pi SDK checkpointing. State must be reconstructable from files.

## Code Style

- TypeScript, strict mode
- Prefer explicit types over inference for public APIs
- Error handling: fail-soft where possible, log and continue. Only halt on disk full or STOP file.
- Agent prompt templates live as markdown files in `prompts/`, loaded at runtime — not hardcoded strings.
- Config is loaded once at startup, not re-read per iteration (except requests.md and STOP).

## Development Phases

We're building in phases per §14 of the spec:

- **Phase 0 (current):** Scaffold — file structure, seed files, context builder, prompt stubs, sandbox choice
- **Phase 1:** Single loop — one full iteration end-to-end
- **Phase 2:** Endurance — Curator, projects, crash recovery, 50-iteration run
- **Phase 3:** Scale — 500+ iterations, dashboard, optimization
- **Phase 4:** Release — package, document, publish

Do not skip ahead. Each phase must work before starting the next.
