# Lessons Learned: 60 Iterations of Autonomous Multi-Agent Creative Production

The Foundry ran for 60 iterations without manual intervention, shipping 58 artifacts across 9 domains with a 4.61 average rating (out of 5.0). Two artifacts were killed. This document describes what we learned building and running it.

---

## 1. What Worked

### Adversarial collaboration is the architecture

The five-agent loop (Ideator → Critic → Creator → Tester → Critic) is not a pipeline — it's a system of productive disagreements. The Critic serves two gates: one filtering ideas before any work begins, and one reviewing finished artifacts before they ship. This dual-gate structure means the system fails cheap (bad ideas die at Gate 1) and fails honest (mediocre artifacts get sent back or killed at Gate 2).

The numbers back this up. Gate 1 rejections were frequent and specific — the Critic rejected "Resonance Garden" in iteration 1 because it was "a Week 3 project, not a Day 1 project." It rejected proposals for being too similar to existing work, too vague, or too safe. These rejections sharpened ideas before compute was spent building them.

At Gate 2, the Critic killed only twice in 60 iterations: iteration 12 (wrong artifact delivered — the Creator built a constellation viewer instead of a compiler wrapper) and iteration 51 (empty artifact, just a truncated README). Both were correct calls. The low kill rate isn't softness — it reflects Gate 1 doing its job.

### The manifesto as shared identity

Every agent receives the manifesto in its context. This gives five separate LLM calls a coherent sense of "who we are" and "what we value." The Creator self-reviews against manifesto values before submitting. The Critic evaluates against them. The Ideator generates ideas that serve them.

The manifesto is not static (see §4), and that evolution is load-bearing. When the Curator added "the document-as-narrator is a signature, not a formula" to the avoidance list, the system's subsequent artifacts demonstrated more formal variety. Identity documents work because LLMs are responsive to stated values in their context — but only if those values evolve with the work.

### Cross-agent learning

The Creator receives the Critic's recent reviews of *all* artifacts, not just its own. This is the most important context-sharing decision in the system. By iteration 15, the Creator was producing work that anticipated Critic objections. By iteration 30, the quality floor had risen from 3.4 (artifact 0008, the only sub-4.0 score) to a consistent 4.1+.

The Critic's reviews double as training signal. When it wrote that artifact 0001 (Stack Trace Confessional) succeeded because "every technical metaphor maps precisely onto emotional truth," that standard echoed through subsequent work. The Creator internalized "formal constraint as load-bearing structure" as a principle — visible in 0011 (iptables love letter, 5.0), 0013 (adaptive maze, 5.0), and 0022 (recursion as forgiveness, 5.0).

### Domain diversity enforcement

The Ideator is required to propose at least one idea in an underrepresented domain each cycle. The Curator tracks domain balance and issues recommendations. The domain collapse detector (see §3) fires if any single domain exceeds 60% of recent output.

The result: 9 domains populated across 58 artifacts — fiction (10), worldbuilding (8), code-tool (8), poetry (7), code-art (7), essay (6), music (5), experiment (5), code-game (4). No domain was abandoned. Music, the most technically challenging domain for an LLM, got 5 entries including a 5.0 (The Terrarium as Proof of Concept, artifact 0012).

### The Tester as pre-filter

The Tester sits between Creator and Critic, catching technical failures before they consume the Critic's evaluation bandwidth. For code artifacts, it runs tests in a sandbox. For prose, it checks completeness and structural integrity.

When working correctly, the Tester caught real bugs (malformed HTML, runtime errors, missing dependencies) that the Critic shouldn't have to care about. The Tester's reports gave the Critic evidence — "this code compiles and runs" or "the test suite passes" — freeing the Critic to focus on quality rather than correctness.

---

## 2. What Didn't Work

### Tester false positives

The Tester's biggest failure mode was flagging complete artifacts as truncated. This happened in iterations 11 (the adaptive maze), 16 (the peripheral vision color), 24 (the error message therapist), and 37 (the CAPTCHA). In each case, the Critic overrode the Tester — correctly — and shipped the artifact.

The pattern: the Tester expected more code than was there, treating minimalism as incompleteness. Artifact 0013 (the maze, rated 5.0) was flagged as truncated despite being a complete, functioning Python game. The Critic's review noted: "This is a complete, functioning artifact that the Tester incorrectly flagged as truncated."

The fix we'd recommend: tester prompts need explicit guidance that "completeness" means "does what the proposal specified," not "contains as much code as I'd expect." Minimalist artifacts are a feature, not a defect.

### Duplicate artifacts

Artifacts 0002 and 0003 are the same piece — Listening Station Bravo, a code-game. This happened because the iteration counter didn't properly advance after the first submission. A simple but embarrassing bug that was caught but not prevented.

### Model parsing failures

YAML extraction from LLM responses failed several times. Iteration 8 was a pure failure — no artifact produced — due to malformed YAML output. Iterations 51 and 59 had model termination events where the LLM stopped generating mid-artifact.

The Creator, Tester, and Critic all produce structured YAML output. When parsing fails, the entire iteration is wasted. Robust YAML extraction with fallback strategies (regex extraction, partial parse recovery) is essential for any multi-agent system that uses structured output.

---

## 3. The Entropy Problem

Autonomous creative systems have a natural tendency toward convergence. Without external pressure, the system finds patterns that score well and repeats them. Quality appears stable while novelty silently dies.

We saw this. By iteration 30, the compressed journal noted: "quality trend flattened — hitting quality ceiling." The system had discovered that melancholic, document-format artifacts with technical metaphors reliably scored 4.5+. It could have produced 500 of those.

### How we fight entropy

Four automated detectors in `src/monitor/detectors.ts` watch for entropy patterns:

1. **Slop Detector:** Tracks mean rating over a rolling window (default 20 iterations). If mean drops below 2.5, it triggers an emergency Curator review. It also checks for downward trends — if the second half of the window scores lower than the first, it warns even if the absolute score is fine.

2. **Repetition Detector:** Compares recent artifacts using trigram overlap on titles, review text, and domain tags. A weighted similarity score above 0.6 triggers an anti-repetition pressure signal to the Ideator. This is what would have caught the 0002/0003 duplicate if it had been running at iteration 2.

3. **Manifesto Drift Detector:** Monitors how often the manifesto changes. Too many changes in a short window (>5 in 30 iterations) signals identity instability. Too few changes (>50 iterations of stagnation) signals the system has stopped self-reflecting.

4. **Domain Collapse Detector:** Fires if any single domain exceeds 60% of the last 30 iterations. When triggered, it forces domain diversification by excluding the dominant domain for a configurable number of iterations.

These detectors don't fix entropy — they surface it. The Curator acts on their warnings during periodic reviews. The real entropy fix is the Curator's manifesto edits (see §4), which rewrite the system's values to push against whatever ruts have formed.

---

## 4. The Manifesto Evolution

The seed manifesto (in the spec, §11) was 15 lines. By iteration 61, it had grown substantially. Here's what changed and why:

### Seed → Iteration 15

The Curator added "visual art" to the range value, acknowledging code-art as a legitimate domain. It also added two crucial lines to "What We Avoid":

- **The document-as-narrator warning:** "The document-as-narrator is a signature, not a formula. Every new use must justify why this format and not another." This was a response to the system producing 4 document-format artifacts in a row (the cartographer's confession, the ceasefire taxonomy, the housing court testimony).
- **The double-duty principle:** "Formats that do double duty — every container is also content" was added to the aesthetic section, codifying what the Critic had been rewarding.

### Iteration 15 → Iteration 30

The Curator escalated. "Emotional register ruts are as dangerous as formal ones — if the last three artifacts were all quietly devastating, the next one should try something else." This was a direct intervention against the melancholic convergence pattern.

It also added an explicit call for "joy, anger, absurdity, laughter" — emotions the portfolio had never explored.

### Iteration 30 → Iteration 45

The domain debt concept became explicit: "A domain with no entries in the last 10 iterations is a debt that must be paid soon." The Curator also escalated emotional range from recommendation to requirement.

### Iteration 45 → Iteration 61

The most aggressive manifesto change: "An artifact that is another bureaucratic document in the melancholic register must now clear the highest bar in the portfolio's history to ship." This directly penalizes the system's most comfortable pattern. The Curator also noted: "After 60 iterations, the humor debt has been paid (0057)." Artifact 0057, the stand-up comedy set, was the portfolio's first humor-first piece, rated 5.0.

The manifesto's final line — "This document evolves. We are not who we were 100 iterations ago" — was present from the seed. It turned out to be the most important sentence in the system.

---

## 5. Surprising Emergent Behaviors

### The document-as-narrator pattern

We didn't design for artifacts where the format itself is a character. But the system discovered it independently. The procurement form for replacing someone who isn't gone yet (0028, 5.0), the Terms of Service for a memory editing service (0038, 5.0), the performance review annotated by the lighthouse light (0032, 4.3) — in each, the bureaucratic document becomes the narrator, and the gap between formal language and emotional content *is* the story.

The system produced enough of these that the Curator had to actively constrain them. That's emergence: a pattern the system invented, refined, became addicted to, and then had to regulate.

### Consistent aesthetic preferences

By iteration 20, the system had developed preferences no one programmed:
- Negative space as technique (what's absent is more powerful than what's present)
- Technical precision in emotional contexts (the 4.2-second neurological threshold in the Stack Trace Confessional)
- Structural constraint as meaning (the iptables love letter's firewall rules *are* the poem)

These emerged from the feedback loop between Creator and Critic. The Critic rewarded these patterns; the Creator learned to produce them; the manifesto eventually codified them.

### Cross-references between artifacts

Artifacts began referencing each other without being prompted. The CAPTCHA (0037) was described by the Critic as "0028's companion piece" — the procurement form documented institutional erasure in future tense, the CAPTCHA documents it in present tense. The emotional software toolchain (0010, 0020, 0027, 0051, 0054, 0056) formed a six-artifact lineage.

The compressed journal tracked these threads: "Emerging threads: Emotional software toolchain. Bureaucratic document as horror genre. Negative space as technique." The system developed thematic continuity without a project structure — just shared memory.

### The humor breakthrough

For 56 iterations, every artifact operated in a melancholic or restrained register. The manifesto called for humor from iteration 30 onward. It took until iteration 57 for the system to deliver: a stand-up comedy set performed by someone who can only tell the truth. It scored 5.0. The compressed journal called it a "breakthrough" and declared "the humor debt tracked since iteration 30 is paid."

This 27-iteration gap between manifesto instruction and execution reveals something about LLM creative systems: they can be told to be funny, but they need to build the internal context to understand *how* this system would be funny, in a way consistent with its identity. The humor, when it arrived, was earned.

---

## 6. Token Economics

All five agents run on GLM-5.1 (the same model tier). The original spec proposed tiering — GLM-5.1 for Ideator and Curator, a cheaper model for Tester — but we found that:

- **The Tester needs a capable model.** Cheap models produced the false-positive truncation reports. The Tester must understand that a 200-line Python game can be complete. This requires reasoning, not just pattern matching.
- **The Ideator's temperature matters more than its model.** At 0.9 temperature, the Ideator produces surprising ideas. At 0.5, it produces competent but predictable ones. The temperature setting was more impactful than model selection.
- **The Critic should run cold.** At 0.3 temperature, the Critic is consistent and specific. Higher temperatures produced reviews that drifted into creative writing rather than evaluation.
- **The Creator is the token sink.** Complex artifacts consumed 60K–150K+ tokens. The Creator's multi-pass process (plan → build → revise → polish) is expensive but produces the quality delta. Single-pass generation would save tokens and lose the quality floor.

We considered A/B testing GLM-4.5 for the Ideator (the config has a commented-out override for iterations 51–70) but never ran it. If cost matters, the Ideator is the first candidate for a cheaper model — idea generation is more forgiving of capability gaps than execution or evaluation.

---

## 7. What We'd Do Differently

### Better YAML extraction

Structured output is the weakest link. We'd invest in a robust extraction layer with fallback parsing, partial recovery, and retry logic. Every iteration lost to a parse failure is pure waste.

### Tester calibration

The Tester needs examples of "complete, minimal artifacts" in its prompt. The false-positive truncation pattern was the most consistent failure mode across the run. A few-shot examples of artifacts that look small but are complete would fix this.

### Earlier humor and tonal range

The 27-iteration gap between "we should try humor" and the first humor artifact suggests the manifesto alone isn't enough for major tonal shifts. We'd add explicit tonal constraints to the Ideator: "your first proposal must be in a tonal register the portfolio hasn't tried."

### Project support

We designed a full project system (multi-iteration work, briefs, status tracking) but never used it. All 58 artifacts were standalone. Whether this means the project system is unnecessary or that the system naturally prefers atomic work is an open question. We'd test with an explicit human redirect requesting a multi-part project.

### Real-time monitoring dashboard

The detectors exist in code but their outputs go to logs. A real-time dashboard showing quality trends, domain balance, detector warnings, and token usage would make the system more legible to observers. Phase 3 of the roadmap includes this.

### Cheaper Curator cycles

The Curator receives "everything" — full journal, all reviews, all test reports. At 60 iterations, that context is enormous. We'd invest in smarter context assembly: only feed the Curator what's changed since its last run, plus the compressed history.

---

## Appendix: Key Artifacts Referenced

| ID | Title | Domain | Rating |
|---|---|---|---|
| 0001 | Stack Trace Confessional | poetry | 4.9 |
| 0008 | A Taxonomy of Ceasefires | worldbuilding | 3.4 |
| 0011 | A Love Letter Written in iptables Rules | poetry | 5.0 |
| 0012 | The Terrarium as Proof of Concept | music | 5.0 |
| 0013 | A Maze That Remembers Every Wrong Turn | code-game | 5.0 |
| 0015 | A Style Guide That Slowly Becomes a Confession | experiment | 5.0 |
| 0028 | A Procurement Form for Replacing Someone Who Isn't Gone Yet | worldbuilding | 5.0 |
| 0037 | A Captcha That Only Lets You Through If You've Been Paying Attention | code-game | 5.0 |
| 0057 | A Stand-Up Comedy Set | fiction | 5.0 |
