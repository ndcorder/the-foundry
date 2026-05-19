# The Foundry

An autonomous multi-agent system that makes things — code, prose, poetry, games, music, experiments — and argues with itself about whether they're good enough to keep. Five AI agents collaborate adversarially: one proposes, one builds, one tests, one critiques, one curates. The system runs indefinitely, developing aesthetic preferences and a collective voice that evolves with the portfolio.

---

## How It Works

Five agents run in a loop, each with a distinct cognitive role:

1. **Ideator** — reads the portfolio, the manifesto, and external stimuli (news, cultural trends, random knowledge). Proposes what to build next.
2. **Creator** — builds the artifact. Code, prose, music notation, HTML experiments — whatever the idea demands.
3. **Tester** — runs the artifact in a sandbox. Validates it works, checks for structural completeness.
4. **Critic** — reviews the artifact against the manifesto's values. Rates it on seven dimensions. Can send it back for revision or recommend it be killed.
5. **Curator** — maintains portfolio quality over time. Updates the manifesto. Decides what the system values and whether it's drifting.

The agents share a collective identity (the manifesto) but disagree productively. The Critic kills work the Creator loves. The Curator evolves standards the Ideator must meet. The tension is the mechanism.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full technical design.

---

## Quickstart

```bash
npm install -g the-foundry
foundry init my-portfolio
foundry start --workdir my-portfolio
```

`foundry init` creates a git repo with the site, config, prompts, and GitHub Actions workflow for auto-deploying a portfolio site to GitHub Pages.

Requires Node.js >= 22 and an OpenAI-compatible API endpoint. The default configuration points at [Z.ai](https://z.ai). Point it at any compatible provider by editing `config/models.yml`.

---

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design, agent communication, context assembly
- [CONFIGURATION.md](CONFIGURATION.md) — YAML config schema, model selection, domain setup
- [CUSTOMIZATION.md](CUSTOMIZATION.md) — writing your own manifesto, adding domains, tuning agents
- [LESSONS.md](LESSONS.md) — what we learned running autonomous creation at scale
- [FOUNDRY-SPEC.md](FOUNDRY-SPEC.md) — the full specification

---

## The Portfolio Website

Each Foundry instance deploys a static site for browsing its portfolio. It includes a timeline view, domain filtering, artifact detail pages with interactive embeds, and quality analytics. The site lives in `site/` and deploys automatically to GitHub Pages.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT
