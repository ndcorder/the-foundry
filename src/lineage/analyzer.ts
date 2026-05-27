import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { resolve } from "../root.js";
import type {
  ArtifactNode,
  ArtifactEdge,
  Constellation,
  CreativeDNA,
  LineageGraph,
  RelationType,
} from "./types.js";

interface ParsedReadme {
  id: string;
  title: string;
  domain: string;
  rating: number;
  proposal: string;
  review: string;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "of", "for", "in", "on", "at", "to", "by", "is", "it",
  "its", "and", "or", "but", "that", "this", "with", "from", "as", "was",
  "are", "be", "has", "have", "had", "do", "does", "did", "not", "no",
  "you", "your", "we", "our", "they", "them", "their", "who", "what",
  "when", "where", "how", "which", "if", "so", "than", "then", "too",
  "very", "just", "about", "up", "out", "into", "over", "also", "been",
  "being", "some", "would", "could", "should", "will", "can", "may",
  "more", "most", "only", "other", "new", "one", "two", "every",
]);

interface TechniqueFamily {
  name: string;
  evocative_name: string;
  keywords: string[];
}

const TECHNIQUE_FAMILIES: TechniqueFamily[] = [
  {
    name: "anthropomorphized_systems",
    evocative_name: "Machines with Feelings",
    keywords: [
      "feeling", "feels", "emotional", "empathize", "empathizes", "anxious",
      "lonely", "neglected", "opinions", "personali", "anthropomorphi",
      "interiority", "soul", "personality", "sentient",
    ],
  },
  {
    name: "bureaucratic_fiction",
    evocative_name: "The Bureaucratic Uncanny",
    keywords: [
      "performance review", "procurement", "form", "handbook", "filing",
      "terms of service", "audit", "checklist", "onboarding", "institutional",
      "bureaucra", "policy", "compliance", "requisition",
    ],
  },
  {
    name: "annotated_documents",
    evocative_name: "Marginalia and Multiple Voices",
    keywords: [
      "annotated", "marginali", "margin", "multiple voices", "two hands",
      "handwriting", "footnote", "commentary", "interlinear",
    ],
  },
  {
    name: "data_as_art",
    evocative_name: "Data Made Audible",
    keywords: [
      "heatmap", "visualization", "data", "algorithm", "compression",
      "entropy", "midi", "translation", "translat", "mapping",
      "log", "metric", "signal",
    ],
  },
  {
    name: "impossible_interfaces",
    evocative_name: "Interfaces That Know Too Much",
    keywords: [
      "loading screen", "captcha", "password", "checkout", "pagination",
      "compass", "visual field", "seating chart", "interface", "UI",
      "button", "click", "hover", "interact",
    ],
  },
  {
    name: "formal_containers",
    evocative_name: "Found Forms",
    keywords: [
      "recipe", "curriculum vitae", "resume", "changelog", "gitignore",
      "bus schedule", "receipt", "floor plan", "glossary", "score",
      "instruction manual", "move list", "frame data",
    ],
  },
  {
    name: "temporal_mechanics",
    evocative_name: "Time as Material",
    keywords: [
      "blinking", "clock", "countdown", "decay", "fading", "evolution",
      "progression", "repetition", "loop", "accumulate", "erode",
      "over time", "gradually",
    ],
  },
];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const PORTFOLIO_DOMAINS = [
  "code-tool", "code-art", "code-game",
  "fiction", "poetry", "essay", "experiment",
  "music", "worldbuilding", "prose", "games", "tools",
];

function parseReadme(content: string, fileDomain: string): ParsedReadme | null {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const idMatch = content.match(/\*\*ID:\*\*\s*(\d{4})/);
  const domainMatch = content.match(/\*\*Domain:\*\*\s*(.+?)\s/);
  const ratingMatch = content.match(/\*\*Mean rating:\*\*\s*([\d.]+)/);

  if (!titleMatch || !idMatch) return null;

  const proposalMatch = content.match(/## Proposal\s+([\s\S]*?)(?=\n## |$)/);
  const reviewMatch = content.match(/## Critic Review\s+([\s\S]*?)(?=\n## |$)/);

  return {
    id: idMatch[1],
    title: titleMatch[1].replace(/\s*\(KILLED\)/, ""),
    domain: domainMatch?.[1]?.trim() ?? fileDomain,
    rating: ratingMatch ? parseFloat(ratingMatch[1]) : 0,
    proposal: proposalMatch?.[1]?.trim() ?? "",
    review: reviewMatch?.[1]?.trim() ?? "",
  };
}

async function findReadmes(): Promise<Array<{ path: string; domain: string }>> {
  const portfolioDir = resolve("portfolio");
  const results: Array<{ path: string; domain: string }> = [];

  let topEntries: string[];
  try {
    topEntries = await readdir(portfolioDir);
  } catch {
    return results;
  }

  for (const domainDir of topEntries) {
    if (domainDir === "killed" || domainDir === "projects") continue;
    const domainPath = path.join(portfolioDir, domainDir);

    let artifacts: string[];
    try {
      artifacts = await readdir(domainPath);
    } catch {
      continue;
    }

    for (const artifact of artifacts) {
      if (artifact === "index.md") continue;
      const readmePath = path.join(domainPath, artifact, "README.md");
      results.push({ path: readmePath, domain: domainDir });
    }
  }

  return results;
}

export async function scanPortfolio(): Promise<{ nodes: ArtifactNode[]; readmes: Map<string, ParsedReadme> }> {
  const files = await findReadmes();
  const nodes: ArtifactNode[] = [];
  const readmes = new Map<string, ParsedReadme>();

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file.path, "utf-8");
    } catch {
      continue;
    }

    const parsed = parseReadme(content, file.domain);
    if (!parsed) continue;

    readmes.set(parsed.id, parsed);
    nodes.push({
      id: parsed.id,
      title: parsed.title,
      domain: parsed.domain,
      rating: parsed.rating,
    });
  }

  return { nodes, readmes };
}

export function detectExplicitReferences(
  readmes: Map<string, ParsedReadme>,
): ArtifactEdge[] {
  const edges: ArtifactEdge[] = [];
  const idPattern = /\b(\d{4})\b/g;

  for (const [id, readme] of readmes) {
    const text = readme.proposal + "\n" + readme.review;
    const matches = text.matchAll(idPattern);

    for (const match of matches) {
      const refId = match[0];
      if (refId === id) continue;
      if (!readmes.has(refId)) continue;

      const relation = classifyExplicitReference(text, refId);
      const detected_by = text.indexOf(refId) < (readme.proposal.length)
        ? "explicit" as const
        : "critic" as const;

      if (!edges.some((e) => e.from === id && e.to === refId && e.relation === relation)) {
        edges.push({
          from: id,
          to: refId,
          relation,
          strength: detected_by === "explicit" ? 0.9 : 0.7,
          detected_by,
          notes: extractReferenceContext(text, refId),
        });
      }
    }
  }

  return edges;
}

function classifyExplicitReference(text: string, refId: string): RelationType {
  const surrounding = extractReferenceContext(text, refId).toLowerCase();

  if (/extends|continues|sequel|continuation|next/.test(surrounding)) return "sequel";
  if (/rework|reimagin|remix|variation/.test(surrounding)) return "remix";
  if (/respond|argues|counter|invert|reverse/.test(surrounding)) return "response";
  if (/companion|sibling|rightful companion/.test(surrounding)) return "thematic";
  if (/technique|form from|form of/.test(surrounding)) return "technique";
  if (/contrast|opposite|inversion|deliberately/.test(surrounding)) return "contrast";
  return "inspired_by";
}

function extractReferenceContext(text: string, refId: string): string {
  const idx = text.indexOf(refId);
  if (idx === -1) return "";
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + refId.length + 60);
  let fragment = text.slice(start, end).replace(/\n/g, " ").trim();
  // Trim to sentence boundaries when possible
  const sentenceStart = fragment.indexOf(". ");
  if (sentenceStart > 0 && sentenceStart < 30) fragment = fragment.slice(sentenceStart + 2);
  const sentenceEnd = fragment.lastIndexOf(".");
  if (sentenceEnd > fragment.length * 0.5) fragment = fragment.slice(0, sentenceEnd + 1);
  return fragment.length > 120 ? fragment.slice(0, 117) + "..." : fragment;
}

function extractKeyPhrases(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

export function detectThematicConnections(
  nodes: ArtifactNode[],
  readmes: Map<string, ParsedReadme>,
  existingEdges: ArtifactEdge[],
): ArtifactEdge[] {
  const edges: ArtifactEdge[] = [];
  const edgeSet = new Set(existingEdges.map((e) => `${e.from}-${e.to}`));

  const nodeTexts = new Map<string, { phrases: string[]; techniques: string[] }>();
  for (const node of nodes) {
    const readme = readmes.get(node.id);
    if (!readme) continue;

    const fullText = `${readme.title} ${readme.proposal}`;
    const phrases = extractKeyPhrases(fullText);
    const techniques = matchTechniques(fullText);
    nodeTexts.set(node.id, { phrases, techniques });
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const key = `${a.id}-${b.id}`;
      const reverseKey = `${b.id}-${a.id}`;
      if (edgeSet.has(key) || edgeSet.has(reverseKey)) continue;

      const aData = nodeTexts.get(a.id);
      const bData = nodeTexts.get(b.id);
      if (!aData || !bData) continue;

      const sharedTechniques = aData.techniques.filter((t) => bData.techniques.includes(t));
      if (sharedTechniques.length >= 2) {
        edges.push({
          from: a.id,
          to: b.id,
          relation: "technique",
          strength: Math.min(0.3 + sharedTechniques.length * 0.15, 0.8),
          detected_by: "semantic",
          notes: `Shared techniques: ${sharedTechniques.join(", ")}`,
        });
        edgeSet.add(key);
        continue;
      }

      const sharedPhrases = aData.phrases.filter((p) => bData.phrases.includes(p));
      const uniqueShared = [...new Set(sharedPhrases)];
      const overlap = uniqueShared.length / Math.min(aData.phrases.length, bData.phrases.length);
      if (overlap > 0.25 && uniqueShared.length >= 5) {
        edges.push({
          from: a.id,
          to: b.id,
          relation: "thematic",
          strength: Math.min(overlap, 0.7),
          detected_by: "semantic",
          notes: `Shared vocabulary: ${uniqueShared.slice(0, 5).join(", ")}`,
        });
        edgeSet.add(key);
      }
    }
  }

  return edges;
}

function matchTechniques(text: string, minHits = 2): string[] {
  const lower = text.toLowerCase();
  const matched: string[] = [];

  for (const family of TECHNIQUE_FAMILIES) {
    const hits = family.keywords.filter((kw) => lower.includes(kw)).length;
    if (hits >= minHits) {
      matched.push(family.name);
    }
  }

  return matched;
}

const CONSTELLATION_STRENGTH_THRESHOLD = 0.75;

export function detectConstellations(
  nodes: ArtifactNode[],
  edges: ArtifactEdge[],
): Constellation[] {
  const strongEdges = edges.filter((e) => e.strength >= CONSTELLATION_STRENGTH_THRESHOLD);

  const adjacency = new Map<string, Set<string>>();
  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }
  for (const edge of strongEdges) {
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }

  // Connected components via BFS
  const visited = new Set<string>();
  const clusters: string[][] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const cluster: string[] = [];
    const queue = [node.id];
    visited.add(node.id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      cluster.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    if (cluster.length >= 2) {
      clusters.push(cluster);
    }
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const allEdges = edges;
  const usedNames = new Set<string>();

  return clusters.map((cluster, idx) => {
    const clusterEdges = allEdges.filter(
      (e) => cluster.includes(e.from) && cluster.includes(e.to),
    );
    const motifs = deriveClusterMotifs(cluster, clusterEdges, nodeMap);
    const iterations = cluster
      .map((id) => parseInt(id, 10))
      .filter((n) => !isNaN(n));

    let name = deriveConstellationName(cluster, clusterEdges, nodeMap);
    if (usedNames.has(name)) {
      const domains = [...new Set(cluster.map((id) => nodeMap.get(id)?.domain).filter(Boolean))];
      name = `${name} (${domains.join(", ")})`;
    }
    usedNames.add(name);

    return {
      id: `constellation-${String(idx + 1).padStart(3, "0")}`,
      name,
      description: deriveDescription(cluster, motifs, nodeMap),
      artifact_ids: cluster.sort(),
      motifs,
      first_seen: iterations.length > 0 ? Math.min(...iterations) : 0,
      last_active: iterations.length > 0 ? Math.max(...iterations) : 0,
    };
  });
}

function deriveClusterMotifs(
  cluster: string[],
  edges: ArtifactEdge[],
  nodeMap: Map<string, ArtifactNode>,
): string[] {
  const techniqueCounts = new Map<string, number>();

  for (const edge of edges) {
    if (edge.notes) {
      const techMatch = edge.notes.match(/Shared techniques: (.+)/);
      if (techMatch) {
        for (const tech of techMatch[1].split(", ")) {
          techniqueCounts.set(tech, (techniqueCounts.get(tech) ?? 0) + 1);
        }
      }
    }
  }

  // Also scan node titles directly for technique families
  for (const id of cluster) {
    const node = nodeMap.get(id);
    if (!node) continue;
    const matched = matchTechniques(node.title, 1);
    for (const tech of matched) {
      techniqueCounts.set(tech, (techniqueCounts.get(tech) ?? 0) + 1);
    }
  }

  const motifs = [...techniqueCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => {
      const family = TECHNIQUE_FAMILIES.find((f) => f.name === name);
      return family ? family.evocative_name : capitalize(name.replace(/_/g, " "));
    });

  return motifs.slice(0, 5);
}

function deriveConstellationName(
  cluster: string[],
  edges: ArtifactEdge[],
  nodeMap: Map<string, ArtifactNode>,
): string {
  // Try technique-based naming from edge metadata
  const techniqueCounts = new Map<string, number>();
  for (const edge of edges) {
    if (edge.notes?.includes("Shared techniques:")) {
      const techs = edge.notes.replace("Shared techniques: ", "").split(", ");
      for (const tech of techs) {
        techniqueCounts.set(tech, (techniqueCounts.get(tech) ?? 0) + 1);
      }
    }
  }

  const dominantTechnique = [...techniqueCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  if (dominantTechnique) {
    const family = TECHNIQUE_FAMILIES.find((f) => f.name === dominantTechnique);
    if (family) return family.evocative_name;
  }

  // Try technique matching directly on artifact titles
  const titleTechniques = new Map<string, number>();
  for (const id of cluster) {
    const node = nodeMap.get(id);
    if (!node) continue;
    for (const tech of matchTechniques(node.title, 1)) {
      titleTechniques.set(tech, (titleTechniques.get(tech) ?? 0) + 1);
    }
  }
  const bestTitleTechnique = [...titleTechniques.entries()]
    .sort((a, b) => b[1] - a[1])[0];
  if (bestTitleTechnique && bestTitleTechnique[1] >= 2) {
    const family = TECHNIQUE_FAMILIES.find((f) => f.name === bestTitleTechnique[0]);
    if (family) return family.evocative_name;
  }

  // Try relation-based naming with context from edge notes
  const dominantRelation = [...edges.reduce((m, e) => {
    m.set(e.relation, (m.get(e.relation) ?? 0) + 1);
    return m;
  }, new Map<RelationType, number>()).entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  const domains = [...new Set(cluster.map((id) => nodeMap.get(id)?.domain).filter((d): d is string => !!d))];
  const titles = cluster.slice(0, 2).map((id) => nodeMap.get(id)?.title).filter((t): t is string => !!t);

  if (dominantRelation === "sequel" || dominantRelation === "inspired_by") {
    if (domains.length === 1) return `The ${capitalize(domains[0]!)} Thread`;
    return `The ${domains.slice(0, 2).map(capitalize).join(" & ")} Thread`;
  }

  if (dominantRelation === "thematic") {
    if (domains.length === 1) return `${capitalize(domains[0]!)} Convergence`;
    return `${domains.slice(0, 2).map(capitalize).join(" & ")} Dialogue`;
  }

  if (domains.length > 0) {
    return `The ${domains.map(capitalize).join(" & ")} Cluster`;
  }
  return `Cluster ${cluster[0]}-${cluster[cluster.length - 1]}`;
}

function deriveDescription(
  cluster: string[],
  motifs: string[],
  nodeMap: Map<string, ArtifactNode>,
): string {
  const domains = [...new Set(cluster.map((id) => nodeMap.get(id)?.domain).filter(Boolean))];
  const domainStr = domains.length > 1 ? `spanning ${domains.join(", ")}` : `in ${domains[0] ?? "mixed"}`;
  const motifStr = motifs.length > 0
    ? motifs.slice(0, 2).join(" and ").toLowerCase()
    : "shared creative threads";
  return `${cluster.length} works ${domainStr}, connected through ${motifStr}.`;
}

export function extractCreativeDNA(
  nodes: ArtifactNode[],
  edges: ArtifactEdge[],
  constellations: Constellation[],
): CreativeDNA {
  // Top motifs
  const motifCounts = new Map<string, { count: number; examples: Set<string> }>();
  for (const constellation of constellations) {
    for (const motif of constellation.motifs) {
      const existing = motifCounts.get(motif) ?? { count: 0, examples: new Set<string>() };
      existing.count += constellation.artifact_ids.length;
      for (const id of constellation.artifact_ids.slice(0, 3)) {
        existing.examples.add(id);
      }
      motifCounts.set(motif, existing);
    }
  }
  const top_motifs = [...motifCounts.entries()]
    .filter(([motif]) => !motif.startsWith("cross-domain"))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([motif, data]) => ({
      motif,
      count: data.count,
      examples: [...data.examples].slice(0, 5),
    }));

  // Technique signatures from families that actually appear
  const seenFamilies = new Set<string>();
  for (const edge of edges) {
    if (edge.notes?.includes("Shared techniques:")) {
      for (const tech of edge.notes.replace("Shared techniques: ", "").split(", ")) {
        seenFamilies.add(tech);
      }
    }
  }
  const technique_signatures = TECHNIQUE_FAMILIES
    .filter((f) => seenFamilies.has(f.name))
    .map((f) => f.evocative_name);

  // Domain affinities
  const domainPairCounts = new Map<string, number>();
  for (const edge of edges) {
    const fromNode = nodes.find((n) => n.id === edge.from);
    const toNode = nodes.find((n) => n.id === edge.to);
    if (!fromNode || !toNode || fromNode.domain === toNode.domain) continue;
    const pair = [fromNode.domain, toNode.domain].sort().join("|");
    domainPairCounts.set(pair, (domainPairCounts.get(pair) ?? 0) + 1);
  }
  const domain_affinities = [...domainPairCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pair, count]) => {
      const [from_domain, to_domain] = pair.split("|");
      return { from_domain, to_domain, count };
    });

  // Unexplored territory: technique x domain combos that haven't been tried
  const seenCombos = new Set<string>();
  for (const node of nodes) {
    const families = matchTechniques(node.title);
    for (const fam of families) {
      seenCombos.add(`${fam}|${node.domain}`);
    }
  }
  const unexplored_territory: string[] = [];
  const activeDomains = new Set(nodes.map((n) => n.domain));
  for (const family of TECHNIQUE_FAMILIES) {
    const familyDomains = new Set<string>();
    for (const domain of activeDomains) {
      if (seenCombos.has(`${family.name}|${domain}`)) familyDomains.add(domain);
    }
    if (familyDomains.size === 0) continue;
    for (const domain of activeDomains) {
      if (!seenCombos.has(`${family.name}|${domain}`)) {
        unexplored_territory.push(`${family.evocative_name} × ${domain}`);
      }
    }
  }

  return {
    top_motifs,
    technique_signatures,
    domain_affinities,
    unexplored_territory: unexplored_territory.slice(0, 15),
  };
}

export async function buildLineageGraph(): Promise<LineageGraph> {
  const { nodes, readmes } = await scanPortfolio();

  const explicitEdges = detectExplicitReferences(readmes);
  const thematicEdges = detectThematicConnections(nodes, readmes, explicitEdges);
  const edges = [...explicitEdges, ...thematicEdges];

  const constellations = detectConstellations(nodes, edges);
  const creative_dna = extractCreativeDNA(nodes, edges, constellations);

  return {
    nodes,
    edges,
    constellations,
    creative_dna,
    updated_at: new Date().toISOString(),
  };
}
