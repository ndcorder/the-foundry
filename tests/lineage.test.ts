import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "yaml";
import { setRootDir } from "../src/root.js";
import type {
  ArtifactNode,
  ArtifactEdge,
  Constellation,
  LineageGraph,
} from "../src/lineage/types.js";

// ── Test data ────────────────────────────────────────────────────

const README_CODEFEELS = `# Codefeels

**Domain:** code-tool
**ID:** 0020
**Mean rating:** 4.9

## Proposal

ideas:
  - title: A Debugger That Shows You What Your Code Is Feeling
    domain: code-tool
    pitch: A CLI debug wrapper that assigns emotional states to code paths
    complexity: M
    why: Extends our code-as-emotional-medium thread — 0010 roasted the user
    project_id: null
    stimulus_ref: null

## Critic Review

This is excellent work. The concept extends what 0010 started.

## Ratings

| Dimension | Score |
|---|---|
| originality | 5 |
| craft | 5 |

## Tester Report

**Verdict:** pass
**Summary:** All tests passed.
`;

const README_ROASTBOT = `# Roastbot

**Domain:** code-tool
**ID:** 0010
**Mean rating:** 4.5

## Proposal

ideas:
  - title: A CLI That Roasts Your Code
    domain: code-tool
    pitch: Emotional feedback from a snarky linter
    complexity: S
    why: Original concept — code with feelings and personality
    project_id: null
    stimulus_ref: null

## Critic Review

Clever concept, good execution. The emotional vocabulary is effective.

## Ratings

| Dimension | Score |
|---|---|
| originality | 4 |
| craft | 5 |
`;

const README_LOADING_SCREEN_POEM = `# Loading Screen Poem

**Domain:** poetry
**ID:** 0030
**Mean rating:** 4.2

## Proposal

ideas:
  - title: A poem written as a loading screen with a password captcha
    domain: poetry
    pitch: An impossible interface that is also a poem about waiting and hovering
    complexity: S
    why: Explores interaction and interface as poetic form with button click hover
    project_id: null
    stimulus_ref: null

## Critic Review

This is a companion piece to 0020 — the interface metaphor works well.

## Ratings

| Dimension | Score |
|---|---|
| originality | 4 |
| craft | 4 |
`;

const README_CLOCK_DECAY = `# Clock Decay

**Domain:** code-art
**ID:** 0040
**Mean rating:** 3.8

## Proposal

ideas:
  - title: A clock that shows countdown fading and blinking over time with gradual decay
    domain: code-art
    pitch: Temporal mechanics as visual art — clock countdown blinking fading evolution
    complexity: M
    why: Time as material for generative art
    project_id: null
    stimulus_ref: null

## Critic Review

Interesting temporal exploration. The decay mechanic is well realized.

## Ratings

| Dimension | Score |
|---|---|
| originality | 4 |
| craft | 3 |
`;

const README_MALFORMED = `# Bad Entry

This README is missing the ID field.
**Domain:** fiction
`;

const README_LONELY_FICTION = `# Lonely Story

**Domain:** fiction
**ID:** 0050
**Mean rating:** 3.5

## Proposal

ideas:
  - title: A story about nothing in particular
    domain: fiction
    pitch: Mundane realism
    complexity: S
    why: Testing standalone fiction
    project_id: null
    stimulus_ref: null

## Critic Review

Decent but unremarkable.
`;

// ── Helpers ───────────────────────────────────────────────────────

let tempDir: string;

function seedPortfolio() {
  const portfolio = path.join(tempDir, "portfolio");
  mkdirSync(path.join(portfolio, "code", "0010-roastbot"), { recursive: true });
  mkdirSync(path.join(portfolio, "code", "0020-codefeels"), { recursive: true });
  mkdirSync(path.join(portfolio, "poetry", "0030-loading-screen-poem"), { recursive: true });
  mkdirSync(path.join(portfolio, "code-art", "0040-clock-decay"), { recursive: true });
  mkdirSync(path.join(portfolio, "fiction", "0050-lonely-story"), { recursive: true });

  writeFileSync(path.join(portfolio, "code", "0010-roastbot", "README.md"), README_ROASTBOT);
  writeFileSync(path.join(portfolio, "code", "0020-codefeels", "README.md"), README_CODEFEELS);
  writeFileSync(path.join(portfolio, "poetry", "0030-loading-screen-poem", "README.md"), README_LOADING_SCREEN_POEM);
  writeFileSync(path.join(portfolio, "code-art", "0040-clock-decay", "README.md"), README_CLOCK_DECAY);
  writeFileSync(path.join(portfolio, "fiction", "0050-lonely-story", "README.md"), README_LONELY_FICTION);
}

function makeReadmeMap() {
  return new Map([
    ["0010", {
      id: "0010", title: "Roastbot", domain: "code-tool", rating: 4.5,
      proposal: "Original concept — code with feelings and personality",
      review: "Clever concept, good execution. The emotional vocabulary is effective.",
    }],
    ["0020", {
      id: "0020", title: "Codefeels", domain: "code-tool", rating: 4.9,
      proposal: "Extends our code-as-emotional-medium thread — 0010 roasted the user",
      review: "This is excellent work. The concept extends what 0010 started.",
    }],
    ["0030", {
      id: "0030", title: "Loading Screen Poem", domain: "poetry", rating: 4.2,
      proposal: "An impossible interface that is also a poem about waiting and hovering",
      review: "This is a companion piece to 0020 — the interface metaphor works well.",
    }],
  ]);
}

function makeNodes(): ArtifactNode[] {
  return [
    { id: "0010", title: "Roastbot", domain: "code-tool", rating: 4.5 },
    { id: "0020", title: "Codefeels", domain: "code-tool", rating: 4.9 },
    { id: "0030", title: "Loading Screen Poem", domain: "poetry", rating: 4.2 },
  ];
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), "foundry-lineage-"));
  setRootDir(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────

import {
  scanPortfolio,
  detectExplicitReferences,
  detectThematicConnections,
  detectConstellations,
  extractCreativeDNA,
} from "../src/lineage/analyzer.js";

import {
  saveLineageGraph,
  loadLineageGraph,
} from "../src/lineage/store.js";

// ── detectExplicitReferences ─────────────────────────────────────

describe("detectExplicitReferences", () => {
  it("detects a reference to artifact 0010 in proposal text", () => {
    const readmes = makeReadmeMap();
    const edges = detectExplicitReferences(readmes);
    const refs = edges.filter((e) => e.to === "0010");
    expect(refs.length).toBeGreaterThanOrEqual(1);
    expect(refs[0].from).toBe("0020");
  });

  it('classifies "extends" as a sequel relationship', () => {
    const readmes = makeReadmeMap();
    const edges = detectExplicitReferences(readmes);
    const edge = edges.find((e) => e.from === "0020" && e.to === "0010");
    expect(edge).toBeDefined();
    expect(edge!.relation).toBe("sequel");
  });

  it('classifies "companion piece" as a thematic relationship', () => {
    const readmes = makeReadmeMap();
    const edges = detectExplicitReferences(readmes);
    const edge = edges.find((e) => e.from === "0030" && e.to === "0020");
    expect(edge).toBeDefined();
    expect(edge!.relation).toBe("thematic");
  });

  it("does not create duplicate edges for same pair+relation", () => {
    // 0020 references 0010 in both proposal and review ("extends...0010" in both)
    const readmes = makeReadmeMap();
    const edges = detectExplicitReferences(readmes);
    const matching = edges.filter(
      (e) => e.from === "0020" && e.to === "0010" && e.relation === "sequel",
    );
    expect(matching).toHaveLength(1);
  });

  it("returns empty for readmes with no cross-references", () => {
    const readmes = new Map([
      ["0010", {
        id: "0010", title: "Solo", domain: "code-tool", rating: 4.0,
        proposal: "Something original with no references.",
        review: "Standalone work.",
      }],
    ]);
    const edges = detectExplicitReferences(readmes);
    expect(edges).toHaveLength(0);
  });

  it("truncates notes to 120 chars max", () => {
    const readmes = makeReadmeMap();
    const edges = detectExplicitReferences(readmes);
    for (const edge of edges) {
      if (edge.notes) {
        expect(edge.notes.length).toBeLessThanOrEqual(120);
      }
    }
  });
});

// ── detectThematicConnections ────────────────────────────────────

describe("detectThematicConnections", () => {
  it("detects technique family matches between artifacts", () => {
    // Both artifacts need 2+ keyword hits in 2+ technique families each.
    // impossible_interfaces keywords: loading screen, captcha, password, interface, button, click
    // temporal_mechanics keywords: blinking, clock, countdown, fading, decay, over time
    const nodes: ArtifactNode[] = [
      { id: "0030", title: "Loading Screen Poem", domain: "poetry", rating: 4.2 },
      { id: "0040", title: "Clock Decay", domain: "code-art", rating: 3.8 },
    ];
    const readmes = new Map([
      ["0030", {
        id: "0030", title: "Loading Screen Poem", domain: "poetry", rating: 4.2,
        proposal: "A loading screen with captcha password interface. Also a blinking clock countdown fading over time.",
        review: "Good.",
      }],
      ["0040", {
        id: "0040", title: "Clock Decay", domain: "code-art", rating: 3.8,
        proposal: "A loading screen captcha password interface. Features blinking clock countdown fading over time decay.",
        review: "Decent.",
      }],
    ]);
    const edges = detectThematicConnections(nodes, readmes, []);
    const techniqueEdge = edges.find((e) => e.relation === "technique");
    expect(techniqueEdge).toBeDefined();
    expect(techniqueEdge!.detected_by).toBe("semantic");
    expect(techniqueEdge!.notes).toContain("Shared techniques:");
  });

  it("does not duplicate edges that already exist in existingEdges", () => {
    const nodes: ArtifactNode[] = [
      { id: "0030", title: "Loading Screen Poem", domain: "poetry", rating: 4.2 },
      { id: "0040", title: "Clock Decay", domain: "code-art", rating: 3.8 },
    ];
    const readmes = new Map([
      ["0030", {
        id: "0030", title: "Loading Screen Poem", domain: "poetry", rating: 4.2,
        proposal: "loading screen captcha password checkout button click hover interact UI",
        review: "Good.",
      }],
      ["0040", {
        id: "0040", title: "Clock Decay", domain: "code-art", rating: 3.8,
        proposal: "loading screen captcha password interact hover button click UI checkout",
        review: "Decent.",
      }],
    ]);
    const existing: ArtifactEdge[] = [{
      from: "0030", to: "0040", relation: "thematic",
      strength: 0.8, detected_by: "explicit",
    }];
    const edges = detectThematicConnections(nodes, readmes, existing);
    expect(edges).toHaveLength(0);
  });

  it("returns empty for nodes with no shared vocabulary", () => {
    const nodes: ArtifactNode[] = [
      { id: "0010", title: "Alpha", domain: "code-tool", rating: 4.0 },
      { id: "0050", title: "Bravo", domain: "fiction", rating: 3.0 },
    ];
    const readmes = new Map([
      ["0010", {
        id: "0010", title: "Alpha", domain: "code-tool", rating: 4.0,
        proposal: "quantum entropy analysis",
        review: "Good.",
      }],
      ["0050", {
        id: "0050", title: "Bravo", domain: "fiction", rating: 3.0,
        proposal: "medieval castle romance",
        review: "Fine.",
      }],
    ]);
    const edges = detectThematicConnections(nodes, readmes, []);
    expect(edges).toHaveLength(0);
  });

  it("finds thematic connections via significant shared vocabulary", () => {
    // Create two nodes with heavily overlapping non-stop-word vocabulary
    const sharedWords = "debugger compiler parser interpreter lexer optimizer evaluator transformer analyzer serializer";
    const nodes: ArtifactNode[] = [
      { id: "0010", title: "Tool A", domain: "code-tool", rating: 4.0 },
      { id: "0020", title: "Tool B", domain: "code-tool", rating: 4.0 },
    ];
    const readmes = new Map([
      ["0010", {
        id: "0010", title: "Tool A", domain: "code-tool", rating: 4.0,
        proposal: `This tool is a ${sharedWords} suite for code analysis`,
        review: "Solid.",
      }],
      ["0020", {
        id: "0020", title: "Tool B", domain: "code-tool", rating: 4.0,
        proposal: `Another ${sharedWords} focused on runtime inspection`,
        review: "Nice.",
      }],
    ]);
    const edges = detectThematicConnections(nodes, readmes, []);
    const thematic = edges.find((e) => e.relation === "thematic");
    expect(thematic).toBeDefined();
    expect(thematic!.detected_by).toBe("semantic");
    expect(thematic!.notes).toContain("Shared vocabulary:");
  });
});

// ── detectConstellations ─────────────────────────────────────────

describe("detectConstellations", () => {
  it("groups connected nodes into constellations", () => {
    const nodes: ArtifactNode[] = [
      { id: "0010", title: "A", domain: "code-tool", rating: 4.0 },
      { id: "0020", title: "B", domain: "code-tool", rating: 4.5 },
      { id: "0030", title: "C", domain: "poetry", rating: 3.0 },
    ];
    const edges: ArtifactEdge[] = [
      { from: "0010", to: "0020", relation: "sequel", strength: 0.9, detected_by: "explicit" },
    ];
    const constellations = detectConstellations(nodes, edges);
    expect(constellations).toHaveLength(1);
    expect(constellations[0].artifact_ids).toContain("0010");
    expect(constellations[0].artifact_ids).toContain("0020");
    expect(constellations[0].artifact_ids).not.toContain("0030");
  });

  it("sets first_seen and last_active from artifact IDs", () => {
    const nodes: ArtifactNode[] = [
      { id: "0010", title: "A", domain: "code-tool", rating: 4.0 },
      { id: "0020", title: "B", domain: "code-tool", rating: 4.5 },
    ];
    const edges: ArtifactEdge[] = [
      { from: "0010", to: "0020", relation: "sequel", strength: 0.9, detected_by: "explicit" },
    ];
    const constellations = detectConstellations(nodes, edges);
    expect(constellations[0].first_seen).toBe(10);
    expect(constellations[0].last_active).toBe(20);
  });

  it("does not create constellations from single nodes", () => {
    const nodes: ArtifactNode[] = [
      { id: "0010", title: "A", domain: "code-tool", rating: 4.0 },
      { id: "0020", title: "B", domain: "poetry", rating: 3.5 },
    ];
    // No edges strong enough (threshold is 0.75)
    const edges: ArtifactEdge[] = [
      { from: "0010", to: "0020", relation: "thematic", strength: 0.3, detected_by: "semantic" },
    ];
    const constellations = detectConstellations(nodes, edges);
    expect(constellations).toHaveLength(0);
  });

  it("assigns evocative names based on technique families", () => {
    const nodes: ArtifactNode[] = [
      { id: "0010", title: "Emotional Robot A", domain: "code-tool", rating: 4.0 },
      { id: "0020", title: "Emotional Robot B", domain: "code-tool", rating: 4.5 },
    ];
    const edges: ArtifactEdge[] = [{
      from: "0010", to: "0020", relation: "technique", strength: 0.9,
      detected_by: "semantic",
      notes: "Shared techniques: anthropomorphized_systems",
    }];
    const constellations = detectConstellations(nodes, edges);
    expect(constellations).toHaveLength(1);
    // The name should come from the evocative_name of the technique family
    expect(constellations[0].name).toBe("Machines with Feelings");
  });

  it("produces motifs from technique family matches on titles", () => {
    // Node titles with temporal mechanics keywords (blinking, clock, countdown)
    const nodes: ArtifactNode[] = [
      { id: "0010", title: "A blinking clock countdown", domain: "code-art", rating: 4.0 },
      { id: "0020", title: "A fading countdown clock decay", domain: "code-art", rating: 4.5 },
    ];
    const edges: ArtifactEdge[] = [{
      from: "0010", to: "0020", relation: "sequel", strength: 0.9,
      detected_by: "explicit",
    }];
    const constellations = detectConstellations(nodes, edges);
    expect(constellations).toHaveLength(1);
    // temporal_mechanics keywords should produce "Time as Material" motif
    expect(constellations[0].motifs).toContain("Time as Material");
  });
});

// ── extractCreativeDNA ───────────────────────────────────────────

describe("extractCreativeDNA", () => {
  const baseNodes: ArtifactNode[] = [
    { id: "0010", title: "A", domain: "code-tool", rating: 4.0 },
    { id: "0020", title: "B", domain: "poetry", rating: 4.5 },
    { id: "0030", title: "C", domain: "code-tool", rating: 3.0 },
  ];

  const baseEdges: ArtifactEdge[] = [
    {
      from: "0010", to: "0020", relation: "thematic", strength: 0.8,
      detected_by: "semantic",
      notes: "Shared techniques: anthropomorphized_systems, impossible_interfaces",
    },
    {
      from: "0020", to: "0030", relation: "technique", strength: 0.7,
      detected_by: "semantic",
      notes: "Shared techniques: anthropomorphized_systems",
    },
  ];

  const baseConstellations: Constellation[] = [{
    id: "constellation-001",
    name: "Machines with Feelings",
    description: "3 works",
    artifact_ids: ["0010", "0020", "0030"],
    motifs: ["Machines with Feelings", "Interfaces That Know Too Much"],
    first_seen: 10,
    last_active: 30,
  }];

  it("returns top motifs sorted by count", () => {
    const dna = extractCreativeDNA(baseNodes, baseEdges, baseConstellations);
    expect(dna.top_motifs.length).toBeGreaterThan(0);
    // motifs should be sorted descending by count
    for (let i = 1; i < dna.top_motifs.length; i++) {
      expect(dna.top_motifs[i].count).toBeLessThanOrEqual(dna.top_motifs[i - 1].count);
    }
  });

  it('filters out "cross-domain" motifs', () => {
    const constellationsWithCrossDomain: Constellation[] = [{
      ...baseConstellations[0],
      motifs: ["cross-domain exploration", "Machines with Feelings"],
    }];
    const dna = extractCreativeDNA(baseNodes, baseEdges, constellationsWithCrossDomain);
    const motifNames = dna.top_motifs.map((m) => m.motif);
    expect(motifNames.every((m) => !m.startsWith("cross-domain"))).toBe(true);
  });

  it("detects technique signatures from edge notes", () => {
    const dna = extractCreativeDNA(baseNodes, baseEdges, baseConstellations);
    expect(dna.technique_signatures).toContain("Machines with Feelings");
    expect(dna.technique_signatures).toContain("Interfaces That Know Too Much");
  });

  it("finds domain affinities from cross-domain edges", () => {
    const dna = extractCreativeDNA(baseNodes, baseEdges, baseConstellations);
    // 0010 (code-tool) -> 0020 (poetry) is a cross-domain edge
    expect(dna.domain_affinities.length).toBeGreaterThan(0);
    const affinity = dna.domain_affinities.find(
      (a) =>
        (a.from_domain === "code-tool" && a.to_domain === "poetry") ||
        (a.from_domain === "poetry" && a.to_domain === "code-tool"),
    );
    expect(affinity).toBeDefined();
  });

  it("produces unexplored territory combinations", () => {
    // anthropomorphized_systems appears with code-tool and poetry via nodes
    // impossible_interfaces appears via edges
    // The unexplored territory should suggest combos of seen techniques with unseen domains
    const nodes: ArtifactNode[] = [
      { id: "0010", title: "Emotional feels personality soul sentient", domain: "code-tool", rating: 4.0 },
      { id: "0020", title: "Something normal", domain: "poetry", rating: 4.5 },
    ];
    const edges: ArtifactEdge[] = [];
    const constellations: Constellation[] = [];
    const dna = extractCreativeDNA(nodes, edges, constellations);
    // anthropomorphized_systems seen with code-tool but not poetry
    // so "Machines with Feelings × poetry" should be unexplored
    const hasUnexplored = dna.unexplored_territory.some(
      (t) => t.includes("Machines with Feelings") && t.includes("poetry"),
    );
    expect(hasUnexplored).toBe(true);
  });
});

// ── saveLineageGraph / loadLineageGraph ──────────────────────────

describe("saveLineageGraph / loadLineageGraph", () => {
  const makeGraph = (): LineageGraph => ({
    nodes: [{ id: "0010", title: "Test", domain: "code-tool", rating: 4.0 }],
    edges: [],
    constellations: [],
    creative_dna: {
      top_motifs: [],
      technique_signatures: [],
      domain_affinities: [],
      unexplored_territory: [],
    },
    updated_at: "2026-01-01T00:00:00.000Z",
  });

  it("saves graph as YAML to identity/lineage.yml", async () => {
    const graph = makeGraph();
    await saveLineageGraph(graph);
    const filePath = path.join(tempDir, "identity", "lineage.yml");
    const content = readFileSync(filePath, "utf-8");
    const parsed = yaml.parse(content);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0].id).toBe("0010");
    expect(parsed.updated_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("creates identity directory if it doesn't exist", async () => {
    const graph = makeGraph();
    await saveLineageGraph(graph);
    const filePath = path.join(tempDir, "identity", "lineage.yml");
    expect(readFileSync(filePath, "utf-8")).toBeTruthy();
  });

  it("loads and parses saved graph", async () => {
    const graph = makeGraph();
    await saveLineageGraph(graph);
    const loaded = await loadLineageGraph();
    expect(loaded).not.toBeNull();
    expect(loaded!.nodes).toHaveLength(1);
    expect(loaded!.nodes[0].title).toBe("Test");
    expect(loaded!.updated_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns null when file doesn't exist", async () => {
    const loaded = await loadLineageGraph();
    expect(loaded).toBeNull();
  });
});

// ── scanPortfolio ────────────────────────────────────────────────

describe("scanPortfolio", () => {
  it("reads all portfolio domain directories", async () => {
    seedPortfolio();
    const { nodes, readmes } = await scanPortfolio();
    // Should find 5 valid artifacts (the malformed one is not seeded)
    expect(nodes.length).toBe(5);
    expect(readmes.size).toBe(5);
  });

  it("parses README format correctly", async () => {
    seedPortfolio();
    const { nodes, readmes } = await scanPortfolio();
    const codefeels = readmes.get("0020");
    expect(codefeels).toBeDefined();
    expect(codefeels!.title).toBe("Codefeels");
    expect(codefeels!.domain).toBe("code-tool");
    expect(codefeels!.rating).toBe(4.9);
    expect(codefeels!.proposal).toContain("Debugger");
    expect(codefeels!.review).toContain("excellent");

    const node = nodes.find((n) => n.id === "0020");
    expect(node).toBeDefined();
    expect(node!.title).toBe("Codefeels");
    expect(node!.domain).toBe("code-tool");
    expect(node!.rating).toBe(4.9);
  });

  it("skips malformed READMEs", async () => {
    // Add a malformed README alongside the good ones
    const portfolio = path.join(tempDir, "portfolio");
    mkdirSync(path.join(portfolio, "fiction", "bad-entry"), { recursive: true });
    writeFileSync(path.join(portfolio, "fiction", "bad-entry", "README.md"), README_MALFORMED);

    seedPortfolio();
    const { nodes } = await scanPortfolio();
    // The malformed one should be skipped — only 5 valid
    const malformed = nodes.find((n) => n.title === "Bad Entry");
    expect(malformed).toBeUndefined();
  });

  it("returns empty for empty portfolio", async () => {
    mkdirSync(path.join(tempDir, "portfolio"), { recursive: true });
    const { nodes, readmes } = await scanPortfolio();
    expect(nodes).toHaveLength(0);
    expect(readmes.size).toBe(0);
  });

  it("returns empty when portfolio directory does not exist", async () => {
    const { nodes, readmes } = await scanPortfolio();
    expect(nodes).toHaveLength(0);
    expect(readmes.size).toBe(0);
  });
});
