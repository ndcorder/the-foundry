# Code Architecture Reference

## Data-Oriented Design

- **Struct-of-arrays vs. array-of-structs:** Instead of `Player[]` where each player has position, health, name — use separate arrays: `positions[]`, `healths[]`, `names[]`. Iterating over one property hits cache lines sequentially. 10-100x faster for hot loops.
- **Entity Component System (ECS):** Entities are just IDs (integers). Components are pure data (Position, Velocity, Health). Systems are functions that iterate over entities matching a component signature. Decouples data from behavior completely. Used in games but applicable anywhere you have heterogeneous collections with shared operations.
- **Cache-friendly layouts:** Data you access together should live together in memory. When designing data structures, ask: "What operations run most frequently, and what data do they touch?" Optimize layout for the hot path.

## Functional Patterns in Imperative Contexts

- **Pipeline/chain pattern:** `input |> validate |> transform |> enrich |> persist`. Each step is a pure function. The pipeline is declarative — reads like a description of what happens, not how. In languages without pipe operators, use method chaining or explicit composition.
- **Monads without the name:** `Result<T, E>` (Rust), `Optional<T>` (Java), `Promise<T>` (JS). They all encode "a value that might not be there yet / might have failed" and provide `.map()` / `.flatMap()` to chain operations without unwrapping. Use them instead of null checks and try/catch.
- **State machines as architecture:** Many bugs come from impossible state combinations. A user who is both "logged in" and "banned" shouldn't exist. Model state as an explicit enum/union where each variant carries only the data valid for that state. Transitions are the only way to change state.
- **Immutable-by-default:** Mutable shared state is the root of most concurrency bugs and many single-threaded bugs too. Default to immutable data, copy-on-write, or persistent data structures. Mutate only at boundaries.

## Constraint-Driven Design

- **Make illegal states unrepresentable:** If a function requires a non-empty list, use a `NonEmptyList` type, not a runtime check. If an email must be validated, use a `ValidatedEmail` newtype. Push validation to the boundary; interior code works with already-valid types.
- **Parse, don't validate:** Validation checks data and throws it away (returns bool). Parsing checks data and preserves the knowledge (returns a richer type). After parsing, you never need to re-check. `parseEmail(s: string): Email | Error` is better than `isValidEmail(s: string): boolean`.
- **Type-state pattern:** Encode state transitions in the type system. A `Connection<Closed>` has a `.open()` method returning `Connection<Open>`. A `Connection<Open>` has `.query()` and `.close()`. Calling `.query()` on a closed connection is a compile error, not a runtime error.

## CLI Design Philosophy

- **Unix philosophy:** Do one thing well. Accept stdin, produce stdout. Play nice with pipes. Exit codes are a contract (0 = success, non-zero = failure). Stderr is for diagnostics, stdout is for data.
- **Composability:** Design programs as filters. Input from stdin or files, output to stdout. Let the user compose behavior with pipes rather than building every feature in.
- **Progressive disclosure:** `tool` does the obvious thing with sensible defaults. `tool --verbose` shows more. `tool --config advanced.yml` unlocks everything. Don't require configuration for the common case.
- **Subcommand patterns:** `tool <verb> <noun> [flags]`. `git commit`, `docker build`, `kubectl get pods`. Discoverable, tab-completable, self-documenting.

## Creative Coding Patterns

- **L-systems:** A string-rewriting grammar. Start with an axiom ("A"), apply production rules ("A → AB", "B → A") iteratively. Interpret the resulting string as drawing instructions. Generates fractal plants, branching structures, organic forms.
- **Cellular automata:** A grid of cells, each with a state. Each step, every cell's new state is determined by its neighbors. Rule 110 is Turing-complete. Conway's Game of Life produces gliders, oscillators, and self-replicating patterns from four simple rules.
- **Noise functions:** Perlin noise / simplex noise produce smooth, organic-looking random values. Use for terrain generation, cloud textures, animation easing, generative art. Layer multiple octaves (fractal noise) for natural-looking complexity.
- **Marching squares/cubes:** Convert a scalar field (grid of values) into contour lines (2D) or mesh surfaces (3D). The algorithm "marches" through cells, looking up how to draw the boundary from a table of cases. Used in isosurface extraction, map generation, metaballs.

## Systems That Surprise Their Creators

- **Emergent behavior:** Simple local rules produce complex global behavior. Flocking (boids): three rules (separation, alignment, cohesion) create realistic flocking. No bird knows the pattern — it emerges.
- **Generative systems:** Define a possibility space and a set of constraints, then let the system explore. Constraint propagation, wave function collapse, genetic algorithms. The designer authors the space, not the output.
- **Evolutionary algorithms:** Represent solutions as "genomes." Mutate, crossbreed, select by fitness. Works on problems where you can evaluate quality but can't compute the solution directly. Has produced antenna designs, game strategies, and art that surprises their creators.
- **Strange loops and self-reference:** Programs that inspect or modify their own source. Quines (programs that print themselves). Self-modifying code. Meta-circular evaluators. These aren't just tricks — they're how consciousness and meaning might work (per Hofstadter).
