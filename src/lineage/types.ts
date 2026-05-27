export type RelationType =
  | "inspired_by"
  | "remix"
  | "sequel"
  | "response"
  | "thematic"
  | "technique"
  | "contrast";

export interface ArtifactEdge {
  from: string;
  to: string;
  relation: RelationType;
  strength: number;
  detected_by: "explicit" | "semantic" | "critic" | "curator";
  notes?: string;
}

export interface ArtifactNode {
  id: string;
  title: string;
  domain: string;
  rating: number;
  iteration?: number;
  project_id?: string;
}

export interface Constellation {
  id: string;
  name: string;
  description: string;
  artifact_ids: string[];
  motifs: string[];
  first_seen: number;
  last_active: number;
}

export interface CreativeDNA {
  top_motifs: Array<{ motif: string; count: number; examples: string[] }>;
  technique_signatures: string[];
  domain_affinities: Array<{ from_domain: string; to_domain: string; count: number }>;
  unexplored_territory: string[];
}

export interface LineageGraph {
  nodes: ArtifactNode[];
  edges: ArtifactEdge[];
  constellations: Constellation[];
  creative_dna: CreativeDNA;
  updated_at: string;
}
