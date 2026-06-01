import type { CriticRatings } from "../types/index.js";

export const CRITIC_RATING_DIMENSIONS = [
  "originality",
  "specificity",
  "craft",
  "surprise",
  "coherence",
  "portfolio_fit",
] as const;

export type CriticRatingDimension = typeof CRITIC_RATING_DIMENSIONS[number];

export function isCriticRatingValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateCriticRatings(ratings: unknown): ratings is CriticRatings {
  if (!isRecord(ratings)) return false;
  const hasRequiredRatings = CRITIC_RATING_DIMENSIONS.every((dimension) => isCriticRatingValue(ratings[dimension]));
  if (!hasRequiredRatings) return false;
  return ratings.technical_quality === undefined || isCriticRatingValue(ratings.technical_quality);
}

export function criticRatingValues(ratings: CriticRatings): number[] {
  const values = CRITIC_RATING_DIMENSIONS.map((dimension) => ratings[dimension]);
  if (ratings.technical_quality !== undefined) {
    values.push(ratings.technical_quality);
  }
  return values;
}

export function meanCriticRating(ratings: CriticRatings): number {
  const values = criticRatingValues(ratings);
  return values.reduce((sum, rating) => sum + rating, 0) / values.length;
}

export function formatMeanCriticRating(ratings: CriticRatings): string {
  return meanCriticRating(ratings).toFixed(1);
}

export function meetsCriticShipThreshold(ratings: CriticRatings): boolean {
  const values = criticRatingValues(ratings);
  return values.every((rating) => rating >= 2) && meanCriticRating(ratings) >= 3;
}

export function assertShippableCriticRatings(ratings: CriticRatings): void {
  const invalidDimension = CRITIC_RATING_DIMENSIONS.find((dimension) => !isCriticRatingValue(ratings[dimension]));
  if (invalidDimension) {
    throw new Error(`Invalid artifact rating for ${invalidDimension}: expected a number from 1 to 5`);
  }
  if (ratings.technical_quality !== undefined && !isCriticRatingValue(ratings.technical_quality)) {
    throw new Error("Invalid artifact rating for technical_quality: expected a number from 1 to 5");
  }
  if (!meetsCriticShipThreshold(ratings)) {
    throw new Error("Invalid artifact ratings: shipped artifacts must meet the Critic Gate 2 ship threshold");
  }
}
