export type MoodAxis =
  | "exploratory"
  | "playful"
  | "restless"
  | "bold"
  | "collaborative";

export interface MoodState {
  axes: Record<MoodAxis, number>;
  dominant_mood: string;
  creative_nudge: string;
  influences: MoodInfluence[];
  iteration: number;
  updated_at: string;
}

export interface MoodInfluence {
  factor: string;
  axis: MoodAxis;
  direction: number;
  weight: number;
}
