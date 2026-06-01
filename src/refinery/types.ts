export type RefinerySourceType = "dream" | "low_rated" | "companion";
export type RefineryType = "resurrected" | "remastered" | "companion";

export interface RefineryConfig {
  enabled: boolean;
  min_iterations_between_runs: number;
  max_refinery_queue: number;
}

export interface RefineryCadenceStatus {
  enabled: boolean;
  minIterationsBetweenRuns: number;
  lastIteration: number | null;
  nextEligibleIteration: number | null;
  iterationsUntilEligible: number | null;
}

export interface RefineryFuelTargetSummary {
  sourceType: RefinerySourceType;
  sourceId: string;
  title: string;
  domain: string;
  refinementType: RefineryType;
  originalRating?: number;
}

export interface RefineryFuelStatus {
  enabled: boolean;
  queueLimit: number;
  available: number;
  byType: {
    dream: number;
    companion: number;
    lowRated: number;
  };
  topTargets: RefineryFuelTargetSummary[];
}

export interface RefineryTarget {
  source_type: RefinerySourceType;
  source_id: string;
  source_title: string;
  source_domain: string;
  original_rating?: number;
  resurrection_hint?: string;
  original_content?: string;
  refinement_type: RefineryType;
}

export interface RefineryAttempt {
  source_type: RefinerySourceType;
  source_id: string;
  iteration: number;
  result?: "shipped" | "killed" | "skipped";
}

export interface PortfolioCandidate {
  id: string;
  title: string;
  domain: string;
  rating: number;
  iteration: number;
  project: string | null;
  refined_from: string | null;
  readme_path: string | null;
  content?: string;
}
