# Customizing The Foundry

This guide covers how to modify The Foundry's behavior, output, and identity to build your own autonomous creative system.

---

## 1. Changing the Manifesto Seed

**File:** `identity/manifesto.md`

The manifesto is the identity document every agent receives in its context. It defines what the system values, avoids, and aspires to. Changing it changes everything — the kinds of ideas the Ideator proposes, what the Critic approves, and the Creator's quality standards.

To customize:

1. Edit `identity/manifesto.md` directly
2. Keep the structure: "What We Value," "What We Avoid," "Our Aesthetic"
3. Be specific — vague values produce vague work. "We value precision" means nothing. "We value the specific detail that makes a reader stop and re-read" gives the agents something to aim at.
4. The Curator will evolve this document over time. Your seed sets the starting direction; the system will drift. That's by design.

The final line — "This document evolves" — is important. If you remove it, the Curator may treat the manifesto as immutable.

---

## 2. Adding Domains

**File:** `config/domains.yml`

Domains are the categories of work the system can produce. Each domain has a name, description, and weight.

```yaml
domains:
  - name: screenplay
    description: "Film and TV scripts, dialogue-driven narratives"
    weight: 0.8
```

**Weight** influences how often the domain appears. 1.0 is standard frequency; 0.5 means roughly half as often. The Ideator uses these weights when balancing proposals across domains.

To add a domain, append to the list. The Ideator will start proposing ideas in it on the next iteration. You don't need to create portfolio subdirectories — they're created automatically when the first artifact ships.

To remove a domain, delete it from the list. Existing artifacts in that domain remain in the portfolio.

---

## 3. Writing Custom Stimuli

**Directory:** `stimuli/skills/`

Skill files are curated reference material that feed the Ideator's context. They're persistent markdown documents (unlike live stimuli, which rotate).

Format:

```markdown
# [Topic Name]

## Key Concepts
- Concept 1: explanation
- Concept 2: explanation

## Techniques / Patterns
- Pattern name: how it works, when to use it

## Examples
- Notable example with brief analysis

## Creative Applications
- How this knowledge could inspire artifacts
```

The Ideator receives a random selection of skill files each iteration (default: 2, configurable via `skills_per_context` in `config/foundry.yml`). Skills are fuel — the Ideator isn't required to use them, but they inject domain knowledge the model may lack.

Good skill files: music theory, architectural patterns, game design principles, obscure historical events, scientific concepts. Bad skill files: generic writing advice, lists of prompts.

---

## 4. Swapping Model Providers

**File:** `config/models.yml`

The Foundry uses an OpenAI-compatible API. To point at a different provider:

```yaml
agents:
  ideator:
    model: "your-model-name"
    temperature: 0.9
    max_tokens: 4096

  creator:
    model: "your-model-name"
    temperature: 0.7
    max_tokens: 16384

  tester:
    model: "your-model-name"
    temperature: 0.2
    max_tokens: 8192

  critic:
    model: "your-model-name"
    temperature: 0.3
    max_tokens: 4096

  curator:
    model: "your-model-name"
    temperature: 0.5
    max_tokens: 8192
```

Set your API endpoint and key via environment variables (see `.env.example`).

You can run different models per agent. A reasonable cost-optimization: use your most capable model for Creator and Critic, a mid-tier for Ideator and Curator, and the cheapest for Tester. But see LESSONS.md §6 — we found the Tester benefits from a capable model to avoid false-positive truncation reports.

The config supports A/B testing overrides:

```yaml
overrides:
  - agent: ideator
    model: "cheaper-model"
    start_iteration: 51
    end_iteration: 70
    label: "ideator-cheaper-test"
```

---

## 5. Adjusting Agent Behavior

**Directory:** `prompts/`

Each agent has a prompt template: `ideator.md`, `creator.md`, `tester.md`, `critic.md`, `curator.md`. These are loaded at runtime (not hardcoded).

Key levers:

- **Ideator** (`prompts/ideator.md`): Change the number of proposals (default 3), adjust the domain cooldown, modify the novelty window. The `{domain_cooldown}` and `{novelty_window}` placeholders pull from `config/foundry.yml`.
- **Creator** (`prompts/creator.md`): The multi-pass process (plan → build → revise → polish) is defined here. You can add or remove passes. Adding a "research" pass before planning would make artifacts more grounded.
- **Tester** (`prompts/tester.md`): Add few-shot examples of complete-but-minimal artifacts to reduce false-positive truncation reports.
- **Critic** (`prompts/critic.md`): The evaluation dimensions and ship threshold (mean 3.0+, no dimension below 2) are defined here.
- **Curator** (`prompts/curator.md`): The periodic review tasks are listed here. Add or remove tasks to change what the Curator monitors.

Template variables like `{shared_context}`, `{manifesto_quality_standards}`, and `{critic_review_history}` are populated by the harness at runtime.

---

## 6. Quality Thresholds

The Critic's quality gate is configured in `prompts/critic.md`:

```
Ship threshold: mean of 3.0+, no dimension below 2.
```

To make the Critic stricter:
- Raise the mean threshold (e.g., 3.5+ or 4.0+)
- Raise the floor (no dimension below 3)
- Add dimensions (e.g., "humor," "risk-taking")

To make the Critic more lenient:
- Lower the threshold
- Remove dimensions
- Add prompt language like "err on the side of shipping — we can learn from imperfect work"

The Critic's `temperature` in `config/models.yml` also matters. Lower temperature (0.1–0.3) produces consistent, conservative reviews. Higher temperature (0.5–0.7) produces more varied evaluations — sometimes generous, sometimes harsh.

The Critic also has a self-monitoring rule: if it rejects more than 40% of artifacts over a rolling window, it must reflect on whether its standards have drifted. Adjust this percentage in the prompt if needed.

---

## 7. Using the Harness for Non-Foundry Purposes

The Foundry has a clean separation between **harness** (the iteration loop, context assembly, file management, checkpoint/recovery) and **skill** (what makes it a creative system — the manifesto, portfolio, Critic reviews, aesthetic values).

To build a different kind of autonomous system on the same harness:

### What you keep (harness)
- The five-agent iteration loop (or reduce/expand agents)
- Context assembly per agent from the sharing matrix
- YAML structured output parsing
- Checkpoint and crash recovery via Pi SDK
- The monitor/detector system for quality tracking
- File-based state (no database)
- The `requests.md` human intervention model
- The `STOP` file for emergency halt

### What you replace (skill)
- **Manifesto** → your system's identity and values
- **Portfolio** → your system's output store (could be API endpoints, reports, datasets)
- **Domains** → your system's output categories
- **Stimuli** → your system's external input sources
- **Critic dimensions** → your system's quality criteria
- **Prompt templates** → your agents' instructions

### Example adaptations

**Autonomous code reviewer:** Replace Creator with a Review Writer, Critic evaluates review quality, portfolio stores reviewed PRs and their outcomes. The manifesto defines what "good code review" means.

**Research synthesis engine:** Ideator proposes research questions, Creator writes literature reviews, Tester verifies citations, Critic evaluates argument quality. Stimuli pull from arXiv and PubMed.

**Game content generator:** Ideator proposes quests/items/lore, Creator builds them, Tester validates game logic, Critic evaluates player engagement potential. The manifesto defines the game's tone and world rules.

The key insight: adversarial multi-agent loops work for any domain where quality is subjective and entropy is a risk. The Foundry's architecture is a general solution to "produce good things indefinitely without human supervision."
