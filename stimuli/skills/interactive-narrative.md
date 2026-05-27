# Interactive Narrative Reference

## Choice Architecture

- **The meaningful choice:** A choice is meaningful when the player has enough information to reason, the consequences are distinguishable, and there's no obviously dominant option. "Do you save the village or pursue the villain?" is meaningful. "Do you open the red door or the blue door?" is usually not — unless the color has been loaded with prior meaning.
- **The illusion of choice:** Both paths lead to the same outcome, but the player feels they chose. Used when true branching is too expensive. The trick: vary the journey, not the destination. Different scenes, different dialogue, different emotional texture — same plot point. The Stanley Parable makes this its entire thesis.
- **Delayed consequences:** The most powerful choices are ones whose effects aren't immediately visible. You spare the thief in chapter 1; in chapter 4, the thief saves your life. The player retroactively feels brilliant. This requires state flags, not branches.
- **The false dilemma:** Present two options, but the real choice is to reject both. "Do you betray your friend or your mission?" The player who finds the third option — confronting the person who forced the dilemma — feels like a genius. But you have to account for it.
- **Quantity vs. quality of choices:** Too many choices per node creates decision paralysis. Two to four options per beat is the sweet spot. Each option should be emotionally distinct — not "attack with sword" vs. "attack with axe" but "fight" vs. "negotiate" vs. "flee."

## Branching Structures

- **The fold-back:** Paths diverge then reconverge at bottleneck nodes. State flags ("player_spared_thief = true") flavor the shared content without requiring separate content for every permutation. This is how most shipped narrative games actually work. Pure branching is exponentially expensive — 10 binary choices = 1024 endpoints.
- **The time cave:** True branching where paths never reconverge. Each playthrough sees a fraction of the content. Works for short pieces (Twine games, CYOA books). The design challenge: make each path feel complete, not like a fragment of the "real" story.
- **The gauntlet:** Linear story with the illusion of branching. Player choices affect tone and detail but not plot direction. Works when the story is strong enough that players want to experience it, not steer it. Walking simulators often use this.
- **The sorting hat:** Early choices slot the player into a track. Fewer total branches, but each track is deep. The player's identity (faction, class, alignment) determines which content they see. Replayable because tracks feel genuinely different.
- **Hub and spoke:** A central location (hub) with multiple storylets (spokes) the player can pursue in any order. Each spoke is self-contained but may unlock content in others. Disco Elysium uses this — the city is the hub, conversations are spokes.

## State Tracking

- **Ink's approach:** Variables, knots (passages), diverts (jumps), conditional text, tunnels (subroutines). The `{variable > 3: text}` pattern lets you write passages that adapt to accumulated state. Ink compiles to JSON, playable in any engine.
- **Twine/Harlowe macros:** `(set: $trust to $trust + 1)`, `(if: $trust > 5)[They confide in you.]`. The variables are the world model. Careful: 20+ state variables become hard to track mentally. Use a state diagram.
- **Quality-based narrative (Fallen London model):** Instead of binary flags, use numerical qualities that accumulate. "Suspicion: 7" unlocks different content than "Suspicion: 3." Qualities act as both progression and resource — spend Suspicion to unlock a risky shortcut.
- **The world state as character:** When state tracking is rich enough, the game world becomes a character with memory. It remembers what you did. NPCs reference past choices. The environment changes. This is expensive but transformative.

## Time Loops as Narrative Mechanic

- **The Groundhog Day structure:** Player relives the same period, retaining knowledge. Each loop, they can use what they learned to access new content. The design challenge: the repeated content must be fast to skip but reward re-examination.
- **Outer Wilds model:** An open world on a 22-minute timer. Nothing carries over except the player's knowledge. Every puzzle is solvable from minute one if you know the answer. The game is a knowledge-gating puzzle disguised as a space exploration game.
- **Twelve Minutes:** A real-time apartment loop. The player's foreknowledge creates dramatic irony — you know the cop is coming, your character doesn't. Actions that were innocent in loop 1 become strategic in loop 5.
- **Meta-loop awareness:** Characters who realize they're in a loop. The mechanic becomes the narrative. "Haven't we done this before?" The loop is both prison and puzzle.

## Meta-Narrative and Ergodic Literature

- **The reader as character:** When the text addresses the reader directly as a participant, not an observer. "You" isn't a character in the story — you, the person holding this, are. Homestuck, Undertale's genocide route, The Stanley Parable.
- **Unreliable interfaces:** The UI lies. Menu options that do something other than what they say. A save file that gets "corrupted" narratively. Doki Doki Literature Club deletes character files from your actual filesystem. The boundary between diegetic (in-story) and extradiegetic (outside-story) dissolves.
- **Ergodic literature (Aarseth):** Text that requires non-trivial effort to traverse. A book where you must assemble pages in order. A novel with footnotes that contain a parallel narrative (House of Leaves). A codex with marginalia that contradicts the main text. The physical/mechanical act of reading IS part of the meaning.
- **Her Story's database model:** Instead of branching narrative, the player searches a database of video clips by keyword. The story emerges from the order in which clips are discovered. Each player assembles a different sequence. The narrative is the player's investigation, not the chronological events.
- **Bandersnatch's recursive structure:** A film about making a branching-path story that is itself a branching-path story. The character becomes aware of the viewer's control. The meta-commentary and the entertainment are the same thing.

## Tools and Patterns for Implementation

- **Ink (inkle):** The most elegant IF scripting language. Compiles to JSON. Supports knots, stitches, diverts, conditional text, variables, tunnels, threads. Good for: branching dialogue, quality-based narrative, anything text-heavy.
- **Twine:** Visual node editor for hypertext fiction. Harlowe (default format) is accessible; SugarCube is more programmable. Good for: prototyping, non-linear exploration, visual structure mapping.
- **Inform 7:** Natural-language programming for parser IF. "The red door is a locked door in the Hallway. The rusty key unlocks the red door." Good for: world-model-heavy IF, puzzles, spatial exploration.
- **Ren'Py:** Python-based visual novel engine. Supports character sprites, backgrounds, music, branching dialogue, save/load. Good for: character-driven stories with visual presentation.
- **Plain markdown as IF:** A markdown file with internal links is a playable CYOA. `[Open the door](#room-2)` with anchor-id sections. Zero dependencies. Playable in any markdown renderer. Constraints breed creativity.

### What if...

- ...you wrote an interactive story where the branching structure itself formed a recognizable shape — a spiral, a tree, a face — when visualized as a graph?
- ...you created a narrative where the "save game" mechanic was diegetic — the character knows they can rewind, and NPCs start noticing?
- ...you built a story told entirely through search results, where the reader's query terms determine which fragments of narrative they uncover?
- ...you designed a CYOA where the choices you didn't make accumulated as a "shadow story" revealed at the end — the life you didn't live?
- ...you wrote a narrative that reads differently depending on the time of day the reader opens it, with the text itself shifting between day and night versions?