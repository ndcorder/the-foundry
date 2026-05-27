# Changelog

All notable changes to The Foundry are documented here.

This project follows [Semantic Versioning](https://semver.org/).

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

[1.1.0]: https://github.com/ndcorder/the-foundry/releases/tag/v1.1.0
[1.0.0]: https://github.com/ndcorder/the-foundry/releases/tag/v1.0.0
