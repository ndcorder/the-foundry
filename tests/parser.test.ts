import { describe, it, expect, vi } from 'vitest';

// Mock outputguard before importing the parser
const mockRepair = vi.fn((s: string) => ({ text: s, repaired: false }));
const mockRetryPrompt = vi.fn(() => 'Please fix the YAML output.');
vi.mock('outputguard', () => ({
  repair: (...args: any[]) => mockRepair(...args),
  retryPrompt: (...args: any[]) => mockRetryPrompt(...args),
}));

import {
  parseYaml,
  buildCorrectionPrompt,
  validateIdeator,
  normalizeCriticGate1,
  validateCriticGate1,
  validateCreator,
  validateTester,
  normalizeCriticGate2,
  validateCriticGate2,
  validateCuratorRedirect,
  validateCuratorFull,
  validateCreatorPlan,
  validateCreatorBuild,
  getSchema,
  getValidator,
} from '../src/parser/yaml-parser.js';

// ── parseYaml ────────────────────────────────────────────────────

describe('parseYaml', () => {
  it('parses plain YAML', () => {
    const result = parseYaml<{ title: string }>('title: hello');
    expect(result).toEqual({ title: 'hello' });
  });

  it('strips markdown fences', () => {
    mockRepair.mockReturnValueOnce({ text: 'title: fenced', repaired: true });
    const result = parseYaml<{ title: string }>('```yaml\ntitle: fenced\n```');
    expect(result.title).toBe('fenced');
  });

  it('strips thinking tags', () => {
    const input = '<thinking>some reasoning</thinking>\ntitle: clean';
    const result = parseYaml<{ title: string }>(input);
    expect(result.title).toBe('clean');
  });

  it('strips reasoning tags', () => {
    const input = '<reasoning>think</reasoning>\ntitle: cleaned';
    const result = parseYaml<{ title: string }>(input);
    expect(result.title).toBe('cleaned');
  });

  it('strips output tags', () => {
    const input = '<output>title: wrapped</output>';
    const result = parseYaml<{ title: string }>(input);
    expect(result.title).toBe('wrapped');
  });

  it('strips response tags', () => {
    const input = '<response>title: resp</response>';
    const result = parseYaml<{ title: string }>(input);
    expect(result.title).toBe('resp');
  });

  it('strips answer tags', () => {
    const input = '<answer>title: ans</answer>';
    const result = parseYaml<{ title: string }>(input);
    expect(result.title).toBe('ans');
  });

  it('strips tool_call tags', () => {
    const input = '<tool_call>use</tool_call>\ntitle: clean';
    const result = parseYaml<{ title: string }>(input);
    expect(result.title).toBe('clean');
  });

  it('strips tool_use tags', () => {
    const input = '<tool_use>use</tool_use>\ntitle: clean';
    const result = parseYaml<{ title: string }>(input);
    expect(result.title).toBe('clean');
  });

  it('strips function_call tags', () => {
    const input = '<function_call>call</function_call>\ntitle: clean';
    const result = parseYaml<{ title: string }>(input);
    expect(result.title).toBe('clean');
  });

  it('throws on unparseable YAML', () => {
    mockRepair.mockReturnValueOnce({ text: '', repaired: false, parseError: 'bad yaml' });
    expect(() => parseYaml('{{{')).toThrow('bad yaml');
  });

  it('throws with parseError when repair reports failure', () => {
    mockRepair.mockReturnValueOnce({ text: '', repaired: false, parseError: 'bad yaml detected' });
    expect(() => parseYaml('bad')).toThrow('bad yaml detected');
  });

  it('handles complex nested YAML', () => {
    const input = `
ideas:
  - title: A poem
    domain: poetry
    pitch: About stars
    complexity: S
    why: Because stars
`;
    const result = parseYaml<{ ideas: any[] }>(input);
    expect(result.ideas).toHaveLength(1);
    expect(result.ideas[0].title).toBe('A poem');
  });
});

// ── buildCorrectionPrompt ──────────────────────────────────────

describe('buildCorrectionPrompt', () => {
  it('uses retryPrompt when role has schema', () => {
    const result = buildCorrectionPrompt('bad yaml', 'parse error', 'ideator');
    expect(mockRetryPrompt).toHaveBeenCalled();
    expect(result).toContain('YAML');
  });

  it('builds generic prompt when role has no schema', () => {
    const result = buildCorrectionPrompt('bad yaml', 'error', 'nonexistent-role');
    expect(result).toContain('bad yaml');
    expect(result).toContain('error');
  });

  it('truncates long responses in generic prompt', () => {
    const longResponse = 'x'.repeat(3000);
    const result = buildCorrectionPrompt(longResponse, 'error');
    expect(result).toContain('[...truncated]');
    // Should only include first 2000 chars of the response
    expect(result).not.toContain('x'.repeat(2001));
  });

  it('does not truncate short responses', () => {
    const result = buildCorrectionPrompt('short', 'error');
    expect(result).not.toContain('[...truncated]');
  });
});

// ── validateIdeator ──────────────────────────────────────────────

describe('validateIdeator', () => {
  it('accepts valid ideator response', () => {
    expect(validateIdeator({
      ideas: [{ title: 'Foo', domain: 'code', pitch: 'A thing', complexity: 'S', why: 'Because' }],
    })).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateIdeator(null)).toBe(false);
    expect(validateIdeator('string')).toBe(false);
    expect(validateIdeator(42)).toBe(false);
  });

  it('rejects missing ideas array', () => {
    expect(validateIdeator({})).toBe(false);
  });

  it('rejects empty ideas array', () => {
    expect(validateIdeator({ ideas: [] })).toBe(false);
  });

  it('rejects ideas missing required string fields', () => {
    expect(validateIdeator({ ideas: [{ title: 'Foo' }] })).toBe(false);
    expect(validateIdeator({ ideas: [{ title: 'Foo', domain: 'x' }] })).toBe(false);
  });

  it('rejects when ideas is not an array', () => {
    expect(validateIdeator({ ideas: 'not array' })).toBe(false);
  });

  it('rejects arrays at top level', () => {
    expect(validateIdeator([{ title: 'Foo', domain: 'x', pitch: 'y' }])).toBe(false);
  });

  it('accepts XL complexity with xl_mode', () => {
    const data = {
      ideas: [{
        title: 'Big Game',
        domain: 'code-game',
        pitch: 'A massive game',
        complexity: 'XL',
        why: 'Ambition',
        project_id: null,
        stimulus_ref: null,
        xl_mode: 'single',
      }],
    };
    expect(validateIdeator(data)).toBe(true);
  });

  it('accepts XL project proposal', () => {
    const data = {
      ideas: [{
        title: 'Epic Novella',
        domain: 'fiction',
        pitch: 'A six-chapter novella',
        complexity: 'XL',
        why: 'Depth',
        project_id: null,
        stimulus_ref: null,
        xl_mode: 'project',
        project: {
          name: 'The Last Librarian',
          description: 'A novella in 6 chapters',
          estimated_iterations: 6,
          structure: [{ chapter_1: 'The arrival' }],
        },
      }],
    };
    expect(validateIdeator(data)).toBe(true);
  });
});

// ── normalizeCriticGate1 ─────────────────────────────────────────

describe('normalizeCriticGate1', () => {
  it('maps decisions key to evaluations', () => {
    const data = { decisions: [{ title: 'A', decision: 'approve' }] };
    normalizeCriticGate1(data);
    expect((data as any).evaluations).toBeDefined();
    expect((data as any).decisions).toBeUndefined();
  });

  it('maps verdict to decision', () => {
    const data = { evaluations: [{ title: 'A', verdict: 'approve' }] };
    normalizeCriticGate1(data);
    expect((data as any).evaluations[0].decision).toBe('approve');
  });

  it('maps notes to sharpening_notes', () => {
    const data = { evaluations: [{ title: 'A', decision: 'ok', notes: 'fix it' }] };
    normalizeCriticGate1(data);
    expect((data as any).evaluations[0].sharpening_notes).toBe('fix it');
  });

  it('maps reason to reasons', () => {
    const data = { evaluations: [{ title: 'A', decision: 'ok', reason: 'bad' }] };
    normalizeCriticGate1(data);
    expect((data as any).evaluations[0].reasons).toBe('bad');
  });

  it('preserves recommended complexity upgrades', () => {
    const data = { evaluations: [{ title: 'A', decision: 'approve', recommended_complexity: 'XL' }] };
    normalizeCriticGate1(data);
    expect((data as any).evaluations[0].recommended_complexity).toBe('XL');
  });

  it('normalizes selected aliases', () => {
    const data = {
      selected_title: 'A',
      evaluations: [{ title: 'A', decision: 'approve' }],
    };
    normalizeCriticGate1(data);
    expect((data as any).selected).toBe('A');
  });

  it('returns non-object input unchanged', () => {
    expect(normalizeCriticGate1(42)).toBe(42);
    expect(normalizeCriticGate1('str')).toBe('str');
  });

  it('returns data unchanged when no evaluations or decisions', () => {
    const data = { other: true };
    normalizeCriticGate1(data);
    expect(data).toEqual({ other: true });
  });
});

// ── normalizeCriticGate2 ────────────────────────────────────────

describe('normalizeCriticGate2', () => {
  it('maps verdict to decision', () => {
    const data = { verdict: 'ship', ratings: {}, review: 'ok' };
    normalizeCriticGate2(data);
    expect((data as any).decision).toBe('ship');
    expect((data as any).verdict).toBeUndefined();
  });

  it('does not overwrite existing decision', () => {
    const data = { decision: 'revise', verdict: 'ship', ratings: {}, review: 'ok' };
    normalizeCriticGate2(data);
    expect((data as any).decision).toBe('revise');
  });

  it('returns non-object input unchanged', () => {
    expect(normalizeCriticGate2(42)).toBe(42);
  });
});

// ── validateCriticGate1 ─────────────────────────────────────────

describe('validateCriticGate1', () => {
  it('accepts valid evaluations', () => {
    expect(validateCriticGate1({
      evaluations: [{ title: 'Idea', decision: 'approve', sharpening_notes: '', reasons: '' }],
    })).toBe(true);
  });

  it('accepts "decisions" key as alias for evaluations', () => {
    expect(validateCriticGate1({
      decisions: [{ title: 'Idea', decision: 'reject', sharpening_notes: '', reasons: '' }],
    })).toBe(true);
  });

  it('accepts "verdict" as alias for decision', () => {
    expect(validateCriticGate1({
      evaluations: [{ title: 'Idea', verdict: 'approve' }],
    })).toBe(true);
  });

  it('accepts selected idea metadata', () => {
    const data = {
      selected: 'Idea',
      evaluations: [{ title: 'Idea', decision: 'approve' }],
    };
    expect(validateCriticGate1(data)).toBe(true);
    expect((data as any).selected).toBe('Idea');
  });

  it('rejects non-object', () => {
    expect(validateCriticGate1(null)).toBe(false);
  });

  it('rejects empty evaluations', () => {
    expect(validateCriticGate1({ evaluations: [] })).toBe(false);
  });

  it('rejects missing title', () => {
    expect(validateCriticGate1({
      evaluations: [{ decision: 'approve' }],
    })).toBe(false);
  });
});

// ── validateCreator ─────────────────────────────────────────────

describe('validateCreator', () => {
  it('accepts valid creator response', () => {
    expect(validateCreator({
      title: 'My Art',
      files: [{ path: 'main.py', content: 'print("hi")' }],
    })).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateCreator(null)).toBe(false);
  });

  it('rejects missing title', () => {
    expect(validateCreator({ files: [{ path: 'a', content: 'b' }] })).toBe(false);
  });

  it('rejects non-string title', () => {
    expect(validateCreator({ title: 42, files: [{ path: 'a', content: 'b' }] })).toBe(false);
  });

  it('rejects missing files', () => {
    expect(validateCreator({ title: 'x' })).toBe(false);
  });

  it('rejects empty files array', () => {
    expect(validateCreator({ title: 'x', files: [] })).toBe(false);
  });

  it('rejects files without path or content', () => {
    expect(validateCreator({ title: 'x', files: [{ path: 'a' }] })).toBe(false);
    expect(validateCreator({ title: 'x', files: [{ content: 'b' }] })).toBe(false);
  });
});

// ── validateTester ──────────────────────────────────────────────

describe('validateTester', () => {
  it('accepts valid tester response', () => {
    expect(validateTester({ verdict: 'pass', summary: 'ok' })).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateTester(null)).toBe(false);
  });

  it('rejects missing verdict', () => {
    expect(validateTester({ summary: 'x' })).toBe(false);
  });

  it('rejects missing summary', () => {
    expect(validateTester({ verdict: 'pass' })).toBe(false);
  });
});

// ── validateCriticGate2 ─────────────────────────────────────────

describe('validateCriticGate2', () => {
  it('accepts valid gate2 response', () => {
    expect(validateCriticGate2({
      decision: 'ship',
      ratings: { originality: 4 },
      review: 'Good work',
    })).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateCriticGate2(null)).toBe(false);
  });

  it('rejects missing decision', () => {
    expect(validateCriticGate2({ ratings: {}, review: 'x' })).toBe(false);
  });

  it('rejects non-object ratings', () => {
    expect(validateCriticGate2({ decision: 'ship', ratings: 'bad', review: 'x' })).toBe(false);
  });

  it('rejects missing review', () => {
    expect(validateCriticGate2({ decision: 'ship', ratings: {} })).toBe(false);
  });

  it('rejects array ratings', () => {
    expect(validateCriticGate2({ decision: 'ship', ratings: [1, 2], review: 'x' })).toBe(false);
  });
});

// ── validateCuratorRedirect ─────────────────────────────────────

describe('validateCuratorRedirect', () => {
  it('accepts valid redirect', () => {
    expect(validateCuratorRedirect({
      proposal: { title: 'New idea', domain: 'code' },
    })).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateCuratorRedirect(null)).toBe(false);
  });

  it('rejects missing proposal', () => {
    expect(validateCuratorRedirect({})).toBe(false);
  });

  it('rejects non-object proposal', () => {
    expect(validateCuratorRedirect({ proposal: 'string' })).toBe(false);
  });

  it('rejects proposal without title', () => {
    expect(validateCuratorRedirect({ proposal: { domain: 'x' } })).toBe(false);
  });

  it('rejects proposal without domain', () => {
    expect(validateCuratorRedirect({ proposal: { title: 'x' } })).toBe(false);
  });
});

// ── validateCuratorFull ─────────────────────────────────────────

describe('validateCuratorFull', () => {
  it('accepts valid curator response', () => {
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
    })).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateCuratorFull(null)).toBe(false);
  });

  it('rejects missing retrospective', () => {
    expect(validateCuratorFull({ compressed_journal: 'x' })).toBe(false);
  });

  it('rejects missing compressed_journal', () => {
    expect(validateCuratorFull({ retrospective: 'x' })).toBe(false);
  });

  it('rejects non-string retrospective', () => {
    expect(validateCuratorFull({ retrospective: 42, compressed_journal: 'x' })).toBe(false);
  });
});

// ── validateCreatorPlan ─────────────────────────────────────────

describe('validateCreatorPlan', () => {
  it('accepts valid plan response', () => {
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it incrementally',
        file_manifest: [{ path: 'main.ts', purpose: 'Entry point' }],
        key_decisions: ['Use TypeScript'],
        challenges: ['Complexity'],
      },
    })).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateCreatorPlan(null)).toBe(false);
  });

  it('rejects missing plan', () => {
    expect(validateCreatorPlan({})).toBe(false);
  });

  it('rejects non-object plan', () => {
    expect(validateCreatorPlan({ plan: 'string' })).toBe(false);
  });

  it('rejects plan without approach', () => {
    expect(validateCreatorPlan({
      plan: { file_manifest: [] },
    })).toBe(false);
  });

  it('rejects plan without file_manifest', () => {
    expect(validateCreatorPlan({
      plan: { approach: 'do stuff' },
    })).toBe(false);
  });
});

// ── validateCreatorBuild ────────────────────────────────────────

describe('validateCreatorBuild', () => {
  it('accepts valid build response', () => {
    expect(validateCreatorBuild({
      files: [{ path: 'main.ts', content: 'console.log(1)' }],
    })).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateCreatorBuild(null)).toBe(false);
  });

  it('rejects missing files', () => {
    expect(validateCreatorBuild({})).toBe(false);
  });

  it('rejects empty files array', () => {
    expect(validateCreatorBuild({ files: [] })).toBe(false);
  });

  it('rejects files without path or content', () => {
    expect(validateCreatorBuild({ files: [{ path: 'a' }] })).toBe(false);
    expect(validateCreatorBuild({ files: [{ content: 'b' }] })).toBe(false);
  });
});

// ── getSchema ────────────────────────────────────────────────────

describe('getSchema', () => {
  it('returns schema for known roles', () => {
    for (const role of ['ideator', 'critic-gate1', 'creator', 'tester', 'critic-gate2', 'curator-redirect', 'curator-full', 'creator-plan', 'creator-build']) {
      expect(getSchema(role)).toBeDefined();
    }
  });

  it('returns undefined for unknown role', () => {
    expect(getSchema('nonexistent')).toBeUndefined();
  });
});

// ── getValidator ─────────────────────────────────────────────────

describe('getValidator', () => {
  it('returns validator for known keys', () => {
    for (const key of ['ideator', 'critic-gate1', 'creator', 'tester', 'critic-gate2', 'curator-redirect', 'curator-full', 'creator-plan', 'creator-build']) {
      const v = getValidator(key);
      expect(typeof v).toBe('function');
    }
  });

  it('returns undefined for unknown key', () => {
    expect(getValidator('nonexistent')).toBeUndefined();
  });
});
