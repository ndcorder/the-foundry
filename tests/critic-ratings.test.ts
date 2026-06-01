import { describe, expect, it } from 'vitest';
import {
  CRITIC_RATING_DIMENSIONS,
  assertShippableCriticRatings,
  criticRatingValues,
  formatMeanCriticRating,
  meanCriticRating,
  meetsCriticShipThreshold,
  validateCriticRatings,
} from '../src/critic/index.js';
import type { CriticRatings } from '../src/types/index.js';

const strongRatings: CriticRatings = {
  originality: 4,
  specificity: 4,
  craft: 5,
  surprise: 4,
  coherence: 4,
  portfolio_fit: 4,
};

describe('critic rating helpers', () => {
  it('defines the required Gate 2 rating dimensions in portfolio order', () => {
    expect(CRITIC_RATING_DIMENSIONS).toEqual([
      'originality',
      'specificity',
      'craft',
      'surprise',
      'coherence',
      'portfolio_fit',
    ]);
  });

  it('validates the Gate 2 rating shape and 1-5 scale', () => {
    expect(validateCriticRatings(strongRatings)).toBe(true);
    expect(validateCriticRatings({ ...strongRatings, technical_quality: 5 })).toBe(true);
    expect(validateCriticRatings(null)).toBe(false);
    expect(validateCriticRatings([4, 4, 4, 4, 4, 4])).toBe(false);
    expect(validateCriticRatings({ ...strongRatings, originality: 6 })).toBe(false);
    expect(validateCriticRatings({ ...strongRatings, technical_quality: 0 })).toBe(false);
    expect(validateCriticRatings({ ...strongRatings, coherence: undefined })).toBe(false);
  });

  it('computes mean ratings with optional technical quality included', () => {
    expect(criticRatingValues({ ...strongRatings, technical_quality: 2 })).toEqual([4, 4, 5, 4, 4, 4, 2]);
    expect(meanCriticRating({ ...strongRatings, technical_quality: 2 })).toBeCloseTo(27 / 7);
    expect(formatMeanCriticRating({ ...strongRatings, technical_quality: 2 })).toBe('3.9');
  });

  it('checks the documented Gate 2 ship threshold', () => {
    expect(meetsCriticShipThreshold(strongRatings)).toBe(true);
    expect(meetsCriticShipThreshold({
      originality: 3,
      specificity: 3,
      craft: 3,
      surprise: 2,
      coherence: 3,
      portfolio_fit: 3,
    })).toBe(false);
    expect(meetsCriticShipThreshold({ ...strongRatings, technical_quality: 1 })).toBe(false);
  });

  it('throws useful errors for invalid shipped ratings', () => {
    expect(() => assertShippableCriticRatings({ ...strongRatings, originality: 6 })).toThrow(/1 to 5/);
    expect(() => assertShippableCriticRatings({
      originality: 3,
      specificity: 3,
      craft: 3,
      surprise: 2,
      coherence: 3,
      portfolio_fit: 3,
    })).toThrow(/ship threshold/);
  });
});
