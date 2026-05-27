# Contributing to The Foundry

Thanks for your interest in contributing. The Foundry is a multi-agent autonomous creative system — contributions that improve its creative output, reliability, or observability are especially welcome.

## Getting Started

1. Fork the repository and clone your fork
2. `pnpm install` (requires Node 22+)
3. Configure your model provider in `config/models.yml`
4. Run `pnpm dev` and inspect `logs/` to verify everything works

## Code Style

- TypeScript in strict mode — see `tsconfig.json`
- Explicit types on public APIs; inference is fine internally
- Agent prompt templates live in `prompts/` as markdown — not hardcoded strings
- YAML for all structured agent output

## Testing

The project uses [Vitest](https://vitest.dev/) with 600+ tests covering all modules.

```bash
pnpm test              # run full suite
pnpm test:watch        # watch mode
pnpm test:coverage     # with coverage report
```

When submitting changes:
- Run the full test suite and confirm everything passes
- Add tests for new functionality
- For prompt changes, also run 3–5 iterations and compare output quality

## Submitting Changes

1. Create a feature branch: `git checkout -b feat/your-change`
2. Make your changes with clear, atomic commits
3. Run `pnpm test` to verify nothing breaks
4. Open a PR with a description of what changed and why
5. If it's a prompt change, include before/after examples

## Where Contributions Are Welcome

- **New domains** — expand what The Foundry can create
- **Stimuli skill files** — new sources of external inspiration
- **Prompt improvements** — better agent instructions (include evidence)
- **Dashboard & site** — visualization, browsing, analytics
- **Documentation** — guides, examples, explanations

## Where to Be Careful

These are core quality mechanisms — changes here need extra scrutiny:

- **Iteration loop** (`src/`) — the orchestration engine
- **Context assembly** — what each agent sees affects everything
- **Critic evaluation** — the quality gate for the entire system

Changes to these areas should include detailed rationale and before/after comparison across multiple iterations.

## Code of Conduct

Be respectful. Give constructive feedback. Assume good intent. We're building something weird and interesting together — keep it fun.
