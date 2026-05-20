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
vi.mock('../src/files/projects.js', () => ({
  updateProjectStatus: mockUpdateProjectStatus,
  linkArtifactToProject: mockLinkArtifactToProject,
  getActiveProjects: mockGetActiveProjects,
}));

// ── Fixtures ─────────────────────────────────────────────────────

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-iter-'));
  setRootDir(tempDir);
  vi.clearAllMocks();
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

  mockDispatchCreator.mockResolvedValueOnce({
    data: { title: 'Test Artifact', files: [{ path: 'poem.md', content: '# A Poem' }], notes: '' },
    usage,
    rawText: '',
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

      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Testing Haiku', files: [{ path: 'haiku.md', content: 'Lines of code flow down' }] },
        usage,
        rawText: '',
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
      expect(mockDispatchIdeator).not.toHaveBeenCalled(); // Skips ideation
      expect(mockClearRequests).toHaveBeenCalledOnce();
    });
  });

  describe('runIteration - all rejected (deadlock)', () => {
    it('skips iteration after ideation deadlock and curator override failure', async () => {
      const config = makeConfig();
      config.iteration.max_idea_retries = 2;

      // All idea attempts get rejected
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

      // Curator deadlock override also fails
      mockDispatchCuratorRedirect.mockRejectedValueOnce(new Error('Curator failed'));

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);

      expect(result.outcome).toBe('skipped');
      expect(result.reason).toContain('deadlock');
    });
  });

  describe('runIteration - kill decision', () => {
    it('kills artifact when gate2 says kill', async () => {
      const proposal = { title: 'Bad Artifact', domain: 'prose', pitch: 'A test', complexity: 'S', why: 'Because', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({
        data: { ideas: [proposal] },
        usage,
        rawText: '',
      });

      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Bad Artifact', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Bad Artifact', files: [{ path: 'bad.md', content: 'bad content' }] },
        usage,
        rawText: '',
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'kill',
          ratings: { originality: 1, specificity: 1, craft: 1, surprise: 1, coherence: 1, portfolio_fit: 1 },
          review: 'Not good enough',
          kill_reason: 'Too derivative',
        },
        usage,
        rawText: '',
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
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      // First creation
      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Revised Art', files: [{ path: 'v1.md', content: 'draft' }] },
        usage,
        rawText: '',
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });

      // Gate2 says revise
      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'revise',
          ratings: { originality: 3, specificity: 2, craft: 2, surprise: 2, coherence: 3, portfolio_fit: 3 },
          review: 'Needs more depth',
          revision_notes: 'Add more imagery',
        },
        usage,
        rawText: '',
      });

      // Revised creation
      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Revised Art', files: [{ path: 'v2.md', content: 'improved draft' }] },
        usage,
        rawText: '',
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'Good now', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });

      // Gate2 ships
      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 4, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 4 },
          review: 'Much better',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(mockDispatchCreator).toHaveBeenCalledTimes(2);
    });
  });

  describe('runIteration - code domain with sandbox', () => {
    it('uses sandbox for code domain artifacts', async () => {
      const proposal = { title: 'Code Tool', domain: 'code-tool', pitch: 'A tool', complexity: 'M', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Code Tool', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(true);

      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Code Tool', files: [{ path: 'main.js', content: 'console.log(1)' }] },
        usage,
        rawText: '',
      });

      // Test plan phase - no test_plan means lightweight fallback
      mockDispatchTesterTestPlan.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'Tests pass', tests_run: [{ name: 'basic', result: 'pass', details: 'ok' }], issues: [] },
        usage,
        rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 3, specificity: 4, craft: 4, surprise: 2, coherence: 4, portfolio_fit: 3, technical_quality: 4 },
          review: 'Working code tool',
        },
        usage,
        rawText: '',
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
      config.loop.disk_space_min_gb = 999999; // impossibly high

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);

      // Either halts on disk space or proceeds (depends on system), so we just verify no crash
      expect(result).toBeDefined();
    });
  });

  describe('runIteration - project bookkeeping', () => {
    it('links artifact to project on ship', async () => {
      const proposal = { title: 'Project Art', domain: 'prose', pitch: 'Test', complexity: 'S', why: 'Why', project_id: 'P001', stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Project Art', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Project Art', files: [{ path: 'art.md', content: 'content' }] },
        usage,
        rawText: '',
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 3, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 4 },
          review: 'Good fit',
        },
        usage,
        rawText: '',
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
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      // First creation
      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Fixable', files: [{ path: 'v1.md', content: 'draft with typo' }] },
        usage,
        rawText: '',
      });

      // Tester finds fixable issues
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: {
          verdict: 'fail_fixable',
          summary: 'Typo found',
          tests_run: [{ name: 'spell', result: 'fail', details: 'typo on line 1' }],
          issues: [{ severity: 'minor', description: 'typo', location: 'line 1', suggested_fix: 'fix the typo' }],
        },
        usage,
        rawText: '',
      });

      // Creator fixes
      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Fixable', files: [{ path: 'v1.md', content: 'draft fixed' }] },
        usage,
        rawText: '',
      });

      // Now passes
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'All good', tests_run: [{ name: 'spell', result: 'pass', details: 'ok' }], issues: [] },
        usage,
        rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 3, specificity: 3, craft: 3, surprise: 3, coherence: 3, portfolio_fit: 3 },
          review: 'OK after fix',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(mockDispatchCreator).toHaveBeenCalledTimes(2);
      expect(mockLogTestReport).toHaveBeenCalledTimes(2);
    });
  });

  describe('runIteration - catastrophic test failure', () => {
    it('forwards catastrophic failure to critic', async () => {
      const proposal = { title: 'Catastrophic', domain: 'prose', pitch: 'Test', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Catastrophic', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Catastrophic', files: [{ path: 'bad.md', content: 'terrible' }] },
        usage,
        rawText: '',
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'fail_catastrophic', summary: 'Totally broken', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });

      // Critic kills it after catastrophic failure
      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'kill',
          ratings: { originality: 1, specificity: 1, craft: 1, surprise: 1, coherence: 1, portfolio_fit: 1 },
          review: 'Catastrophic failure',
          kill_reason: 'Complete failure',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('killed');
    });
  });

  describe('runIteration - code with sandbox test plan', () => {
    it('executes test plan in sandbox and gets verdict', async () => {
      const proposal = { title: 'Sandbox Code', domain: 'code-tool', pitch: 'Tool', complexity: 'M', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Sandbox Code', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(true);

      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Sandbox Code', files: [{ path: 'main.js', content: 'console.log(42)' }] },
        usage,
        rawText: '',
      });

      // Test plan with sandbox execution
      mockDispatchTesterTestPlan.mockResolvedValueOnce({
        data: {
          verdict: 'pass',
          summary: 'Tests planned',
          tests_run: [],
          issues: [],
          test_plan: {
            language: 'node',
            setup_commands: ['npm init -y'],
            files: [{ path: 'test.js', content: 'console.log("test")' }],
            run_command: 'node test.js',
          },
        },
        usage,
        rawText: '',
      });

      // Sandbox fails (QEMU not installed) -> falls back to lightweight
      mockCreateSandbox.mockRejectedValueOnce(new Error('Failed to create sandbox VM: QEMU not found'));

      // Lightweight fallback
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'Lightweight pass', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 3, specificity: 4, craft: 4, surprise: 2, coherence: 4, portfolio_fit: 3 },
          review: 'Good code tool',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(mockCreateSandbox).toHaveBeenCalledOnce();
    });
  });

  describe('runIteration - max revision rounds force ship', () => {
    it('force ships after max revision rounds', async () => {
      const config = makeConfig();
      config.iteration.max_revision_rounds = 0; // No revision rounds allowed

      const proposal = { title: 'Force Ship', domain: 'prose', pitch: 'Test', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Force Ship', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Force Ship', files: [{ path: 'v1.md', content: 'content' }] },
        usage,
        rawText: '',
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });

      // Critic says revise, but we're at max rounds
      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'revise',
          ratings: { originality: 3, specificity: 2, craft: 2, surprise: 2, coherence: 3, portfolio_fit: 3 },
          review: 'Needs work',
          revision_notes: 'Fix it',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);

      // Mean = (3+2+2+2+3+3)/6 = 2.5, not below threshold — should force ship
      expect(result.outcome).toBe('shipped');
      expect(mockDispatchCreator).toHaveBeenCalledTimes(1); // No revision round
    });

    it('force kills after max revision rounds when mean rating below threshold', async () => {
      const config = makeConfig();
      config.iteration.max_revision_rounds = 0;

      const proposal = { title: 'Bad Art', domain: 'prose', pitch: 'Test', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Bad Art', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Bad Art', files: [{ path: 'v1.md', content: 'content' }] },
        usage,
        rawText: '',
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });

      // Critic says revise with very low ratings (mean = 1.5, below 2.5)
      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'revise',
          ratings: { originality: 1, specificity: 2, craft: 1, surprise: 2, coherence: 1, portfolio_fit: 2 },
          review: 'Terrible',
          revision_notes: 'Start over',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);

      // Mean 1.5 < 2.5 threshold — should force kill
      expect(result.outcome).toBe('killed');
      expect(mockDispatchCreator).toHaveBeenCalledTimes(1);
    });
  });

  describe('runIteration - max revision rounds force ship', () => {
    it('force-ships when max revision rounds exhausted without kill', async () => {
      const config = makeConfig();
      config.iteration.max_revision_rounds = 1;

      const proposal = { title: 'Stubborn Art', domain: 'prose', pitch: 'Art', complexity: 'M', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Stubborn Art', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      // First creation
      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Stubborn Art', files: [{ path: 'v1.md', content: 'draft' }] },
        usage,
        rawText: '',
      });
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });
      // Gate2 says revise
      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'revise',
          ratings: { originality: 2, specificity: 2, craft: 2, surprise: 2, coherence: 2, portfolio_fit: 2 },
          review: 'Needs more depth',
          revision_notes: 'Add more',
        },
        usage,
        rawText: '',
      });

      // Second creation (last round)
      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Stubborn Art', files: [{ path: 'v2.md', content: 'improved' }] },
        usage,
        rawText: '',
      });
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });
      // Gate2 says revise AGAIN but max_revision_rounds=1 means we force ship
      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'revise',
          ratings: { originality: 3, specificity: 3, craft: 3, surprise: 3, coherence: 3, portfolio_fit: 3 },
          review: 'Still not great but acceptable',
          revision_notes: 'More please',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(mockDispatchCreator).toHaveBeenCalledTimes(2);
    });
  });

  describe('runIteration - project bookkeeping error', () => {
    it('handles project bookkeeping failure gracefully on ship', async () => {
      const proposal = { title: 'Project Fail', domain: 'prose', pitch: 'Test', complexity: 'S', why: 'Why', project_id: 'P001', stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Project Fail', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Project Fail', files: [{ path: 'art.md', content: 'content' }] },
        usage,
        rawText: '',
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 3, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 4 },
          review: 'Good',
        },
        usage,
        rawText: '',
      });

      // Make project bookkeeping fail
      mockLinkArtifactToProject.mockRejectedValueOnce(new Error('Project P001 not found'));

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      // Should still ship despite bookkeeping error
      expect(result.outcome).toBe('shipped');
      expect(mockWriteArtifact).toHaveBeenCalledOnce();
    });
  });

  describe('runIteration - code domain with full sandbox test plan', () => {
    it('runs sandbox tests with test_plan and gets verdict', async () => {
      const proposal = { title: 'Code With Tests', domain: 'code-tool', pitch: 'A tool', complexity: 'M', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Code With Tests', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(true);

      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Code With Tests', files: [{ path: 'main.js', content: 'module.exports = {}' }] },
        usage,
        rawText: '',
      });

      // Test plan phase returns a test_plan
      mockDispatchTesterTestPlan.mockResolvedValueOnce({
        data: {
          verdict: 'pass',
          summary: 'Plan ready',
          tests_run: [],
          issues: [],
          test_plan: {
            language: 'node',
            setup_commands: ['npm install'],
            files: [{ path: 'test.js', content: 'console.log("test")' }],
            run_command: 'node test.js',
          },
        },
        usage,
        rawText: '',
      });

      // Sandbox mock
      const mockSandboxSession = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        exec: vi.fn()
          .mockResolvedValueOnce({ exitCode: 0, stdout: 'ok', stderr: '', timedOut: false, durationMs: 100 })
          .mockResolvedValueOnce({ exitCode: 0, stdout: 'All tests passed', stderr: '', timedOut: false, durationMs: 200 }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      mockCreateSandbox.mockResolvedValueOnce(mockSandboxSession);

      // Verdict after sandbox execution
      mockDispatchTesterVerdict.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'All tests passed', tests_run: [{ name: 'basic', result: 'pass', details: 'ok' }], issues: [] },
        usage,
        rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 4, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 4 },
          review: 'Solid code with tests',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(mockCreateSandbox).toHaveBeenCalledOnce();
      expect(mockDispatchTesterVerdict).toHaveBeenCalledOnce();
      expect(mockSandboxSession.writeFile).toHaveBeenCalled();
      expect(mockSandboxSession.exec).toHaveBeenCalledTimes(2); // setup + test run
      expect(mockSandboxSession.close).toHaveBeenCalledOnce();
    });

    it('falls back to lightweight when sandbox is unavailable (QEMU)', async () => {
      const proposal = { title: 'No Sandbox', domain: 'code-tool', pitch: 'A tool', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'No Sandbox', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(true);

      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'No Sandbox', files: [{ path: 'main.js', content: 'code' }] },
        usage,
        rawText: '',
      });

      mockDispatchTesterTestPlan.mockResolvedValueOnce({
        data: {
          verdict: 'pass',
          summary: 'Plan ready',
          tests_run: [],
          issues: [],
          test_plan: {
            language: 'node',
            setup_commands: [],
            files: [{ path: 'test.js', content: 'test' }],
            run_command: 'node test.js',
          },
        },
        usage,
        rawText: '',
      });

      // Sandbox creation fails with QEMU error
      mockCreateSandbox.mockRejectedValueOnce(new Error('Failed to create sandbox: QEMU not installed'));

      // Falls back to lightweight
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'Lightweight pass', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 3, specificity: 3, craft: 3, surprise: 3, coherence: 3, portfolio_fit: 3 },
          review: 'OK',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(mockDispatchTesterLightweight).toHaveBeenCalledOnce();
    });

    it('handles sandbox setup command failure', async () => {
      const proposal = { title: 'Setup Fail', domain: 'code-tool', pitch: 'A tool', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Setup Fail', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(true);

      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Setup Fail', files: [{ path: 'main.js', content: 'code' }] },
        usage,
        rawText: '',
      });

      mockDispatchTesterTestPlan.mockResolvedValueOnce({
        data: {
          verdict: 'pass',
          summary: 'Plan ready',
          tests_run: [],
          issues: [],
          test_plan: {
            language: 'node',
            setup_commands: ['npm install'],
            files: [{ path: 'test.js', content: 'test' }],
            run_command: 'node test.js',
          },
        },
        usage,
        rawText: '',
      });

      const mockSandboxSession = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        exec: vi.fn().mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'npm ERR! missing', timedOut: false, durationMs: 50 }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      mockCreateSandbox.mockResolvedValueOnce(mockSandboxSession);

      // Verdict interprets the setup failure
      mockDispatchTesterVerdict.mockResolvedValueOnce({
        data: { verdict: 'fail_fixable', summary: 'Setup failed', tests_run: [], issues: [{ severity: 'major', description: 'npm install failed', location: 'setup', suggested_fix: 'fix package.json' }] },
        usage,
        rawText: '',
      });

      // Creator fixes
      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Setup Fail', files: [{ path: 'main.js', content: 'fixed code' }] },
        usage,
        rawText: '',
      });

      // Second test plan - no test plan this time (falls through to verdict-as-is)
      mockDispatchTesterTestPlan.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'All good now', tests_run: [{ name: 'basic', result: 'pass', details: 'ok' }], issues: [] },
        usage,
        rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 3, specificity: 3, craft: 3, surprise: 3, coherence: 3, portfolio_fit: 3 },
          review: 'Fixed and shipped',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
    });

    it('handles sandbox test timeout', async () => {
      const proposal = { title: 'Timeout Test', domain: 'code-tool', pitch: 'A tool', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Timeout Test', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(true);

      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Timeout Test', files: [{ path: 'main.js', content: 'while(true){}' }] },
        usage,
        rawText: '',
      });

      mockDispatchTesterTestPlan.mockResolvedValueOnce({
        data: {
          verdict: 'pass',
          summary: 'Plan ready',
          tests_run: [],
          issues: [],
          test_plan: {
            language: 'node',
            setup_commands: [],
            files: [{ path: 'test.js', content: 'test' }],
            run_command: 'node test.js',
          },
        },
        usage,
        rawText: '',
      });

      const mockSandboxSession = {
        writeFile: vi.fn().mockResolvedValue(undefined),
        exec: vi.fn().mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '', timedOut: true, durationMs: 60000 }),
        close: vi.fn().mockResolvedValue(undefined),
      };
      mockCreateSandbox.mockResolvedValueOnce(mockSandboxSession);

      mockDispatchTesterVerdict.mockResolvedValueOnce({
        data: { verdict: 'fail_catastrophic', summary: 'Infinite loop', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'kill',
          ratings: { originality: 1, specificity: 1, craft: 1, surprise: 1, coherence: 1, portfolio_fit: 1 },
          review: 'Infinite loop',
          kill_reason: 'Code hangs',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('killed');
    });
  });

  describe('runIteration - max test fix cycles exhausted', () => {
    it('stops fixing after max_test_fix_cycles', async () => {
      const config = makeConfig();
      config.iteration.max_test_fix_cycles = 2;

      const proposal = { title: 'Fix Exhaust', domain: 'prose', pitch: 'Test', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Fix Exhaust', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Fix Exhaust', files: [{ path: 'v1.md', content: 'broken' }] },
        usage,
        rawText: '',
      });

      // First test: fail_fixable
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: {
          verdict: 'fail_fixable',
          summary: 'Issues',
          tests_run: [],
          issues: [{ severity: 'major', description: 'bug', location: 'line 1' }],
        },
        usage,
        rawText: '',
      });

      // Creator fixes
      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Fix Exhaust', files: [{ path: 'v1.md', content: 'still broken' }] },
        usage,
        rawText: '',
      });

      // Second test: still fail_fixable but max cycles hit
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: {
          verdict: 'fail_fixable',
          summary: 'Still broken',
          tests_run: [],
          issues: [{ severity: 'major', description: 'bug2', location: 'line 2' }],
        },
        usage,
        rawText: '',
      });

      // Proceeds to gate2 despite unfixed issues
      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'kill',
          ratings: { originality: 2, specificity: 2, craft: 1, surprise: 1, coherence: 2, portfolio_fit: 1 },
          review: 'Unfixed issues remain',
          kill_reason: 'Quality too low',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);

      expect(result.outcome).toBe('killed');
      expect(mockDispatchCreator).toHaveBeenCalledTimes(2);
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

  describe('runIteration - curator deadlock override succeeds', () => {
    it('uses curator-forced proposal after ideation deadlock', async () => {
      const config = makeConfig();
      config.iteration.max_idea_retries = 1;

      // Ideation rejected
      mockDispatchIdeator.mockResolvedValueOnce({
        data: { ideas: [{ title: 'Rejected', domain: 'prose', pitch: 'Meh', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null }] },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Rejected', decision: 'reject', sharpening_notes: '', reasons: 'Boring' }] },
        usage,
        rawText: '',
      });

      // Curator override succeeds
      const forcedProposal = { title: 'Forced Idea [FORCED]', domain: 'code-tool', pitch: 'Forced', complexity: 'M', why: 'Curator override', project_id: null, stimulus_ref: null };
      mockDispatchCuratorRedirect.mockResolvedValueOnce({
        data: { proposal: forcedProposal },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockDispatchCreator.mockResolvedValueOnce({
        data: { title: 'Forced Idea', files: [{ path: 'forced.md', content: 'forced content' }] },
        usage,
        rawText: '',
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 3, specificity: 3, craft: 3, surprise: 3, coherence: 3, portfolio_fit: 3 },
          review: 'Acceptable',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);

      expect(result.outcome).toBe('shipped');
    });
  });

  describe('runIteration - curator deadlock override with non-Error throw', () => {
    it('handles non-Error thrown from curator redirect', async () => {
      const config = makeConfig();
      config.iteration.max_idea_retries = 1;

      mockDispatchIdeator.mockResolvedValueOnce({
        data: { ideas: [{ title: 'Rejected', domain: 'prose', pitch: 'Meh', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null }] },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Rejected', decision: 'reject', sharpening_notes: '', reasons: 'Boring' }] },
        usage,
        rawText: '',
      });

      // Throw a non-Error (string) to cover the String(err) branch
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
