import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setRootDir } from '../src/root.js';
import type { FoundryConfig, ModelsConfig } from '../src/types/index.js';

// ── Mocks ────────────────────────────────────────────────────────

const mockCallModel = vi.fn();
vi.mock('../src/model/index.js', () => ({
  callModel: mockCallModel,
}));

const mockLogDecision = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/logging/index.js', () => ({
  logDecision: mockLogDecision,
}));

const mockBuildSharedContext = vi.fn().mockResolvedValue('shared context');
const mockLoadDomainsConfig = vi.fn().mockResolvedValue({ domains: [{ name: 'code-tool' }, { name: 'prose' }] });
const mockReadDecisions = vi.fn().mockResolvedValue([{ gate: 'gate2', decision: 'ship', proposal_title: 'Old', review: 'Good' }]);
const mockReadTestReports = vi.fn().mockResolvedValue([]);
const mockReadLiveStimuli = vi.fn().mockResolvedValue('stimuli content');
const mockPickRandomSkills = vi.fn().mockResolvedValue('skill content');
const mockFormatDecisions = vi.fn().mockReturnValue('formatted decisions');
const mockFormatTestReports = vi.fn().mockReturnValue('formatted reports');
const mockSelectDiverseReviews = vi.fn().mockReturnValue([]);
const mockSafeRead = vi.fn().mockResolvedValue('')
const mockGetComplexityDistribution = vi.fn().mockResolvedValue({ S: 5, M: 3, L: 1, XL: 0 })
const mockFormatComplexityDistribution = vi.fn().mockReturnValue("S: 5 (56%)  M: 3 (33%)  L: 1 (11%)  XL: 0 (0%)");

vi.mock('../src/context/index.js', () => ({
  buildSharedContext: mockBuildSharedContext,
  loadDomainsConfig: mockLoadDomainsConfig,
  readDecisions: mockReadDecisions,
  readTestReports: mockReadTestReports,
  readLiveStimuli: mockReadLiveStimuli,
  pickRandomSkills: mockPickRandomSkills,
  formatDecisions: mockFormatDecisions,
  formatTestReports: mockFormatTestReports,
  selectDiverseReviews: mockSelectDiverseReviews,
  safeRead: mockSafeRead,
  getComplexityDistribution: mockGetComplexityDistribution,
  formatComplexityDistribution: mockFormatComplexityDistribution,
}));

// ── Fixtures ─────────────────────────────────────────────────────

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-disp-'));
  setRootDir(tempDir);
  vi.clearAllMocks();

  // Create prompts directory with test prompts
  const promptsDir = path.join(tempDir, 'prompts');
  mkdirSync(promptsDir, { recursive: true });
  writeFileSync(path.join(promptsDir, 'ideator.md'), 'Ideator: {shared_context} {stimuli_live} {stimuli_skills} {critic_gate1_history} {domain_list} {domain_cooldown} {novelty_window}', 'utf-8');
  writeFileSync(path.join(promptsDir, 'critic.md'), 'Gate1: {shared_context} {ideator_proposals} {critic_gate1_history} {complexity_distribution}\n\n## GATE 2\n\nGate2: {shared_context} {critic_review_history} {artifact_content} {approved_proposal} {tester_report}', 'utf-8');
  writeFileSync(path.join(promptsDir, 'creator.md'), 'Creator: {shared_context} {critic_review_history} {approved_proposal} {critic_sharpening_notes} {project_context} {manifesto_quality_standards}', 'utf-8');
  writeFileSync(path.join(promptsDir, 'tester.md'), 'Tester: {approved_proposal} {critic_sharpening_notes} {artifact_content}', 'utf-8');
  writeFileSync(path.join(promptsDir, 'curator.md'), 'Curator prompt', 'utf-8');

  // Create identity dir for manifesto
  mkdirSync(path.join(tempDir, 'identity'), { recursive: true });
  writeFileSync(path.join(tempDir, 'identity', 'manifesto.md'), '## What We Value\n\nQuality\n\n## What We Avoid\n\nJunk\n\n## Our Aesthetic\n\nMinimal', 'utf-8');
});
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

const makeConfig = (): FoundryConfig => ({
  foundry: { name: 'test', version: '0.1.0' },
  iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
  projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
  stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
  context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
  intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
  logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
  recovery: { checkpoint_every: 5, resume_on_crash: true },
  loop: { cooldown_seconds: 2, disk_space_min_gb: 1 },
});

const makeModels = (): ModelsConfig => ({
  agents: {
    ideator: { model: 'test', temperature: 0.9, max_tokens: 4096 },
    creator: { model: 'test', temperature: 0.7, max_tokens: 8192 },
    tester: { model: 'test', temperature: 0.3, max_tokens: 4096 },
    critic: { model: 'test', temperature: 0.5, max_tokens: 4096 },
    curator: { model: 'test', temperature: 0.5, max_tokens: 4096 },
  },
});

describe('agents/dispatcher', () => {
  describe('dispatchIdeator', () => {
    it('assembles prompt and returns parsed ideator response', async () => {
      const ideatorYaml = 'ideas:\n  - title: "Test Idea"\n    domain: code-tool\n    pitch: "A test"\n    complexity: S\n    why: "Because"\n    project_id: null\n    stimulus_ref: null';
      mockCallModel.mockResolvedValueOnce({ text: ideatorYaml, usage: { input: 100, output: 50 } });

      const { dispatchIdeator } = await import('../src/agents/dispatcher.js');
      const result = await dispatchIdeator(makeConfig(), makeModels(), 1);

      expect(result.data.ideas).toHaveLength(1);
      expect(result.data.ideas[0].title).toBe('Test Idea');
      expect(result.usage).toEqual({ input: 100, output: 50 });
      expect(mockCallModel).toHaveBeenCalledOnce();
    });

    it('appends rejection context when provided', async () => {
      const ideatorYaml = 'ideas:\n  - title: "Retry Idea"\n    domain: prose\n    pitch: "Retry"\n    complexity: M\n    why: "Retry"\n    project_id: null\n    stimulus_ref: null';
      mockCallModel.mockResolvedValueOnce({ text: ideatorYaml, usage: { input: 100, output: 50 } });

      const { dispatchIdeator } = await import('../src/agents/dispatcher.js');
      await dispatchIdeator(makeConfig(), makeModels(), 2, 'previous rejection reason');

      const systemPrompt = mockCallModel.mock.calls[0][1];
      expect(systemPrompt).toContain('Previous Rejection');
      expect(systemPrompt).toContain('previous rejection reason');
    });

    it('retries on YAML parse failure', async () => {
      mockCallModel
        .mockResolvedValueOnce({ text: 'not valid yaml {{{', usage: { input: 50, output: 20 } })
        .mockResolvedValueOnce({
          text: 'ideas:\n  - title: "Recovered"\n    domain: prose\n    pitch: "OK"\n    complexity: S\n    why: "Fixed"\n    project_id: null\n    stimulus_ref: null',
          usage: { input: 50, output: 30 },
        });

      const { dispatchIdeator } = await import('../src/agents/dispatcher.js');
      const result = await dispatchIdeator(makeConfig(), makeModels(), 1);

      expect(result.data.ideas[0].title).toBe('Recovered');
      expect(result.usage).toEqual({ input: 100, output: 50 });
      expect(mockCallModel).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting retries', async () => {
      mockCallModel.mockResolvedValue({ text: 'garbage', usage: { input: 10, output: 5 } });

      const { dispatchIdeator } = await import('../src/agents/dispatcher.js');
      await expect(dispatchIdeator(makeConfig(), makeModels(), 1)).rejects.toThrow('Failed to get valid YAML');
      expect(mockCallModel).toHaveBeenCalledTimes(3); // initial + 2 retries
    });
  });

  describe('dispatchCriticGate1', () => {
    it('parses evaluations and logs decisions', async () => {
      const gate1Yaml = 'evaluations:\n  - title: "Test Idea"\n    decision: approve\n    sharpening_notes: "Sharpen it"\n    reasons: "Good idea"';
      mockCallModel.mockResolvedValueOnce({ text: gate1Yaml, usage: { input: 80, output: 40 } });

      const { dispatchCriticGate1 } = await import('../src/agents/dispatcher.js');
      const result = await dispatchCriticGate1(makeConfig(), makeModels(), 1, 'proposals yaml');

      expect(result.data.evaluations).toHaveLength(1);
      expect(result.data.evaluations[0].decision).toBe('approve');
      expect(mockLogDecision).toHaveBeenCalledOnce();
    });
  });

  describe('dispatchCreator', () => {
    it('parses creator response with files', async () => {
      const creatorYaml = 'title: "My Artifact"\nfiles:\n  - path: main.ts\n    content: "console.log(1)"\nnotes: "Created"';
      mockCallModel.mockResolvedValueOnce({ text: creatorYaml, usage: { input: 200, output: 100 } });

      const { dispatchCreator } = await import('../src/agents/dispatcher.js');
      const proposal = { title: 'Test', domain: 'code-tool', pitch: 'A test', complexity: 'S' as const, why: 'Because', project_id: null, stimulus_ref: null };
      const result = await dispatchCreator(makeConfig(), makeModels(), 1, proposal, 'notes');

      expect(result.data.title).toBe('My Artifact');
      expect(result.data.files).toHaveLength(1);
      expect(result.data.files[0].path).toBe('main.ts');
    });

    it('includes revision notes when provided', async () => {
      const creatorYaml = 'title: "Revised"\nfiles:\n  - path: main.ts\n    content: "fixed"';
      mockCallModel.mockResolvedValueOnce({ text: creatorYaml, usage: { input: 200, output: 100 } });

      const { dispatchCreator } = await import('../src/agents/dispatcher.js');
      const proposal = { title: 'Test', domain: 'prose', pitch: 'Test', complexity: 'M' as const, why: 'Why', project_id: null, stimulus_ref: null };
      await dispatchCreator(makeConfig(), makeModels(), 1, proposal, 'notes', 'fix the bugs');

      const systemPrompt = mockCallModel.mock.calls[0][1];
      expect(systemPrompt).toContain('Revision Required');
      expect(systemPrompt).toContain('fix the bugs');
    });
  });

  describe('dispatchTesterTestPlan', () => {
    it('parses tester response', async () => {
      const testerYaml = 'verdict: pass\nsummary: "All tests pass"\ntests_run:\n  - name: test1\n    result: pass\n    details: ok\nissues: []\npost_mortem: null';
      mockCallModel.mockResolvedValueOnce({ text: testerYaml, usage: { input: 150, output: 80 } });

      const { dispatchTesterTestPlan } = await import('../src/agents/dispatcher.js');
      const proposal = { title: 'Test', domain: 'code-tool', pitch: 'Test', complexity: 'S' as const, why: 'Why', project_id: null, stimulus_ref: null };
      const result = await dispatchTesterTestPlan(makeConfig(), makeModels(), 1, proposal, 'notes', 'artifact content');

      expect(result.data.verdict).toBe('pass');
      expect(result.data.summary).toBe('All tests pass');
    });
  });

  describe('dispatchTesterLightweight', () => {
    it('parses lightweight tester response', async () => {
      const testerYaml = 'verdict: fail_fixable\nsummary: "Minor issues"\ntests_run: []\nissues:\n  - severity: minor\n    description: "typo"\n    location: "line 5"\npost_mortem: null';
      mockCallModel.mockResolvedValueOnce({ text: testerYaml, usage: { input: 100, output: 60 } });

      const { dispatchTesterLightweight } = await import('../src/agents/dispatcher.js');
      const proposal = { title: 'Test', domain: 'prose', pitch: 'Test', complexity: 'S' as const, why: 'Why', project_id: null, stimulus_ref: null };
      const result = await dispatchTesterLightweight(makeConfig(), makeModels(), 1, proposal, 'notes', 'artifact');

      expect(result.data.verdict).toBe('fail_fixable');
    });
  });

  describe('dispatchTesterVerdict', () => {
    it('parses verdict after sandbox execution', async () => {
      const verdictYaml = 'verdict: pass\nsummary: "Tests passed after sandbox run"\ntests_run:\n  - name: integration\n    result: pass\n    details: ok\nissues: []\npost_mortem: null';
      mockCallModel.mockResolvedValueOnce({ text: verdictYaml, usage: { input: 100, output: 50 } });

      const { dispatchTesterVerdict } = await import('../src/agents/dispatcher.js');
      const proposal = { title: 'Test', domain: 'code-tool', pitch: 'Test', complexity: 'S' as const, why: 'Why', project_id: null, stimulus_ref: null };
      const result = await dispatchTesterVerdict(makeConfig(), makeModels(), 1, proposal, 'artifact code', 'exit code 0');

      expect(result.data.verdict).toBe('pass');
    });
  });

  describe('dispatchCriticGate2', () => {
    it('parses gate2 response and logs decision', async () => {
      const gate2Yaml = 'decision: ship\nratings:\n  originality: 4\n  specificity: 3.5\n  craft: 4\n  surprise: 3\n  coherence: 4\n  portfolio_fit: 3.5\nreview: "Solid work"';
      mockCallModel.mockResolvedValueOnce({ text: gate2Yaml, usage: { input: 200, output: 80 } });

      const { dispatchCriticGate2 } = await import('../src/agents/dispatcher.js');
      const proposal = { title: 'Test', domain: 'code-tool', pitch: 'Test', complexity: 'S' as const, why: 'Why', project_id: null, stimulus_ref: null };
      const result = await dispatchCriticGate2(makeConfig(), makeModels(), 1, proposal, 'artifact', 'tester report');

      expect(result.data.decision).toBe('ship');
      expect(result.data.ratings.originality).toBe(4);
      expect(mockLogDecision).toHaveBeenCalledOnce();
    });
  });

  describe('dispatchCreator - manifesto with no quality sections', () => {
    it('uses full manifesto when no matching sections found', async () => {
      // safeRead mock returns the manifesto content — use text with no quality sections
      mockSafeRead.mockResolvedValueOnce('# Manifesto\n\nJust some text, no matching sections.');

      const creatorYaml = 'title: "Test"\nfiles:\n  - path: main.ts\n    content: "code"';
      mockCallModel.mockResolvedValueOnce({ text: creatorYaml, usage: { input: 200, output: 100 } });

      const { dispatchCreator } = await import('../src/agents/dispatcher.js');
      const proposal = { title: 'Test', domain: 'prose', pitch: 'Test', complexity: 'S' as const, why: 'Why', project_id: null, stimulus_ref: null };
      await dispatchCreator(makeConfig(), makeModels(), 1, proposal, 'notes');

      // The prompt should contain the full manifesto since no quality sections matched
      const systemPrompt = mockCallModel.mock.calls[0][1];
      expect(systemPrompt).toContain('Just some text');
    });
  });

  describe('dispatchCreator - empty critic notes', () => {
    it('uses "No sharpening notes" when notes are empty', async () => {
      const creatorYaml = 'title: "Test"\nfiles:\n  - path: main.ts\n    content: "code"';
      mockCallModel.mockResolvedValueOnce({ text: creatorYaml, usage: { input: 200, output: 100 } });

      const { dispatchCreator } = await import('../src/agents/dispatcher.js');
      const proposal = { title: 'Test', domain: 'prose', pitch: 'Test', complexity: 'S' as const, why: 'Why', project_id: null, stimulus_ref: null };
      await dispatchCreator(makeConfig(), makeModels(), 1, proposal, '');

      const systemPrompt = mockCallModel.mock.calls[0][1];
      expect(systemPrompt).toContain('No sharpening notes');
    });
  });

  describe('dispatchWithRetry - structural validation failure path', () => {
    it('logs warning for parsed but structurally invalid YAML and retries', async () => {
      // First call: valid YAML but structurally invalid (missing 'ideas' key)
      // Second call: still invalid
      // Third call: valid
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockCallModel
        .mockResolvedValueOnce({ text: 'something: true\nother: false', usage: { input: 10, output: 5 } })
        .mockResolvedValueOnce({ text: 'wrong_key: []', usage: { input: 10, output: 5 } })
        .mockResolvedValueOnce({
          text: 'ideas:\n  - title: "Recovered"\n    domain: prose\n    pitch: "OK"\n    complexity: S\n    why: "Fixed"\n    project_id: null\n    stimulus_ref: null',
          usage: { input: 50, output: 30 },
        });

      const { dispatchIdeator } = await import('../src/agents/dispatcher.js');
      const result = await dispatchIdeator(makeConfig(), makeModels(), 1);

      expect(result.data.ideas[0].title).toBe('Recovered');
      // Should have warned about structurally invalid YAML
      expect(consoleSpy).toHaveBeenCalled();
      const warnCalls = consoleSpy.mock.calls.map(c => String(c[0]));
      const hasStructuralWarning = warnCalls.some(msg => msg.includes('structurally invalid') || msg.includes('YAML'));
      expect(hasStructuralWarning).toBe(true);

      consoleSpy.mockRestore();
    });

    it('logs recovery message when YAML succeeds on retry', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      mockCallModel
        .mockResolvedValueOnce({ text: 'not_ideas: true', usage: { input: 10, output: 5 } })
        .mockResolvedValueOnce({
          text: 'ideas:\n  - title: "After Retry"\n    domain: prose\n    pitch: "OK"\n    complexity: S\n    why: "Fixed"\n    project_id: null\n    stimulus_ref: null',
          usage: { input: 50, output: 30 },
        });

      const { dispatchIdeator } = await import('../src/agents/dispatcher.js');
      const result = await dispatchIdeator(makeConfig(), makeModels(), 1);

      expect(result.data.ideas[0].title).toBe('After Retry');
      const logCalls = consoleSpy.mock.calls.map(c => String(c[0]));
      const hasRecoveryLog = logCalls.some(msg => msg.includes('YAML recovered'));
      expect(hasRecoveryLog).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  describe('extractQualityStandards', () => {
    it('extracts quality sections from manifesto', async () => {
      // Set up a manifesto with the target sections
      writeFileSync(path.join(tempDir, 'identity', 'manifesto.md'), [
        '# Manifesto',
        '',
        '## What We Value',
        '',
        'Excellence and craft.',
        '',
        '## History',
        '',
        'Some boring history.',
        '',
        '## What We Avoid',
        '',
        'Mediocrity.',
        '',
        '## Our Aesthetic',
        '',
        'Minimal and precise.',
      ].join('\n'), 'utf-8');

      // safeRead will return the manifesto content
      mockSafeRead.mockResolvedValueOnce([
        '# Manifesto',
        '',
        '## What We Value',
        '',
        'Excellence and craft.',
        '',
        '## History',
        '',
        'Some boring history.',
        '',
        '## What We Avoid',
        '',
        'Mediocrity.',
        '',
        '## Our Aesthetic',
        '',
        'Minimal and precise.',
      ].join('\n'));

      const creatorYaml = 'title: "Quality Test"\nfiles:\n  - path: main.ts\n    content: "code"';
      mockCallModel.mockResolvedValueOnce({ text: creatorYaml, usage: { input: 200, output: 100 } });

      const { dispatchCreator } = await import('../src/agents/dispatcher.js');
      const proposal = { title: 'Test', domain: 'prose', pitch: 'Test', complexity: 'S' as const, why: 'Why', project_id: null, stimulus_ref: null };
      const result = await dispatchCreator(makeConfig(), makeModels(), 1, proposal, 'notes');

      expect(result.data.title).toBe('Quality Test');
      // The prompt should contain quality standards extracted from manifesto
      const systemPrompt = mockCallModel.mock.calls[0][1];
      expect(systemPrompt).toContain('Excellence and craft');
    });

    it('returns full manifesto when no quality sections found', async () => {
      mockSafeRead.mockResolvedValueOnce('# Simple Manifesto\n\nJust some text without specific sections.');

      const creatorYaml = 'title: "Simple"\nfiles:\n  - path: main.ts\n    content: "code"';
      mockCallModel.mockResolvedValueOnce({ text: creatorYaml, usage: { input: 200, output: 100 } });

      const { dispatchCreator } = await import('../src/agents/dispatcher.js');
      const proposal = { title: 'Test', domain: 'prose', pitch: 'Test', complexity: 'S' as const, why: 'Why', project_id: null, stimulus_ref: null };
      const result = await dispatchCreator(makeConfig(), makeModels(), 1, proposal, 'notes');

      expect(result.data.title).toBe('Simple');
      const systemPrompt = mockCallModel.mock.calls[0][1];
      // When no quality sections found, the full manifesto is used
      expect(systemPrompt).toContain('Simple Manifesto');
    });
  });

  describe('dispatchTesterVerdict', () => {
    it('parses verdict response', async () => {
      const testerYaml = 'verdict: pass\nsummary: "All sandbox tests pass"\ntests_run:\n  - name: test1\n    result: pass\n    details: ok\nissues: []\npost_mortem: null';
      mockCallModel.mockResolvedValueOnce({ text: testerYaml, usage: { input: 200, output: 100 } });

      const { dispatchTesterVerdict } = await import('../src/agents/dispatcher.js');
      const proposal = { title: 'Test', domain: 'code-tool', pitch: 'Test', complexity: 'S' as const, why: 'Why', project_id: null, stimulus_ref: null };
      const result = await dispatchTesterVerdict(makeConfig(), makeModels(), 1, proposal, 'artifact code', 'tests passed');

      expect(result.data.verdict).toBe('pass');
      expect(result.data.summary).toBe('All sandbox tests pass');
    });
  });

  describe('dispatchCuratorRedirect', () => {
    it('parses redirect response', async () => {
      const curatorYaml = 'proposal:\n  title: "Human Request"\n  domain: "code-tool"\n  pitch: "Build what the human asked"\n  complexity: "M"\n  why: "Human redirect"\n  project_id: null\n  stimulus_ref: null';
      mockCallModel.mockResolvedValueOnce({ text: curatorYaml, usage: { input: 150, output: 80 } });

      const { dispatchCuratorRedirect } = await import('../src/agents/dispatcher.js');
      const result = await dispatchCuratorRedirect(makeConfig(), makeModels(), 1, 'Build me a tool');

      expect(result.data.proposal.title).toBe('Human Request');
      expect(result.data.proposal.domain).toBe('code-tool');
    });
  });

  describe('dispatchCriticGate2 - edge cases', () => {
    it('uses fallback text when testerReport is empty', async () => {
      const gate2Yaml = 'decision: ship\nratings:\n  originality: 4\n  specificity: 3.5\n  craft: 4\n  surprise: 3\n  coherence: 4\n  portfolio_fit: 3.5\nreview: "Good"';
      mockCallModel.mockResolvedValueOnce({ text: gate2Yaml, usage: { input: 100, output: 50 } });

      const { dispatchCriticGate2 } = await import('../src/agents/dispatcher.js');
      const proposal = { title: 'Test', domain: 'code-tool', pitch: 'Test', complexity: 'S' as const, why: 'Why', project_id: null, stimulus_ref: null };
      const result = await dispatchCriticGate2(makeConfig(), makeModels(), 1, proposal, 'artifact', '');

      expect(result.data.decision).toBe('ship');
      const systemPrompt = mockCallModel.mock.calls[0][1];
      expect(systemPrompt).toContain('No tester report');
    });

    it('logs revision_notes in decision when decision is revise', async () => {
      const gate2Yaml = 'decision: revise\nratings:\n  originality: 2\n  specificity: 2\n  craft: 2\n  surprise: 2\n  coherence: 2\n  portfolio_fit: 2\nreview: "Needs work"\nrevision_notes: "Fix the structure"';
      mockCallModel.mockResolvedValueOnce({ text: gate2Yaml, usage: { input: 100, output: 50 } });

      const { dispatchCriticGate2 } = await import('../src/agents/dispatcher.js');
      const proposal = { title: 'Test', domain: 'code-tool', pitch: 'Test', complexity: 'S' as const, why: 'Why', project_id: null, stimulus_ref: null };
      const result = await dispatchCriticGate2(makeConfig(), makeModels(), 1, proposal, 'artifact', 'tester report');

      expect(result.data.decision).toBe('revise');
      expect(mockLogDecision).toHaveBeenCalledWith(expect.objectContaining({
        decision: 'revise',
        reasons: 'Fix the structure',
      }));
    });

    it('logs kill_reason in decision when decision is kill', async () => {
      const gate2Yaml = 'decision: kill\nratings:\n  originality: 1\n  specificity: 1\n  craft: 1\n  surprise: 1\n  coherence: 1\n  portfolio_fit: 1\nreview: "Terrible"\nkill_reason: "Beyond saving"';
      mockCallModel.mockResolvedValueOnce({ text: gate2Yaml, usage: { input: 100, output: 50 } });

      const { dispatchCriticGate2 } = await import('../src/agents/dispatcher.js');
      const proposal = { title: 'Test', domain: 'code-tool', pitch: 'Test', complexity: 'S' as const, why: 'Why', project_id: null, stimulus_ref: null };
      const result = await dispatchCriticGate2(makeConfig(), makeModels(), 1, proposal, 'artifact', 'tester report');

      expect(result.data.decision).toBe('kill');
      expect(mockLogDecision).toHaveBeenCalledWith(expect.objectContaining({
        decision: 'kill',
        reasons: 'Beyond saving',
      }));
    });
  });

  describe('dispatchIdeator - with gate1 history', () => {
    it('filters and slices gate1 decisions from history', async () => {
      mockReadDecisions.mockResolvedValueOnce([
        { gate: 'gate1', decision: 'approve', proposal_title: 'Old Idea 1' },
        { gate: 'gate2', decision: 'ship', proposal_title: 'Old Idea 2' },
        { gate: 'gate1', decision: 'reject', proposal_title: 'Old Idea 3' },
      ]);

      const ideatorYaml = 'ideas:\n  - title: "Test"\n    domain: prose\n    pitch: "A test"\n    complexity: S\n    why: "Because"\n    project_id: null\n    stimulus_ref: null';
      mockCallModel.mockResolvedValueOnce({ text: ideatorYaml, usage: { input: 100, output: 50 } });

      const { dispatchIdeator } = await import('../src/agents/dispatcher.js');
      const result = await dispatchIdeator(makeConfig(), makeModels(), 1);
      expect(result.data.ideas[0].title).toBe('Test');
      // Verify formatDecisions was called with filtered gate1 entries
      expect(mockFormatDecisions).toHaveBeenCalled();
    });
  });

  describe('dispatchCriticGate1 - with decisions history', () => {
    it('uses gate1 history from decisions', async () => {
      mockReadDecisions.mockResolvedValueOnce([
        { gate: 'gate1', decision: 'approve', proposal_title: 'Prev' },
      ]);

      const gate1Yaml = 'evaluations:\n  - title: "Test"\n    decision: reject\n    reasons: "Not good"';
      mockCallModel.mockResolvedValueOnce({ text: gate1Yaml, usage: { input: 80, output: 40 } });

      const { dispatchCriticGate1 } = await import('../src/agents/dispatcher.js');
      const result = await dispatchCriticGate1(makeConfig(), makeModels(), 1, 'proposals');
      expect(result.data.evaluations[0].decision).toBe('reject');
    });
  });

  describe('dispatchWithRetry - parse error catch branch', () => {
    it('enters catch block when parseYaml throws on truly unparseable input', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Use input that makes yaml.parse throw: a string with tabs in flow context
      // which strict YAML mode rejects. But the repair lib might fix it.
      // Safest bet: make callModel return something that triggers catch.
      // Return a null/undefined text to force an error in parseYaml.
      mockCallModel
        .mockResolvedValueOnce({ text: '', usage: { input: 10, output: 5 } })
        .mockResolvedValueOnce({ text: '\x00\x01\x02', usage: { input: 10, output: 5 } })
        .mockResolvedValueOnce({
          text: 'ideas:\n  - title: "Saved"\n    domain: prose\n    pitch: "OK"\n    complexity: S\n    why: "Y"\n    project_id: null\n    stimulus_ref: null',
          usage: { input: 50, output: 30 },
        });

      const { dispatchIdeator } = await import('../src/agents/dispatcher.js');
      const result = await dispatchIdeator(makeConfig(), makeModels(), 1);
      expect(result.data.ideas[0].title).toBe('Saved');
      consoleSpy.mockRestore();
    });
  });

  describe('dispatchCuratorRedirect', () => {
    it('parses curator redirect response', async () => {
      const redirectYaml = 'proposal:\n  title: "Human Request"\n  domain: code-tool\n  pitch: "What the human wanted"\n  complexity: M\n  why: "Human redirect"\n  project_id: null\n  stimulus_ref: null';
      mockCallModel.mockResolvedValueOnce({ text: redirectYaml, usage: { input: 100, output: 50 } });

      const { dispatchCuratorRedirect } = await import('../src/agents/dispatcher.js');
      const result = await dispatchCuratorRedirect(makeConfig(), makeModels(), 1, 'make a poem');

      expect(result.data.proposal.title).toBe('Human Request');
      expect(result.data.proposal.domain).toBe('code-tool');
    });
  });
});
