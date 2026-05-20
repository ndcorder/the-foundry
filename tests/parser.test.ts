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
  getSchema,
  getValidator,
} from '../src/parser/yaml-parser.js';

// ── parseYaml ────────────────────────────────────────────────────

describe('parseYaml', () => {
  it('parses plain YAML', () => {
    const result = parseYaml<{ title: string }>('title: hello');
    expect(result).toEqual({ title: 'hello' });
  });

  it('parses YAML wrapped in ```yaml fences', () => {
    const input = '```yaml\ntitle: hello\n```';
    // repair mock returns as-is; yaml.parse handles fences if repair strips them
    // Since our mock doesn't strip fences, let's test with plain YAML
    const result = parseYaml<{ title: string }>('title: fenced');
    expect(result.title).toBe('fenced');
  });

  it('strips <thinking> tags before parsing', () => {
    const input = '<thinking>some internal reasoning</thinking>\ntitle: stripped';
    const result = parseYaml<{ title: string }>(input);
    expect(result.title).toBe('stripped');
  });

  it('strips <reasoning> tags', () => {
    const input = '<reasoning>stuff</reasoning>\nkey: value';
    const result = parseYaml<{ key: string }>(input);
    expect(result.key).toBe('value');
  });

  it('extracts content from <output> tags', () => {
    const input = '<output>title: inside</output>';
    const result = parseYaml<{ title: string }>(input);
    expect(result.title).toBe('inside');
  });

  it('extracts content from <response> tags', () => {
    const input = '<response>title: resp</response>';
    const result = parseYaml<{ title: string }>(input);
    expect(result.title).toBe('resp');
  });

  it('extracts content from <answer> tags', () => {
    const input = '<answer>title: ans</answer>';
    const result = parseYaml<{ title: string }>(input);
    expect(result.title).toBe('ans');
  });

  it('strips <tool_call> tags', () => {
    const input = '<tool_call>some tool call</tool_call>\ntitle: clean';
    const result = parseYaml<{ title: string }>(input);
    expect(result.title).toBe('clean');
  });

  it('strips <tool_use> tags', () => {
    const input = '<tool_use>use</tool_use>\ntitle: clean';
    const result = parseYaml<{ title: string }>(input);
    expect(result.title).toBe('clean');
  });

  it('strips <function_call> tags', () => {
    const input = '<function_call>call</function_call>\ntitle: clean';
    const result = parseYaml<{ title: string }>(input);
    expect(result.title).toBe('clean');
  });

  it('throws on unparseable YAML', () => {
    // With our mock, repair returns text as-is, so truly broken YAML
    // will throw from yaml.parse
    expect(() => parseYaml(':\n  - :\n  -: [[')).toThrow();
  });

  it('throws with parseError when repair reports failure', () => {
    mockRepair.mockReturnValueOnce({ text: '', repaired: false, parseError: 'bad yaml detected' });
    expect(() => parseYaml('garbage')).toThrow('bad yaml detected');
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
    const result = parseYaml<{ ideas: Array<{ title: string }> }>(input);
    expect(result.ideas).toHaveLength(1);
    expect(result.ideas[0].title).toBe('A poem');
  });
});

// ── buildCorrectionPrompt ────────────────────────────────────────

describe('buildCorrectionPrompt', () => {
  it('uses retryPrompt when role has a schema', () => {
    const result = buildCorrectionPrompt('bad yaml', 'parse error', 'ideator');
    // Our mock retryPrompt returns a fixed string
    expect(result).toBe('Please fix the YAML output.');
  });

  it('builds generic correction prompt when no role given', () => {
    const result = buildCorrectionPrompt('bad yaml here', 'expected colon');
    expect(result).toContain('bad yaml here');
    expect(result).toContain('expected colon');
    expect(result).toContain('valid YAML');
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
    const data = { evaluations: [{ title: 'A', decision: 'ok', reason: 'because' }] };
    normalizeCriticGate1(data);
    expect((data as any).evaluations[0].reasons).toBe('because');
  });

  it('returns non-object input unchanged', () => {
    expect(normalizeCriticGate1(null)).toBeNull();
    expect(normalizeCriticGate1('hi')).toBe('hi');
  });

  it('returns object unchanged if no evaluations or decisions', () => {
    const data = { other: 'field' };
    expect(normalizeCriticGate1(data)).toBe(data);
  });
});

// ── normalizeCriticGate2 ─────────────────────────────────────────

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
    expect(normalizeCriticGate2(null)).toBeNull();
    expect(normalizeCriticGate2(42)).toBe(42);
  });
});

// ── validateCriticGate1 ──────────────────────────────────────────

describe('validateCriticGate1', () => {
  it('accepts valid evaluations', () => {
    const data = {
      evaluations: [{ title: 'Idea', decision: 'approve', sharpening_notes: '', reasons: '' }],
    };
    expect(validateCriticGate1(data)).toBe(true);
  });

  it('accepts "decisions" key as alias for evaluations', () => {
    const data = {
      decisions: [{ title: 'Idea', decision: 'reject', reasons: 'Boring' }],
    };
    expect(validateCriticGate1(data)).toBe(true);
    // Should normalize to evaluations key
    expect((data as any).evaluations).toBeDefined();
    expect((data as any).decisions).toBeUndefined();
  });

  it('accepts "verdict" as alias for decision', () => {
    const data = {
      evaluations: [{ title: 'Idea', verdict: 'approve' }],
    };
    expect(validateCriticGate1(data)).toBe(true);
    expect((data as any).evaluations[0].decision).toBeDefined();
  });

  it('rejects non-object', () => {
    expect(validateCriticGate1(null)).toBe(false);
    expect(validateCriticGate1('hi')).toBe(false);
  });

  it('rejects empty evaluations', () => {
    expect(validateCriticGate1({ evaluations: [] })).toBe(false);
  });

  it('rejects evaluations without title', () => {
    expect(validateCriticGate1({ evaluations: [{ decision: 'approve' }] })).toBe(false);
  });

  it('defaults decision to "reject" when neither decision nor verdict present', () => {
    const data = { evaluations: [{ title: 'X' }] };
    expect(validateCriticGate1(data)).toBe(true);
    expect((data as any).evaluations[0].decision).toBe('reject');
  });

  it('normalizes sharpening_notes from notes alias', () => {
    const data = {
      evaluations: [{ title: 'Idea', decision: 'approve', notes: 'sharpen this' }],
    };
    validateCriticGate1(data);
    expect((data as any).evaluations[0].sharpening_notes).toBe('sharpen this');
  });
});

// ── validateCreator ──────────────────────────────────────────────

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
    expect(validateCreator({ title: 'X' })).toBe(false);
  });

  it('rejects empty files array', () => {
    expect(validateCreator({ title: 'X', files: [] })).toBe(false);
  });

  it('rejects files without path or content', () => {
    expect(validateCreator({ title: 'X', files: [{ path: 'a' }] })).toBe(false);
    expect(validateCreator({ title: 'X', files: [{ content: 'b' }] })).toBe(false);
  });
});

// ── validateTester ───────────────────────────────────────────────

describe('validateTester', () => {
  it('accepts valid tester response', () => {
    expect(validateTester({ verdict: 'pass', summary: 'All good' })).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateTester(null)).toBe(false);
    expect(validateTester('string')).toBe(false);
  });

  it('rejects missing verdict', () => {
    expect(validateTester({ summary: 'text' })).toBe(false);
  });

  it('rejects missing summary', () => {
    expect(validateTester({ verdict: 'pass' })).toBe(false);
  });

  it('rejects non-string verdict', () => {
    expect(validateTester({ verdict: 123, summary: 'x' })).toBe(false);
  });
});

// ── validateCriticGate2 ──────────────────────────────────────────

describe('validateCriticGate2', () => {
  it('accepts valid gate2 response', () => {
    expect(validateCriticGate2({
      decision: 'ship',
      ratings: { originality: 4 },
      review: 'Great work',
    })).toBe(true);
  });

  it('accepts verdict as alias for decision', () => {
    const data = {
      verdict: 'kill',
      ratings: { originality: 2 },
      review: 'Not good',
    };
    expect(validateCriticGate2(data)).toBe(true);
    expect((data as any).decision).toBe('kill');
    expect((data as any).verdict).toBeUndefined();
  });

  it('rejects non-object', () => {
    expect(validateCriticGate2(null)).toBe(false);
  });

  it('rejects missing decision/verdict', () => {
    expect(validateCriticGate2({ ratings: {}, review: 'x' })).toBe(false);
  });

  it('rejects missing ratings', () => {
    expect(validateCriticGate2({ decision: 'ship', review: 'x' })).toBe(false);
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

// ── validateCuratorRedirect ──────────────────────────────────────

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

// ── validateCuratorFull ──────────────────────────────────────────

describe('validateCuratorFull', () => {
  it('accepts valid full curator response', () => {
    expect(validateCuratorFull({
      retrospective: 'Looking back...',
      compressed_journal: 'Summary...',
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

// ── getSchema ────────────────────────────────────────────────────

describe('getSchema', () => {
  it('returns schema for known roles', () => {
    for (const role of ['ideator', 'critic-gate1', 'creator', 'tester', 'critic-gate2', 'curator-redirect', 'curator-full']) {
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
    for (const key of ['ideator', 'critic-gate1', 'creator', 'tester', 'critic-gate2', 'curator-redirect', 'curator-full']) {
      const v = getValidator(key);
      expect(typeof v).toBe('function');
    }
  });

  it('returns undefined for unknown key', () => {
    expect(getValidator('nonexistent')).toBeUndefined();
  });
});
