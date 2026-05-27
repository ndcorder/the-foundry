# Visual Composition Reference

## Composition Rules and When to Break Them

- **Rule of thirds:** Divide the frame into a 3x3 grid. Place subjects at intersections, not center. Creates dynamic tension. But centering works when you want confrontation, symmetry, or unease — Kubrick centered everything and it felt like the frame was watching you.
- **Golden spiral (Fibonacci):** A logarithmic spiral that appears in nautilus shells, hurricanes, galaxy arms. More organic than the rule of thirds. The eye follows the spiral inward to the focal point. Use when you want the viewer to feel drawn in rather than scanning.
- **Diagonal dominance:** Lines running corner-to-corner create energy and movement. Horizontals feel stable; verticals feel imposing; diagonals feel unstable, alive. A landscape tilted 5° off-horizontal makes the viewer's inner ear object — use that discomfort intentionally.
- **Breaking symmetry:** A perfectly symmetric composition with one element displaced creates more tension than asymmetry alone. The eye goes straight to the violation. Useful for visual storytelling: "something is wrong here."
- **The Müller-Lyer illusion:** Two lines of equal length appear different when one has outward-pointing arrows and the other inward. Apply this: elements near converging lines feel compressed; elements near diverging lines feel expansive. You can make identical objects feel different sizes through context.

## Color Theory for Emotional Effect

- **Warm/cool temperature:** Warm colors (red, orange, yellow) advance — they feel closer, more urgent. Cool colors (blue, green, violet) recede — they feel distant, contemplative. A single warm accent in a cool palette draws the eye like a signal fire.
- **Complementary tension:** Colors opposite on the wheel (red/green, blue/orange, purple/yellow) vibrate when placed adjacent. This optical buzzing creates energy but also discomfort at high saturation. Desaturate one side to calm it.
- **Analogous harmony:** Colors adjacent on the wheel (blue, blue-green, green) create calm coherence. Nature defaults to analogous palettes. Use when you want the viewer to settle in rather than be provoked.
- **Chromatic aberration as metaphor:** The prismatic color fringing that happens at lens edges. In photography it's a flaw; in creative work it signals unreliable perception, digital degradation, or the moment reality splits. CSS can simulate it with layered text-shadows in cyan and magenta.
- **Monochromatic with one violation:** An entirely blue composition with a single red element. The violation carries all the narrative weight. In data visualization, this is how you make one data point unforgettable.
- **Color and cultural loading:** White means purity in Western contexts, mourning in East Asian ones. Red means danger in traffic, luck in Chinese culture, love on Valentine's Day. When your audience is an AI generating for unknown humans, lean on physiological responses (warm/cool, contrast, saturation) over cultural associations.

## Negative Space

- **Active negative space:** The empty area isn't absent — it's a shape. The FedEx arrow lives in negative space. Rubin's vase/faces illusion. When you design the space around a subject as carefully as the subject itself, the composition breathes.
- **Horror vacui vs. kenosis:** Horror vacui (fear of empty space) fills every surface — Islamic geometric art, Victorian wallpaper, maximalist design. Kenosis (emptying) strips to essential forms — Japanese ma, Scandinavian minimalism. Neither is superior. The choice encodes a worldview.
- **The pause:** In music, silence is a note. In visual composition, negative space is a pause. It controls pacing — dense regions feel fast; open regions feel slow. A wall of text with no whitespace is visually suffocating for the same reason.

## Rhythm and Pattern in Visual Layout

- **Repetition with variation:** A row of identical elements is a pattern. A row of identical elements with one that's rotated 15° is a story. Repetition establishes expectation; variation delivers meaning.
- **Visual hierarchy through scale:** The largest element is read first. Then the next largest. Then text. This is a sequence — you're directing a reading order through size alone. In ASCII art, a single large character among small ones becomes the focal point.
- **Grid systems as constraint:** The International Typographic Style (Swiss design) uses rigid grids. The grid is a constraint that creates coherence across diverse content. Breaking the grid — one element that bleeds outside — signals importance or rebellion.
- **Tessellation:** Shapes that tile a plane without gaps. Escher's interlocking lizards. Regular tessellations use one shape (triangles, squares, hexagons). Semi-regular ones mix shapes. The math of what can tile is surprisingly deep — Penrose tiles are aperiodic, never repeating.

## Typography as Art

- **Type anatomy as expression:** Serifs feel traditional, authoritative. Sans-serif feels modern, clean. Monospace feels technical, honest (every character gets equal space — democratic). Blackletter feels archaic or metal. The choice of typeface is a voice before a single word is read.
- **Concrete poetry / typographic composition:** Apollinaire's calligrams shaped text into images. Mallarmé's "Un Coup de Dés" scattered words across the page to represent a shipwreck. The physical arrangement of letterforms IS content.
- **Kerning as meaning:** Tightening letter-spacing creates density, urgency, claustrophobia. Loosening it creates openness, calm, luxury. Tracking a word out to one-letter-per-line turns typography into architecture.

## ASCII, ANSI, and SVG as Creative Media

- **ASCII art constraints:** 95 printable characters, fixed-width grid. The constraint forces abstraction. Character density creates shading: `@` is darkest, `.` is lightest. Braille characters (⠁⠂⠃...) offer 2x4 sub-cell resolution in a single character cell.
- **ANSI escape codes:** 256 colors, bold, dim, blink, inverse. Terminal art uses these for color gradients, animation frames, and interactive displays. The terminal is a grid of colored character cells — think of it as a very low-resolution display with typography built in.
- **SVG as generative canvas:** XML-based vector format readable by humans and machines. Paths, transforms, filters, animation — all in plain text. An AI can write SVG directly. Fractal curves, recursive patterns, data-driven art — all expressible as markup. The `<filter>` element alone enables blur, displacement mapping, turbulence noise, and compositing.
- **Data visualization as art:** Tufte's principle: maximize the data-ink ratio. But: Dear Data (Lupi & Posavec) hand-drew personal data as postcards — the human imprecision WAS the art. Sonification, physicalization (3D-printed data), edible data. When the visualization is more interesting than the data, you've crossed from information design into art.

### What if...

- ...you composed a poem where the whitespace between stanzas encoded a secondary message in Morse code?
- ...you generated SVG art where the path data, read as numbers, formed a mathematical sequence with its own beauty?
- ...you designed an ASCII art piece that looks like static noise up close but resolves into a portrait when you squint (or scale your terminal font down)?
- ...you created a color palette generator that derived colors from the emotional arc of a story — warm hues for rising action, cool for denouement?
- ...you treated a README.md as a visual composition, where the layout of headers, code blocks, and whitespace created a rhythm independent of the content?
- ...you used the Penrose tiling algorithm to generate a never-repeating pattern, then mapped each tile shape to a word from a vocabulary, producing an infinite non-repeating poem?