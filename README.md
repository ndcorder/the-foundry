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
│   ├── sandbox/            # Docker/Firejail code execution
│   ├── stats/              # Statistics tracking
│   └── stimuli/            # External input pipeline
├── config/                 # YAML configuration
├── dashboard/              # Observatory web dashboard
├── identity/               # Manifesto, journal, lineage, mood
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

## License

MIT
