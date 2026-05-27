import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setRootDir } from '../src/root.js';
import type { FoundryConfig, ModelsConfig } from '../src/types/index.js';

// ── Mock all agent dispatchers ──────────────────────────────────────

const mockDispatchIdeator = vi.fn();
const mockDispatchCriticGate1 = vi.fn();
const mockDispatchCreator = vi.fn();
const mockDispatchTesterTestPlan = vi.fn();
const mockDispatchTesterLightweight = vi.fn();
const mockDispatchTesterVerdict = vi.fn();
const mockDispatchCriticGate2 = vi.fn();
const mockDispatchCuratorRedirect = vi.fn();

vi.mock('../src/agents/index.js', () => ({
  dispatchIdeator: mockDispatchIdeator,
  dispatchCriticGate1: mockDispatchCriticGate1,
  dispatchCreator: mockDispatchCreator,
  dispatchTesterTestPlan: mockDispatchTesterTestPlan,
  dispatchTesterLightweight: mockDispatchTesterLightweight,
  dispatchTesterVerdict: mockDispatchTesterVerdict,
  dispatchCriticGate2: mockDispatchCriticGate2,
  dispatchCuratorRedirect: mockDispatchCuratorRedirect,
}));

// ── Mock creator pipeline ────────────────────────────────────────

const mockRunCreatorPipeline = vi.fn();

vi.mock('../src/creator/index.js', () => ({
  runCreatorPipeline: (...args: any[]) => mockRunCreatorPipeline(...args),
}));

// ── Mock file operations ──────────────────────────────────────────

const mockIsCodeDomain = vi.fn();
const mockGetNextArtifactId = vi.fn().mockResolvedValue('0001');
const mockWriteArtifact = vi.fn().mockResolvedValue('/tmp/artifact');
const mockUpdatePortfolioIndex = vi.fn().mockResolvedValue(undefined);
const mockWriteKilledArtifact = vi.fn().mockResolvedValue(undefined);
const mockClearWorkspace = vi.fn().mockResolvedValue(undefined);
const mockWriteWorkspaceFile = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/files/index.js', () => ({
  isCodeDomain: mockIsCodeDomain,
  getNextArtifactId: mockGetNextArtifactId,
  writeArtifact: mockWriteArtifact,
  updatePortfolioIndex: mockUpdatePortfolioIndex,
  writeKilledArtifact: mockWriteKilledArtifact,
  clearWorkspace: mockClearWorkspace,
  writeWorkspaceFile: mockWriteWorkspaceFile,
}));

const mockAppendJournal = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/files/journal.js', () => ({
  appendJournal: mockAppendJournal,
}));

const mockCheckStopFile = vi.fn().mockResolvedValue(false);
const mockReadRequests = vi.fn().mockResolvedValue('');
const mockClearRequests = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/files/intervention.js', () => ({
  checkStopFile: mockCheckStopFile,
  readRequests: mockReadRequests,
  clearRequests: mockClearRequests,
}));

const mockLogIteration = vi.fn().mockResolvedValue(undefined);
const mockLogTestReport = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/logging/index.js', () => ({
  logIteration: mockLogIteration,
  logTestReport: mockLogTestReport,
}));

const mockCreateSandbox = vi.fn();
vi.mock('../src/sandbox/index.js', () => ({
  createSandbox: mockCreateSandbox,
}));

const mockUpdateProjectStatus = vi.fn().mockResolvedValue(undefined);
const mockLinkArtifactToProject = vi.fn().mockResolvedValue(undefined);
const mockGetActiveProjects = vi.fn().mockResolvedValue([]);
const mockCreateProject = vi.fn().mockResolvedValue('P001');
vi.mock('../src/files/projects.js', () => ({
  updateProjectStatus: mockUpdateProjectStatus,
  linkArtifactToProject: mockLinkArtifactToProject,
  getActiveProjects: mockGetActiveProjects,
  createProject: mockCreateProject,
}));

// ── Fixtures ─────────────────────────────────────────────────────

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-iter-'));
  setRootDir(tempDir);
  vi.clearAllMocks();
  mockGetNextArtifactId.mockReset();
  mockGetNextArtifactId.mockResolvedValue('0001');
  mkdirSync(path.join(tempDir, 'logs'), { recursive: true });
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

const usage = { input: 100, output: 50 };

function setupHappyPath() {
  const proposal = { title: 'Test Artifact', domain: 'prose', pitch: 'A test', complexity: 'S', why: 'Because', project_id: null, stimulus_ref: null };

  mockDispatchIdeator.mockResolvedValueOnce({
    data: { ideas: [proposal] },
    usage,
    rawText: '',
  });

  mockDispatchCriticGate1.mockResolvedValueOnce({
    data: { evaluations: [{ title: 'Test Artifact', decision: 'approve', sharpening_notes: 'Good', reasons: '' }] },
    usage,
    rawText: '',
  });

  mockIsCodeDomain.mockReturnValue(false);

  mockRunCreatorPipeline.mockResolvedValueOnce({
    artifact: { title: 'Test Artifact', files: [{ path: 'poem.md', content: '# A Poem' }], notes: '' },
    usage,
    phasesRun: ['build'],
    phaseTokens: { build: 50 },
  });

  mockDispatchTesterLightweight.mockResolvedValueOnce({
    data: { verdict: 'pass', summary: 'Looks good', tests_run: [], issues: [] },
    usage,
    rawText: '',
  });

  mockDispatchCriticGate2.mockResolvedValueOnce({
    data: {
      decision: 'ship',
      ratings: { originality: 4, specificity: 3.5, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 3.5 },
      review: 'Well crafted piece',
    },
    usage,
    rawText: '',
  });
}

describe('iteration/runner', () => {
  describe('runIteration - happy path (ship)', () => {
    it('runs full iteration and ships artifact', async () => {
      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(result.artifact_id).toBe('0001');
      expect(result.title).toBe('Test Artifact');
      expect(result.domain).toBe('prose');
      expect(mockWriteArtifact).toHaveBeenCalledOnce();
      expect(mockUpdatePortfolioIndex).toHaveBeenCalledOnce();
      expect(mockLogIteration).toHaveBeenCalledOnce();
    });

    it('serializes portfolio bookkeeping for concurrent shipped iterations', async () => {
      const proposal = { title: 'Concurrent Artifact', domain: 'prose', pitch: 'A test', complexity: 'S' as const, why: 'Because', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValue({
        data: { ideas: [proposal] },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate1.mockResolvedValue({
        data: { evaluations: [{ title: 'Concurrent Artifact', decision: 'approve', sharpening_notes: 'Good', reasons: '' }] },
        usage,
        rawText: '',
      });
      mockIsCodeDomain.mockReturnValue(false);
      mockRunCreatorPipeline.mockResolvedValue({
        artifact: { title: 'Concurrent Artifact', files: [{ path: 'piece.md', content: '# Piece' }], notes: '' },
        usage,
        phasesRun: ['build'],
        phaseTokens: { build: 50 },
      });
      mockDispatchTesterLightweight.mockResolvedValue({
        data: { verdict: 'pass', summary: 'Looks good', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate2.mockResolvedValue({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 3.5, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 3.5 },
          review: 'Well crafted piece',
        },
        usage,
        rawText: '',
      });

      let activeBookkeeping = 0;
      let maxActiveBookkeeping = 0;
      let nextId = 1;
      mockGetNextArtifactId.mockImplementation(async () => {
        activeBookkeeping++;
        maxActiveBookkeeping = Math.max(maxActiveBookkeeping, activeBookkeeping);
        await new Promise((r) => setTimeout(r, 25));
        activeBookkeeping--;
        return String(nextId++).padStart(4, '0');
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const [first, second] = await Promise.all([
        runIteration(makeConfig(), makeModels(), 1, 1),
        runIteration(makeConfig(), makeModels(), 2, 2),
      ]);

      expect(first.outcome).toBe('shipped');
      expect(second.outcome).toBe('shipped');
      expect(maxActiveBookkeeping).toBe(1);
    });
  });

  describe('runIteration - STOP file', () => {
    it('halts when STOP file is detected', async () => {
      mockCheckStopFile.mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('halted');
      expect(result.reason).toContain('STOP');
      expect(mockDispatchIdeator).not.toHaveBeenCalled();
    });
  });

  describe('runIteration - human redirect', () => {
    it('processes human redirect via curator', async () => {
      mockReadRequests.mockResolvedValueOnce('Make a haiku about testing');

      const redirectProposal = { title: 'Testing Haiku', domain: 'prose', pitch: 'A haiku', complexity: 'S', why: 'Human redirect', project_id: null, stimulus_ref: null };
      mockDispatchCuratorRedirect.mockResolvedValueOnce({
        data: { proposal: redirectProposal },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Testing Haiku', files: [{ path: 'haiku.md', content: 'Lines of code flow down' }] },
        usage,
        phasesRun: ['build'],
        phaseTokens: { build: 50 },
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'Nice haiku', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 3, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 3 },
          review: 'Lovely haiku',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(result.title).toBe('Testing Haiku');
      expect(mockDispatchIdeator).not.toHaveBeenCalled();
      expect(mockClearRequests).toHaveBeenCalledOnce();
    });
  });

  describe('runIteration - all rejected (deadlock)', () => {
    it('skips iteration after ideation deadlock and curator override failure', async () => {
      const config = makeConfig();
      config.iteration.max_idea_retries = 2;

      for (let i = 0; i < 2; i++) {
        mockDispatchIdeator.mockResolvedValueOnce({
          data: { ideas: [{ title: `Idea ${i}`, domain: 'prose', pitch: 'Meh', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null }] },
          usage,
          rawText: '',
        });
        mockDispatchCriticGate1.mockResolvedValueOnce({
          data: { evaluations: [{ title: `Idea ${i}`, decision: 'reject', sharpening_notes: '', reasons: 'Not good enough' }] },
          usage,
          rawText: '',
        });
      }

      mockDispatchCuratorRedirect.mockRejectedValueOnce(new Error('Curator failed'));

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);

      expect(result.outcome).toBe('skipped');
      expect(result.reason).toContain('deadlock');
      expect(mockDispatchIdeator.mock.calls[1][3]).toContain('Propose 5 NEW ideas');
    });
  });

  describe('runIteration - kill decision', () => {
    it('kills artifact when gate2 says kill', async () => {
      const proposal = { title: 'Bad Artifact', domain: 'prose', pitch: 'A test', complexity: 'S', why: 'Because', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Bad Artifact', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Bad Artifact', files: [{ path: 'bad.md', content: 'bad content' }] },
        usage,
        phasesRun: ['build'],
        phaseTokens: { build: 50 },
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage, rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'kill',
          ratings: { originality: 1, specificity: 1, craft: 1, surprise: 1, coherence: 1, portfolio_fit: 1 },
          review: 'Not good enough',
          kill_reason: 'Too derivative',
        },
        usage, rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('killed');
      expect(result.reason).toContain('Too derivative');
      expect(mockWriteKilledArtifact).toHaveBeenCalledOnce();
      expect(mockWriteArtifact).not.toHaveBeenCalled();
    });
  });

  describe('runIteration - revision cycle', () => {
    it('revises artifact and ships on second round', async () => {
      const proposal = { title: 'Revised Art', domain: 'prose', pitch: 'Art', complexity: 'M', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Revised Art', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      // First creation via pipeline
      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Revised Art', files: [{ path: 'v1.md', content: 'draft' }] },
        usage,
        phasesRun: ['plan', 'build-1', 'revise'],
        phaseTokens: { plan: 30, 'build-1': 40, revise: 30 },
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage, rawText: '',
      });

      // Gate2 says revise
      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'revise',
          ratings: { originality: 3, specificity: 2, craft: 2, surprise: 2, coherence: 3, portfolio_fit: 3 },
          review: 'Needs more depth',
          revision_notes: 'Add more imagery',
        },
        usage, rawText: '',
      });

      // Revised creation via pipeline
      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Revised Art', files: [{ path: 'v2.md', content: 'improved draft' }] },
        usage,
        phasesRun: ['plan', 'build-1', 'revise'],
        phaseTokens: { plan: 30, 'build-1': 40, revise: 30 },
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'Good now', tests_run: [], issues: [] },
        usage, rawText: '',
      });

      // Gate2 ships
      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 4, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 4 },
          review: 'Much better',
        },
        usage, rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(mockRunCreatorPipeline).toHaveBeenCalledTimes(2);
    });
  });

  describe('runIteration - code domain with sandbox', () => {
    it('uses sandbox for code domain artifacts', async () => {
      const proposal = { title: 'Code Tool', domain: 'code-tool', pitch: 'A tool', complexity: 'M', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Code Tool', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(true);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Code Tool', files: [{ path: 'main.js', content: 'console.log(1)' }] },
        usage,
        phasesRun: ['plan', 'build-1', 'revise'],
        phaseTokens: { plan: 30, 'build-1': 40, revise: 30 },
      });

      mockDispatchTesterTestPlan.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'Tests pass', tests_run: [{ name: 'basic', result: 'pass', details: 'ok' }], issues: [] },
        usage, rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 3, specificity: 4, craft: 4, surprise: 2, coherence: 4, portfolio_fit: 3, technical_quality: 4 },
          review: 'Working code tool',
        },
        usage, rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(mockDispatchTesterTestPlan).toHaveBeenCalledOnce();
    });
  });

  describe('runIteration - disk space check', () => {
    it('halts on low disk space when configured', async () => {
      const config = makeConfig();
      config.loop.disk_space_min_gb = 999999;

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);
      expect(result).toBeDefined();
    });
  });

  describe('runIteration - project bookkeeping', () => {
    it('links artifact to project on ship', async () => {
      const proposal = { title: 'Project Art', domain: 'prose', pitch: 'Test', complexity: 'S', why: 'Why', project_id: 'P001', stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Project Art', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Project Art', files: [{ path: 'art.md', content: 'content' }] },
        usage,
        phasesRun: ['build'],
        phaseTokens: { build: 50 },
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage, rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 3, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 4 },
          review: 'Good fit',
        },
        usage, rawText: '',
      });

      mockGetActiveProjects.mockResolvedValueOnce([{ project_id: 'P001', completed_iterations: 2 }]);

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(mockLinkArtifactToProject).toHaveBeenCalledWith('P001', '0001', 'Project Art');
      expect(mockUpdateProjectStatus).toHaveBeenCalled();
    });
  });

  describe('runIteration - test fix cycle', () => {
    it('sends fixable failures back to creator', async () => {
      const proposal = { title: 'Fixable', domain: 'prose', pitch: 'Test', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Fixable', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      // First creation
      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Fixable', files: [{ path: 'v1.md', content: 'draft with typo' }] },
        usage,
        phasesRun: ['build'],
        phaseTokens: { build: 50 },
      });

      // Tester finds fixable issues
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: {
          verdict: 'fail_fixable',
          summary: 'Typo found',
          tests_run: [{ name: 'spell', result: 'fail', details: 'typo on line 1' }],
          issues: [{ severity: 'minor', description: 'typo', location: 'line 1', suggested_fix: 'fix the typo' }],
        },
        usage, rawText: '',
      });

      // Creator fixes via pipeline
      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Fixable', files: [{ path: 'v1.md', content: 'draft fixed' }] },
        usage,
        phasesRun: ['build'],
        phaseTokens: { build: 50 },
      });

      // Now passes
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'All good', tests_run: [{ name: 'spell', result: 'pass', details: 'ok' }], issues: [] },
        usage, rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 3, specificity: 3, craft: 3, surprise: 3, coherence: 3, portfolio_fit: 3 },
          review: 'OK after fix',
        },
        usage, rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(mockRunCreatorPipeline).toHaveBeenCalledTimes(2);
      expect(mockLogTestReport).toHaveBeenCalledTimes(2);
    });
  });

  describe('runIteration - max revision rounds force ship', () => {
    it('force ships after max revision rounds', async () => {
      const config = makeConfig();
      config.iteration.max_revision_rounds = 0;

      const proposal = { title: 'Force Ship', domain: 'prose', pitch: 'Test', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Force Ship', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Force Ship', files: [{ path: 'v1.md', content: 'content' }] },
        usage,
        phasesRun: ['build'],
        phaseTokens: { build: 50 },
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage, rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'revise',
          ratings: { originality: 3, specificity: 2, craft: 2, surprise: 2, coherence: 3, portfolio_fit: 3 },
          review: 'Needs work',
          revision_notes: 'Fix it',
        },
        usage, rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(mockRunCreatorPipeline).toHaveBeenCalledTimes(1);
    });

    it('force kills after max revision rounds when mean rating below threshold', async () => {
      const config = makeConfig();
      config.iteration.max_revision_rounds = 0;

      const proposal = { title: 'Bad Art', domain: 'prose', pitch: 'Test', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Bad Art', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Bad Art', files: [{ path: 'v1.md', content: 'content' }] },
        usage,
        phasesRun: ['build'],
        phaseTokens: { build: 50 },
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage, rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'revise',
          ratings: { originality: 1, specificity: 2, craft: 1, surprise: 2, coherence: 1, portfolio_fit: 2 },
          review: 'Terrible',
          revision_notes: 'Start over',
        },
        usage, rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);

      expect(result.outcome).toBe('killed');
      expect(mockRunCreatorPipeline).toHaveBeenCalledTimes(1);
    });
  });

  describe('runIteration - XL project creation', () => {
    it('creates project for XL proposals and downgrades to L', async () => {
      const proposal = {
        title: 'Epic Project', domain: 'fiction', pitch: 'A novella',
        complexity: 'XL' as const, why: 'Ambition',
        project_id: null, stimulus_ref: null,
        xl_mode: 'project' as const,
        project: { name: 'The Last Librarian', description: 'A novella', estimated_iterations: 6, structure: [{ ch1: 'Arrival' }] },
      };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Epic Project', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Epic Project', files: [{ path: 'ch1.md', content: 'Chapter 1' }] },
        usage,
        phasesRun: ['plan', 'build-1', 'build-2', 'revise', 'polish'],
        phaseTokens: { plan: 30, 'build-1': 40, 'build-2': 40, revise: 30, polish: 20 },
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage, rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
          review: 'Excellent start',
        },
        usage, rawText: '',
      });

      mockGetActiveProjects.mockResolvedValueOnce([{ project_id: 'P001', completed_iterations: 0 }]);

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(mockCreateProject).toHaveBeenCalledOnce();
      // Pipeline should receive L complexity (downgraded from XL)
      const pipelineCall = mockRunCreatorPipeline.mock.calls[0];
      expect(pipelineCall[1].complexity).toBe('L');
      // Iteration log should record original XL complexity
      expect(mockLogIteration).toHaveBeenCalledWith(expect.objectContaining({ complexity: 'XL' }));
    });
  });

  describe('runIteration - M-complexity pipeline', () => {
    it('uses pipeline for M-complexity proposals', async () => {
      const proposal = { title: 'Multi Phase', domain: 'code-tool', pitch: 'Complex tool', complexity: 'M', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Multi Phase', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Multi Phase', files: [{ path: 'main.ts', content: 'code' }] },
        usage,
        phasesRun: ['plan', 'build-1', 'revise'],
        phaseTokens: { plan: 30, 'build-1': 40, revise: 30 },
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage, rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 4, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 4 },
          review: 'Good multi-phase work',
        },
        usage, rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(mockRunCreatorPipeline).toHaveBeenCalledOnce();
      // Verify iteration log includes phase data
      expect(mockLogIteration).toHaveBeenCalledWith(expect.objectContaining({
        complexity: 'M',
        phases_run: ['plan', 'build-1', 'revise'],
      }));
    });

    it('uses Critic recommended complexity upgrades for creation', async () => {
      const proposal = { title: 'Too Small', domain: 'code-tool', pitch: 'A cautious tool idea', complexity: 'M', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Too Small', decision: 'approve', sharpening_notes: 'Make it substantial', reasons: '', recommended_complexity: 'XL' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Too Small', files: [{ path: 'main.ts', content: 'export {}' }] },
        usage,
        phasesRun: ['plan', 'build-1'],
        phaseTokens: { plan: 50, 'build-1': 50 },
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage, rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 4, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 4 },
          review: 'Good',
        },
        usage, rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(makeConfig(), makeModels(), 1);

      expect(mockRunCreatorPipeline.mock.calls[0][1].complexity).toBe('XL');
    });
  });

  describe('runIteration - curator deadlock override succeeds', () => {
    it('uses curator-forced proposal after ideation deadlock', async () => {
      const config = makeConfig();
      config.iteration.max_idea_retries = 1;

      mockDispatchIdeator.mockResolvedValueOnce({
        data: { ideas: [{ title: 'Rejected', domain: 'prose', pitch: 'Meh', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null }] },
        usage, rawText: '',
      });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Rejected', decision: 'reject', sharpening_notes: '', reasons: 'Boring' }] },
        usage, rawText: '',
      });

      const forcedProposal = { title: 'Forced Idea [FORCED]', domain: 'code-tool', pitch: 'Forced', complexity: 'M', why: 'Curator override', project_id: null, stimulus_ref: null };
      mockDispatchCuratorRedirect.mockResolvedValueOnce({
        data: { proposal: forcedProposal },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Forced Idea', files: [{ path: 'forced.md', content: 'forced content' }] },
        usage,
        phasesRun: ['plan', 'build-1', 'revise'],
        phaseTokens: { plan: 30, 'build-1': 40, revise: 30 },
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage, rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 3, specificity: 3, craft: 3, surprise: 3, coherence: 3, portfolio_fit: 3 },
          review: 'Acceptable',
        },
        usage, rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);

      expect(result.outcome).toBe('shipped');
    });
  });

  describe('runIteration - project bookkeeping error', () => {
    it('handles project bookkeeping failure gracefully on ship', async () => {
      const proposal = { title: 'Project Fail', domain: 'prose', pitch: 'Test', complexity: 'S', why: 'Why', project_id: 'P001', stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Project Fail', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Project Fail', files: [{ path: 'art.md', content: 'content' }] },
        usage,
        phasesRun: ['build'],
        phaseTokens: { build: 50 },
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage, rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 3, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 4 },
          review: 'Good',
        },
        usage, rawText: '',
      });

      mockLinkArtifactToProject.mockRejectedValueOnce(new Error('Project P001 not found'));

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(mockWriteArtifact).toHaveBeenCalledOnce();
    });
  });

  describe('runIteration - disk space check with 0 minimum', () => {
    it('skips disk check when disk_space_min_gb is 0', async () => {
      const config = makeConfig();
      config.loop.disk_space_min_gb = 0;
      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);
      expect(result.outcome).toBe('shipped');
    });
  });

  describe('runIteration - catastrophic test failure', () => {
    it('forwards catastrophic failure to critic', async () => {
      const proposal = { title: 'Catastrophic', domain: 'prose', pitch: 'Test', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Catastrophic', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Catastrophic', files: [{ path: 'bad.md', content: 'terrible' }] },
        usage,
        phasesRun: ['build'],
        phaseTokens: { build: 50 },
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'fail_catastrophic', summary: 'Totally broken', tests_run: [], issues: [] },
        usage, rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'kill',
          ratings: { originality: 1, specificity: 1, craft: 1, surprise: 1, coherence: 1, portfolio_fit: 1 },
          review: 'Catastrophic failure',
          kill_reason: 'Complete failure',
        },
        usage, rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('killed');
    });
  });

  describe('runIteration - curator deadlock override with non-Error throw', () => {
    it('handles non-Error thrown from curator redirect', async () => {
      const config = makeConfig();
      config.iteration.max_idea_retries = 1;

      mockDispatchIdeator.mockResolvedValueOnce({
        data: { ideas: [{ title: 'Rejected', domain: 'prose', pitch: 'Meh', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null }] },
        usage, rawText: '',
      });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Rejected', decision: 'reject', sharpening_notes: '', reasons: 'Boring' }] },
        usage, rawText: '',
      });

      mockDispatchCuratorRedirect.mockRejectedValueOnce('string error');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);

      expect(result.outcome).toBe('skipped');
      const warnOutput = warnSpy.mock.calls.map(c => c.join(' ')).join('\n');
      expect(warnOutput).toContain('string error');
      warnSpy.mockRestore();
    });
  });
});
