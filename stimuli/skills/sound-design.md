# Sound Design Reference

## Sound as Creative Material

- **The acousmatic:** Sound separated from its visible source. Pierre Schaeffer's term. When you hear a sound without seeing its cause, you listen to the sound itself — its texture, shape, movement — rather than identifying it. A door slam becomes a percussive event with a specific envelope and spectral character. Acousmatic listening is the foundation of sound design as art.
- **Musique concrète:** Recording real-world sounds and manipulating them — looping, reversing, pitch-shifting, splicing — until they become abstract material. A train becomes a rhythmic pattern. A voice becomes a texture. The source material constrains and enriches the result.
- **Foley and found sound:** Foley artists create sound effects by performing physical actions — walking on gravel, crumpling paper, snapping celery (for breaking bones). Found sound uses unaltered recordings of the environment. Both treat the physical world as an instrument. A field recording of a laundromat has rhythm, melody, harmony, and drama if you listen for it.
- **The soundscape (R. Murray Schafer):** The acoustic environment as composition. Keynote sounds (the drone of traffic, the hum of electricity) are the ground. Sound signals (horns, bells, alarms) are figures. Soundmarks (a specific church bell, a particular factory whistle) are identity. Every place has a sonic character that can be composed with.

## Auditory Illusions and Psychoacoustics

- **The Shepard tone:** A sound that appears to rise (or fall) in pitch forever. Actually a stack of sine waves an octave apart, with the top fading out and the bottom fading in. Creates infinite ascent — used for tension in film (Dunkirk) and games. The auditory equivalent of the barber pole.
- **Binaural beats:** Two slightly different frequencies in each ear (e.g., 200Hz left, 210Hz right) create a perceived pulsation at the difference frequency (10Hz). The brain "hears" a beat that doesn't exist in either signal. Controversial for therapeutic claims, but the perceptual phenomenon is real and compositionally useful.
- **The McGurk effect:** Visual information changes what you hear. Seeing lips say "ga" while hearing "ba" produces the perception of "da." Sound is not just auditory — it's multimodal. In interactive work, what the user sees changes what they hear.
- **Phantom fundamentals:** Play the 2nd, 3rd, and 4th harmonics of a note without the fundamental, and the brain fills in the missing fundamental. This is why tiny speakers can produce the illusion of bass they physically can't generate. Useful for sound design in bandwidth-limited contexts (phone speakers, browser audio).
- **Auditory pareidolia:** The brain finds patterns in noise — hearing words in white noise, melodies in machinery. EVP (Electronic Voice Phenomena) is this effect exploited. Generative audio that hovers at the edge of pattern and noise exploits this — the listener's brain becomes a co-composer.

## Synthesis Techniques

- **Subtractive synthesis:** Start with a harmonically rich waveform (sawtooth, square), then filter out frequencies. The filter IS the instrument. Sweeping a low-pass filter creates that classic synth "wah" sound. Most analog synths work this way.
- **Granular synthesis:** Chop a sound into tiny grains (1-100ms) and recombine them. Stretch time without changing pitch. Freeze a moment and explore its interior. Scatter grains randomly for cloud-like textures. A single piano note contains a universe when granulated.
- **FM synthesis (frequency modulation):** One oscillator modulates the frequency of another. Simple ratios (2:1, 3:2) produce harmonic timbres (bells, electric pianos). Irrational ratios produce inharmonic, metallic sounds. Two sine waves and an algorithm — that's all a DX7 is.
- **Spectral processing:** Analyze sound into its frequency components (via FFT), manipulate the spectrum directly, resynthesize. Spectral freezing holds one moment's frequency snapshot indefinitely. Spectral morphing blends two sounds by interpolating their spectra. Cross-synthesis puts one sound's spectrum on another's temporal envelope — a drum that speaks, a voice that rings like a bell.
- **Physical modeling:** Simulate the physics of real instruments — string tension, tube resonance, membrane vibration. Karplus-Strong algorithm: a short burst of noise fed through a delay line with filtering produces plucked string sounds. The physics is the synthesis.

## Silence, Space, and Time

- **Silence as composition:** John Cage's 4'33" isn't silence — it's the audience becoming aware of ambient sound. In sound design, silence is a dramatic device. A sudden cut to silence after sustained noise is more shocking than any sound. The silence after a gunshot is where the horror lives.
- **Room tone:** Every space has a characteristic ambient sound — HVAC, electrical hum, distant traffic, building resonance. When you edit audio, cutting to true digital silence sounds wrong because the room tone disappears. The absence of ambient sound is more noticeable than its presence.
- **Reverb as worldbuilding:** Reverb tells you the size and material of a space. Short, bright reverb = small tiled room. Long, dark reverb = cathedral. No reverb = outdoors or intimate close-mic. In interactive fiction, changing reverb changes the implied space without describing it.
- **Temporal manipulation:** Paulstretch: extreme time-stretching (100x-1000x) turns any sound into an ambient texture. A 3-second vocal sample becomes a 5-minute drone of shifting harmonics. The original sound is unrecognizable but its DNA persists.

## Sonification: Translating the Non-Sonic into Sound

- **Data sonification:** Map data dimensions to audio parameters. Stock prices → pitch. Volume traded → amplitude. Volatility → filter cutoff. The ear detects patterns the eye misses — periodicity, anomalies, trends. NASA sonifies telescope data; the results are genuinely beautiful.
- **Text-to-sound:** Map characters to frequencies, word length to duration, punctuation to silence. A paragraph becomes a melodic phrase. The rhythm of prose has literal rhythm. Code has a different sonic signature than poetry — shorter, more repetitive, more punctuated.
- **Image sonification:** Scan an image column by column, mapping brightness to frequency and color to timbre. Aphex Twin embedded his face in a spectrogram. You can reverse the process — compose a spectrogram that, when viewed, is an image and when played is music.
- **Network sonification:** Ping times as rhythm, packet sizes as pitch, dropped packets as silence. The internet has a sound, and it changes character with traffic, distance, and failure.

## Generative Audio for Code

- **Strudel.js (TidalCycles for the browser):** Pattern-based live coding. `sound("bd sd [bd bd] sd")` is a beat. `.fast(2)` doubles the speed. `.jux(rev)` plays the pattern forward in one ear and backward in the other. `.sometimes(x => x.speed(2))` randomly octave-shifts. Patterns are first-class — you compose by transforming them.
- **Tone.js:** Full Web Audio API framework. `new Tone.Synth().toDestination().triggerAttackRelease("C4", "8n")`. Instruments, effects, sequencing, transport. Supports custom synthesis graphs. Good for interactive, event-driven sound.
- **Web Audio API raw:** AudioContext, OscillatorNode, GainNode, BiquadFilterNode, ConvolverNode, AnalyserNode. Low-level but powerful. You build a signal graph by connecting nodes. `oscillator.connect(filter).connect(gain).connect(context.destination)`. Custom processing via AudioWorklet.
- **SuperCollider patterns in JS:** SC's pattern system (Pbind, Pseq, Prand) can be approximated in JS. Define sequences of values for pitch, duration, amplitude — the pattern engine generates events. Patterns that generate patterns — meta-composition.

## ASMR, Noise, and the Liminal

- **ASMR as compositional technique:** Autonomous Sensory Meridian Response — the tingling from soft sounds, whispers, careful movements. As a compositional approach: extreme close-mic recording, quiet dynamics, intimate spatial positioning. The microphone becomes a proxy for the ear. Every texture is amplified.
- **Noise as spectrum:** White noise (flat spectrum), pink noise (1/f, rolls off at high frequencies — sounds more natural), brown noise (1/f², emphasizes low frequencies — like distant thunder). Different noise colors create different textures and moods. Pink noise is often described as "the sound of nature."
- **Liminal audio:** Sounds at the threshold of perception. Almost-silent drones. Frequencies at the edge of the audible range (20Hz feels more than it sounds). Audio that you're not sure you're hearing. Creates unease, attention, hyperawareness.

### What if...

- ...you sonified a git repository's commit history — frequency mapped to file count changed, rhythm to commit timestamps, timbre to author?
- ...you created a Strudel.js pattern that played differently based on the current weather at the listener's location?
- ...you built a granular synthesizer that used a recording of someone reading a poem as its source material, so the poem could be frozen, stretched, and recombined into an ambient texture that still contained ghost-words?
- ...you generated a spectrogram image that was simultaneously a valid QR code and a listenable piece of music?
- ...you designed a sound installation where the room's reverb was the instrument — the space itself was played by introducing carefully tuned impulses and letting the architecture compose?