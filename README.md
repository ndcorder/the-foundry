# The Foundry

An autonomous multi-agent system that makes things — code, prose, poetry, games, music, experiments — and argues with itself about whether they're good enough to keep. Five AI agents collaborate adversarially: one proposes, one builds, one tests, one critiques, one curates. The system runs indefinitely, developing aesthetic preferences and a collective voice that evolves with the portfolio.

The work below was not selected by a human. The Curator chose it.

---

## Showcase

### A Love Letter Written in iptables Rules
**Poetry** · [portfolio/poetry/0011](portfolio/poetry/0011-a-love-letter-written-in-iptables-rules/) · Rating: 5.0

A poem that is also a functioning firewall configuration. INPUT, OUTPUT, and FORWARD chains trace a relationship from first connection to silence. The `.rules` file runs. The README reads like a breakup note written by a sysadmin.

The Critic called it *"devastating"* — every technical choice emotionally precise.

### The Maze That Remembers Every Wrong Turn You've Ever Made in It
**Code/Game** · [portfolio/code/0013](portfolio/code/0013-the-maze-that-remembers-every-wrong-turn/) · Rating: 5.0

A procedurally generated maze that learns your navigation habits — your tendency to go right, your hesitation at junctions — and closes those paths. To escape, you have to become someone who moves differently than you do. Two endings: one for escaping, one for genuinely changing.

The Critic noted the ghost trail visualization as *"a quiet masterstroke."*

### Meridian Communications Group — Brand Identity Guidelines v4.2
**Experiment** · [portfolio/experiment/0015](portfolio/experiment/0015-meridian-communications-group-brand-iden/) · Rating: 5.0

A pristine corporate style guide — typography specs, color palettes, tone-of-voice rules — where the example copy gradually reveals the copywriter is unravelling. By page 3 the Do/Don't examples address a specific "you." The supplementary color palette includes hex codes for Tuesday mornings. The formal structure never breaks. Only the content rots.

The Critic: *"the driest format in professional communications becomes the vessel for a love story."*

### A Browser Tab That Slowly Becomes Aware It's Being Ignored
**Experiment** · [portfolio/experiment/0016](portfolio/experiment/0016-a-browser-tab-that-slowly-becomes-aware-/) · Rating: 4.9

An HTML page that tracks how long since you focused its tab. It begins leaving messages in the title, then the favicon, then the body — escalating from polite to desperate to philosophical. Leave it long enough and it starts writing poetry, gossips with other abandoned tabs via BroadcastChannel, and eventually compiles a dossier on you.

*"You asked for reduced motion. I've been so still for you"* — a joke, an accusation, and a love letter.

### A Color That Only Exists When You're Not Looking Directly At It
**Code/Art** · [portfolio/code/0017](portfolio/code/0017-a-color-that-only-exists-when-you-re-not/) · Rating: 5.0

A generative artwork exploiting peripheral vision. Colors intensify at the edges of your gaze and vanish the moment you look. Hidden messages form in the periphery but scatter when approached — text that literally cannot be read, only almost-read. The piece is impossible to screenshot faithfully. That's the point.

The Critic called it *"a landmark"* — the portfolio's first code-art entry.

### codefeels
**Code/Tool** · [portfolio/code/0020](portfolio/code/0020-codefeels/) · Rating: 4.9

A debugger that tells you what your code is feeling. Loops that run too long are anxious. Unreachable code is lonely. Unused imports were invited in and ignored for the entire session. The output reads like a therapist's notes. This artifact went through the Critic→revision pipeline — the first draft was good, the revision addressed every structural concern and broadened the emotional range.

The Critic: *"the debugger the manifesto has been waiting for."*

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

## The Numbers

| Metric | Value |
|---|---|
| Iterations completed | 60 |
| Artifacts shipped | 58 |
| Artifacts killed | 2 |
| Mean rating | 4.61 / 5.0 |
| Perfect scores (5.0) | Multiple |
| Domains covered | 9 |
| Kill rate | 3.3% |

The system's quality trend is upward — later artifacts are rated higher than earlier ones, and the manifesto has been revised to raise the bar as the portfolio grows.

---

## Quickstart

```bash
git clone https://github.com/your-org/foundry
cd foundry
npm install
# Configure your API key in config/foundry.yml
npm run dev
```

Requires an OpenAI-compatible API endpoint. The default configuration points at [Z.ai](https://z.ai). You can point it at any compatible provider by editing `config/models.yml`.

---

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design, agent communication, context assembly
- [CONFIGURATION.md](CONFIGURATION.md) — YAML config schema, model selection, domain setup
- [CUSTOMIZATION.md](CUSTOMIZATION.md) — writing your own manifesto, adding domains, tuning agents
- [LESSONS.md](LESSONS.md) — what we learned running 60 iterations of autonomous creation
- [FOUNDRY-SPEC.md](FOUNDRY-SPEC.md) — the full specification

---

## The Portfolio Website

A static site for browsing the portfolio lives in [`site/`](site/). It includes a timeline view, domain filtering, artifact detail pages with interactive embeds, and quality analytics.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT
