# Music Theory & Composition Reference

## Harmony

- **Chord progressions as emotional arcs:** I→IV→V→I is home→departure→tension→resolution. I→vi→IV→V is the "axis of awesome" (most pop songs). The further from the tonic, the more tension.
- **Tension and release:** Dominant chords (V, V7) create pull toward the tonic. Suspensions (sus4 resolving to major) create micro-tension within a chord. The longer you sustain tension, the more satisfying the release.
- **Modal interchange:** Borrow chords from parallel modes. C major borrowing from C minor gives you bVII (Bb), bVI (Ab), bIII (Eb) — darkens the palette without leaving the key. Film composers use this constantly.
- **Borrowed chords and chromatic mediants:** Moving between chords whose roots are a third apart (C to Ab, C to E) creates a sense of wonder or shift. Used in film scores for "magical" transitions.
- **Pedal tones:** Hold one note (usually root or fifth) while chords move above it. Creates groundedness over harmonic motion. Useful for building tension without losing tonal center.

## Rhythm and Groove

- **Polyrhythm:** Two rhythmic patterns of different lengths superimposed. 3-against-2 is the most basic and appears in almost every music tradition worldwide. Creates a "rolling" feel.
- **Syncopation:** Accenting the off-beats. Emphasis where you don't expect it. The gap between where you expect the beat and where it lands creates energy. Funk lives here.
- **Swing:** Pairs of notes played with unequal duration instead of straight. Light swing (60/40) vs. hard swing (75/25). Transforms mechanical patterns into human-feeling grooves.
- **Metric modulation:** Change tempo by reinterpreting a subdivision. If triplets at 120 BPM become straight eighth notes, the new tempo is 180 BPM. Sounds complex but feels like a natural gear shift.

## Melody Writing

- **Motif development:** Start with 3-5 notes. Repeat, then vary: transpose it, invert it (flip intervals), retrograde (play backward), augment (stretch in time), diminish (compress). A whole piece can grow from one motif.
- **Call and response:** Phrase A asks a question (ends on an unstable note); Phrase B answers (resolves). This conversational structure appears in blues, jazz, gospel, and most folk traditions.
- **Contour:** The shape of a melody over time — ascending, descending, arch, valley, static. An ascending melody builds energy; a descending melody releases it. The highest note in a phrase carries emotional weight.
- **Interval emotion:** Minor 2nd = tension/dread. Major 3rd = bright/happy. Perfect 4th = anthemic. Tritone = unease. Perfect 5th = open/pure. Minor 6th = longing. Octave = triumph. These associations aren't universal but are deeply ingrained in Western music.

## Structure

- **Verse-chorus:** Verses change (tell the story); chorus repeats (delivers the emotional payload). The chorus should be immediately singable on first listen. Pre-chorus builds anticipation.
- **AABA (32-bar form):** A = theme, B = bridge (contrast). Standard in jazz standards and Tin Pan Alley. The bridge provides harmonic and melodic contrast that makes the return of A satisfying.
- **Through-composed:** No repeating sections. Each moment is new. Used when the narrative demands continuous development. Harder to write, harder to remember, but can be more emotionally specific.
- **Minimalist repetition:** A short pattern repeats with gradual, almost imperceptible changes. Steve Reich's phase technique: two identical patterns slowly drift apart. Hypnotic. The ear starts finding patterns that aren't there.

## Sound Design for Code

- **Strudel.js:** Live-coding pattern language for the browser. Patterns are strings: `"bd sd bd sd"` is a basic beat. Transform with functions: `.fast(2)`, `.rev()`, `.jux(rev)` (reverse in one ear). Compose by stacking: `stack(drums, bass, melody)`.
- **Tone.js:** Web Audio framework. Synths (`new Tone.Synth()`), effects (reverb, delay, distortion), scheduling (`Tone.Transport`). Good for interactive/responsive sound.
- **Algorithmic composition approaches:** L-systems generating note sequences. Cellular automata mapped to pitch grids. Markov chains trained on chord progressions. Perlin noise controlling parameters over time.
- **Generative music principles (Brian Eno):** Simple rules, complex results. Set up a system and let it run. The composer designs the garden, not the plants.

## Timbre and Texture

- **Layering:** Combine sounds that occupy different frequency ranges. A sub-bass (30-80Hz) + a mid-range pad (300-2kHz) + a sparkly arpeggio (4-10kHz) fills the spectrum without clashing.
- **Space and silence:** Rests are compositional choices. A sudden silence after a dense section is dramatic. Space between notes lets each one breathe and carry meaning.
- **Frequency spectrum as composition:** Think of pitch space as a canvas. Where you place sounds vertically (pitch) matters as much as horizontally (time). Crowded midrange = muddy. Spread spectrum = clarity.
