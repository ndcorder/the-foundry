export type {
  RelationType,
  ArtifactEdge,
  ArtifactNode,
  Constellation,
  CreativeDNA,
  LineageGraph,
} from "./types.js";

export {
  scanPortfolio,
  detectExplicitReferences,
  detectThematicConnections,
  detectConstellations,
  extractCreativeDNA,
  buildLineageGraph,
} from "./analyzer.js";

export {
  saveLineageGraph,
  loadLineageGraph,
} from "./store.js";
