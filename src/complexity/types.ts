export type ComplexityTier = "S" | "M" | "L" | "XL";
export type ComplexityConfidence = "low" | "medium" | "high";

export interface ComplexityYield {
  tier: ComplexityTier;
  shipped_count: number;
  mean_rating: number;
  mean_token_cost: number;
  roi: number;
}

export interface ComplexityBias {
  updated_at: string;
  updated_iteration: number;
  yields: ComplexityYield[];
  recommendation: {
    favor: ComplexityTier | "balanced";
    avoid: ComplexityTier[];
    confidence: ComplexityConfidence;
    reason: string;
  };
}

export interface ComplexityConfig {
  yield_window: number;
  min_samples_for_confidence: number;
  high_confidence_samples: number;
}

export interface ComplexityAnalysisOptions {
  window?: number;
  min_samples_for_confidence?: number;
  high_confidence_samples?: number;
}

export interface ComplexityIterationEntry {
  iteration: number;
  outcome: "shipped" | "killed" | "skipped" | "halted";
  complexity?: ComplexityTier;
  mean_rating?: string;
  token_usage?: { input: number; output: number };
}
