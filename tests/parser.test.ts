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
  const makeIdea = (overrides: Record<string, unknown> = {}) => ({
    title: 'Foo',
    domain: 'code',
    pitch: 'A thing',
    complexity: 'M',
    why: 'Because',
    ...overrides,
  });

  const makeIdeas = (first: Record<string, unknown> = {}) => [
    makeIdea(first),
    makeIdea({ title: 'Bar', domain: 'prose' }),
    makeIdea({ title: 'Baz', domain: 'code-tool', complexity: 'L' }),
    makeIdea({ title: 'Qux', domain: 'poetry', complexity: 'L' }),
    makeIdea({ title: 'Quux', domain: 'fiction', complexity: 'XL', xl_mode: 'single' }),
  ];

  const validProject = {
    name: 'The Last Librarian',
    description: 'A novella in 6 chapters',
    estimated_iterations: 6,
    structure: [{ chapter_1: 'The arrival' }],
  };

  it('accepts valid ideator response', () => {
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'S' }),
    })).toBe(true);
  });

  it('trims proposal titles before validation', () => {
    const data = {
      ideas: makeIdeas({ title: '  Foo  ', complexity: 'S' }),
    };
    expect(validateIdeator(data)).toBe(true);
    expect((data as any).ideas[0].title).toBe('Foo');
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

  it('requires exactly five ideas', () => {
    expect(validateIdeator({ ideas: makeIdeas().slice(0, 4) })).toBe(false);
    expect(validateIdeator({ ideas: [...makeIdeas(), makeIdea({ title: 'Sixth' })] })).toBe(false);
  });

  it('requires the configured ambitious complexity distribution', () => {
    expect(validateIdeator({
      ideas: [
        makeIdea({ title: 'One', complexity: 'S' }),
        makeIdea({ title: 'Two', complexity: 'S' }),
        makeIdea({ title: 'Three', complexity: 'M' }),
        makeIdea({ title: 'Four', complexity: 'L' }),
        makeIdea({ title: 'Five', complexity: 'XL', xl_mode: 'single' }),
      ],
    })).toBe(false);
    expect(validateIdeator({
      ideas: [
        makeIdea({ title: 'One', complexity: 'S' }),
        makeIdea({ title: 'Two', complexity: 'M' }),
        makeIdea({ title: 'Three', complexity: 'M' }),
        makeIdea({ title: 'Four', complexity: 'M' }),
        makeIdea({ title: 'Five', complexity: 'L' }),
      ],
    })).toBe(false);
  });

  it('rejects ideas missing required string fields', () => {
    expect(validateIdeator({ ideas: makeIdeas({ domain: undefined, pitch: undefined, complexity: undefined, why: undefined }) })).toBe(false);
    expect(validateIdeator({ ideas: makeIdeas({ pitch: undefined, complexity: undefined, why: undefined }) })).toBe(false);
    expect(validateIdeator({ ideas: makeIdeas({ complexity: undefined, why: undefined }) })).toBe(false);
  });

  it('rejects blank proposal core fields', () => {
    expect(validateIdeator({ ideas: makeIdeas({ domain: '', complexity: 'S' }) })).toBe(false);
    expect(validateIdeator({ ideas: makeIdeas({ pitch: '   ', complexity: 'S' }) })).toBe(false);
    expect(validateIdeator({ ideas: makeIdeas({ why: '', complexity: 'S' }) })).toBe(false);
  });

  it('rejects blank or duplicate proposal titles', () => {
    expect(validateIdeator({
      ideas: makeIdeas({ title: '', complexity: 'S' }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ title: '   ', complexity: 'S' }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: [
        makeIdea({ title: 'Foo', complexity: 'S' }),
        makeIdea({ title: ' Foo ', domain: 'prose', pitch: 'Another thing', complexity: 'M', why: 'Variety' }),
        ...makeIdeas().slice(2),
      ],
    })).toBe(false);
  });

  it('rejects unsupported complexity tiers', () => {
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'XXL' }),
    })).toBe(false);
  });

  it('rejects XL proposals without valid XL mode metadata', () => {
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'XL', xl_mode: undefined }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'XL', xl_mode: 'giant' }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'XL', xl_mode: 'project', project: null }),
    })).toBe(false);
  });

  it('rejects malformed XL project metadata', () => {
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'XL', xl_mode: 'project', project: { ...validProject, name: undefined } }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'XL', xl_mode: 'project', project: { ...validProject, name: '   ' } }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'XL', xl_mode: 'project', project: { ...validProject, description: '' } }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'XL', xl_mode: 'project', project: { ...validProject, estimated_iterations: 0 } }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'XL', xl_mode: 'project', project: { ...validProject, estimated_iterations: 1.5 } }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'XL', xl_mode: 'project', project: { ...validProject, structure: undefined } }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'XL', xl_mode: 'project', project: { ...validProject, structure: [] } }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'XL', xl_mode: 'project', project: { ...validProject, structure: [{}] } }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'XL', xl_mode: 'project', project: { ...validProject, structure: ['chapter one'] } }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'XL', xl_mode: 'project', project: { ...validProject, structure: [{ chapter_1: 42 }] } }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'XL', xl_mode: 'project', project: { ...validProject, structure: [{ chapter_1: '   ' }] } }),
    })).toBe(false);
  });

  it('accepts L project starters', () => {
    expect(validateIdeator({
      ideas: makeIdeas({
        title: 'Compact Serial',
        complexity: 'L',
        xl_mode: 'project',
        project: validProject,
      }),
    })).toBe(true);
  });

  it('rejects inconsistent project starter metadata', () => {
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'L', project: validProject }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'M', xl_mode: 'project', project: validProject }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'L', xl_mode: 'single' }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ complexity: 'L', xl_mode: 'project', project_id: 'P001', project: validProject }),
    })).toBe(false);
  });

  it('rejects malformed optional proposal metadata', () => {
    expect(validateIdeator({
      ideas: makeIdeas({ project_id: 42 }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ project_id: '   ' }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ stimulus_ref: [] }),
    })).toBe(false);
    expect(validateIdeator({
      ideas: makeIdeas({ stimulus_ref: '' }),
    })).toBe(false);
  });

  it('rejects proposals without rationale', () => {
    expect(validateIdeator({
      ideas: makeIdeas({ why: undefined }),
    })).toBe(false);
  });

  it('rejects when ideas is not an array', () => {
    expect(validateIdeator({ ideas: 'not array' })).toBe(false);
  });

  it('rejects arrays at top level', () => {
    expect(validateIdeator([{ title: 'Foo', domain: 'x', pitch: 'y' }])).toBe(false);
  });

  it('accepts XL complexity with xl_mode', () => {
    const data = {
      ideas: makeIdeas({
        title: 'Big Game',
        domain: 'code-game',
        pitch: 'A massive game',
        complexity: 'XL',
        why: 'Ambition',
        project_id: null,
        stimulus_ref: null,
        xl_mode: 'single',
      }),
    };
    expect(validateIdeator(data)).toBe(true);
  });

  it('accepts XL project proposal', () => {
    const data = {
      ideas: makeIdeas({
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
      }),
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
    const data = {
      evaluations: [{ title: 'Idea', decision: 'approve', sharpening_notes: '', reasons: '' }],
    };
    expect(validateCriticGate1(data)).toBe(true);
    expect((data as any).selected).toBe('Idea');
  });

  it('accepts "decisions" key as alias for evaluations', () => {
    expect(validateCriticGate1({
      decisions: [{ title: 'Idea', decision: 'reject', sharpening_notes: '', reasons: 'Too generic.' }],
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

  it('rejects ambiguous or contradicted Gate 1 approvals without a selected title', () => {
    expect(validateCriticGate1({
      evaluations: [
        { title: 'First', decision: 'approve', sharpening_notes: 'Good', reasons: '' },
        { title: 'Second', decision: 'approve', sharpening_notes: 'Better', reasons: '' },
      ],
    })).toBe(false);
    expect(validateCriticGate1({
      selected: null,
      evaluations: [{ title: 'Approved', decision: 'approve', sharpening_notes: 'Good', reasons: '' }],
    })).toBe(false);
    expect(validateCriticGate1({
      selected: null,
      evaluations: [{ title: 'Rejected', decision: 'reject', sharpening_notes: '', reasons: 'Too small.' }],
    })).toBe(true);
  });

  it('trims selected idea metadata before validation', () => {
    const data = {
      selected: '  Idea  ',
      evaluations: [{ title: 'Idea', decision: 'approve' }],
    };
    expect(validateCriticGate1(data)).toBe(true);
    expect((data as any).selected).toBe('Idea');
  });

  it('trims evaluation titles before selected validation', () => {
    const data = {
      selected: 'Idea',
      evaluations: [{ title: '  Idea  ', decision: 'approve' }],
    };
    expect(validateCriticGate1(data)).toBe(true);
    expect((data as any).evaluations[0].title).toBe('Idea');
  });

  it('accepts optional recommended complexity overrides', () => {
    expect(validateCriticGate1({
      evaluations: [{ title: 'Idea', decision: 'approve', recommended_complexity: 'XL' }],
    })).toBe(true);
    expect(validateCriticGate1({
      evaluations: [{ title: 'Idea', decision: 'approve', recommended_complexity: null }],
    })).toBe(true);
  });

  it('rejects recommended complexity on non-approved Gate 1 evaluations', () => {
    expect(validateCriticGate1({
      selected: null,
      evaluations: [{ title: 'Reject Me', decision: 'reject', reasons: 'Too derivative.', recommended_complexity: 'L' }],
    })).toBe(false);
    expect(validateCriticGate1({
      selected: null,
      evaluations: [{ title: 'Revise Me', decision: 'revise', reasons: 'Good kernel, but underspecified.', recommended_complexity: 'XL' }],
    })).toBe(false);
  });

  it('accepts reject and revise evaluations when they include reasons', () => {
    expect(validateCriticGate1({
      evaluations: [{ title: 'Reject Me', decision: 'reject', reasons: 'Too derivative.' }],
    })).toBe(true);
    expect(validateCriticGate1({
      evaluations: [{ title: 'Revise Me', decision: 'revise', reasons: 'Good kernel, but the pitch is underspecified.' }],
    })).toBe(true);
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

  it('rejects non-object evaluation entries without throwing', () => {
    const data = { evaluations: [null] };
    expect(() => validateCriticGate1(data)).not.toThrow();
    expect(validateCriticGate1({ evaluations: ['approve it'] })).toBe(false);
  });

  it('rejects blank or duplicate evaluation titles', () => {
    expect(validateCriticGate1({
      evaluations: [{ title: '', decision: 'approve' }],
    })).toBe(false);
    expect(validateCriticGate1({
      evaluations: [{ title: '   ', decision: 'approve' }],
    })).toBe(false);
    expect(validateCriticGate1({
      evaluations: [
        { title: 'Idea', decision: 'approve' },
        { title: ' Idea ', decision: 'reject', reasons: 'Duplicate evaluation.' },
      ],
    })).toBe(false);
  });

  it('rejects decision values outside the Gate 1 enum', () => {
    expect(validateCriticGate1({
      evaluations: [{ title: 'Idea', decision: 'approved' }],
    })).toBe(false);
    expect(validateCriticGate1({
      evaluations: [{ title: 'Idea', verdict: 'maybe' }],
    })).toBe(false);
  });

  it('rejects recommended complexity values outside the supported tiers', () => {
    expect(validateCriticGate1({
      evaluations: [{ title: 'Idea', decision: 'approve', recommended_complexity: 'XXL' }],
    })).toBe(false);
    expect(validateCriticGate1({
      evaluations: [{ title: 'Idea', decision: 'approve', recommended_complexity: 3 }],
    })).toBe(false);
  });

  it('rejects reject and revise evaluations without non-empty reasons', () => {
    expect(validateCriticGate1({
      evaluations: [{ title: 'Reject Me', decision: 'reject' }],
    })).toBe(false);
    expect(validateCriticGate1({
      evaluations: [{ title: 'Reject Me', decision: 'reject', reasons: '   ' }],
    })).toBe(false);
    expect(validateCriticGate1({
      evaluations: [{ title: 'Revise Me', decision: 'revise', reasons: '' }],
    })).toBe(false);
  });

  it('rejects selected ideas that are missing or not approved in the evaluations', () => {
    expect(validateCriticGate1({
      selected: 'Missing',
      evaluations: [{ title: 'Idea', decision: 'approve' }],
    })).toBe(false);
    expect(validateCriticGate1({
      selected: 'Rejected',
      evaluations: [
        { title: 'Rejected', decision: 'reject' },
        { title: 'Approved', decision: 'approve' },
      ],
    })).toBe(false);
    expect(validateCriticGate1({
      selected: 'Needs Work',
      evaluations: [{ title: 'Needs Work', decision: 'revise' }],
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

  it('rejects blank creator titles', () => {
    expect(validateCreator({ title: '', files: [{ path: 'a', content: 'b' }] })).toBe(false);
    expect(validateCreator({ title: '   ', files: [{ path: 'a', content: 'b' }] })).toBe(false);
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

  it('rejects blank creator file contents', () => {
    expect(validateCreator({ title: 'x', files: [{ path: 'a', content: '' }] })).toBe(false);
    expect(validateCreator({ title: 'x', files: [{ path: 'a', content: '   ' }] })).toBe(false);
  });

  it('rejects unsafe or duplicate file paths', () => {
    expect(validateCreator({ title: 'x', files: [{ path: '../escape.txt', content: 'b' }] })).toBe(false);
    expect(validateCreator({
      title: 'x',
      files: [
        { path: 'main.ts', content: 'one' },
        { path: 'main.ts', content: 'two' },
      ],
    })).toBe(false);
  });

  it('rejects malformed optional file language metadata', () => {
    expect(validateCreator({
      title: 'x',
      files: [{ path: 'main.ts', content: 'console.log(1)', language: 'typescript' }],
    })).toBe(true);
    expect(validateCreator({
      title: 'x',
      files: [{ path: 'main.ts', content: 'console.log(1)', language: 42 }],
    })).toBe(false);
    expect(validateCreator({
      title: 'x',
      files: [{ path: 'main.ts', content: 'console.log(1)', language: '   ' }],
    })).toBe(false);
  });
});

// ── validateTester ──────────────────────────────────────────────

describe('validateTester', () => {
  const validTesterEvidence = { tests_run: [], issues: [] };

  it('accepts valid tester response', () => {
    expect(validateTester({ verdict: 'pass', summary: 'ok', ...validTesterEvidence })).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateTester(null)).toBe(false);
  });

  it('rejects missing verdict', () => {
    expect(validateTester({ summary: 'x' })).toBe(false);
  });

  it('rejects missing summary', () => {
    expect(validateTester({ verdict: 'pass', ...validTesterEvidence })).toBe(false);
  });

  it('rejects blank tester summaries', () => {
    expect(validateTester({ verdict: 'pass', summary: '', ...validTesterEvidence })).toBe(false);
    expect(validateTester({ verdict: 'pass', summary: '   ', ...validTesterEvidence })).toBe(false);
  });

  it('rejects verdict values outside the tester enum', () => {
    expect(validateTester({ verdict: 'ok', summary: 'Looks fine', ...validTesterEvidence })).toBe(false);
  });

  it('rejects missing tester evidence arrays', () => {
    expect(validateTester({ verdict: 'pass', summary: 'ok', issues: [] })).toBe(false);
    expect(validateTester({ verdict: 'pass', summary: 'ok', tests_run: [] })).toBe(false);
    expect(validateTester({ verdict: 'pass', summary: 'ok', tests_run: 'unit', issues: [] })).toBe(false);
    expect(validateTester({ verdict: 'pass', summary: 'ok', tests_run: [], issues: 'none' })).toBe(false);
  });

  it('requires at least one issue for fixable tester failures', () => {
    expect(validateTester({
      verdict: 'fail_fixable',
      summary: 'A repair is needed.',
      tests_run: [],
      issues: [],
    })).toBe(false);
    expect(validateTester({
      verdict: 'fail_fixable',
      summary: 'A repair is needed.',
      tests_run: [],
      issues: [{ severity: 'major', description: 'Missing entrypoint', location: 'main.ts', suggested_fix: 'Add the missing entrypoint.' }],
    })).toBe(true);
  });

  it('requires suggested fixes only for fixable tester issues', () => {
    expect(validateTester({
      verdict: 'fail_fixable',
      summary: 'A repair is needed.',
      tests_run: [],
      issues: [{ severity: 'major', description: 'Missing entrypoint', location: 'main.ts' }],
    })).toBe(false);
    expect(validateTester({
      verdict: 'fail_fixable',
      summary: 'A repair is needed.',
      tests_run: [],
      issues: [{ severity: 'major', description: 'Missing entrypoint', location: 'main.ts', suggested_fix: null }],
    })).toBe(false);
    expect(validateTester({
      verdict: 'fail_catastrophic',
      summary: 'The artifact cannot be executed.',
      tests_run: [],
      issues: [{ severity: 'critical', description: 'Missing runtime', location: 'package.json', suggested_fix: 'Add scripts.' }],
      post_mortem: 'The project lacks enough structure for targeted repair.',
    })).toBe(false);
    expect(validateTester({
      verdict: 'fail_catastrophic',
      summary: 'The artifact cannot be executed.',
      tests_run: [],
      issues: [{ severity: 'critical', description: 'Missing runtime', location: 'package.json', suggested_fix: null }],
      post_mortem: 'The project lacks enough structure for targeted repair.',
    })).toBe(true);
  });

  it('rejects passing tester reports with failures or issues', () => {
    expect(validateTester({
      verdict: 'pass',
      summary: 'Looks good.',
      tests_run: [{ name: 'unit', result: 'fail', details: 'Assertion failed' }],
      issues: [],
    })).toBe(false);
    expect(validateTester({
      verdict: 'pass',
      summary: 'Looks good.',
      tests_run: [{ name: 'unit', result: 'pass', details: 'green' }],
      issues: [{ severity: 'minor', description: 'Typo remains', location: 'README.md' }],
    })).toBe(false);
  });

  it('requires post mortem only for catastrophic tester failures', () => {
    expect(validateTester({
      verdict: 'fail_catastrophic',
      summary: 'The artifact cannot be executed.',
      ...validTesterEvidence,
      post_mortem: 'The entrypoint crashes before any behavior can be tested.',
    })).toBe(true);
    expect(validateTester({
      verdict: 'fail_catastrophic',
      summary: 'The artifact cannot be executed.',
      ...validTesterEvidence,
    })).toBe(false);
    expect(validateTester({
      verdict: 'fail_catastrophic',
      summary: 'The artifact cannot be executed.',
      ...validTesterEvidence,
      post_mortem: '   ',
    })).toBe(false);
    expect(validateTester({
      verdict: 'fail_fixable',
      summary: 'A minor issue is present.',
      ...validTesterEvidence,
      post_mortem: 'This field is only for catastrophic failures.',
    })).toBe(false);
    expect(validateTester({
      verdict: 'pass',
      summary: 'ok',
      ...validTesterEvidence,
      post_mortem: null,
    })).toBe(true);
  });

  it('accepts valid tester detail arrays and test plans', () => {
    expect(validateTester({
      verdict: 'pass',
      summary: 'ok',
      tests_run: [{ name: 'unit', result: 'pass', details: 'green' }],
      issues: [],
      test_plan: {
        language: 'typescript',
        setup_commands: ['pnpm install'],
        files: [{ path: 'tests/generated.test.ts', content: 'test("x", () => {})' }],
        run_command: 'pnpm test',
      },
    })).toBe(true);
  });

  it('rejects malformed tester test results when present', () => {
    expect(validateTester({
      verdict: 'pass',
      summary: 'ok',
      tests_run: [{ name: 'unit', result: 'skipped', details: 'not run' }],
      issues: [],
    })).toBe(false);
  });

  it('rejects blank tester test result evidence', () => {
    expect(validateTester({
      verdict: 'pass',
      summary: 'ok',
      tests_run: [{ name: '', result: 'pass', details: 'green' }],
      issues: [],
    })).toBe(false);
    expect(validateTester({
      verdict: 'pass',
      summary: 'ok',
      tests_run: [{ name: 'unit', result: 'pass', details: '   ' }],
      issues: [],
    })).toBe(false);
  });

  it('rejects malformed tester issues when present', () => {
    expect(validateTester({
      verdict: 'fail_fixable',
      summary: 'needs changes',
      tests_run: [],
      issues: [{ severity: 'medium', description: 'bug', location: 'main.ts' }],
    })).toBe(false);
  });

  it('rejects blank tester issue evidence', () => {
    expect(validateTester({
      verdict: 'fail_fixable',
      summary: 'needs changes',
      tests_run: [],
      issues: [{ severity: 'minor', description: '', location: 'README.md' }],
    })).toBe(false);
    expect(validateTester({
      verdict: 'fail_fixable',
      summary: 'needs changes',
      tests_run: [],
      issues: [{ severity: 'minor', description: 'typo', location: '   ' }],
    })).toBe(false);
    expect(validateTester({
      verdict: 'fail_fixable',
      summary: 'needs changes',
      tests_run: [],
      issues: [{ severity: 'minor', description: 'typo', location: 'README.md', suggested_fix: '' }],
    })).toBe(false);
  });

  it('rejects malformed tester test plans when present', () => {
    expect(validateTester({
      verdict: 'pass',
      summary: 'ok',
      ...validTesterEvidence,
      test_plan: {
        language: 'typescript',
        setup_commands: 'pnpm install',
        files: [],
        run_command: 'pnpm test',
      },
    })).toBe(false);
    expect(validateTester({
      verdict: 'pass',
      summary: 'ok',
      ...validTesterEvidence,
      test_plan: {
        language: 'typescript',
        setup_commands: [],
        files: [{ path: '../escape.test.ts', content: 'test("x", () => {})' }],
        run_command: 'pnpm test',
      },
    })).toBe(false);
  });

  it('rejects tester test plans without generated files', () => {
    expect(validateTester({
      verdict: 'pass',
      summary: 'ok',
      ...validTesterEvidence,
      test_plan: {
        language: 'typescript',
        setup_commands: [],
        files: [],
        run_command: 'pnpm test',
      },
    })).toBe(false);
  });

  it('rejects blank tester test plan fields', () => {
    expect(validateTester({
      verdict: 'pass',
      summary: 'ok',
      ...validTesterEvidence,
      test_plan: {
        language: '   ',
        setup_commands: [],
        files: [],
        run_command: 'pnpm test',
      },
    })).toBe(false);
    expect(validateTester({
      verdict: 'pass',
      summary: 'ok',
      ...validTesterEvidence,
      test_plan: {
        language: 'typescript',
        setup_commands: ['   '],
        files: [],
        run_command: 'pnpm test',
      },
    })).toBe(false);
    expect(validateTester({
      verdict: 'pass',
      summary: 'ok',
      ...validTesterEvidence,
      test_plan: {
        language: 'typescript',
        setup_commands: [],
        files: [{ path: 'tests/generated.test.ts', content: '   ' }],
        run_command: 'pnpm test',
      },
    })).toBe(false);
  });
});

// ── validateCriticGate2 ─────────────────────────────────────────

describe('validateCriticGate2', () => {
  const validGate2Ratings = {
    originality: 4,
    specificity: 4,
    craft: 4,
    surprise: 4,
    coherence: 4,
    portfolio_fit: 4,
  };

  it('accepts valid gate2 response', () => {
    expect(validateCriticGate2({
      decision: 'ship',
      ratings: validGate2Ratings,
      review: 'Good work',
    })).toBe(true);
  });

  it('accepts optional technical quality rating when numeric and in range', () => {
    expect(validateCriticGate2({
      decision: 'ship',
      ratings: {
        originality: 4,
        specificity: 4,
        craft: 4,
        surprise: 4,
        coherence: 4,
        portfolio_fit: 4,
        technical_quality: 5,
      },
      review: 'Good work',
    })).toBe(true);
  });

  it('rejects ship decisions below the Gate 2 shipping threshold', () => {
    expect(validateCriticGate2({
      decision: 'ship',
      ratings: {
        originality: 3,
        specificity: 3,
        craft: 3,
        surprise: 3,
        coherence: 2,
        portfolio_fit: 2,
      },
      review: 'Not strong enough to ship.',
    })).toBe(false);
    expect(validateCriticGate2({
      decision: 'ship',
      ratings: {
        originality: 5,
        specificity: 4,
        craft: 4,
        surprise: 4,
        coherence: 4,
        portfolio_fit: 1,
      },
      review: 'One dimension falls below the floor.',
    })).toBe(false);
    expect(validateCriticGate2({
      decision: 'ship',
      ratings: {
        originality: 4,
        specificity: 4,
        craft: 4,
        surprise: 4,
        coherence: 4,
        portfolio_fit: 4,
        technical_quality: 1,
      },
      review: 'Technical quality is part of the shipping floor when present.',
    })).toBe(false);
  });

  it('requires actionable revision notes for revise decisions', () => {
    expect(validateCriticGate2({
      decision: 'revise',
      ratings: validGate2Ratings,
      review: 'Needs another pass',
    })).toBe(false);
    expect(validateCriticGate2({
      decision: 'revise',
      ratings: validGate2Ratings,
      review: 'Needs another pass',
      revision_notes: '',
    })).toBe(false);
    expect(validateCriticGate2({
      decision: 'revise',
      ratings: validGate2Ratings,
      review: 'Needs another pass',
      revision_notes: 'Tighten the ending and remove the generic setup.',
    })).toBe(true);
  });

  it('requires a concrete kill reason for kill decisions', () => {
    expect(validateCriticGate2({
      decision: 'kill',
      ratings: validGate2Ratings,
      review: 'This cannot be rescued',
    })).toBe(false);
    expect(validateCriticGate2({
      decision: 'kill',
      ratings: validGate2Ratings,
      review: 'This cannot be rescued',
      kill_reason: '   ',
    })).toBe(false);
    expect(validateCriticGate2({
      decision: 'kill',
      ratings: validGate2Ratings,
      review: 'This cannot be rescued',
      kill_reason: 'The core premise is incoherent after execution.',
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

  it('rejects blank Gate 2 reviews', () => {
    expect(validateCriticGate2({
      decision: 'ship',
      ratings: validGate2Ratings,
      review: '',
    })).toBe(false);
    expect(validateCriticGate2({
      decision: 'ship',
      ratings: validGate2Ratings,
      review: '   ',
    })).toBe(false);
  });

  it('rejects array ratings', () => {
    expect(validateCriticGate2({ decision: 'ship', ratings: [1, 2], review: 'x' })).toBe(false);
  });

  it('rejects decision values outside the Gate 2 enum', () => {
    expect(validateCriticGate2({ decision: 'approve', ratings: {}, review: 'x' })).toBe(false);
  });

  it('rejects missing required rating dimensions', () => {
    expect(validateCriticGate2({
      decision: 'ship',
      ratings: { originality: 4 },
      review: 'x',
    })).toBe(false);
  });

  it('rejects non-numeric or out-of-range rating dimensions', () => {
    expect(validateCriticGate2({
      decision: 'ship',
      ratings: {
        originality: 4,
        specificity: 'high',
        craft: 4,
        surprise: 4,
        coherence: 4,
        portfolio_fit: 4,
      },
      review: 'x',
    })).toBe(false);
    expect(validateCriticGate2({
      decision: 'ship',
      ratings: {
        originality: 4,
        specificity: 4,
        craft: 6,
        surprise: 4,
        coherence: 4,
        portfolio_fit: 4,
      },
      review: 'x',
    })).toBe(false);
  });
});

// ── validateCuratorRedirect ─────────────────────────────────────

describe('validateCuratorRedirect', () => {
  it('accepts valid redirect', () => {
    expect(validateCuratorRedirect({
      proposal: {
        title: 'New idea',
        domain: 'code',
        pitch: 'A human-directed artifact',
        complexity: 'M',
        why: 'Responding to human redirect.',
        project_id: null,
        stimulus_ref: null,
      },
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

  it('rejects proposal without full Ideator proposal fields', () => {
    expect(validateCuratorRedirect({
      proposal: {
        title: 'New idea',
        domain: 'code',
        complexity: 'M',
        why: 'Responding to human redirect.',
      },
    })).toBe(false);
  });

  it('rejects blank proposal core fields', () => {
    for (const overrides of [
      { domain: '' },
      { pitch: '   ' },
      { why: '' },
    ]) {
      expect(validateCuratorRedirect({
        proposal: {
          title: 'New idea',
          domain: 'code',
          pitch: 'A human-directed artifact',
          complexity: 'M',
          why: 'Responding to human redirect.',
          ...overrides,
        },
      })).toBe(false);
    }
  });

  it('rejects unsupported proposal complexity tiers', () => {
    expect(validateCuratorRedirect({
      proposal: {
        title: 'New idea',
        domain: 'code',
        pitch: 'A human-directed artifact',
        complexity: 'XXL',
        why: 'Responding to human redirect.',
      },
    })).toBe(false);
  });

  it('rejects malformed XL project proposals', () => {
    expect(validateCuratorRedirect({
      proposal: {
        title: 'New project',
        domain: 'fiction',
        pitch: 'A human-directed long-form project',
        complexity: 'XL',
        why: 'Responding to human redirect.',
        project_id: null,
        stimulus_ref: null,
        xl_mode: 'project',
        project: { name: 'Missing details' },
      },
    })).toBe(false);
  });
});

// ── validateCuratorFull ─────────────────────────────────────────

describe('validateCuratorFull', () => {
  const makeCuratorFull = (overrides: Record<string, unknown> = {}) => ({
    retrospective: 'retro',
    compressed_journal: 'journal',
    domain_recommendations: '',
    manifesto_changes: [],
    project_decisions: [],
    stimuli_actions: [],
    human_redirect: null,
    ...overrides,
  });

  it('accepts valid curator response', () => {
    expect(validateCuratorFull(makeCuratorFull())).toBe(true);
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

  it('requires domain recommendations text even when empty', () => {
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
    })).toBe(false);
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      domain_recommendations: ['try more prose'],
      manifesto_changes: [],
      project_decisions: [],
      stimuli_actions: [],
      human_redirect: null,
    })).toBe(false);
    expect(validateCuratorFull(makeCuratorFull())).toBe(true);
  });

  it('requires curator side-effect arrays and human redirect state even when empty', () => {
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      domain_recommendations: '',
      project_decisions: [],
      stimuli_actions: [],
      human_redirect: null,
    })).toBe(false);
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      domain_recommendations: '',
      manifesto_changes: [],
      stimuli_actions: [],
      human_redirect: null,
    })).toBe(false);
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      domain_recommendations: '',
      manifesto_changes: [],
      project_decisions: [],
      human_redirect: null,
    })).toBe(false);
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      domain_recommendations: '',
      manifesto_changes: [],
      project_decisions: [],
      stimuli_actions: [],
    })).toBe(false);
  });

  it('rejects non-string retrospective', () => {
    expect(validateCuratorFull({ retrospective: 42, compressed_journal: 'x' })).toBe(false);
  });

  it('rejects blank retrospective and compressed journal fields', () => {
    expect(validateCuratorFull({
      retrospective: '   ',
      compressed_journal: 'journal',
    })).toBe(false);
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: '',
    })).toBe(false);
  });

  it('accepts explicit null human redirect', () => {
    expect(validateCuratorFull(makeCuratorFull({
      human_redirect: null,
    }))).toBe(true);
  });

  it('accepts valid human redirect proposals', () => {
    expect(validateCuratorFull(makeCuratorFull({
      human_redirect: {
        proposal: {
          title: 'Human-directed idea',
          domain: 'code',
          pitch: 'Build what was requested',
          complexity: 'M',
          why: 'Responding to a human request.',
          project_id: null,
          stimulus_ref: null,
        },
      },
    }))).toBe(true);
  });

  it('rejects malformed human redirect proposals', () => {
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      human_redirect: {
        proposal: {
          title: 'Human-directed idea',
          domain: 'code',
          pitch: 'Build what was requested',
          complexity: 'XXL',
          why: 'Responding to a human request.',
        },
      },
    })).toBe(false);
  });

  it('rejects non-null human redirect values without proposal wrappers', () => {
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      human_redirect: 'make a thing',
    })).toBe(false);
  });

  it('accepts valid curator action arrays when present', () => {
    expect(validateCuratorFull(makeCuratorFull({
      manifesto_changes: [{ section: 'Values', old: 'old', new: 'new', reason: 'better fit' }],
      project_decisions: [{ project_id: 'P001', action: 'continue', reason: 'Still promising' }],
      stimuli_actions: [{ action: 'commission_skill', target: 'poetics', content: '# Skill' }],
    }))).toBe(true);
  });

  it('rejects malformed manifesto changes when present', () => {
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      manifesto_changes: [{ section: 'Values', old: 'old', new: 'new' }],
    })).toBe(false);
  });

  it('rejects blank manifesto change targets when present', () => {
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      manifesto_changes: [{ section: 'Values', old: '   ', new: 'new', reason: 'better fit' }],
    })).toBe(false);
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      manifesto_changes: [{ section: '', old: 'old', new: 'new', reason: 'better fit' }],
    })).toBe(false);
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      manifesto_changes: [{ section: 'Values', old: 'old', new: 'new', reason: '   ' }],
    })).toBe(false);
  });

  it('rejects malformed project decisions when present', () => {
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      project_decisions: [{ project_id: 'P001', action: 'pause', reason: 'Maybe later' }],
    })).toBe(false);
  });

  it('rejects blank project decisions when present', () => {
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      project_decisions: [{ project_id: '   ', action: 'continue', reason: 'Still promising' }],
    })).toBe(false);
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      project_decisions: [{ project_id: 'P001', action: 'continue', reason: '' }],
    })).toBe(false);
  });

  it('rejects malformed stimuli actions when present', () => {
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      stimuli_actions: [{ action: 'refresh' }],
    })).toBe(false);
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      stimuli_actions: [{ action: 'delete_source', target: 'news' }],
    })).toBe(false);
  });

  it('rejects blank stimuli actions when present', () => {
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      stimuli_actions: [{ action: 'refresh', target: '   ' }],
    })).toBe(false);
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      stimuli_actions: [{ action: 'commission_skill', target: 'poetics', content: '' }],
    })).toBe(false);
  });

  it('rejects non-array curator action fields when present', () => {
    expect(validateCuratorFull({
      retrospective: 'retro',
      compressed_journal: 'journal',
      project_decisions: 'continue everything',
    })).toBe(false);
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

  it('rejects blank creator plan approach', () => {
    expect(validateCreatorPlan({
      plan: {
        approach: '   ',
        file_manifest: [{ path: 'main.ts', purpose: 'Entry point' }],
      },
    })).toBe(false);
  });

  it('rejects plan without file_manifest', () => {
    expect(validateCreatorPlan({
      plan: { approach: 'do stuff' },
    })).toBe(false);
  });

  it('rejects empty file_manifest', () => {
    expect(validateCreatorPlan({
      plan: { approach: 'do stuff', file_manifest: [] },
    })).toBe(false);
  });

  it('rejects malformed file_manifest entries', () => {
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it',
        file_manifest: [{ path: 'main.ts' }],
      },
    })).toBe(false);
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it',
        file_manifest: [{ path: 'main.ts', purpose: 'Entry', estimated_lines: 12.5 }],
      },
    })).toBe(false);
  });

  it('rejects blank file_manifest purposes', () => {
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it',
        file_manifest: [{ path: 'main.ts', purpose: '' }],
      },
    })).toBe(false);
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it',
        file_manifest: [{ path: 'main.ts', purpose: '   ' }],
      },
    })).toBe(false);
  });

  it('rejects unsafe or duplicate file_manifest paths', () => {
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it',
        file_manifest: [{ path: '../escape.ts', purpose: 'Escape' }],
      },
    })).toBe(false);
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it',
        file_manifest: [
          { path: 'main.ts', purpose: 'One' },
          { path: 'main.ts', purpose: 'Two' },
        ],
      },
    })).toBe(false);
  });

  it('rejects malformed optional planning arrays', () => {
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it',
        file_manifest: [{ path: 'main.ts', purpose: 'Entry' }],
        key_decisions: 'Use TypeScript',
      },
    })).toBe(false);
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it',
        file_manifest: [{ path: 'main.ts', purpose: 'Entry' }],
        challenges: [42],
      },
    })).toBe(false);
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it',
        file_manifest: [{ path: 'main.ts', purpose: 'Entry' }],
        build_order: ['main.ts'],
      },
    })).toBe(false);
  });

  it('rejects blank optional planning array entries', () => {
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it',
        file_manifest: [{ path: 'main.ts', purpose: 'Entry' }],
        key_decisions: ['   '],
      },
    })).toBe(false);
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it',
        file_manifest: [{ path: 'main.ts', purpose: 'Entry' }],
        challenges: [''],
      },
    })).toBe(false);
  });

  it('rejects build_order paths outside the manifest', () => {
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it',
        file_manifest: [{ path: 'main.ts', purpose: 'Entry' }],
        build_order: [['main.ts', 'extra.ts']],
      },
    })).toBe(false);
  });

  it('rejects unsafe build_order paths', () => {
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it',
        file_manifest: [{ path: 'main.ts', purpose: 'Entry' }],
        build_order: [['../escape.ts']],
      },
    })).toBe(false);
  });

  it('rejects empty build_order batches', () => {
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it',
        file_manifest: [{ path: 'main.ts', purpose: 'Entry' }],
        build_order: [[]],
      },
    })).toBe(false);
  });

  it('rejects duplicate build_order paths', () => {
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it',
        file_manifest: [{ path: 'main.ts', purpose: 'Entry' }],
        build_order: [['main.ts', 'main.ts']],
      },
    })).toBe(false);
    expect(validateCreatorPlan({
      plan: {
        approach: 'Build it',
        file_manifest: [
          { path: 'main.ts', purpose: 'Entry' },
          { path: 'helper.ts', purpose: 'Helper' },
        ],
        build_order: [['main.ts'], ['helper.ts', 'main.ts']],
      },
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

  it('rejects blank build file contents', () => {
    expect(validateCreatorBuild({ files: [{ path: 'main.ts', content: '' }] })).toBe(false);
    expect(validateCreatorBuild({ files: [{ path: 'main.ts', content: '   ' }] })).toBe(false);
  });

  it('rejects unsafe file paths', () => {
    expect(validateCreatorBuild({ files: [{ path: '', content: 'x' }] })).toBe(false);
    expect(validateCreatorBuild({ files: [{ path: '/tmp/escape.txt', content: 'x' }] })).toBe(false);
    expect(validateCreatorBuild({ files: [{ path: '../escape.txt', content: 'x' }] })).toBe(false);
    expect(validateCreatorBuild({ files: [{ path: 'src/../escape.txt', content: 'x' }] })).toBe(false);
    expect(validateCreatorBuild({ files: [{ path: 'src\\main.ts', content: 'x' }] })).toBe(false);
    expect(validateCreatorBuild({ files: [{ path: 'src/\tmain.ts', content: 'x' }] })).toBe(false);
    expect(validateCreatorBuild({ files: [{ path: 'src/main\n.ts', content: 'x' }] })).toBe(false);
  });

  it('rejects duplicate file paths', () => {
    expect(validateCreatorBuild({
      files: [
        { path: 'main.ts', content: 'one' },
        { path: 'main.ts', content: 'two' },
      ],
    })).toBe(false);
  });

  it('rejects malformed optional file language metadata', () => {
    expect(validateCreatorBuild({
      files: [{ path: 'main.ts', content: 'console.log(1)', language: 'typescript' }],
    })).toBe(true);
    expect(validateCreatorBuild({
      files: [{ path: 'main.ts', content: 'console.log(1)', language: false }],
    })).toBe(false);
    expect(validateCreatorBuild({
      files: [{ path: 'main.ts', content: 'console.log(1)', language: '' }],
    })).toBe(false);
  });
});

// ── getSchema ────────────────────────────────────────────────────

describe('getSchema', () => {
  it('returns schema for known roles', () => {
    for (const role of ['ideator', 'critic-gate1', 'creator', 'tester', 'critic-gate2', 'curator-redirect', 'curator-full', 'creator-plan', 'creator-build']) {
      expect(getSchema(role)).toBeDefined();
    }
  });

  it('describes Gate 1 recommended complexity as null or a supported tier', () => {
    const schema = getSchema('critic-gate1') as any;
    const recommended = schema.properties.evaluations.items.properties.recommended_complexity;
    expect(recommended.type).toEqual(['string', 'null']);
    expect(recommended.enum).toEqual(['S', 'M', 'L', 'XL', null]);
    expect(recommended.description).toContain('approved evaluations');
  });

  it('describes Ideator proposal titles as non-empty and unique', () => {
    const schema = getSchema('ideator') as any;
    const title = schema.properties.ideas.items.properties.title;
    const proposal = schema.properties.ideas.items;
    expect(schema.properties.ideas.minItems).toBe(5);
    expect(schema.properties.ideas.maxItems).toBe(5);
    expect(schema.properties.ideas.description).toContain('At least four');
    expect(schema.properties.ideas.description).toContain('At least three');
    expect(proposal.properties.xl_mode.description).toContain('Required for XL');
    expect(proposal.properties.xl_mode.description).toContain('L/XL project starters');
    expect(proposal.properties.project_id.type).toEqual(['string', 'null']);
    expect(proposal.properties.project_id.minLength).toBe(1);
    expect(proposal.properties.stimulus_ref.type).toEqual(['string', 'null']);
    expect(proposal.properties.stimulus_ref.minLength).toBe(1);
    expect(proposal.properties.project.description).toContain('xl_mode: project');
    const project = proposal.properties.project.anyOf[1];
    expect(project.required).toEqual(['name', 'description', 'estimated_iterations', 'structure']);
    expect(project.properties.name.minLength).toBe(1);
    expect(project.properties.description.minLength).toBe(1);
    expect(project.properties.estimated_iterations.type).toBe('integer');
    expect(project.properties.estimated_iterations.minimum).toBe(1);
    expect(project.properties.structure.minItems).toBe(1);
    expect(project.properties.structure.items.minProperties).toBe(1);
    expect(project.properties.structure.items.additionalProperties.type).toBe('string');
    expect(project.properties.structure.items.additionalProperties.minLength).toBe(1);
    expect(title.minLength).toBe(1);
    expect(title.description).toContain('unique');
  });

  it('describes Ideator proposal core text fields as non-empty', () => {
    const schema = getSchema('ideator') as any;
    const proposal = schema.properties.ideas.items;
    expect(proposal.properties.domain.minLength).toBe(1);
    expect(proposal.properties.pitch.minLength).toBe(1);
    expect(proposal.properties.why.minLength).toBe(1);
  });

  it('describes Ideator proposal and project starter text fields as non-whitespace text', () => {
    const schema = getSchema('ideator') as any;
    const proposal = schema.properties.ideas.items.properties;
    const project = proposal.project.anyOf[1].properties;

    expect(proposal.title.pattern).toBe('\\S');
    expect(proposal.domain.pattern).toBe('\\S');
    expect(proposal.pitch.pattern).toBe('\\S');
    expect(proposal.why.pattern).toBe('\\S');
    expect(proposal.project_id.pattern).toBe('\\S');
    expect(proposal.stimulus_ref.pattern).toBe('\\S');
    expect(project.name.pattern).toBe('\\S');
    expect(project.description.pattern).toBe('\\S');
    expect(project.structure.items.additionalProperties.pattern).toBe('\\S');
  });

  it('describes Gate 1 selected as an approved evaluation title when present', () => {
    const schema = getSchema('critic-gate1') as any;
    expect(schema.properties.selected.description).toContain('approved evaluation');
    expect(schema.properties.selected.description).toContain('required when any evaluation is approved');
  });

  it('describes Gate 1 evaluation titles as non-empty and unique', () => {
    const schema = getSchema('critic-gate1') as any;
    const title = schema.properties.evaluations.items.properties.title;
    expect(title.minLength).toBe(1);
    expect(title.description).toContain('unique');
  });

  it('describes Gate 1 evaluation titles as non-whitespace text', () => {
    const schema = getSchema('critic-gate1') as any;
    const title = schema.properties.evaluations.items.properties.title;
    expect(title.pattern).toBe('\\S');
  });

  it('describes Gate 1 decisions as the supported enum', () => {
    const schema = getSchema('critic-gate1') as any;
    const decision = schema.properties.evaluations.items.properties.decision;
    expect(decision.enum).toEqual(['approve', 'reject', 'revise']);
  });

  it('describes Gate 1 reasons as required for non-approval decisions', () => {
    const schema = getSchema('critic-gate1') as any;
    const reasons = schema.properties.evaluations.items.properties.reasons;
    expect(reasons.description).toContain('reject or revise');
  });

  it('describes Gate 1 reject and revise reasons with conditional nonblank requirements', () => {
    const schema = getSchema('critic-gate1') as any;
    const evaluation = schema.properties.evaluations.items;
    expect(Array.isArray(evaluation.allOf)).toBe(true);
    const decisions = evaluation.allOf.map((rule: any) => rule.if.properties.decision.const);

    expect(decisions).toEqual(['reject', 'revise']);
    for (const rule of evaluation.allOf) {
      expect(rule.then.required).toEqual(['reasons']);
      expect(rule.then.properties.reasons.pattern).toBe('\\S');
      expect(rule.then.properties.recommended_complexity.type).toBe('null');
    }
  });

  it('describes Gate 2 review and follow-up fields as non-empty strings', () => {
    const schema = getSchema('critic-gate2') as any;
    expect(schema.properties.review.minLength).toBe(1);
    expect(schema.properties.revision_notes.minLength).toBe(1);
    expect(schema.properties.kill_reason.minLength).toBe(1);
  });

  it('describes Gate 2 review and follow-up fields as non-whitespace strings', () => {
    const schema = getSchema('critic-gate2') as any;
    expect(schema.properties.review.pattern).toBe('\\S');
    expect(schema.properties.revision_notes.pattern).toBe('\\S');
    expect(schema.properties.kill_reason.pattern).toBe('\\S');
  });

  it('describes Gate 2 revise and kill follow-up fields with conditional nonblank requirements', () => {
    const schema = getSchema('critic-gate2') as any;
    expect(Array.isArray(schema.allOf)).toBe(true);
    const rulesByDecision = new Map(
      schema.allOf.map((rule: any) => [rule.if.properties.decision.const, rule.then]),
    );

    expect(rulesByDecision.get('revise')?.required).toEqual(['revision_notes']);
    expect(rulesByDecision.get('revise')?.properties.revision_notes.pattern).toBe('\\S');
    expect(rulesByDecision.get('kill')?.required).toEqual(['kill_reason']);
    expect(rulesByDecision.get('kill')?.properties.kill_reason.pattern).toBe('\\S');
  });

  it('describes Gate 2 rating dimensions and ranges', () => {
    const schema = getSchema('critic-gate2') as any;
    const ratings = schema.properties.ratings;
    expect(ratings.required).toEqual([
      'originality',
      'specificity',
      'craft',
      'surprise',
      'coherence',
      'portfolio_fit',
    ]);
    for (const dimension of [...ratings.required, 'technical_quality']) {
      expect(ratings.properties[dimension].type).toBe('number');
      expect(ratings.properties[dimension].minimum).toBe(1);
      expect(ratings.properties[dimension].maximum).toBe(5);
    }
  });

  it('describes curator redirects with the full proposal contract', () => {
    const schema = getSchema('curator-redirect') as any;
    const proposal = schema.properties.proposal;
    expect(proposal.required).toEqual(expect.arrayContaining(['title', 'domain', 'pitch', 'complexity', 'why']));
    expect(proposal.properties.complexity.enum).toEqual(['S', 'M', 'L', 'XL']);
  });

  it('describes curator full human redirects with the proposal wrapper contract', () => {
    const schema = getSchema('curator-full') as any;
    const proposal = schema.properties.human_redirect.anyOf[1].properties.proposal;
    expect(proposal.required).toEqual(expect.arrayContaining(['title', 'domain', 'pitch', 'complexity', 'why']));
    expect(proposal.properties.complexity.enum).toEqual(['S', 'M', 'L', 'XL']);
  });

  it('describes curator full side-effect arrays with item contracts', () => {
    const schema = getSchema('curator-full') as any;
    expect(schema.required).toEqual([
      'retrospective',
      'compressed_journal',
      'manifesto_changes',
      'domain_recommendations',
      'project_decisions',
      'stimuli_actions',
      'human_redirect',
    ]);
    expect(schema.properties.domain_recommendations.type).toBe('string');
    expect(schema.properties.manifesto_changes.items.required).toEqual(['section', 'old', 'new', 'reason']);
    expect(schema.properties.project_decisions.items.properties.action.enum).toEqual(['continue', 'complete', 'abandon', 'extend']);
    expect(schema.properties.stimuli_actions.items.properties.action.enum).toEqual(['refresh', 'commission_skill']);
  });

  it('describes commissioned stimuli skills as requiring nonblank content', () => {
    const schema = getSchema('curator-full') as any;
    const stimuliAction = schema.properties.stimuli_actions.items;
    expect(Array.isArray(stimuliAction.allOf)).toBe(true);
    const commissionRule = stimuliAction.allOf.find(
      (rule: any) => rule.if.properties.action.const === 'commission_skill',
    );

    expect(commissionRule.then.required).toEqual(['content']);
    expect(commissionRule.then.properties.content.pattern).toBe('\\S');
  });

  it('describes Curator side-effect text fields as non-whitespace text', () => {
    const schema = getSchema('curator-full') as any;
    const manifesto = schema.properties.manifesto_changes.items.properties;
    const projectDecision = schema.properties.project_decisions.items.properties;
    const stimuliAction = schema.properties.stimuli_actions.items.properties;

    expect(manifesto.section.pattern).toBe('\\S');
    expect(manifesto.old.pattern).toBe('\\S');
    expect(manifesto.reason.pattern).toBe('\\S');
    expect(projectDecision.project_id.pattern).toBe('\\S');
    expect(projectDecision.reason.pattern).toBe('\\S');
    expect(stimuliAction.target.pattern).toBe('\\S');
    expect(stimuliAction.content.pattern).toBe('\\S');
  });

  it('describes creator plan manifests and optional arrays with item contracts', () => {
    const schema = getSchema('creator-plan') as any;
    const plan = schema.properties.plan;
    expect(plan.properties.file_manifest.minItems).toBe(1);
    expect(plan.properties.file_manifest.uniqueItems).toBe(true);
    expect(plan.properties.file_manifest.description).toContain('unique');
    expect(plan.properties.file_manifest.description).toContain('path');
    expect(plan.properties.file_manifest.items.required).toEqual(['path', 'purpose']);
    expect(plan.properties.file_manifest.items.properties.path.description).toContain('relative');
    expect(plan.properties.key_decisions.items.type).toBe('string');
    expect(plan.properties.challenges.items.type).toBe('string');
    expect(plan.properties.build_order.items.items.type).toBe('string');
    expect(plan.properties.build_order.items.uniqueItems).toBe(true);
    expect(plan.properties.build_order.items.items.description).toContain('file_manifest');
  });

  it('describes Creator plan text fields as non-whitespace text', () => {
    const schema = getSchema('creator-plan') as any;
    const plan = schema.properties.plan;
    expect(plan.properties.approach.pattern).toBe('\\S');
    expect(plan.properties.file_manifest.items.properties.purpose.pattern).toBe('\\S');
    expect(plan.properties.key_decisions.items.pattern).toBe('\\S');
    expect(plan.properties.challenges.items.pattern).toBe('\\S');
  });

  it('describes creator build files with relative path constraints', () => {
    const schema = getSchema('creator-build') as any;
    const file = schema.properties.files.items;
    expect(schema.properties.files.uniqueItems).toBe(true);
    expect(schema.properties.files.description).toContain('unique');
    expect(schema.properties.files.description).toContain('path');
    expect(file.properties.path.minLength).toBe(1);
    expect(file.properties.path.description).toContain('relative');
    expect(file.properties.content.type).toBe('string');
  });

  it('describes Creator and Tester file paths with safe relative path patterns', () => {
    const creator = getSchema('creator') as any;
    const creatorPlan = getSchema('creator-plan') as any;
    const creatorBuild = getSchema('creator-build') as any;
    const tester = getSchema('tester') as any;

    const pathSchemas = [
      creator.properties.files.items.properties.path,
      creatorPlan.properties.plan.properties.file_manifest.items.properties.path,
      creatorPlan.properties.plan.properties.build_order.items.items,
      creatorBuild.properties.files.items.properties.path,
      tester.properties.test_plan.properties.files.items.properties.path,
    ];

    for (const pathSchema of pathSchemas) {
      expect(typeof pathSchema.pattern).toBe('string');
      expect(pathSchema.pattern).toContain('(?!/)');
      expect(pathSchema.pattern).toContain('(?!.*\\\\)');
      expect(pathSchema.pattern).toContain('\\.\\.');
      expect(pathSchema.pattern).toContain('\\u0000');
      expect(pathSchema.pattern).toContain('\\u001F');
      expect(pathSchema.description).toContain('relative');
      expect(pathSchema.description).toContain('NUL');
      expect(pathSchema.description).toContain('control');
    }
  });

  it('describes Creator artifact titles and file contents as non-whitespace text', () => {
    const creator = getSchema('creator') as any;
    const build = getSchema('creator-build') as any;
    expect(creator.properties.files.uniqueItems).toBe(true);
    expect(creator.properties.files.description).toContain('unique');
    expect(creator.properties.files.description).toContain('path');
    expect(creator.properties.title.pattern).toBe('\\S');
    expect(creator.properties.files.items.properties.content.pattern).toBe('\\S');
    expect(creator.properties.files.items.properties.language.pattern).toBe('\\S');
    expect(build.properties.files.items.properties.content.pattern).toBe('\\S');
    expect(build.properties.files.items.properties.language.pattern).toBe('\\S');
  });

  it('describes tester detail arrays and test plan contracts', () => {
    const schema = getSchema('tester') as any;
    const passRule = schema.allOf.find(
      (rule: any) => rule.if.properties.verdict.const === 'pass',
    );
    const failFixableRule = schema.allOf.find(
      (rule: any) => rule.if.properties.verdict.const === 'fail_fixable',
    );
    expect(schema.required).toEqual(['verdict', 'summary', 'tests_run', 'issues']);
    expect(schema.properties.tests_run.items.properties.result.enum).toEqual(['pass', 'fail']);
    expect(schema.properties.issues.items.properties.severity.enum).toEqual(['critical', 'major', 'minor']);
    expect(passRule.then.properties.issues.maxItems).toBe(0);
    expect(passRule.then.properties.tests_run.items.properties.result.const).toBe('pass');
    expect(failFixableRule.then.properties.issues.minItems).toBe(1);
    expect(failFixableRule.then.properties.issues.items.required).toContain('suggested_fix');
    expect(failFixableRule.then.properties.issues.items.properties.suggested_fix.pattern).toBe('\\S');
    expect(schema.properties.test_plan.required).toEqual(['language', 'setup_commands', 'files', 'run_command']);
    expect(schema.properties.test_plan.properties.files.minItems).toBe(1);
    expect(schema.properties.test_plan.properties.files.uniqueItems).toBe(true);
    expect(schema.properties.test_plan.properties.files.description).toContain('unique');
    expect(schema.properties.test_plan.properties.files.description).toContain('path');
    expect(schema.properties.test_plan.properties.files.items.properties.path.description).toContain('relative');
  });

  it('describes Tester report evidence fields as non-whitespace text', () => {
    const schema = getSchema('tester') as any;
    const testResult = schema.properties.tests_run.items.properties;
    const issue = schema.properties.issues.items.properties;
    const postMortemRule = schema.allOf.find(
      (rule: any) => rule.if.properties.verdict.const === 'fail_catastrophic',
    );
    expect(schema.properties.summary.pattern).toBe('\\S');
    expect(testResult.name.pattern).toBe('\\S');
    expect(testResult.details.pattern).toBe('\\S');
    expect(issue.description.pattern).toBe('\\S');
    expect(issue.location.pattern).toBe('\\S');
    expect(issue.suggested_fix.type).toEqual(['string', 'null']);
    expect(issue.suggested_fix.pattern).toBe('\\S');
    expect(schema.properties.post_mortem.type).toEqual(['string', 'null']);
    expect(schema.properties.post_mortem.pattern).toBe('\\S');
    expect(postMortemRule.then.required).toEqual(['post_mortem']);
    expect(postMortemRule.then.properties.post_mortem.pattern).toBe('\\S');
    expect(postMortemRule.else.properties.post_mortem.type).toBe('null');
  });

  it('describes Tester test plan fields as non-whitespace text', () => {
    const schema = getSchema('tester') as any;
    const testPlan = schema.properties.test_plan.properties;
    expect(testPlan.language.pattern).toBe('\\S');
    expect(testPlan.setup_commands.items.pattern).toBe('\\S');
    expect(testPlan.files.items.properties.content.pattern).toBe('\\S');
    expect(testPlan.run_command.pattern).toBe('\\S');
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
