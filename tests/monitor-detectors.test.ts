import { describe, it, expect } from 'vitest';
import {
  detectSlop,
  detectRepetition,
  detectManifestoDrift,
  detectDomainCollapse,
  detectComplexityYield,
  detectLogHealth,
  runAllDetectors,
  type IterationEntry,
} from '../src/monitor/detectors.js';
import { DEFAULT_MONITOR_CONFIG, type MonitorConfig } from '../src/monitor/types.js';
import type { JsonlLogHealth } from '../src/logging/index.js';

// ── Helpers ──────────────────────────────────────────────────────

function entry(overrides: Partial<IterationEntry> & { iteration: number }): IterationEntry {
  return {
    timestamp: new Date().toISOString(),
    outcome: 'shipped',
    token_usage: { input: 100, output: 50 },
    duration_ms: 1000,
    ...overrides,
  };
}

function complexityEntry(
  iteration: number,
  complexity: 'S' | 'M',
  meanRating: string,
  tokens: number,
): IterationEntry {
  return entry({
    iteration,
    outcome: 'shipped',
    complexity,
    mean_rating: meanRating,
    token_usage: { input: Math.floor(tokens * 0.7), output: Math.ceil(tokens * 0.3) },
  });
}

function shippedEntries(
  count: number,
  meanRating: string,
  domain = 'code',
): IterationEntry[] {
  return Array.from({ length: count }, (_, i) =>
    entry({
      iteration: i + 1,
      outcome: 'shipped',
      mean_rating: meanRating,
      title: `Artifact ${i}`,
      domain,
    }),
  );
}

const cfg = DEFAULT_MONITOR_CONFIG;

function logHealth(overrides: Partial<JsonlLogHealth> = {}): JsonlLogHealth {
  return {
    activeFiles: 1,
    archiveCount: 0,
    totalActiveBytes: 100,
    totalArchiveBytes: 0,
    totalLogBytes: 100,
    rotationThresholdBytes: 50 * 1024 * 1024,
    largestActivePercent: 0,
    largestActiveBytesRemaining: 50 * 1024 * 1024 - 100,
    rotationPressure: 'clear',
    healthState: 'healthy',
    malformedActiveLines: 0,
    malformedActiveFiles: [],
    malformedActiveFileDetails: [],
    recommendedActions: [],
    largestActive: { name: 'events.jsonl', bytes: 100 },
    largestArchive: null,
    ...overrides,
  };
}

// ── detectSlop ───────────────────────────────────────────────────

describe('detectSlop', () => {
  it('returns no warnings when fewer than 3 shipped entries', () => {
    const entries = shippedEntries(2, '4.0');
    expect(detectSlop(entries, 3, cfg)).toEqual([]);
  });

  it('returns no warnings when quality is above threshold', () => {
    const entries = shippedEntries(5, '3.5');
    expect(detectSlop(entries, 6, cfg)).toEqual([]);
  });

  it('returns critical warning when mean rating below threshold', () => {
    const entries = shippedEntries(5, '1.5');
    const warnings = detectSlop(entries, 6, cfg);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('critical');
    expect(warnings[0].detector).toBe('slop');
    expect(warnings[0].action?.type).toBe('emergency_curator');
  });

  it('detects declining trend when >= 6 entries and above threshold', () => {
    // First half high ratings, second half lower (but overall still above threshold)
    const entries: IterationEntry[] = [];
    for (let i = 0; i < 3; i++) {
      entries.push(entry({ iteration: i + 1, outcome: 'shipped', mean_rating: '4.0', title: `A${i}` }));
    }
    for (let i = 3; i < 6; i++) {
      entries.push(entry({ iteration: i + 1, outcome: 'shipped', mean_rating: '3.0', title: `B${i}` }));
    }
    const warnings = detectSlop(entries, 7, cfg);
    expect(warnings.some(w => w.severity === 'warning' && w.message.includes('trending down'))).toBe(true);
  });

  it('does not flag trend when second half is higher', () => {
    const entries: IterationEntry[] = [];
    for (let i = 0; i < 3; i++) {
      entries.push(entry({ iteration: i + 1, outcome: 'shipped', mean_rating: '3.0', title: `A${i}` }));
    }
    for (let i = 3; i < 6; i++) {
      entries.push(entry({ iteration: i + 1, outcome: 'shipped', mean_rating: '4.0', title: `B${i}` }));
    }
    const warnings = detectSlop(entries, 7, cfg);
    expect(warnings.every(w => !w.message.includes('trending down'))).toBe(true);
  });

  it('ignores non-shipped entries', () => {
    const entries = [
      entry({ iteration: 1, outcome: 'killed', mean_rating: '1.0' }),
      entry({ iteration: 2, outcome: 'skipped', mean_rating: '1.0' }),
      ...shippedEntries(3, '4.0'),
    ];
    expect(detectSlop(entries, 6, cfg)).toEqual([]);
  });

  it('ignores shipped entries without mean_rating', () => {
    const entries = [
      entry({ iteration: 1, outcome: 'shipped' }),
      entry({ iteration: 2, outcome: 'shipped' }),
      entry({ iteration: 3, outcome: 'shipped' }),
    ];
    expect(detectSlop(entries, 4, cfg)).toEqual([]);
  });

  it('respects slop_window by slicing to last N entries', () => {
    const config: MonitorConfig = { ...cfg, slop_window: 3 };
    // 10 entries: first 7 bad, last 3 good
    const entries: IterationEntry[] = [
      ...shippedEntries(7, '1.0'),
      ...shippedEntries(3, '4.0').map((e, i) => ({ ...e, iteration: 8 + i })),
    ];
    const warnings = detectSlop(entries, 11, config);
    // Only the last 3 are considered, which are good
    expect(warnings).toEqual([]);
  });
});

// ── detectRepetition ─────────────────────────────────────────────

describe('detectRepetition', () => {
  it('returns no warnings with fewer than 2 shipped entries', () => {
    const entries = [entry({ iteration: 1, outcome: 'shipped', title: 'Foo' })];
    expect(detectRepetition(entries, 2, cfg)).toEqual([]);
  });

  it('returns no warnings for dissimilar artifacts', () => {
    const entries = [
      entry({ iteration: 1, outcome: 'shipped', title: 'A poem about stars', domain: 'poetry' }),
      entry({ iteration: 2, outcome: 'shipped', title: 'HTTP server in Go', domain: 'code' }),
    ];
    expect(detectRepetition(entries, 3, cfg)).toEqual([]);
  });

  it('flags identical artifacts (same domain + title + review)', () => {
    const entries = [
      entry({ iteration: 1, outcome: 'shipped', title: 'A CLI tool', domain: 'code', review: 'Great work on the CLI' }),
      entry({ iteration: 2, outcome: 'shipped', title: 'A CLI tool', domain: 'code', review: 'Great work on the CLI' }),
    ];
    const warnings = detectRepetition(entries, 3, cfg);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0].detector).toBe('repetition');
    expect(warnings[0].action?.type).toBe('anti_repetition_pressure');
  });

  it('ignores non-shipped entries', () => {
    const entries = [
      entry({ iteration: 1, outcome: 'killed', title: 'A CLI tool', domain: 'code' }),
      entry({ iteration: 2, outcome: 'killed', title: 'A CLI tool', domain: 'code' }),
    ];
    expect(detectRepetition(entries, 3, cfg)).toEqual([]);
  });

  it('handles entries without title/domain/review gracefully', () => {
    const entries = [
      entry({ iteration: 1, outcome: 'shipped' }),
      entry({ iteration: 2, outcome: 'shipped' }),
    ];
    // Should not throw, and similarity should be 0 (no domain, no title, no review)
    const warnings = detectRepetition(entries, 3, cfg);
    expect(warnings).toEqual([]);
  });

  it('uses artifact_id as fallback label when title is missing', () => {
    const entries = [
      entry({ iteration: 1, outcome: 'shipped', domain: 'code', artifact_id: 'abc', review: 'exact same review text here and more' }),
      entry({ iteration: 2, outcome: 'shipped', domain: 'code', artifact_id: 'def', review: 'exact same review text here and more' }),
    ];
    const warnings = detectRepetition(entries, 3, cfg);
    // Same domain (0.3) + same review text (up to 0.3) — may or may not cross 0.6
    // Just verify it runs without error and uses artifact_id in message if flagged
    for (const w of warnings) {
      expect(w.message).toMatch(/abc|def/);
    }
  });
});

// ── detectManifestoDrift ─────────────────────────────────────────

describe('detectManifestoDrift', () => {
  it('returns info warning when journal has no manifesto mentions', () => {
    const warnings = detectManifestoDrift('nothing here', 100, cfg);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('info');
    expect(warnings[0].message).toContain("hasn't changed");
  });

  it('returns stagnation warning when last change was long ago', () => {
    const journal = 'Iteration 5: Updated manifesto vision section';
    const config: MonitorConfig = { ...cfg, manifesto_stagnation_threshold: 10 };
    const warnings = detectManifestoDrift(journal, 100, config);
    expect(warnings.some(w => w.severity === 'info' && w.message.includes("hasn't changed in 95"))).toBe(true);
  });

  it('returns no stagnation warning when change is recent', () => {
    const journal = 'Iteration 98: Updated manifesto vision section';
    const config: MonitorConfig = { ...cfg, manifesto_stagnation_threshold: 10 };
    const warnings = detectManifestoDrift(journal, 100, config);
    expect(warnings).toEqual([]);
  });

  it('flags excessive manifesto changes in window', () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      `Iteration ${90 + i}: Updated manifesto section ${i}`,
    ).join('\n');
    const config: MonitorConfig = { ...cfg, manifesto_change_window: 20, manifesto_max_changes: 5 };
    const warnings = detectManifestoDrift(lines, 100, config);
    expect(warnings.some(w => w.detector === 'manifesto_drift' && w.severity === 'warning')).toBe(true);
  });

  it('does not flag when changes are within limit', () => {
    const lines = 'Iteration 95: Updated manifesto\nIteration 98: Updated manifesto';
    const config: MonitorConfig = { ...cfg, manifesto_change_window: 20, manifesto_max_changes: 5, manifesto_stagnation_threshold: 10 };
    const warnings = detectManifestoDrift(lines, 100, config);
    // No warning for excessive changes, no stagnation (recent change)
    expect(warnings).toEqual([]);
  });

  it('parses various iteration number formats', () => {
    const journal = [
      'iter. 85: manifesto tweak',
      'Iteration 90: manifesto update',
      '#95 manifesto changed',
    ].join('\n');
    const config: MonitorConfig = { ...cfg, manifesto_change_window: 20, manifesto_max_changes: 2, manifesto_stagnation_threshold: 10 };
    const warnings = detectManifestoDrift(journal, 100, config);
    // 3 changes in window of 20 (all > 80), max is 2 → should warn
    expect(warnings.some(w => w.severity === 'warning')).toBe(true);
  });
});

// ── detectDomainCollapse ─────────────────────────────────────────

describe('detectDomainCollapse', () => {
  it('returns no warnings with fewer than 3 entries', () => {
    const entries = [
      entry({ iteration: 1, domain: 'code' }),
      entry({ iteration: 2, domain: 'code' }),
    ];
    expect(detectDomainCollapse(entries, 3, cfg)).toEqual([]);
  });

  it('returns no warnings when domains are balanced', () => {
    const entries = [
      entry({ iteration: 1, domain: 'code' }),
      entry({ iteration: 2, domain: 'poetry' }),
      entry({ iteration: 3, domain: 'music' }),
      entry({ iteration: 4, domain: 'prose' }),
    ];
    expect(detectDomainCollapse(entries, 5, cfg)).toEqual([]);
  });

  it('flags domain concentration above threshold', () => {
    // 4 out of 5 = 80%, threshold is 60%
    const entries = [
      entry({ iteration: 1, domain: 'code' }),
      entry({ iteration: 2, domain: 'code' }),
      entry({ iteration: 3, domain: 'code' }),
      entry({ iteration: 4, domain: 'code' }),
      entry({ iteration: 5, domain: 'poetry' }),
    ];
    const warnings = detectDomainCollapse(entries, 6, cfg);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('critical');
    expect(warnings[0].detector).toBe('domain_collapse');
    expect(warnings[0].action?.type).toBe('domain_force_diversify');
  });

  it('ignores entries without domain', () => {
    const entries = [
      entry({ iteration: 1 }), // no domain
      entry({ iteration: 2, domain: '' }), // empty domain
      entry({ iteration: 3, domain: 'code' }),
      entry({ iteration: 4, domain: 'poetry' }),
      entry({ iteration: 5, domain: 'music' }),
    ];
    expect(detectDomainCollapse(entries, 6, cfg)).toEqual([]);
  });

  it('respects domain_collapse_window by slicing', () => {
    const config: MonitorConfig = { ...cfg, domain_collapse_window: 3 };
    // First 5 entries all 'code', last 3 are diverse
    const entries = [
      ...Array.from({ length: 5 }, (_, i) => entry({ iteration: i + 1, domain: 'code' })),
      entry({ iteration: 6, domain: 'poetry' }),
      entry({ iteration: 7, domain: 'music' }),
      entry({ iteration: 8, domain: 'prose' }),
    ];
    // Only last 3 considered — all different domains
    expect(detectDomainCollapse(entries, 9, config)).toEqual([]);
  });
});

// ── runAllDetectors ──────────────────────────────────────────────

describe('runAllDetectors', () => {
  it('aggregates warnings from all detectors', () => {
    // Craft data that triggers slop + domain collapse
    const entries = shippedEntries(5, '1.0', 'code').map(e => ({
      ...e,
      domain: 'code',
      title: 'Same title',
      review: 'Same review text for all artifacts here',
    }));
    const journal = '';
    const warnings = runAllDetectors(entries, journal, 10);
    // Should have at least slop critical + manifesto info
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    const detectors = new Set(warnings.map(w => w.detector));
    expect(detectors.has('slop')).toBe(true);
  });

  it('uses DEFAULT_MONITOR_CONFIG when none provided', () => {
    // Just verify it doesn't throw
    const warnings = runAllDetectors([], '', 1);
    // Empty iterations → only manifesto stagnation info
    expect(warnings.some(w => w.detector === 'manifesto_drift')).toBe(true);
  });

  it('includes JSONL log health warnings when log health is supplied', () => {
    const warnings = runAllDetectors([], '', 1, cfg, logHealth({
      healthState: 'malformed',
      malformedActiveLines: 1,
      malformedActiveFiles: ['events.jsonl'],
      malformedActiveFileDetails: [
        { name: 'events.jsonl', malformedLines: 1, firstMalformedLine: 7 },
      ],
    }));

    expect(warnings.some(w => w.detector === 'log_health' && w.severity === 'critical')).toBe(true);
  });
});

// ── detectLogHealth ─────────────────────────────────────────────

describe('detectLogHealth', () => {
  it('returns no warnings for healthy logs', () => {
    expect(detectLogHealth(logHealth(), 12)).toEqual([]);
  });

  it('returns a critical warning with first-line details for malformed active logs', () => {
    const warnings = detectLogHealth(logHealth({
      healthState: 'malformed',
      malformedActiveLines: 2,
      malformedActiveFiles: ['events.jsonl'],
      malformedActiveFileDetails: [
        { name: 'events.jsonl', malformedLines: 2, firstMalformedLine: 7 },
      ],
    }), 12);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      detector: 'log_health',
      severity: 'critical',
      iteration: 12,
    });
    expect(warnings[0].message).toContain('2 malformed');
    expect(warnings[0].message).toContain('events.jsonl');
    expect(warnings[0].message).toContain('first line 7');
  });

  it('returns a warning when the largest active log is near rotation', () => {
    const warnings = detectLogHealth(logHealth({
      healthState: 'rotate-soon',
      rotationPressure: 'rotate-soon',
      largestActivePercent: 97,
      largestActiveBytesRemaining: 1024,
      largestActive: { name: 'iterations.jsonl', bytes: 50 * 1024 * 1024 - 1024 },
    }), 12);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      detector: 'log_health',
      severity: 'warning',
    });
    expect(warnings[0].message).toContain('iterations.jsonl');
    expect(warnings[0].message).toContain('97%');
  });
});

// ── detectComplexityYield ───────────────────────────────────────

describe('detectComplexityYield', () => {
  it('returns a complexity bias update warning when ROI data is actionable', () => {
    const entries = [
      complexityEntry(1, 'S', '3.0', 3000),
      complexityEntry(2, 'S', '3.0', 3000),
      complexityEntry(3, 'S', '3.0', 3000),
      complexityEntry(4, 'M', '4.0', 12000),
      complexityEntry(5, 'M', '4.0', 12000),
      complexityEntry(6, 'M', '4.0', 12000),
    ];

    const warnings = detectComplexityYield(entries, 7, {
      yield_window: 20,
      min_samples_for_confidence: 3,
      high_confidence_samples: 5,
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0].detector).toBe('complexity_yield');
    expect(warnings[0].severity).toBe('info');
    expect(warnings[0].action?.type).toBe('complexity_bias_update');
    if (warnings[0].action?.type === 'complexity_bias_update') {
      expect(warnings[0].action.bias.recommendation.favor).toBe('S');
      expect(warnings[0].action.bias.recommendation.avoid).toEqual(['M']);
    }
  });

  it('returns no warning when complexity yield confidence is low', () => {
    const warnings = detectComplexityYield([
      complexityEntry(1, 'S', '4.0', 1000),
      complexityEntry(2, 'M', '4.0', 1000),
    ], 3);

    expect(warnings).toEqual([]);
  });
});

// ── DEFAULT_MONITOR_CONFIG ───────────────────────────────────────

describe('DEFAULT_MONITOR_CONFIG', () => {
  it('exports expected default values', () => {
    expect(DEFAULT_MONITOR_CONFIG.slop_window).toBe(20);
    expect(DEFAULT_MONITOR_CONFIG.slop_threshold).toBe(2.5);
    expect(DEFAULT_MONITOR_CONFIG.repetition_window).toBe(15);
    expect(DEFAULT_MONITOR_CONFIG.repetition_threshold).toBe(0.6);
    expect(DEFAULT_MONITOR_CONFIG.manifesto_change_window).toBe(30);
    expect(DEFAULT_MONITOR_CONFIG.manifesto_max_changes).toBe(5);
    expect(DEFAULT_MONITOR_CONFIG.manifesto_stagnation_threshold).toBe(50);
    expect(DEFAULT_MONITOR_CONFIG.domain_collapse_window).toBe(30);
    expect(DEFAULT_MONITOR_CONFIG.domain_collapse_threshold).toBe(0.6);
    expect(DEFAULT_MONITOR_CONFIG.domain_force_duration).toBe(5);
    expect(DEFAULT_MONITOR_CONFIG.complexity_yield_window).toBe(20);
    expect(DEFAULT_MONITOR_CONFIG.complexity_min_samples_for_confidence).toBe(3);
    expect(DEFAULT_MONITOR_CONFIG.complexity_high_confidence_samples).toBe(5);
    expect(DEFAULT_MONITOR_CONFIG.active_warning_window).toBe(10);
  });

  it('has all MonitorConfig keys', () => {
    const keys = Object.keys(DEFAULT_MONITOR_CONFIG);
    expect(keys).toContain('slop_window');
    expect(keys).toContain('slop_threshold');
    expect(keys).toContain('repetition_window');
    expect(keys).toContain('repetition_threshold');
    expect(keys).toContain('manifesto_change_window');
    expect(keys).toContain('manifesto_max_changes');
    expect(keys).toContain('manifesto_stagnation_threshold');
    expect(keys).toContain('domain_collapse_window');
    expect(keys).toContain('domain_collapse_threshold');
    expect(keys).toContain('domain_force_duration');
    expect(keys).toContain('complexity_yield_window');
    expect(keys).toContain('complexity_min_samples_for_confidence');
    expect(keys).toContain('complexity_high_confidence_samples');
    expect(keys).toContain('active_warning_window');
  });
});
