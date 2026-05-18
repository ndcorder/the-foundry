# Game Design Reference

## Core Loops and Feedback Systems

- **The core loop** is the smallest repeatable unit of play: act → outcome → reward → act again. Everything else is scaffolding around this. If the core loop isn't satisfying at 30 seconds, no amount of content saves the game.
- **Risk/reward:** Players trade safety for potential gain. The tension lives in the decision point, not the outcome. Make the stakes legible before the choice.
- **Push-your-luck:** Each success increases the reward but also the risk of losing everything. The game asks: "Do you feel lucky?" repeatedly, with mounting tension. Blackjack, Yahtzee, roguelike dungeon descent.
- **Escalating stakes:** Early decisions are low-cost experiments; late decisions are high-cost commitments. This creates a natural difficulty curve without changing the mechanics.
- **Positive feedback loops** (snowballing) make leaders stronger — exciting but can feel unfair. **Negative feedback loops** (rubber-banding) keep games close — satisfying but can feel pointless. The best games balance both.

## Player Agency and Meaningful Choice

- **False choice:** "Do you go left or right?" and both lead to the same room. Players detect this quickly and disengage. Every choice must produce a distinguishable outcome.
- **Real choice requires:** information to reason with, consequences that matter, and no obviously dominant strategy.
- **Consequence design:** Immediate consequences are satisfying; delayed consequences are interesting. The best choices have both — an immediate effect and a long-term ramification the player doesn't fully see yet.
- **Branching:** True branching is exponentially expensive. Effective branching uses a "bottleneck" structure — paths diverge then reconverge at key plot points, carrying state flags that flavor the shared content.

## Text Game / Interactive Fiction Techniques

- **Parser design:** Classic IF uses verb-noun parsing ("open door", "examine painting"). Modern IF trends toward choice-based (Twine/Ink) or hybrid. Parser games reward exploration; choice games reward decision-making.
- **State machines:** Track world state as a set of flags/variables. Descriptions, available actions, and NPC dialogue all branch on state. The state machine IS the world model.
- **World models:** Rooms contain objects; objects have properties (portable, openable, readable). Interactions are property-based: "open" works on anything with the openable property. This creates emergent puzzles.
- **Procedural text generation:** Template systems ("The {adjective} {noun} {verbs} {adverb}") for variety. Markov chains for uncanny prose. Grammar-based generation (Tracery) for structured randomness.

## Puzzle Design

- **Lateral thinking puzzles:** The solution requires reframing the problem. The player's assumption about what's possible is the real obstacle.
- **Information gating:** The player has all the pieces but doesn't know which matter. The puzzle is recognizing relevance, not executing a solution.
- **The "aha" moment:** The best puzzles have a single insight that makes the solution obvious. If the player needs to try every combination, it's a lock, not a puzzle.
- **Difficulty curves:** Teach mechanics through use, not explanation. Level 1 teaches the jump; level 2 tests it; level 3 combines it with something new. Each puzzle should teach the tool needed for the next puzzle.

## Juice and Feel

- **Micro-feedback:** Every player action gets an immediate response — sound, animation, text change, state update. Silence after input feels broken.
- **Timing:** A 100ms delay between action and response feels instant. 300ms feels deliberate. 500ms+ feels sluggish. In text games, pacing text output (character-by-character, line-by-line) creates drama.
- **Surprise:** Occasionally break the pattern. An unexpected response to a common action makes the world feel alive and rewards curiosity.
- **In text-only games:** Typography, spacing, color, ASCII art, and pacing ARE your juice. A well-timed pause (forced wait) before a revelation is the text equivalent of a dramatic camera angle.

## Genres as Design Constraints

- **Roguelike:** Permadeath + procedural generation + emergent systems. The constraint is: every run must feel fair but different. Knowledge persists across deaths even when items don't.
- **Puzzle game:** One solution per level. The design constraint is elegance — can you teach the mechanic and test it in the same level?
- **Narrative game:** Player choices shape a story. The constraint is authorial — every branch must feel intentional, not random.
- **Sandbox/simulation:** Provide tools and let the player set their own goals. The constraint is systemic richness — emergent behavior from simple rule interactions.
