import { describe, it, expect, beforeEach } from 'vitest';
import { StatsTracker } from '../src/stats/index.js';
import type { StatsSnapshot } from '../src/types/index.js';

function emptySnapshot(): StatsSnapshot {
  return {
    iteration: 0,
    shipped: 0,
    killed: 0,
    skipped: 0,
    domain_counts: {},
    recent_outcomes: [],
    critic_rejection_window: [],
    total_tokens: { input: 0, output: 0 },
  };
}

describe('StatsTracker', () => {
  let tracker: StatsTracker;

  beforeEach(() => {
    tracker = StatsTracker.fresh();
  });

  // ── fresh() ──────────────────────────────────────────────

  describe('fresh()', () => {
    it('creates a tracker with zeroed snapshot', () => {
      const snap = tracker.getSnapshot();
      expect(snap).toEqual(emptySnapshot());
    });

    it('starts at iteration 0', () => {
      expect(tracker.getIteration()).toBe(0);
    });
  });

  // ── fromSnapshot() ───────────────────────────────────────

  describe('fromSnapshot()', () => {
    it('restores all fields from a snapshot', () => {
      const snap: StatsSnapshot = {
        iteration: 10,
        shipped: 5,
        killed: 3,
        skipped: 2,
        domain_counts: { poetry: 3, code: 2 },
        recent_outcomes: [{ iteration: 9, outcome: 'shipped', domain: 'poetry' }],
        critic_rejection_window: [{ iteration: 10, rejected: true }],
        total_tokens: { input: 1000, output: 500 },
      };
      const restored = StatsTracker.fromSnapshot(snap);
      expect(restored.getSnapshot()).toEqual(snap);
      expect(restored.getIteration()).toBe(10);
    });

    it('does not mutate the original snapshot', () => {
      const snap: StatsSnapshot = {
        iteration: 5,
        shipped: 1,
        killed: 0,
        skipped: 0,
        domain_counts: { prose: 1 },
        recent_outcomes: [{ iteration: 1, outcome: 'shipped', domain: 'prose' }],
        critic_rejection_window: [],
        total_tokens: { input: 100, output: 50 },
      };
      const restored = StatsTracker.fromSnapshot(snap);
      restored.recordOutcome(6, 'shipped', 'code');
      expect(snap.shipped).toBe(1);
      expect(snap.domain_counts).toEqual({ prose: 1 });
    });

    it('caps recent_outcomes at 50 entries', () => {
      const outcomes = Array.from({ length: 60 }, (_, i) => ({
        iteration: i,
        outcome: 'shipped',
        domain: 'test',
      }));
      const snap: StatsSnapshot = {
        ...emptySnapshot(),
        recent_outcomes: outcomes,
      };
      const restored = StatsTracker.fromSnapshot(snap);
      expect(restored.getSnapshot().recent_outcomes).toHaveLength(50);
      // Should keep the last 50
      expect(restored.getSnapshot().recent_outcomes[0].iteration).toBe(10);
    });

    it('caps critic_rejection_window at 20 entries', () => {
      const window = Array.from({ length: 30 }, (_, i) => ({
        iteration: i,
        rejected: i % 2 === 0,
      }));
      const snap: StatsSnapshot = {
        ...emptySnapshot(),
        critic_rejection_window: window,
      };
      const restored = StatsTracker.fromSnapshot(snap);
      expect(restored.getSnapshot().critic_rejection_window).toHaveLength(20);
      expect(restored.getSnapshot().critic_rejection_window[0].iteration).toBe(10);
    });
  });

  // ── recordOutcome() ──────────────────────────────────────

  describe('recordOutcome()', () => {
    it('increments shipped count', () => {
      tracker.recordOutcome(1, 'shipped', 'poetry');
      expect(tracker.getSnapshot().shipped).toBe(1);
    });

    it('increments killed count', () => {
      tracker.recordOutcome(1, 'killed');
      expect(tracker.getSnapshot().killed).toBe(1);
    });

    it('increments skipped count', () => {
      tracker.recordOutcome(1, 'skipped');
      expect(tracker.getSnapshot().skipped).toBe(1);
    });

    it('tracks domain counts for shipped artifacts', () => {
      tracker.recordOutcome(1, 'shipped', 'poetry');
      tracker.recordOutcome(2, 'shipped', 'poetry');
      tracker.recordOutcome(3, 'shipped', 'code');
      expect(tracker.getSnapshot().domain_counts).toEqual({ poetry: 2, code: 1 });
    });

    it('does not track domain for killed/skipped', () => {
      tracker.recordOutcome(1, 'killed', 'poetry');
      tracker.recordOutcome(2, 'skipped', 'code');
      expect(tracker.getSnapshot().domain_counts).toEqual({});
    });

    it('does not track domain for shipped without domain', () => {
      tracker.recordOutcome(1, 'shipped');
      expect(tracker.getSnapshot().domain_counts).toEqual({});
    });

    it('appends to recentOutcomes', () => {
      tracker.recordOutcome(1, 'shipped', 'poetry');
      tracker.recordOutcome(2, 'killed');
      const outcomes = tracker.getSnapshot().recent_outcomes;
      expect(outcomes).toHaveLength(2);
      expect(outcomes[0]).toEqual({ iteration: 1, outcome: 'shipped', domain: 'poetry' });
      expect(outcomes[1]).toEqual({ iteration: 2, outcome: 'killed', domain: undefined });
    });

    it('caps recentOutcomes at 50 by shifting oldest', () => {
      for (let i = 0; i < 55; i++) {
        tracker.recordOutcome(i, 'shipped', 'test');
      }
      const outcomes = tracker.getSnapshot().recent_outcomes;
      expect(outcomes).toHaveLength(50);
      expect(outcomes[0].iteration).toBe(5);
      expect(outcomes[49].iteration).toBe(54);
    });
  });

  // ── recordCriticDecision() ───────────────────────────────

  describe('recordCriticDecision()', () => {
    it('records a rejection', () => {
      tracker.recordCriticDecision(1, true);
      expect(tracker.getSnapshot().critic_rejection_window).toEqual([
        { iteration: 1, rejected: true },
      ]);
    });

    it('records an approval', () => {
      tracker.recordCriticDecision(1, false);
      expect(tracker.getSnapshot().critic_rejection_window).toEqual([
        { iteration: 1, rejected: false },
      ]);
    });

    it('caps window at 20 entries', () => {
      for (let i = 0; i < 25; i++) {
        tracker.recordCriticDecision(i, i % 2 === 0);
      }
      const window = tracker.getSnapshot().critic_rejection_window;
      expect(window).toHaveLength(20);
      expect(window[0].iteration).toBe(5);
    });
  });

  // ── recordTokens() ──────────────────────────────────────

  describe('recordTokens()', () => {
    it('accumulates token counts', () => {
      tracker.recordTokens(100, 50);
      tracker.recordTokens(200, 100);
      expect(tracker.getSnapshot().total_tokens).toEqual({ input: 300, output: 150 });
    });
  });

  // ── getSnapshot() ────────────────────────────────────────

  describe('getSnapshot()', () => {
    it('returns a defensive copy (mutating snapshot does not affect tracker)', () => {
      tracker.recordOutcome(1, 'shipped', 'code');
      const snap1 = tracker.getSnapshot();
      snap1.shipped = 999;
      snap1.domain_counts['code'] = 999;
      snap1.recent_outcomes.push({ iteration: 99, outcome: 'killed' });
      snap1.total_tokens.input = 999;

      const snap2 = tracker.getSnapshot();
      expect(snap2.shipped).toBe(1);
      expect(snap2.domain_counts['code']).toBe(1);
      expect(snap2.recent_outcomes).toHaveLength(1);
      expect(snap2.total_tokens.input).toBe(0);
    });
  });

  // ── getRejectionRate() ───────────────────────────────────

  describe('getRejectionRate()', () => {
    it('returns 0 for empty window', () => {
      expect(tracker.getRejectionRate()).toBe(0);
    });

    it('returns 1.0 when all rejected', () => {
      tracker.recordCriticDecision(1, true);
      tracker.recordCriticDecision(2, true);
      expect(tracker.getRejectionRate()).toBe(1);
    });

    it('returns 0 when none rejected', () => {
      tracker.recordCriticDecision(1, false);
      tracker.recordCriticDecision(2, false);
      expect(tracker.getRejectionRate()).toBe(0);
    });

    it('returns correct ratio for mixed decisions', () => {
      tracker.recordCriticDecision(1, true);
      tracker.recordCriticDecision(2, false);
      tracker.recordCriticDecision(3, true);
      tracker.recordCriticDecision(4, false);
      expect(tracker.getRejectionRate()).toBe(0.5);
    });
  });

  // ── getDomainStats() ─────────────────────────────────────

  describe('getDomainStats()', () => {
    it('returns placeholder when no artifacts shipped', () => {
      expect(tracker.getDomainStats()).toBe('(no artifacts shipped)');
    });

    it('formats single domain correctly', () => {
      tracker.recordOutcome(1, 'shipped', 'poetry');
      expect(tracker.getDomainStats()).toBe('poetry: 1 (100%)');
    });

    it('sorts domains by count descending', () => {
      tracker.recordOutcome(1, 'shipped', 'code');
      tracker.recordOutcome(2, 'shipped', 'poetry');
      tracker.recordOutcome(3, 'shipped', 'poetry');
      tracker.recordOutcome(4, 'shipped', 'poetry');
      const stats = tracker.getDomainStats();
      expect(stats).toMatch(/^poetry: 3 \(75%\), code: 1 \(25%\)$/);
    });
  });

  // ── getIteration() / setIteration() ──────────────────────

  describe('getIteration() / setIteration()', () => {
    it('setIteration updates the iteration', () => {
      tracker.setIteration(42);
      expect(tracker.getIteration()).toBe(42);
    });

    it('iteration is reflected in snapshot', () => {
      tracker.setIteration(7);
      expect(tracker.getSnapshot().iteration).toBe(7);
    });
  });
});
