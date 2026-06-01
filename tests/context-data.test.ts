import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setRootDir } from '../src/root.js';
import {
  safeRead,
  safeReadAbsolute,
  readJsonlEntries,
  readDecisions,
  readTestReports,
  formatDecisions,
  formatTestReports,
  readLiveStimuli,
  pickRandomSkills,
  readLineageContext,
  readMoodContext,
  readDreamsContext,
  selectDiverseReviews,
} from '../src/context/data.js';
import type { DecisionLogEntry, TestReportEntry } from '../src/types/index.js';

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-test-'));
  setRootDir(tempDir);
  mkdirSync(path.join(tempDir, 'portfolio', 'projects'), { recursive: true });
  mkdirSync(path.join(tempDir, 'identity'), { recursive: true });
  mkdirSync(path.join(tempDir, 'logs'), { recursive: true });
  mkdirSync(path.join(tempDir, 'stimuli', 'skills'), { recursive: true });
  mkdirSync(path.join(tempDir, 'stimuli', 'live'), { recursive: true });
  mkdirSync(path.join(tempDir, 'config'), { recursive: true });
});
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

// --- safeRead ---

describe('safeRead', () => {
  it('reads an existing file', async () => {
    const filePath = path.join(tempDir, 'test.txt');
    writeFileSync(filePath, 'hello world');
    expect(await safeRead(filePath)).toBe('hello world');
  });

  it('returns empty string for missing file', async () => {
    expect(await safeRead(path.join(tempDir, 'nope.txt'))).toBe('');
  });
});

// --- safeReadAbsolute ---

describe('safeReadAbsolute', () => {
  it('reads an existing file', async () => {
    const filePath = path.join(tempDir, 'abs.txt');
    writeFileSync(filePath, 'absolute content');
    expect(await safeReadAbsolute(filePath)).toBe('absolute content');
  });

  it('returns empty string for missing file', async () => {
    expect(await safeReadAbsolute(path.join(tempDir, 'missing.txt'))).toBe('');
  });
});

// --- readJsonlEntries ---

describe('readJsonlEntries', () => {
  it('parses JSONL file', async () => {
    const filePath = path.join(tempDir, 'logs', 'test.jsonl');
    writeFileSync(filePath, '{"a":1}\n{"a":2}\n');
    const entries = await readJsonlEntries<{ a: number }>(filePath);
    expect(entries).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('returns empty array for empty file', async () => {
    const filePath = path.join(tempDir, 'logs', 'empty.jsonl');
    writeFileSync(filePath, '');
    const entries = await readJsonlEntries<unknown>(filePath);
    expect(entries).toEqual([]);
  });

  it('skips malformed lines', async () => {
    const filePath = path.join(tempDir, 'logs', 'bad.jsonl');
    writeFileSync(filePath, '{"ok":true}\nnot json\n{"ok":false}\n');
    const entries = await readJsonlEntries<{ ok: boolean }>(filePath);
    expect(entries).toEqual([{ ok: true }, { ok: false }]);
  });

  it('returns empty array for missing file', async () => {
    const entries = await readJsonlEntries<unknown>(path.join(tempDir, 'logs', 'nope.jsonl'));
    expect(entries).toEqual([]);
  });

  it('includes rotated archives in chronological order', async () => {
    const dir = path.join(tempDir, 'logs');
    writeFileSync(path.join(dir, 'decisions.jsonl'), '{"id":3}\n');
    writeFileSync(path.join(dir, 'decisions.2026-05-01.jsonl'), '{"id":1}\n');
    writeFileSync(path.join(dir, 'decisions.2026-05-10.jsonl'), '{"id":2}\n');
    const entries = await readJsonlEntries<{ id: number }>(path.join(dir, 'decisions.jsonl'));
    expect(entries.map(e => e.id)).toEqual([1, 2, 3]);
  });

  it('orders same-timestamp rotated archives by suffix', async () => {
    const dir = path.join(tempDir, 'logs');
    writeFileSync(path.join(dir, 'events.jsonl'), '{"id":3}\n');
    writeFileSync(path.join(dir, 'events.2026-01-01T00-00-00-000Z.jsonl'), '{"id":1}\n');
    writeFileSync(path.join(dir, 'events.2026-01-01T00-00-00-000Z.1.jsonl'), '{"id":2}\n');

    const entries = await readJsonlEntries<{ id: number }>(path.join(dir, 'events.jsonl'));

    expect(entries.map(e => e.id)).toEqual([1, 2, 3]);
  });

  it('reads at most 2 most recent rotated archives', async () => {
    const dir = path.join(tempDir, 'logs');
    writeFileSync(path.join(dir, 'data.jsonl'), '{"id":5}\n');
    writeFileSync(path.join(dir, 'data.2026-01-01.jsonl'), '{"id":1}\n');
    writeFileSync(path.join(dir, 'data.2026-02-01.jsonl'), '{"id":2}\n');
    writeFileSync(path.join(dir, 'data.2026-03-01.jsonl'), '{"id":3}\n');
    writeFileSync(path.join(dir, 'data.2026-04-01.jsonl'), '{"id":4}\n');
    const entries = await readJsonlEntries<{ id: number }>(path.join(dir, 'data.jsonl'));
    // Only the 2 most recent rotated (2026-03-01, 2026-04-01) + current
    expect(entries.map(e => e.id)).toEqual([3, 4, 5]);
  });

  it('handles missing directory gracefully', async () => {
    const entries = await readJsonlEntries<unknown>(path.join(tempDir, 'nodir', 'file.jsonl'));
    expect(entries).toEqual([]);
  });
});

// --- readDecisions / readTestReports ---

describe('readDecisions', () => {
  it('reads decisions from logs/decisions.jsonl', async () => {
    const entry: DecisionLogEntry = {
      timestamp: '2026-01-01T00:00:00Z',
      iteration: 1,
      gate: 'gate1',
      agent: 'critic',
      decision: 'approve',
      proposal_title: 'Test Proposal',
    };
    writeFileSync(path.join(tempDir, 'logs', 'decisions.jsonl'), JSON.stringify(entry) + '\n');
    const result = await readDecisions();
    expect(result).toHaveLength(1);
    expect(result[0].proposal_title).toBe('Test Proposal');
  });
});

describe('readTestReports', () => {
  it('reads test reports from logs/test-reports.jsonl', async () => {
    const entry: TestReportEntry = {
      timestamp: '2026-01-01T00:00:00Z',
      iteration: 1,
      artifact_id: '0001',
      outcome: 'pass',
      summary: 'All good',
      tests_run: 3,
      tests_passed: 3,
      tests_failed: 0,
    };
    writeFileSync(path.join(tempDir, 'logs', 'test-reports.jsonl'), JSON.stringify(entry) + '\n');
    const result = await readTestReports();
    expect(result).toHaveLength(1);
    expect(result[0].artifact_id).toBe('0001');
  });
});

// --- formatDecisions ---

describe('formatDecisions', () => {
  it('returns placeholder for empty array', () => {
    expect(formatDecisions([])).toBe('*No decisions recorded yet.*');
  });

  it('formats decisions with proposal_title', () => {
    const entries: DecisionLogEntry[] = [{
      timestamp: '2026-01-01T00:00:00Z',
      iteration: 1,
      gate: 'gate1',
      agent: 'critic',
      decision: 'approve',
      proposal_title: 'Cool Project',
      review: 'Great idea',
    }];
    const result = formatDecisions(entries);
    expect(result).toContain('gate1');
    expect(result).toContain('approve');
    expect(result).toContain('Cool Project');
    expect(result).toContain('Great idea');
  });

  it('formats decisions with artifact_id fallback', () => {
    const entries: DecisionLogEntry[] = [{
      timestamp: '2026-01-01T00:00:00Z',
      iteration: 1,
      gate: 'gate2',
      agent: 'critic',
      decision: 'ship',
      artifact_id: '0042',
    }];
    const result = formatDecisions(entries);
    expect(result).toContain('0042');
  });

  it('uses reasons as detail', () => {
    const entries: DecisionLogEntry[] = [{
      timestamp: '2026-01-01T00:00:00Z',
      iteration: 1,
      gate: 'gate1',
      agent: 'critic',
      decision: 'reject',
      reasons: 'Too generic',
    }];
    const result = formatDecisions(entries);
    expect(result).toContain('Too generic');
  });

  it('uses sharpening_notes as detail', () => {
    const entries: DecisionLogEntry[] = [{
      timestamp: '2026-01-01T00:00:00Z',
      iteration: 1,
      gate: 'gate1',
      agent: 'critic',
      decision: 'revise',
      sharpening_notes: 'Needs focus',
    }];
    const result = formatDecisions(entries);
    expect(result).toContain('Needs focus');
  });

  it('includes recommended complexity upgrades in decision history', () => {
    const entries: DecisionLogEntry[] = [{
      timestamp: '2026-01-01T00:00:00Z',
      iteration: 1,
      gate: 'gate1',
      agent: 'critic',
      decision: 'approve',
      proposal_title: 'Small Code Sketch',
      recommended_complexity: 'XL',
    }];
    const result = formatDecisions(entries);
    expect(result).toContain('recommended complexity: XL');
  });

  it('labels human redirect decisions in decision history', () => {
    const entries: DecisionLogEntry[] = [{
      timestamp: '2026-01-01T00:00:00Z',
      iteration: 1,
      gate: 'gate1',
      agent: 'critic',
      decision: 'approve',
      source: 'human_redirect',
      proposal_title: 'Operator Request',
      sharpening_notes: 'Keep the operator constraint visible',
    }];
    const result = formatDecisions(entries);
    expect(result).toContain('[human redirect]');
    expect(result).toContain('Operator Request');
    expect(result).toContain('Keep the operator constraint visible');
  });

  it('handles missing label gracefully', () => {
    const entries: DecisionLogEntry[] = [{
      timestamp: '2026-01-01T00:00:00Z',
      iteration: 1,
      gate: 'gate1',
      agent: 'critic',
      decision: 'approve',
    }];
    const result = formatDecisions(entries);
    expect(result).toContain('unknown');
  });
});

// --- formatTestReports ---

describe('formatTestReports', () => {
  it('returns placeholder for empty array', () => {
    expect(formatTestReports([])).toBe('*No test reports yet.*');
  });

  it('formats test report entries', () => {
    const entries: TestReportEntry[] = [{
      timestamp: '2026-01-01T00:00:00Z',
      iteration: 1,
      artifact_id: '0001',
      outcome: 'pass',
      summary: 'Everything passed',
      tests_run: 5,
      tests_passed: 5,
      tests_failed: 0,
    }];
    const result = formatTestReports(entries);
    expect(result).toContain('0001');
    expect(result).toContain('pass');
    expect(result).toContain('5/5');
    expect(result).toContain('Everything passed');
  });
});

// --- readLiveStimuli ---

describe('readLiveStimuli', () => {
  it('returns placeholder when no live dir', async () => {
    rmSync(path.join(tempDir, 'stimuli', 'live'), { recursive: true, force: true });
    expect(await readLiveStimuli()).toBe('*No live stimuli available.*');
  });

  it('returns placeholder when dir is empty', async () => {
    expect(await readLiveStimuli()).toBe('*No live stimuli available.*');
  });

  it('reads .md files from stimuli/live sorted', async () => {
    const liveDir = path.join(tempDir, 'stimuli', 'live');
    writeFileSync(path.join(liveDir, 'b-source.md'), 'B content');
    writeFileSync(path.join(liveDir, 'a-source.md'), 'A content');
    writeFileSync(path.join(liveDir, 'not-md.txt'), 'ignored');
    const result = await readLiveStimuli();
    expect(result).toBe('A content\n\n---\n\nB content');
  });

  it('skips empty md files', async () => {
    const liveDir = path.join(tempDir, 'stimuli', 'live');
    writeFileSync(path.join(liveDir, 'empty.md'), '   ');
    writeFileSync(path.join(liveDir, 'valid.md'), 'content');
    const result = await readLiveStimuli();
    expect(result).toBe('content');
  });
});

// --- pickRandomSkills ---

describe('pickRandomSkills', () => {
  it('returns placeholder when no skills dir', async () => {
    rmSync(path.join(tempDir, 'stimuli', 'skills'), { recursive: true, force: true });
    expect(await pickRandomSkills(3)).toBe('*No skill files available.*');
  });

  it('returns placeholder when dir is empty', async () => {
    expect(await pickRandomSkills(3)).toBe('*No skill files available.*');
  });

  it('picks up to count skills', async () => {
    const dir = path.join(tempDir, 'stimuli', 'skills');
    writeFileSync(path.join(dir, 'skill-a.md'), 'Skill A content');
    writeFileSync(path.join(dir, 'skill-b.md'), 'Skill B content');
    writeFileSync(path.join(dir, 'skill-c.md'), 'Skill C content');
    const result = await pickRandomSkills(2);
    // Should contain exactly 2 skill headers
    const headers = result.match(/### skill-[abc]\.md/g);
    expect(headers).toHaveLength(2);
  });

  it('picks all when count exceeds available', async () => {
    const dir = path.join(tempDir, 'stimuli', 'skills');
    writeFileSync(path.join(dir, 'only.md'), 'Only skill');
    const result = await pickRandomSkills(5);
    expect(result).toContain('### only.md');
    expect(result).toContain('Only skill');
  });

  it('skips empty skill files', async () => {
    const dir = path.join(tempDir, 'stimuli', 'skills');
    writeFileSync(path.join(dir, 'empty.md'), '  ');
    const result = await pickRandomSkills(3);
    expect(result).toBe('*No skill files available.*');
  });

  it('ignores non-md files', async () => {
    const dir = path.join(tempDir, 'stimuli', 'skills');
    writeFileSync(path.join(dir, 'readme.txt'), 'not a skill');
    expect(await pickRandomSkills(3)).toBe('*No skill files available.*');
  });
});

// --- readLineageContext / readMoodContext / readDreamsContext ---

describe('expanded ideator context readers', () => {
  it('formats lineage context from identity/lineage.yml', async () => {
    writeFileSync(path.join(tempDir, 'identity', 'lineage.yml'), [
      'nodes: []',
      'edges: []',
      'constellations:',
      '  - id: constellation-1',
      '    name: Recursive Tools',
      '    description: Tools that inspect their own process',
      '    artifact_ids: [0001, 0002]',
      '    motifs: []',
      '    first_seen: 1',
      '    last_active: 2',
      'creative_dna:',
      '  top_motifs: []',
      '  technique_signatures:',
      '    - constraint-first interfaces',
      '  domain_affinities: []',
      '  unexplored_territory:',
      '    - physical computing',
      'updated_at: "2026-01-01T00:00:00Z"',
    ].join('\n'));

    const result = await readLineageContext();

    expect(result).toContain('Recursive Tools');
    expect(result).toContain('constraint-first interfaces');
    expect(result).toContain('physical computing');
  });

  it('formats current mood context from identity/mood.yml', async () => {
    writeFileSync(path.join(tempDir, 'identity', 'mood.yml'), [
      'axes:',
      '  exploratory: 0.7',
      '  playful: 0.1',
      '  restless: -0.4',
      '  bold: 0',
      '  collaborative: 0',
      'dominant_mood: restless curiosity',
      'creative_nudge: Build something stranger than the last run.',
      'influences: []',
      'iteration: 12',
      'updated_at: "2026-01-01T00:00:00Z"',
    ].join('\n'));

    const result = await readMoodContext();

    expect(result).toContain('restless curiosity');
    expect(result).toContain('Build something stranger');
    expect(result).toContain('exploratory: +0.7');
    expect(result).toContain('restless: -0.4');
    expect(result).not.toContain('playful: +0.1');
  });

  it('formats dream context from identity/dreams.yml', async () => {
    writeFileSync(path.join(tempDir, 'identity', 'dreams.yml'), [
      'dreams:',
      '  - artifact_id: "0042"',
      '    title: Fallen Clock',
      '    domain: code-art',
      '    original_pitch: A clock that forgets time',
      '    kill_reason: The implementation was too thin',
      '    what_was_good: The metaphor had force',
      '    resurrection_hint: Rebuild it as an interactive installation',
      '    iteration: 42',
      '    created_at: "2026-01-01T00:00:00Z"',
      'updated_at: "2026-01-01T00:00:00Z"',
    ].join('\n'));

    const result = await readDreamsContext();

    expect(result).toContain('Fallen Clock');
    expect(result).toContain('The metaphor had force');
    expect(result).toContain('interactive installation');
  });
});

// --- selectDiverseReviews ---

describe('selectDiverseReviews', () => {
  function makeReview(title: string, gate: 'gate1' | 'gate2' = 'gate2'): DecisionLogEntry {
    return {
      timestamp: '2026-01-01T00:00:00Z',
      iteration: 1,
      gate,
      agent: 'critic',
      decision: 'ship',
      proposal_title: title,
    };
  }

  it('returns all when count <= maxCount', () => {
    const reviews = [makeReview('A'), makeReview('B')];
    expect(selectDiverseReviews(reviews, 5)).toEqual(reviews);
  });

  it('selects diverse reviews across domains', () => {
    const reviews = [
      makeReview('fiction story1'),
      makeReview('fiction story2'),
      makeReview('fiction story3'),
      makeReview('code tool1'),
      makeReview('code tool2'),
      makeReview('poetry haiku'),
    ];
    const selected = selectDiverseReviews(reviews, 3);
    expect(selected).toHaveLength(3);
    // Should include items from different "domains" (first word of title)
    const domains = new Set(selected.map(r => r.proposal_title!.split(' ')[0]));
    expect(domains.size).toBeGreaterThan(1);
  });

  it('preserves original order in output', () => {
    const reviews = [
      makeReview('alpha one'),
      makeReview('beta two'),
      makeReview('gamma three'),
      makeReview('alpha four'),
    ];
    const selected = selectDiverseReviews(reviews, 3);
    // Check indices are ascending
    const indices = selected.map(s => reviews.indexOf(s));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  it('handles reviews with undefined proposal_title', () => {
    const reviews: DecisionLogEntry[] = [
      { timestamp: '2026-01-01T00:00:00Z', iteration: 1, gate: 'gate2', agent: 'critic', decision: 'ship' },
      { timestamp: '2026-01-02T00:00:00Z', iteration: 2, gate: 'gate2', agent: 'critic', decision: 'ship' },
      { timestamp: '2026-01-03T00:00:00Z', iteration: 3, gate: 'gate2', agent: 'critic', decision: 'ship' },
    ];
    // All go to "unknown" domain; selecting 2 should still work
    const selected = selectDiverseReviews(reviews, 2);
    expect(selected).toHaveLength(2);
  });

  it('exhausts all domains when maxCount exceeds single-domain pool', () => {
    // Single domain with exactly maxCount items — should exhaust and break
    const reviews = [
      makeReview('alpha one'),
      makeReview('alpha two'),
    ];
    const selected = selectDiverseReviews(reviews, 2);
    expect(selected).toHaveLength(2);
  });

  it('handles pool exhaustion with domain splice edge case', () => {
    const reviews = [
      makeReview('aaa item1'),
      makeReview('bbb item1'),
      makeReview('bbb item2'),
    ];
    const selected = selectDiverseReviews(reviews, 3);
    expect(selected).toHaveLength(3);
  });

  it('removes the correct exhausted domain, not the next one', () => {
    // Domain "x" has 1 entry, "y" has 2, "z" has 2. When "x" exhausts after
    // round 1, splicing must remove "x" — not "y".
    const reviews = [
      makeReview('x only'),
      makeReview('y first'),
      makeReview('y second'),
      makeReview('z first'),
      makeReview('z second'),
    ];
    const selected = selectDiverseReviews(reviews, 4);
    expect(selected).toHaveLength(4);
    const titles = selected.map(r => r.proposal_title!);
    // "x only" must be included (it's the sole x entry)
    expect(titles).toContain('x only');
    // Both y and z domains should be represented
    const domains = new Set(titles.map(t => t.split(' ')[0]));
    expect(domains).toContain('y');
    expect(domains).toContain('z');
  });

  it('exhausts all domains and breaks out of while loop', () => {
    // All reviews from one domain, maxCount = number of reviews
    // This ensures domains.length reaches 0 and break fires
    const reviews = [
      makeReview('same item1'),
      makeReview('same item2'),
      makeReview('same item3'),
    ];
    const selected = selectDiverseReviews(reviews, 3);
    expect(selected).toHaveLength(3);
  });
});

// --- getComplexityDistribution / formatComplexityDistribution ---

import { getComplexityDistribution, formatComplexityDistribution } from '../src/context/data.js';

describe('getComplexityDistribution', () => {
  it('counts complexity tiers from iteration log', async () => {
    const logContent = [
      '{"iteration":1,"complexity":"S"}',
      '{"iteration":2,"complexity":"M"}',
      '{"iteration":3,"complexity":"S"}',
      '{"iteration":4,"complexity":"L"}',
    ].join('\n');
    writeFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), logContent);

    const dist = await getComplexityDistribution(10);
    expect(dist.S).toBe(2);
    expect(dist.M).toBe(1);
    expect(dist.L).toBe(1);
    expect(dist.XL).toBe(0);
  });

  it('defaults missing complexity to S', async () => {
    const logContent = '{"iteration":1}';
    writeFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), logContent);

    const dist = await getComplexityDistribution(10);
    expect(dist.S).toBe(1);
  });

  it('respects window size', async () => {
    const logContent = [
      '{"iteration":1,"complexity":"S"}',
      '{"iteration":2,"complexity":"S"}',
      '{"iteration":3,"complexity":"M"}',
      '{"iteration":4,"complexity":"L"}',
    ].join('\n');
    writeFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), logContent);

    const dist = await getComplexityDistribution(2);
    expect(dist.M).toBe(1);
    expect(dist.L).toBe(1);
    expect(dist.S).toBe(0);
  });

  it('returns zeros when no iteration log exists', async () => {
    const dist = await getComplexityDistribution(10);
    expect(dist.S).toBe(0);
    expect(dist.M).toBe(0);
    expect(dist.L).toBe(0);
    expect(dist.XL).toBe(0);
  });
});

describe('formatComplexityDistribution', () => {
  it('formats distribution with percentages', () => {
    const result = formatComplexityDistribution({ S: 5, M: 3, L: 1, XL: 1 });
    expect(result).toContain('S: 5 (50%)');
    expect(result).toContain('M: 3 (30%)');
    expect(result).toContain('L: 1 (10%)');
    expect(result).toContain('XL: 1 (10%)');
  });

  it('returns placeholder when total is zero', () => {
    const result = formatComplexityDistribution({ S: 0, M: 0, L: 0, XL: 0 });
    expect(result).toBe('*No iteration data yet.*');
  });
});
