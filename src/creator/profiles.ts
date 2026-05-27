import type { FoundryConfig, ComplexityProfileConfig } from "../types/index.js";

export type PhaseKind = "plan" | "build" | "revise" | "polish" | "assemble";

export interface ComplexityProfile {
  phases: PhaseKind[];
  maxTokensPerPhase: number;
  expectedFiles: [number, number];
  budgetWarningThreshold: number;
}

const PHASE_SEQUENCES: Record<string, PhaseKind[]> = {
  S: ["build"],
  M: ["plan", "build", "revise"],
  L: ["plan", "build", "build", "build", "build", "revise", "polish"],
  XL: [
    "plan",
    "build",
    "build",
    "build",
    "build",
    "build",
    "build",
    "build",
    "build",
    "assemble",
    "revise",
    "polish",
  ],
};

const EXPECTED_FILES: Record<string, [number, number]> = {
  S: [1, 2],
  M: [1, 4],
  L: [6, 12],
  XL: [12, 24],
};

const DEFAULTS: Record<string, { maxTokens: number; warning: number }> = {
  S: { maxTokens: 16384, warning: 25000 },
  M: { maxTokens: 32768, warning: 120000 },
  L: { maxTokens: 65536, warning: 400000 },
  XL: { maxTokens: 100000, warning: 800000 },
};

export function getComplexityProfile(
  complexity: string,
  config: FoundryConfig,
): ComplexityProfile {
  const tier = complexity in PHASE_SEQUENCES ? complexity : "S";
  const configProfile = config.iteration.complexity_profiles?.[tier] as
    | ComplexityProfileConfig
    | undefined;
  const defaults = DEFAULTS[tier];

  return {
    phases: PHASE_SEQUENCES[tier],
    maxTokensPerPhase: configProfile?.max_tokens_per_phase ?? defaults.maxTokens,
    expectedFiles: EXPECTED_FILES[tier],
    budgetWarningThreshold:
      configProfile?.budget_warning_threshold ?? defaults.warning,
  };
}
