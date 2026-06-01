import type { CriticGate1Evaluation, IdeatorProposal } from "../types/index.js";

export interface SpeculativeConfig {
  enabled: boolean;
  max_carried_ideas: number;
}

export interface SpeculativeIdea {
  proposal: IdeatorProposal;
  critic_evaluation: Pick<CriticGate1Evaluation, "decision" | "reasons" | "sharpening_notes">;
  iteration: number;
  salvageable: boolean;
}

export interface SpeculativeStore {
  ideas: SpeculativeIdea[];
  updated_at: string;
}
