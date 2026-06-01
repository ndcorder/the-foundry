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

const mockLoadStreakHistory = vi.fn();
const mockUpdateStreakState = vi.fn();
const mockSaveStreakHistory = vi.fn();
const mockLoadStokerDirective = vi.fn();
const mockClearConsumedStokerDirective = vi.fn();
const mockSaveStokerDirective = vi.fn();

vi.mock('../src/streaks/index.js', () => ({
  loadStreakHistory: mockLoadStreakHistory,
  updateStreakState: mockUpdateStreakState,
  saveStreakHistory: mockSaveStreakHistory,
}));

vi.mock('../src/stoker/index.js', () => ({
  loadStokerDirective: (...args: any[]) => mockLoadStokerDirective(...args),
  clearConsumedStokerDirective: (...args: any[]) => mockClearConsumedStokerDirective(...args),
  saveStokerDirective: (...args: any[]) => mockSaveStokerDirective(...args),
}));

const mockBuildSpeculativeIdeas = vi.fn().mockReturnValue([]);
const mockSaveSpeculativeIdeas = vi.fn().mockResolvedValue(undefined);
const mockClearSpeculativeIdeas = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/speculative/index.js', () => ({
  buildSpeculativeIdeas: (...args: any[]) => mockBuildSpeculativeIdeas(...args),
  saveSpeculativeIdeas: (...args: any[]) => mockSaveSpeculativeIdeas(...args),
  clearSpeculativeIdeas: (...args: any[]) => mockClearSpeculativeIdeas(...args),
}));

const mockSelectRefineryTargets = vi.fn();
const mockDispatchRefinery = vi.fn();

vi.mock('../src/refinery/index.js', () => ({
  selectRefineryTargets: (...args: any[]) => mockSelectRefineryTargets(...args),
  dispatchRefinery: (...args: any[]) => mockDispatchRefinery(...args),
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
const mockLogRefinery = vi.fn().mockResolvedValue(undefined);
const mockLogEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/logging/index.js', () => ({
  logIteration: mockLogIteration,
  logTestReport: mockLogTestReport,
  logRefinery: mockLogRefinery,
  logEvent: mockLogEvent,
}));

const mockCreateSandbox = vi.fn();
vi.mock('../src/sandbox/index.js', () => ({
  createSandbox: mockCreateSandbox,
}));

const mockUpdateProjectStatus = vi.fn().mockResolvedValue(undefined);
const mockLinkArtifactToProject = vi.fn().mockResolvedValue(undefined);
const mockGetActiveProjects = vi.fn().mockResolvedValue([]);
const mockCountActiveProjects = vi.fn().mockResolvedValue(0);
const mockCreateProject = vi.fn().mockResolvedValue('P001');
vi.mock('../src/files/projects.js', () => ({
  updateProjectStatus: mockUpdateProjectStatus,
  linkArtifactToProject: mockLinkArtifactToProject,
  getActiveProjects: mockGetActiveProjects,
  countActiveProjects: mockCountActiveProjects,
  createProject: mockCreateProject,
}));

const mockBuildLineageGraph = vi.fn().mockResolvedValue({ edges: [], constellations: [] });
const mockSaveLineageGraph = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/lineage/index.js', () => ({
  buildLineageGraph: mockBuildLineageGraph,
  saveLineageGraph: mockSaveLineageGraph,
}));

// ── Fixtures ─────────────────────────────────────────────────────

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-iter-'));
  setRootDir(tempDir);
  vi.clearAllMocks();
  const emptyStreakHistory = {
    current: null,
    recent_breaks: [],
    cooldown_domains: [],
    cooldown_remaining: 0,
  };
  mockLoadStreakHistory.mockResolvedValue(emptyStreakHistory);
  mockUpdateStreakState.mockReturnValue(emptyStreakHistory);
  mockSaveStreakHistory.mockResolvedValue(undefined);
  mockLoadStokerDirective.mockReset();
  mockLoadStokerDirective.mockResolvedValue(null);
  mockClearConsumedStokerDirective.mockReset();
  mockClearConsumedStokerDirective.mockResolvedValue(undefined);
  mockSaveStokerDirective.mockReset();
  mockSaveStokerDirective.mockResolvedValue(undefined);
  mockSelectRefineryTargets.mockReset();
  mockSelectRefineryTargets.mockResolvedValue([]);
  mockDispatchRefinery.mockReset();
  mockBuildSpeculativeIdeas.mockReset();
  mockBuildSpeculativeIdeas.mockReturnValue([]);
  mockSaveSpeculativeIdeas.mockReset();
  mockSaveSpeculativeIdeas.mockResolvedValue(undefined);
  mockClearSpeculativeIdeas.mockReset();
  mockClearSpeculativeIdeas.mockResolvedValue(undefined);
  mockGetNextArtifactId.mockReset();
  mockGetNextArtifactId.mockResolvedValue('0001');
  mockLogRefinery.mockReset();
  mockLogRefinery.mockResolvedValue(undefined);
  mockLogEvent.mockReset();
  mockLogEvent.mockResolvedValue(undefined);
  mockBuildLineageGraph.mockReset();
  mockBuildLineageGraph.mockResolvedValue({ edges: [], constellations: [] });
  mockSaveLineageGraph.mockReset();
  mockSaveLineageGraph.mockResolvedValue(undefined);
  mockCountActiveProjects.mockReset();
  mockCountActiveProjects.mockResolvedValue(0);
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
      expect(result.source).toBe('ideator');
      expect(mockWriteArtifact).toHaveBeenCalledOnce();
      expect(mockUpdatePortfolioIndex).toHaveBeenCalledOnce();
      expect(mockLogIteration).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'shipped',
        source: 'ideator',
      }));
      expect(mockClearConsumedStokerDirective).toHaveBeenCalledWith(1);
    });

    it('writes start-runtime lifecycle events around post-ship lineage rebuild', async () => {
      setupHappyPath();
      mockBuildLineageGraph.mockResolvedValueOnce({
        edges: [{ from: '0001', to: '0002', type: 'inspired_by' }],
        constellations: [{ name: 'Test Cluster', artifacts: ['0001', '0002'] }],
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_lineage_rebuild_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'lineage_rebuild',
          outcome: 'shipped',
          artifact_id: '0001',
          title: 'Test Artifact',
          domain: 'prose',
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_lineage_rebuild_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'lineage_rebuild',
          result: 'saved',
          artifact_id: '0001',
          edges: 1,
          constellations: 1,
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes start-runtime lifecycle events around Phase 0 precheck', async () => {
      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_precheck_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'precheck',
          stop_file: 'STOP',
          disk_min_gb: 1,
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_precheck_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'precheck',
          result: 'continue',
          stop_file_detected: false,
          disk_space_ok: true,
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes start-runtime lifecycle events around an empty request-file poll', async () => {
      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_request_poll_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'request_poll',
          request_file: 'requests.md',
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_request_poll_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'request_poll',
          result: 'empty',
          request_pending: false,
          request_length: 0,
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes start-runtime lifecycle events around an empty Stoker directive load', async () => {
      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(makeConfig(), makeModels(), 1, 3, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 4,
          startIteration: 1,
        },
      });

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_stoker_directive_load_start',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 4,
          start_iteration: 1,
          iteration: 1,
          slot: 3,
          stage: 'stoker_directive_load',
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_stoker_directive_load_complete',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 4,
          start_iteration: 1,
          iteration: 1,
          slot: 3,
          stage: 'stoker_directive_load',
          result: 'empty',
          directive_present: false,
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes a start-runtime lifecycle failure event when Stoker directive loading fails', async () => {
      mockLoadStokerDirective.mockRejectedValueOnce(new Error('directive file unreadable'));
      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1, 3, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 4,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('shipped');
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_stoker_directive_load_failed',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 4,
          start_iteration: 1,
          iteration: 1,
          slot: 3,
          stage: 'stoker_directive_load',
          result: 'failed',
          detail: 'directive file unreadable',
          duration_ms: expect.any(Number),
        }),
      }));
      expect(mockDispatchIdeator).toHaveBeenCalledOnce();
    });

    it('clears stale Stoker directives before Phase 0 precheck work', async () => {
      mockLoadStokerDirective.mockResolvedValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 0,
        for_iteration: 0,
        urgency: 'low',
        streak_instruction: 'neutral',
        refinery_queue: 1,
        rules_fired: ['refinery_fuel'],
      });
      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(makeConfig(), makeModels(), 1, 3, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 4,
          startIteration: 1,
        },
      });

      expect(mockClearConsumedStokerDirective).toHaveBeenCalledWith(1);
      expect(mockClearConsumedStokerDirective.mock.invocationCallOrder[0]).toBeLessThan(
        mockCheckStopFile.mock.invocationCallOrder[0],
      );
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_stoker_directive_stale_cleared',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 4,
          start_iteration: 1,
          iteration: 1,
          slot: 3,
          stage: 'stoker_directive_stale_cleanup',
          result: 'cleared',
          directive_for_iteration: 0,
          current_iteration: 1,
          urgency: 'low',
          rules_fired: ['refinery_fuel'],
          refinery_queue: 1,
          duration_ms: expect.any(Number),
        }),
      }));
      expect(mockLogIteration).toHaveBeenCalledWith(expect.objectContaining({
        stoker_directive_applied: false,
      }));
    });

    it('writes start-runtime lifecycle events around the Creator phase', async () => {
      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_creator_phase_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'creation',
          revision_round: 0,
          title: 'Test Artifact',
          domain: 'prose',
          complexity: 'S',
          project_id: null,
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_creator_phase_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'creation',
          revision_round: 0,
          title: 'Test Artifact',
          domain: 'prose',
          complexity: 'S',
          artifact_title: 'Test Artifact',
          file_count: 1,
          phases_run: ['build'],
          phase_tokens: { build: 50 },
          token_usage: { input: 100, output: 50 },
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes a start-runtime lifecycle failure event when the Creator phase throws', async () => {
      const proposal = { title: 'Exploding Artifact', domain: 'prose', pitch: 'A test', complexity: 'S' as const, why: 'Because', project_id: null, stimulus_ref: null };
      mockDispatchIdeator.mockResolvedValueOnce({
        data: { ideas: [proposal] },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Exploding Artifact', decision: 'approve', sharpening_notes: 'Build it', reasons: '' }] },
        usage,
        rawText: '',
      });
      mockRunCreatorPipeline.mockRejectedValueOnce(new Error('creator went boom'));

      const { runIteration } = await import('../src/iteration/runner.js');
      await expect(runIteration(makeConfig(), makeModels(), 1, 2, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 3,
          startIteration: 1,
        },
      })).rejects.toThrow('creator went boom');

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_creator_phase_failed',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 2,
          stage: 'creation',
          revision_round: 0,
          title: 'Exploding Artifact',
          domain: 'prose',
          complexity: 'S',
          detail: 'creator went boom',
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes start-runtime lifecycle events around the lightweight Tester phase', async () => {
      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_tester_phase_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'testing',
          tester_mode: 'lightweight',
          revision_round: 0,
          test_fix_cycle: 0,
          title: 'Test Artifact',
          domain: 'prose',
          complexity: 'S',
          artifact_title: 'Test Artifact',
          file_count: 1,
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_tester_phase_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'testing',
          tester_mode: 'lightweight',
          revision_round: 0,
          test_fix_cycle: 0,
          verdict: 'pass',
          summary_preview: 'Looks good',
          tests_run_count: 0,
          issues_count: 0,
          token_usage: { input: 100, output: 50 },
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes a start-runtime lifecycle failure event when the Tester phase throws', async () => {
      const proposal = { title: 'Fragile Artifact', domain: 'prose', pitch: 'A test', complexity: 'S' as const, why: 'Because', project_id: null, stimulus_ref: null };
      mockDispatchIdeator.mockResolvedValueOnce({
        data: { ideas: [proposal] },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Fragile Artifact', decision: 'approve', sharpening_notes: 'Build it', reasons: '' }] },
        usage,
        rawText: '',
      });
      mockIsCodeDomain.mockReturnValue(false);
      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Fragile Artifact', files: [{ path: 'fragile.md', content: 'snap' }] },
        usage,
        phasesRun: ['build'],
        phaseTokens: { build: 50 },
      });
      mockDispatchTesterLightweight.mockRejectedValueOnce(new Error('tester went boom'));

      const { runIteration } = await import('../src/iteration/runner.js');
      await expect(runIteration(makeConfig(), makeModels(), 1, 2, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 3,
          startIteration: 1,
        },
      })).rejects.toThrow('tester went boom');

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_tester_phase_failed',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 2,
          stage: 'testing',
          tester_mode: 'lightweight',
          revision_round: 0,
          test_fix_cycle: 0,
          title: 'Fragile Artifact',
          domain: 'prose',
          complexity: 'S',
          artifact_title: 'Fragile Artifact',
          file_count: 1,
          detail: 'tester went boom',
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes start-runtime lifecycle events around the artifact gate', async () => {
      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_artifact_gate_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'artifact_gate',
          revision_round: 0,
          test_fix_cycles: 0,
          title: 'Test Artifact',
          domain: 'prose',
          complexity: 'S',
          artifact_title: 'Test Artifact',
          file_count: 1,
          tester_verdict: 'pass',
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_artifact_gate_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'artifact_gate',
          decision: 'ship',
          mean_rating: '3.7',
          ship_threshold_met: true,
          review_preview: 'Well crafted piece',
          token_usage: { input: 100, output: 50 },
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes start-runtime lifecycle events around Ideator proposal generation', async () => {
      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_ideation_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'ideation',
          attempt: 1,
          max_attempts: 3,
          retry: false,
          burst_count: 1,
          stoker_directive_applied: false,
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_ideation_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'ideation',
          attempt: 1,
          result: 'proposed',
          ideas_count: 1,
          successful_bursts: 1,
          failed_bursts: 0,
          token_usage: { input: 100, output: 50 },
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes start-runtime lifecycle events around the Idea Gate', async () => {
      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_idea_gate_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'idea_gate',
          source: 'ideator',
          attempt: 1,
          ideas_count: 1,
          idea_titles: ['Test Artifact'],
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_idea_gate_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'idea_gate',
          source: 'ideator',
          result: 'approved',
          approved_count: 1,
          rejected_count: 0,
          revise_count: 0,
          selected_title: 'Test Artifact',
          token_usage: { input: 100, output: 50 },
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes a start-runtime lifecycle failure event when the Idea Gate throws', async () => {
      const proposal = { title: 'Gate One Fragile', domain: 'prose', pitch: 'A test', complexity: 'S' as const, why: 'Because', project_id: null, stimulus_ref: null };
      mockDispatchIdeator.mockResolvedValueOnce({
        data: { ideas: [proposal] },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate1.mockRejectedValueOnce(new Error('gate one went boom'));

      const { runIteration } = await import('../src/iteration/runner.js');
      await expect(runIteration(makeConfig(), makeModels(), 1, 2, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 3,
          startIteration: 1,
        },
      })).rejects.toThrow('gate one went boom');

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_idea_gate_failed',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 2,
          stage: 'idea_gate',
          source: 'ideator',
          attempt: 1,
          ideas_count: 1,
          idea_titles: ['Gate One Fragile'],
          detail: 'gate one went boom',
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes start-runtime lifecycle events around workspace staging', async () => {
      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_workspace_stage_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'workspace_stage',
          stage_reason: 'creation',
          revision_round: 0,
          title: 'Test Artifact',
          artifact_title: 'Test Artifact',
          file_count: 1,
          file_paths: ['poem.md'],
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_workspace_stage_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'workspace_stage',
          stage_reason: 'creation',
          revision_round: 0,
          file_count: 1,
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes a start-runtime lifecycle failure event when workspace staging throws', async () => {
      const proposal = { title: 'Unstageable', domain: 'prose', pitch: 'A test', complexity: 'S' as const, why: 'Because', project_id: null, stimulus_ref: null };
      mockDispatchIdeator.mockResolvedValueOnce({
        data: { ideas: [proposal] },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Unstageable', decision: 'approve', sharpening_notes: 'Build it', reasons: '' }] },
        usage,
        rawText: '',
      });
      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Unstageable', files: [{ path: 'bad.md', content: 'content' }] },
        usage,
        phasesRun: ['build'],
        phaseTokens: { build: 50 },
      });
      mockWriteWorkspaceFile.mockRejectedValueOnce(new Error('workspace write failed'));

      const { runIteration } = await import('../src/iteration/runner.js');
      await expect(runIteration(makeConfig(), makeModels(), 1, 2, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 3,
          startIteration: 1,
        },
      })).rejects.toThrow('workspace write failed');

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_workspace_stage_failed',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 2,
          stage: 'workspace_stage',
          stage_reason: 'creation',
          revision_round: 0,
          title: 'Unstageable',
          artifact_title: 'Unstageable',
          file_count: 1,
          file_paths: ['bad.md'],
          detail: 'workspace write failed',
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes start-runtime lifecycle events around shipped artifact bookkeeping', async () => {
      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_bookkeeping_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'bookkeeping',
          outcome: 'shipped',
          title: 'Test Artifact',
          domain: 'prose',
          complexity: 'S',
          artifact_title: 'Test Artifact',
          file_count: 1,
          gate_decision: 'ship',
          tester_verdict: 'pass',
          token_usage: { input: 500, output: 250 },
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_bookkeeping_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'bookkeeping',
          outcome: 'shipped',
          artifact_id: '0001',
          mean_rating: '3.7',
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes a start-runtime lifecycle failure event when bookkeeping throws', async () => {
      setupHappyPath();
      mockWriteArtifact.mockRejectedValueOnce(new Error('portfolio write failed'));

      const { runIteration } = await import('../src/iteration/runner.js');
      await expect(runIteration(makeConfig(), makeModels(), 1, 2, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 3,
          startIteration: 1,
        },
      })).rejects.toThrow('portfolio write failed');

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_bookkeeping_failed',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 2,
          stage: 'bookkeeping',
          outcome: 'shipped',
          title: 'Test Artifact',
          domain: 'prose',
          complexity: 'S',
          artifact_title: 'Test Artifact',
          file_count: 1,
          gate_decision: 'ship',
          tester_verdict: 'pass',
          artifact_id: '0001',
          detail: 'portfolio write failed',
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes a start-runtime lifecycle failure event when the artifact gate throws', async () => {
      const proposal = { title: 'Gate Fragile', domain: 'prose', pitch: 'A test', complexity: 'S' as const, why: 'Because', project_id: null, stimulus_ref: null };
      mockDispatchIdeator.mockResolvedValueOnce({
        data: { ideas: [proposal] },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Gate Fragile', decision: 'approve', sharpening_notes: 'Build it', reasons: '' }] },
        usage,
        rawText: '',
      });
      mockIsCodeDomain.mockReturnValue(false);
      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Gate Fragile', files: [{ path: 'gate.md', content: 'draft' }] },
        usage,
        phasesRun: ['build'],
        phaseTokens: { build: 50 },
      });
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate2.mockRejectedValueOnce(new Error('gate went boom'));

      const { runIteration } = await import('../src/iteration/runner.js');
      await expect(runIteration(makeConfig(), makeModels(), 1, 2, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 3,
          startIteration: 1,
        },
      })).rejects.toThrow('gate went boom');

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_artifact_gate_failed',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 2,
          stage: 'artifact_gate',
          revision_round: 0,
          test_fix_cycles: 0,
          title: 'Gate Fragile',
          domain: 'prose',
          complexity: 'S',
          artifact_title: 'Gate Fragile',
          file_count: 1,
          tester_verdict: 'pass',
          detail: 'gate went boom',
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('persists streak state for shipped artifacts', async () => {
      setupHappyPath();
      const savedHistory = {
        current: {
          active: true,
          length: 1,
          domain: 'prose',
          avg_rating: 3.7,
          start_iteration: 1,
          last_iteration: 1,
          artifact_ids: ['0001'],
          project_id: null,
        },
        recent_breaks: [],
        cooldown_domains: [],
        cooldown_remaining: 0,
      };
      mockUpdateStreakState.mockReturnValueOnce(savedHistory);

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.mean_rating).toBe('3.7');
      expect(mockLoadStreakHistory).toHaveBeenCalledOnce();
      expect(mockUpdateStreakState).toHaveBeenCalledWith(
        expect.objectContaining({ current: null }),
        expect.objectContaining({
          iteration: 1,
          outcome: 'shipped',
          artifact_id: '0001',
          title: 'Test Artifact',
          domain: 'prose',
          mean_rating: '3.7',
          project_id: null,
        }),
        undefined,
      );
      expect(mockSaveStreakHistory).toHaveBeenCalledWith(savedHistory);
    });

    it('logs applied Stoker directive metadata and resulting streak state', async () => {
      const savedHistory = {
        current: {
          active: true,
          length: 1,
          domain: 'prose',
          avg_rating: 3.7,
          start_iteration: 1,
          last_iteration: 1,
          artifact_ids: ['0001'],
          project_id: null,
        },
        recent_breaks: [],
        cooldown_domains: [],
        cooldown_remaining: 0,
      };
      mockLoadStokerDirective.mockResolvedValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 0,
        for_iteration: 1,
        urgency: 'high',
        streak_instruction: 'neutral',
        ideator_hint: 'Take a sharper risk.',
        rules_fired: ['running_cold', 'complexity_bias'],
      });
      mockUpdateStreakState.mockReturnValueOnce(savedHistory);
      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(mockLogIteration).toHaveBeenCalledWith(expect.objectContaining({
        stoker_directive_applied: true,
        stoker_directive_rules: ['running_cold', 'complexity_bias'],
        stoker_directive_urgency: 'high',
        streak_state: savedHistory,
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_stoker_directive_load_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'stoker_directive_load',
          result: 'loaded',
          directive_present: true,
          for_iteration: 1,
          urgency: 'high',
          rules_fired: ['running_cold', 'complexity_bias'],
          refinery_queue: 0,
          duration_ms: expect.any(Number),
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_stoker_directive_consumed_cleared',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'stoker_directive_consumed_cleanup',
          result: 'cleared',
          directive_for_iteration: 1,
          urgency: 'high',
          rules_fired: ['running_cold', 'complexity_bias'],
          refinery_queue: 0,
          duration_ms: expect.any(Number),
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_streak_update_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'streak_update',
          result: 'saved',
          outcome: 'shipped',
          domain: 'prose',
          title: 'Test Artifact',
          streak_current_domain: 'prose',
          streak_current_length: 1,
          cooldown_remaining: 0,
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('clears consumed speculative ideas only after the Ideator has had access to them and logs lifecycle cleanup', async () => {
      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(mockClearSpeculativeIdeas).toHaveBeenCalledOnce();
      expect(mockDispatchIdeator).toHaveBeenCalledOnce();
      expect(mockClearSpeculativeIdeas.mock.invocationCallOrder[0]).toBeGreaterThan(
        mockDispatchIdeator.mock.invocationCallOrder[0],
      );
      expect(mockClearSpeculativeIdeas.mock.invocationCallOrder[0]).toBeLessThan(
        mockDispatchCriticGate1.mock.invocationCallOrder[0],
      );
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_speculative_cleanup_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'speculative_cleanup',
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_speculative_cleanup_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'speculative_cleanup',
          result: 'cleared',
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('persists salvageable unselected Gate 1 ideas and logs the carried count', async () => {
      const selected = { title: 'Selected', domain: 'prose', pitch: 'Selected pitch', complexity: 'S' as const, why: 'Best', project_id: null, stimulus_ref: null };
      const spare = { title: 'Spare', domain: 'poetry', pitch: 'Spare pitch', complexity: 'M' as const, why: 'Still useful', project_id: null, stimulus_ref: null };
      mockDispatchIdeator.mockResolvedValueOnce({
        data: { ideas: [selected, spare] },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: {
          selected: 'Selected',
          evaluations: [
            { title: 'Selected', decision: 'approve', sharpening_notes: 'Build it', reasons: 'Best option.' },
            { title: 'Spare', decision: 'revise', sharpening_notes: 'Make it weirder', reasons: 'Good kernel.' },
          ],
        },
        usage,
        rawText: '',
      });
      const carried = [{
        proposal: spare,
        critic_evaluation: { decision: 'revise', reasons: 'Good kernel.', sharpening_notes: 'Make it weirder' },
        iteration: 1,
        salvageable: true,
      }];
      mockBuildSpeculativeIdeas.mockReturnValueOnce(carried);
      mockIsCodeDomain.mockReturnValue(false);
      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Selected', files: [{ path: 'poem.md', content: '# A Poem' }], notes: '' },
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

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(mockBuildSpeculativeIdeas).toHaveBeenCalledWith(
        [selected, spare],
        expect.arrayContaining([
          expect.objectContaining({ title: 'Selected' }),
          expect.objectContaining({ title: 'Spare' }),
        ]),
        'Selected',
        1,
        undefined,
      );
      expect(mockSaveSpeculativeIdeas).toHaveBeenCalledWith(carried);
      expect(mockLogIteration).toHaveBeenCalledWith(expect.objectContaining({
        speculative_ideas_carried: 1,
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_speculative_carry_forward_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'speculative_carry_forward',
          chosen_title: 'Selected',
          ideas_count: 2,
          evaluations_count: 2,
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_speculative_carry_forward_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'speculative_carry_forward',
          result: 'saved',
          chosen_title: 'Selected',
          carried_count: 1,
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('runs a Stoker-queued refinery job before normal ideation', async () => {
      const config = makeConfig();
      config.refinery = { enabled: true, min_iterations_between_runs: 5, max_refinery_queue: 1 };
      const target = {
        source_type: 'dream' as const,
        source_id: '0007',
        source_title: 'Clock Complaint Ledger',
        source_domain: 'prose',
        resurrection_hint: 'Make the complaints escalate.',
        original_content: 'Pitch: A clock complains about time.',
        refinement_type: 'resurrected' as const,
      };
      mockLoadStokerDirective.mockResolvedValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 0,
        for_iteration: 1,
        urgency: 'normal',
        streak_instruction: 'neutral',
        refinery_queue: 1,
        rules_fired: ['refinery_fuel'],
      });
      mockSelectRefineryTargets.mockResolvedValueOnce([target]);
      mockDispatchRefinery.mockResolvedValueOnce({
        artifact: {
          title: 'Clock Complaint Ledger Reforged',
          files: [{ path: 'README.md', content: '# Reforged clock' }],
          notes: 'Refined from a killed dream.',
        },
        usage: { input: 20, output: 10 },
        rawText: '',
      });
      mockGetNextArtifactId
        .mockResolvedValueOnce('0001')
        .mockResolvedValueOnce('0002');

      setupHappyPath();
      mockDispatchTesterLightweight.mockReset();
      mockDispatchTesterLightweight
        .mockResolvedValueOnce({
          data: { verdict: 'pass', summary: 'Refinery artifact is complete', tests_run: [], issues: [] },
          usage: { input: 5, output: 2 },
          rawText: '',
        })
        .mockResolvedValueOnce({
          data: { verdict: 'pass', summary: 'Main artifact looks good', tests_run: [], issues: [] },
          usage,
          rawText: '',
        });
      mockDispatchCriticGate2.mockReset();
      mockDispatchCriticGate2
        .mockResolvedValueOnce({
          data: {
            decision: 'ship',
            ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
            review: 'The second pass has a sharper shape.',
          },
          usage: { input: 7, output: 3 },
          rawText: '',
        })
        .mockResolvedValueOnce({
          data: {
            decision: 'ship',
            ratings: { originality: 4, specificity: 3.5, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 3.5 },
            review: 'Well crafted piece',
          },
          usage,
          rawText: '',
        });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);

      expect(mockSelectRefineryTargets).toHaveBeenCalledWith(1, config.refinery);
      expect(mockDispatchRefinery).toHaveBeenCalledWith(config, expect.anything(), 1, target);
      expect(mockDispatchRefinery.mock.invocationCallOrder[0]).toBeLessThan(
        mockDispatchIdeator.mock.invocationCallOrder[0],
      );
      expect(mockDispatchTesterLightweight.mock.calls[0][3]).toMatchObject({
        title: 'Clock Complaint Ledger [refined]',
        domain: 'prose',
        stimulus_ref: 'refinery:dream:0007',
      });
      expect(mockWriteArtifact).toHaveBeenNthCalledWith(1, expect.objectContaining({
        id: '0001',
        title: 'Clock Complaint Ledger Reforged [refined]',
        domain: 'prose',
        refinery: expect.objectContaining({
          source_type: 'dream',
          source_id: '0007',
          source_title: 'Clock Complaint Ledger',
          refinement_type: 'resurrected',
        }),
      }));
      expect(mockUpdatePortfolioIndex).toHaveBeenNthCalledWith(
        1,
        '0001',
        'Clock Complaint Ledger Reforged [refined]',
        'prose',
        '4.0',
        undefined,
        expect.objectContaining({ refined_from: '0007' }),
      );
      expect(mockLogRefinery).toHaveBeenCalledWith(expect.objectContaining({
        iteration: 1,
        source_type: 'dream',
        source_id: '0007',
        refinement_type: 'resurrected',
        result: 'shipped',
        artifact_id: '0001',
        token_usage: { input: 32, output: 15 },
      }));
      expect(result.artifact_id).toBe('0002');
      expect(result.token_usage).toEqual({ input: 532, output: 265 });
    });

    it('writes start-runtime lifecycle events for shipped Stoker-queued refinery jobs', async () => {
      const config = makeConfig();
      config.refinery = { enabled: true, min_iterations_between_runs: 5, max_refinery_queue: 1 };
      const target = {
        source_type: 'dream' as const,
        source_id: '0007',
        source_title: 'Clock Complaint Ledger',
        source_domain: 'prose',
        resurrection_hint: 'Make the complaints escalate.',
        original_content: 'Pitch: A clock complains about time.',
        refinement_type: 'resurrected' as const,
      };
      mockLoadStokerDirective.mockResolvedValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 0,
        for_iteration: 1,
        urgency: 'normal',
        streak_instruction: 'neutral',
        refinery_queue: 1,
        rules_fired: ['refinery_fuel'],
      });
      mockSelectRefineryTargets.mockResolvedValueOnce([target]);
      mockDispatchRefinery.mockResolvedValueOnce({
        artifact: {
          title: 'Clock Complaint Ledger Reforged',
          files: [{ path: 'README.md', content: '# Reforged clock' }],
          notes: 'Refined from a killed dream.',
        },
        usage: { input: 20, output: 10 },
        rawText: '',
      });
      mockGetNextArtifactId
        .mockResolvedValueOnce('0001')
        .mockResolvedValueOnce('0002');

      setupHappyPath();
      mockDispatchTesterLightweight.mockReset();
      mockDispatchTesterLightweight
        .mockResolvedValueOnce({
          data: { verdict: 'pass', summary: 'Refinery artifact is complete', tests_run: [], issues: [] },
          usage: { input: 5, output: 2 },
          rawText: '',
        })
        .mockResolvedValueOnce({
          data: { verdict: 'pass', summary: 'Main artifact looks good', tests_run: [], issues: [] },
          usage,
          rawText: '',
        });
      mockDispatchCriticGate2.mockReset();
      mockDispatchCriticGate2
        .mockResolvedValueOnce({
          data: {
            decision: 'ship',
            ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
            review: 'The second pass has a sharper shape.',
          },
          usage: { input: 7, output: 3 },
          rawText: '',
        })
        .mockResolvedValueOnce({
          data: {
            decision: 'ship',
            ratings: { originality: 4, specificity: 3.5, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 3.5 },
            review: 'Well crafted piece',
          },
          usage,
          rawText: '',
        });

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(config, makeModels(), 1, 2, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 3,
          startIteration: 1,
        },
      });

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_refinery_start',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 2,
          queue_index: 1,
          queued_jobs: 1,
          source_type: 'dream',
          source_id: '0007',
          source_title: 'Clock Complaint Ledger',
          source_domain: 'prose',
          refinement_type: 'resurrected',
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_refinery_complete',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 2,
          queue_index: 1,
          queued_jobs: 1,
          source_type: 'dream',
          source_id: '0007',
          source_title: 'Clock Complaint Ledger',
          source_domain: 'prose',
          refinement_type: 'resurrected',
          result: 'shipped',
          artifact_id: '0001',
          title: 'Clock Complaint Ledger Reforged [refined]',
          mean_rating: '4.0',
          token_usage: { input: 32, output: 15 },
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes dream-capture lifecycle events for killed Stoker-queued refinery jobs', async () => {
      const config = makeConfig();
      config.refinery = { enabled: true, min_iterations_between_runs: 5, max_refinery_queue: 1 };
      const target = {
        source_type: 'dream' as const,
        source_id: '0007',
        source_title: 'Clock Complaint Ledger',
        source_domain: 'prose',
        resurrection_hint: 'Make the complaints escalate.',
        original_content: 'Pitch: A clock complains about time.',
        refinement_type: 'resurrected' as const,
      };
      mockLoadStokerDirective.mockResolvedValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 0,
        for_iteration: 1,
        urgency: 'normal',
        streak_instruction: 'neutral',
        refinery_queue: 1,
        rules_fired: ['refinery_fuel'],
      });
      mockSelectRefineryTargets.mockResolvedValueOnce([target]);
      mockDispatchRefinery.mockResolvedValueOnce({
        artifact: {
          title: 'Clock Complaint Ledger Reforged',
          files: [{ path: 'README.md', content: '# Reforged clock' }],
          notes: 'Refined from a killed dream.',
        },
        usage: { input: 20, output: 10 },
        rawText: '',
      });
      mockGetNextArtifactId
        .mockResolvedValueOnce('0001')
        .mockResolvedValueOnce('0002');

      setupHappyPath();
      mockDispatchTesterLightweight.mockReset();
      mockDispatchTesterLightweight
        .mockResolvedValueOnce({
          data: { verdict: 'pass', summary: 'Refinery artifact is coherent but thin', tests_run: [], issues: [] },
          usage: { input: 5, output: 2 },
          rawText: '',
        })
        .mockResolvedValueOnce({
          data: { verdict: 'pass', summary: 'Main artifact looks good', tests_run: [], issues: [] },
          usage,
          rawText: '',
        });
      mockDispatchCriticGate2.mockReset();
      mockDispatchCriticGate2
        .mockResolvedValueOnce({
          data: {
            decision: 'kill',
            ratings: { originality: 2, specificity: 2, craft: 2, surprise: 2, coherence: 2, portfolio_fit: 2 },
            review: 'The concept is still promising, but the execution is too generic.',
            kill_reason: 'Still too generic',
          },
          usage: { input: 7, output: 3 },
          rawText: '',
        })
        .mockResolvedValueOnce({
          data: {
            decision: 'ship',
            ratings: { originality: 4, specificity: 3.5, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 3.5 },
            review: 'Well crafted piece',
          },
          usage,
          rawText: '',
        });

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(config, makeModels(), 1, 2, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 3,
          startIteration: 1,
        },
      });

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_dream_capture_start',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 2,
          stage: 'dream_capture',
          source: 'refinery',
          outcome: 'killed',
          artifact_id: '0001',
          title: 'Clock Complaint Ledger Reforged [refined]',
          domain: 'prose',
          source_type: 'dream',
          source_id: '0007',
          source_title: 'Clock Complaint Ledger',
          kill_reason_preview: 'Still too generic',
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_dream_capture_complete',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 2,
          stage: 'dream_capture',
          source: 'refinery',
          result: 'recorded',
          artifact_id: '0001',
          title: 'Clock Complaint Ledger Reforged [refined]',
          resurrection_hint_preview: expect.any(String),
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes start-runtime lifecycle failure events for skipped Stoker-queued refinery jobs', async () => {
      const config = makeConfig();
      config.refinery = { enabled: true, min_iterations_between_runs: 5, max_refinery_queue: 1 };
      const target = {
        source_type: 'companion' as const,
        source_id: '0012',
        source_title: 'Sharp Little Tool',
        source_domain: 'code-tool',
        resurrection_hint: 'Build the obvious companion utility.',
        original_content: 'A small but promising artifact.',
        refinement_type: 'companion' as const,
        original_rating: 4.2,
      };
      mockLoadStokerDirective.mockResolvedValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 0,
        for_iteration: 1,
        urgency: 'normal',
        streak_instruction: 'neutral',
        refinery_queue: 1,
        rules_fired: ['refinery_fuel'],
      });
      mockSelectRefineryTargets.mockResolvedValueOnce([target]);
      mockDispatchRefinery.mockRejectedValueOnce(new Error('creator parse failed'));

      setupHappyPath();

      const { runIteration } = await import('../src/iteration/runner.js');
      await runIteration(config, makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(mockLogRefinery).toHaveBeenCalledWith(expect.objectContaining({
        iteration: 1,
        source_type: 'companion',
        source_id: '0012',
        source_domain: 'code-tool',
        refinement_type: 'companion',
        result: 'skipped',
        reason: 'creator parse failed',
        token_usage: { input: 0, output: 0 },
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_refinery_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          queue_index: 1,
          queued_jobs: 1,
          source_type: 'companion',
          source_id: '0012',
          source_title: 'Sharp Little Tool',
          source_domain: 'code-tool',
          refinement_type: 'companion',
          original_rating: 4.2,
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_refinery_failed',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          queue_index: 1,
          queued_jobs: 1,
          source_type: 'companion',
          source_id: '0012',
          source_title: 'Sharp Little Tool',
          source_domain: 'code-tool',
          refinement_type: 'companion',
          original_rating: 4.2,
          result: 'skipped',
          reason: 'creator parse failed',
          detail: 'creator parse failed',
          token_usage: { input: 0, output: 0 },
          duration_ms: expect.any(Number),
        }),
      }));
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
      let lineageStartedDuringBookkeeping = false;
      let nextId = 1;
      mockGetNextArtifactId.mockImplementation(async () => {
        activeBookkeeping++;
        maxActiveBookkeeping = Math.max(maxActiveBookkeeping, activeBookkeeping);
        await new Promise((r) => setTimeout(r, 25));
        activeBookkeeping--;
        return String(nextId++).padStart(4, '0');
      });
      mockBuildLineageGraph.mockImplementation(async () => {
        lineageStartedDuringBookkeeping = lineageStartedDuringBookkeeping || activeBookkeeping > 0;
        return { edges: [], constellations: [] };
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const [first, second] = await Promise.all([
        runIteration(makeConfig(), makeModels(), 1, 1),
        runIteration(makeConfig(), makeModels(), 2, 2),
      ]);

      expect(first.outcome).toBe('shipped');
      expect(second.outcome).toBe('shipped');
      expect(maxActiveBookkeeping).toBe(1);
      expect(lineageStartedDuringBookkeeping).toBe(false);
    });

    it('runs configured ideation bursts and sends the combined slate to the critic', async () => {
      const config = makeConfig();
      config.iteration.ideation_burst_count = 3;

      const proposals = [
        { title: 'Burst One', domain: 'prose', pitch: 'First slate', complexity: 'L' as const, why: 'One', project_id: null, stimulus_ref: null },
        { title: 'Burst Two', domain: 'code-tool', pitch: 'Second slate', complexity: 'XL' as const, why: 'Two', project_id: null, stimulus_ref: null, xl_mode: 'single' as const },
        { title: 'Burst Three', domain: 'poetry', pitch: 'Third slate', complexity: 'M' as const, why: 'Three', project_id: null, stimulus_ref: null },
      ];

      for (const proposal of proposals) {
        mockDispatchIdeator.mockResolvedValueOnce({
          data: { ideas: [proposal] },
          usage,
          rawText: '',
        });
      }

      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [
          { title: 'Burst One', decision: 'reject', sharpening_notes: '', reasons: 'Less interesting' },
          { title: 'Burst Two', decision: 'approve', sharpening_notes: 'Build the large version', reasons: '' },
          { title: 'Burst Three', decision: 'reject', sharpening_notes: '', reasons: 'Less ambitious' },
        ] },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);
      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Burst Two', files: [{ path: 'large.md', content: '# Large' }], notes: '' },
        usage,
        phasesRun: ['plan', 'build-1'],
        phaseTokens: { plan: 50, 'build-1': 50 },
      });
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
          review: 'Strong',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);

      expect(result.title).toBe('Burst Two');
      expect(mockDispatchIdeator).toHaveBeenCalledTimes(3);
      expect(mockDispatchIdeator.mock.calls.map((call) => call[4])).toEqual([
        expect.stringContaining('burst 1/3'),
        expect.stringContaining('burst 2/3'),
        expect.stringContaining('burst 3/3'),
      ]);

      const criticSlate = mockDispatchCriticGate1.mock.calls[0][3];
      expect(criticSlate).toContain('Burst One');
      expect(criticSlate).toContain('Burst Two');
      expect(criticSlate).toContain('Burst Three');
      expect(mockRunCreatorPipeline.mock.calls[0][1].title).toBe('Burst Two');
    });

    it('honors the critic selected field when multiple proposals are approved', async () => {
      const firstProposal = { title: 'Approved First', domain: 'prose', pitch: 'First', complexity: 'S' as const, why: 'One', project_id: null, stimulus_ref: null };
      const selectedProposal = { title: 'Selected Second', domain: 'prose', pitch: 'Second', complexity: 'L' as const, why: 'Two', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({
        data: { ideas: [firstProposal, selectedProposal] },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: {
          selected: 'Selected Second',
          evaluations: [
            { title: 'Approved First', decision: 'approve', sharpening_notes: 'Good', reasons: '' },
            { title: 'Selected Second', decision: 'approve', sharpening_notes: 'Better', reasons: '' },
          ],
        },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);
      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Selected Second', files: [{ path: 'selected.md', content: '# Selected' }], notes: '' },
        usage,
        phasesRun: ['build'],
        phaseTokens: { build: 50 },
      });
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
          review: 'Strong',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.title).toBe('Selected Second');
      expect(mockRunCreatorPipeline.mock.calls[0][1].title).toBe('Selected Second');
      expect(mockRunCreatorPipeline.mock.calls[0][2]).toBe('Better');
    });

    it('continues with successful ideation bursts when one burst fails', async () => {
      const config = makeConfig();
      config.iteration.ideation_burst_count = 3;

      const proposalA = { title: 'Surviving Burst A', domain: 'prose', pitch: 'First surviving slate', complexity: 'L' as const, why: 'One', project_id: null, stimulus_ref: null };
      const proposalB = { title: 'Surviving Burst B', domain: 'poetry', pitch: 'Second surviving slate', complexity: 'M' as const, why: 'Two', project_id: null, stimulus_ref: null };

      mockDispatchIdeator
        .mockResolvedValueOnce({ data: { ideas: [proposalA] }, usage, rawText: '' })
        .mockRejectedValueOnce(new Error('burst 2 failed'))
        .mockResolvedValueOnce({ data: { ideas: [proposalB] }, usage, rawText: '' });

      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [
          { title: 'Surviving Burst A', decision: 'reject', sharpening_notes: '', reasons: 'Less useful' },
          { title: 'Surviving Burst B', decision: 'approve', sharpening_notes: 'Use the second survivor', reasons: '' },
        ] },
        usage,
        rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);
      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Surviving Burst B', files: [{ path: 'survivor.md', content: '# Survivor' }], notes: '' },
        usage,
        phasesRun: ['plan', 'build-1'],
        phaseTokens: { plan: 50, 'build-1': 50 },
      });
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
          review: 'Strong',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);

      expect(result.title).toBe('Surviving Burst B');
      expect(mockDispatchIdeator).toHaveBeenCalledTimes(3);
      const criticSlate = mockDispatchCriticGate1.mock.calls[0][3];
      expect(criticSlate).toContain('Surviving Burst A');
      expect(criticSlate).toContain('Surviving Burst B');
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

    it('writes start-runtime lifecycle precheck completion when STOP halts the iteration', async () => {
      mockCheckStopFile.mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1, 2, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 3,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('halted');
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_precheck_complete',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 2,
          stage: 'precheck',
          result: 'halted',
          reason: 'STOP file detected',
          stop_file_detected: true,
          duration_ms: expect.any(Number),
        }),
      }));
      expect(mockDispatchIdeator).not.toHaveBeenCalled();
    });

    it('writes start-runtime lifecycle precheck failure when STOP checking throws', async () => {
      mockCheckStopFile.mockRejectedValueOnce(new Error('STOP check failed'));

      const { runIteration } = await import('../src/iteration/runner.js');
      await expect(runIteration(makeConfig(), makeModels(), 1, 2, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 3,
          startIteration: 1,
        },
      })).rejects.toThrow('STOP check failed');

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_precheck_failed',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 2,
          stage: 'precheck',
          result: 'failed',
          detail: 'STOP check failed',
          stop_file_detected: false,
          disk_space_ok: null,
          duration_ms: expect.any(Number),
        }),
      }));
      expect(mockDispatchIdeator).not.toHaveBeenCalled();
    });
  });

  describe('runIteration - human redirect', () => {
    it('processes human redirect via curator and Critic Gate 1', async () => {
      mockReadRequests.mockResolvedValueOnce('Make a haiku about testing');

      const redirectProposal = { title: 'Testing Haiku', domain: 'prose', pitch: 'A haiku', complexity: 'S', why: 'Human redirect', project_id: null, stimulus_ref: null };
      mockDispatchCuratorRedirect.mockResolvedValueOnce({
        data: { proposal: redirectProposal },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: {
          evaluations: [{ title: 'Testing Haiku', decision: 'approve', sharpening_notes: 'Keep the testing image concrete.', reasons: '' }],
          selected: 'Testing Haiku',
        },
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
      const result = await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('shipped');
      expect(result.title).toBe('Testing Haiku');
      expect(result.source).toBe('human_redirect');
      expect(mockDispatchIdeator).not.toHaveBeenCalled();
      expect(mockDispatchCriticGate1).toHaveBeenCalledOnce();
      expect(mockDispatchCriticGate1.mock.calls[0][3]).toContain('human_redirect');
      expect(mockDispatchCriticGate1.mock.calls[0][3]).toContain('Make a haiku about testing');
      expect(mockDispatchCriticGate1.mock.calls[0][4]).toBe('human_redirect');
      expect(mockRunCreatorPipeline.mock.calls[0][2]).toBe('Human redirect — evaluate charitably. Keep the testing image concrete.');
      expect(mockClearRequests).toHaveBeenCalledOnce();
      expect(mockLogIteration).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'shipped',
        source: 'human_redirect',
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_human_redirect_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          request_file: 'requests.md',
          request_preview: 'Make a haiku about testing',
          request_length: 'Make a haiku about testing'.length,
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_request_poll_complete',
        data: expect.objectContaining({
          result: 'pending',
          request_pending: true,
          request_file: 'requests.md',
          request_preview: 'Make a haiku about testing',
          request_length: 'Make a haiku about testing'.length,
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_human_redirect_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          result: 'approved',
          title: 'Testing Haiku',
          domain: 'prose',
          complexity: 'S',
          token_usage: { input: 200, output: 100 },
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('defers Stoker-queued refinery while processing a human redirect', async () => {
      const config = makeConfig();
      config.refinery = { enabled: true, min_iterations_between_runs: 5, max_refinery_queue: 1 };
      const directive = {
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 0,
        for_iteration: 1,
        urgency: 'normal' as const,
        streak_instruction: 'neutral' as const,
        refinery_queue: 1,
        rules_fired: ['refinery_fuel'],
      };
      mockLoadStokerDirective.mockResolvedValueOnce(directive);
      mockReadRequests.mockResolvedValueOnce('Make a haiku before any background work');
      mockSelectRefineryTargets.mockResolvedValueOnce([]);

      const redirectProposal = { title: 'Priority Haiku', domain: 'prose', pitch: 'A haiku', complexity: 'S', why: 'Human redirect', project_id: null, stimulus_ref: null };
      mockDispatchCuratorRedirect.mockResolvedValueOnce({
        data: { proposal: redirectProposal },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: {
          evaluations: [{ title: 'Priority Haiku', decision: 'approve', sharpening_notes: 'Keep it precise.', reasons: '' }],
          selected: 'Priority Haiku',
        },
        usage,
        rawText: '',
      });
      mockIsCodeDomain.mockReturnValue(false);
      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Priority Haiku', files: [{ path: 'haiku.md', content: 'first things first' }] },
        usage,
        phasesRun: ['build'],
        phaseTokens: { build: 50 },
      });
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'Focused', tests_run: [], issues: [] },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 3, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 3 },
          review: 'Focused redirect',
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1, 2, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 3,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('shipped');
      expect(result.source).toBe('human_redirect');
      expect(mockSelectRefineryTargets).not.toHaveBeenCalled();
      expect(mockDispatchRefinery).not.toHaveBeenCalled();
      expect(mockSaveStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        ...directive,
        for_iteration: 2,
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_stoker_directive_deferred',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 2,
          stage: 'stoker_directive',
          result: 'deferred',
          reason: 'human_redirect',
          from_iteration: 1,
          to_iteration: 2,
          urgency: 'normal',
          rules_fired: ['refinery_fuel'],
          refinery_queue: 1,
          request_file: 'requests.md',
          request_preview: 'Make a haiku before any background work',
          request_length: 'Make a haiku before any background work'.length,
        }),
      }));
    });

    it('writes a request poll lifecycle failure when the request file cannot be read', async () => {
      mockReadRequests.mockRejectedValueOnce(new Error('request read failed'));

      const { runIteration } = await import('../src/iteration/runner.js');
      await expect(runIteration(makeConfig(), makeModels(), 1, 2, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 3,
          startIteration: 1,
        },
      })).rejects.toThrow('request read failed');

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_request_poll_failed',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 2,
          stage: 'request_poll',
          request_file: 'requests.md',
          result: 'failed',
          detail: 'request read failed',
          duration_ms: expect.any(Number),
        }),
      }));
      expect(mockDispatchIdeator).not.toHaveBeenCalled();
      expect(mockSelectRefineryTargets).not.toHaveBeenCalled();
    });

    it('skips a human redirect when Critic Gate 1 rejects the translated proposal', async () => {
      mockReadRequests.mockResolvedValueOnce('Make a generic poem');

      const redirectProposal = { title: 'Generic Poem', domain: 'prose', pitch: 'A generic poem', complexity: 'S', why: 'Human redirect', project_id: null, stimulus_ref: null };
      mockDispatchCuratorRedirect.mockResolvedValueOnce({
        data: { proposal: redirectProposal },
        usage,
        rawText: '',
      });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: {
          evaluations: [{ title: 'Generic Poem', decision: 'reject', sharpening_notes: '', reasons: 'Too generic even for a redirect.' }],
          selected: null,
        },
        usage,
        rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1, 4, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 4,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('skipped');
      expect(result.source).toBe('human_redirect');
      expect(result.reason).toContain('Human redirect rejected by Critic Gate 1');
      expect(result.reason).toContain('Too generic even for a redirect.');
      expect(mockDispatchIdeator).not.toHaveBeenCalled();
      expect(mockRunCreatorPipeline).not.toHaveBeenCalled();
      expect(mockDispatchTesterLightweight).not.toHaveBeenCalled();
      expect(mockDispatchCriticGate2).not.toHaveBeenCalled();
      expect(mockClearRequests).toHaveBeenCalledOnce();
      expect(mockClearSpeculativeIdeas).toHaveBeenCalledOnce();
      expect(mockLogIteration).toHaveBeenCalledWith(expect.objectContaining({
        iteration: 1,
        outcome: 'skipped',
        source: 'human_redirect',
        reason: expect.stringContaining('Human redirect rejected by Critic Gate 1'),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_human_redirect_start',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 4,
          start_iteration: 1,
          iteration: 1,
          slot: 4,
          request_file: 'requests.md',
          request_preview: 'Make a generic poem',
          request_length: 'Make a generic poem'.length,
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_human_redirect_complete',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 4,
          start_iteration: 1,
          iteration: 1,
          slot: 4,
          result: 'rejected',
          title: 'Generic Poem',
          domain: 'prose',
          complexity: 'S',
          reason: expect.stringContaining('Human redirect rejected by Critic Gate 1'),
          token_usage: { input: 200, output: 100 },
          duration_ms: expect.any(Number),
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_speculative_cleanup_complete',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 4,
          start_iteration: 1,
          iteration: 1,
          slot: 4,
          stage: 'speculative_cleanup',
          result: 'cleared',
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('writes a start-runtime lifecycle failure event when human redirect translation throws', async () => {
      mockReadRequests.mockResolvedValueOnce('Make a brittle request');
      mockDispatchCuratorRedirect.mockRejectedValueOnce(new Error('redirect translator broke'));

      const { runIteration } = await import('../src/iteration/runner.js');
      await expect(runIteration(makeConfig(), makeModels(), 1, 2, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 3,
          startIteration: 1,
        },
      })).rejects.toThrow('redirect translator broke');

      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_human_redirect_failed',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 2,
          request_file: 'requests.md',
          request_preview: 'Make a brittle request',
          request_length: 'Make a brittle request'.length,
          result: 'failed',
          detail: 'redirect translator broke',
          token_usage: { input: 0, output: 0 },
          duration_ms: expect.any(Number),
        }),
      }));
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
      const result = await runIteration(config, makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('skipped');
      expect(result.reason).toContain('deadlock');
      expect(mockDispatchIdeator.mock.calls[1][3]).toContain('Propose 5 NEW ideas');
      expect(mockUpdateStreakState).toHaveBeenCalledWith(
        expect.objectContaining({ current: null }),
        expect.objectContaining({
          iteration: 1,
          outcome: 'skipped',
          reason: expect.stringContaining('Ideation deadlock'),
        }),
        undefined,
      );
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_deadlock_override_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          max_idea_retries: 2,
          rejection_context_preview: expect.stringContaining('Not good enough'),
          rejection_context_length: expect.any(Number),
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_deadlock_override_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          result: 'failed',
          detail: 'Curator failed',
          duration_ms: expect.any(Number),
        }),
      }));
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
      const result = await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('killed');
      expect(result.reason).toContain('Too derivative');
      expect(mockWriteKilledArtifact).toHaveBeenCalledOnce();
      expect(mockWriteArtifact).not.toHaveBeenCalled();
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_dream_capture_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'dream_capture',
          outcome: 'killed',
          artifact_id: '0001',
          title: 'Bad Artifact',
          domain: 'prose',
          kill_reason_preview: 'Too derivative',
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_dream_capture_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'dream_capture',
          result: 'recorded',
          artifact_id: '0001',
          title: 'Bad Artifact',
          resurrection_hint_preview: expect.any(String),
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('persists a broken streak when an artifact is killed', async () => {
      const proposal = { title: 'Bad Artifact', domain: 'prose', pitch: 'A test', complexity: 'S', why: 'Because', project_id: null, stimulus_ref: null };
      const activeHistory = {
        current: {
          active: true,
          length: 2,
          domain: 'prose',
          avg_rating: 4.0,
          start_iteration: 1,
          last_iteration: 2,
          artifact_ids: ['0001', '0002'],
          project_id: null,
        },
        recent_breaks: [],
        cooldown_domains: [],
        cooldown_remaining: 0,
      };
      const brokenHistory = {
        current: null,
        recent_breaks: [{ iteration: 3, domain: 'prose', break_reason: 'killed' }],
        cooldown_domains: ['prose'],
        cooldown_remaining: 2,
      };
      mockLoadStreakHistory.mockResolvedValueOnce(activeHistory);
      mockUpdateStreakState.mockReturnValueOnce(brokenHistory);

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
      const result = await runIteration(makeConfig(), makeModels(), 3);

      expect(result.outcome).toBe('killed');
      expect(mockUpdateStreakState).toHaveBeenCalledWith(
        activeHistory,
        expect.objectContaining({
          iteration: 3,
          outcome: 'killed',
          artifact_id: '0001',
          title: 'Bad Artifact',
          domain: 'prose',
          reason: 'Too derivative',
          project_id: null,
        }),
        undefined,
      );
      expect(mockSaveStreakHistory).toHaveBeenCalledWith(brokenHistory);
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
      const result = await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('shipped');
      expect(mockDispatchTesterTestPlan).toHaveBeenCalledOnce();
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_tester_phase_start',
        data: expect.objectContaining({
          tester_mode: 'code_sandbox',
          title: 'Code Tool',
          domain: 'code-tool',
          complexity: 'M',
          artifact_title: 'Code Tool',
          file_count: 1,
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_tester_phase_complete',
        data: expect.objectContaining({
          tester_mode: 'code_plan',
          verdict: 'pass',
          summary_preview: 'Tests pass',
          tests_run_count: 1,
          issues_count: 0,
          token_usage: { input: 100, output: 50 },
        }),
      }));
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

      mockGetActiveProjects
        .mockResolvedValueOnce([{ project_id: 'P001', completed_iterations: 2 }])
        .mockResolvedValueOnce([{ project_id: 'P001', completed_iterations: 2 }]);

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('shipped');
      expect(mockLinkArtifactToProject).toHaveBeenCalledWith('P001', '0001', 'Project Art');
      expect(mockUpdateProjectStatus).toHaveBeenCalled();
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_project_progress_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'project_progress',
          project_id: 'P001',
          artifact_id: '0001',
          title: 'Project Art',
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_project_progress_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'project_progress',
          result: 'updated',
          project_id: 'P001',
          artifact_id: '0001',
          title: 'Project Art',
          previous_completed_iterations: 2,
          completed_iterations: 3,
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('logs a project milestone when a shipped continuation reaches the planned count', async () => {
      const proposal = { title: 'Project Finale', domain: 'prose', pitch: 'Test', complexity: 'S', why: 'Why', project_id: 'P001', stimulus_ref: null };
      const projectStatus = { project_id: 'P001', completed_iterations: 2, estimated_iterations: 3 };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Project Finale', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Project Finale', files: [{ path: 'finale.md', content: 'content' }] },
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
          ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
          review: 'Strong finale',
        },
        usage, rawText: '',
      });

      mockGetActiveProjects
        .mockResolvedValueOnce([projectStatus])
        .mockResolvedValueOnce([projectStatus]);

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('shipped');
      expect(result).toMatchObject({
        project_id: 'P001',
        project_completed_iterations: 3,
        project_estimated_iterations: 3,
        project_milestone_reached: true,
      });
      expect(mockLogIteration).toHaveBeenCalledWith(expect.objectContaining({
        outcome: 'shipped',
        project_id: 'P001',
        project_completed_iterations: 3,
        project_estimated_iterations: 3,
        project_milestone_reached: true,
      }));
      expect(mockAppendJournal).toHaveBeenCalledWith(expect.stringContaining('Project P001 reached its planned iteration count'));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_project_milestone_reached',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'project_milestone',
          result: 'needs_curator_decision',
          project_id: 'P001',
          artifact_id: '0001',
          title: 'Project Finale',
          completed_iterations: 3,
          estimated_iterations: 3,
        }),
      }));
    });

    it('strips stale project continuation ids before creation', async () => {
      const proposal = { title: 'Stale Project Art', domain: 'prose', pitch: 'Test', complexity: 'S' as const, why: 'Why', project_id: 'P999', stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Stale Project Art', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);
      mockGetActiveProjects.mockResolvedValueOnce([{ project_id: 'P001', completed_iterations: 2 }]);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Stale Project Art', files: [{ path: 'art.md', content: 'content' }] },
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

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('shipped');
      const pipelineCall = mockRunCreatorPipeline.mock.calls[0];
      expect(pipelineCall[1].project_id).toBeNull();
      expect(mockLinkArtifactToProject).not.toHaveBeenCalled();
      expect(mockUpdateProjectStatus).not.toHaveBeenCalled();
      expect(mockAppendJournal).toHaveBeenCalledWith(expect.stringContaining('Project P999 is not active'));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_project_continuation_stale_cleared',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'project_continuation_validation',
          result: 'standalone',
          stale_project_id: 'P999',
          active_project_count: 1,
          title: 'Stale Project Art',
          domain: 'prose',
        }),
      }));
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
      const result = await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('shipped');
      expect(mockRunCreatorPipeline).toHaveBeenCalledTimes(2);
      expect(mockLogTestReport).toHaveBeenCalledTimes(2);
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_creator_phase_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'test_fix',
          revision_round: 0,
          test_fix_cycle: 1,
          title: 'Fixable',
          domain: 'prose',
          complexity: 'S',
          revision_notes_present: true,
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_creator_phase_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'test_fix',
          revision_round: 0,
          test_fix_cycle: 1,
          artifact_title: 'Fixable',
          file_count: 1,
          phases_run: ['build'],
          phase_tokens: { build: 50 },
          token_usage: { input: 100, output: 50 },
          duration_ms: expect.any(Number),
        }),
      }));
    });
  });

  describe('runIteration - max revision rounds force ship', () => {
    it('force ships after max revision rounds when ratings meet the Gate 2 ship threshold', async () => {
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
          ratings: { originality: 3, specificity: 3, craft: 3, surprise: 3, coherence: 3, portfolio_fit: 3 },
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

    it('force kills after max revision rounds when ratings miss the Gate 2 ship threshold', async () => {
      const config = makeConfig();
      config.iteration.max_revision_rounds = 0;

      const proposal = { title: 'Almost There', domain: 'prose', pitch: 'Test', complexity: 'S', why: 'Why', project_id: null, stimulus_ref: null };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Almost There', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Almost There', files: [{ path: 'v1.md', content: 'content' }] },
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
          ratings: { originality: 3, specificity: 3, craft: 3, surprise: 2, coherence: 3, portfolio_fit: 3 },
          review: 'Nearly viable but below the shipping bar.',
          revision_notes: 'Raise the craft and surprise before shipping.',
        },
        usage, rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1);

      expect(result.outcome).toBe('killed');
      expect(result.reason).toContain('ship threshold');
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
      const result = await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('shipped');
      expect(mockCreateProject).toHaveBeenCalledOnce();
      // Pipeline should receive L complexity (downgraded from XL)
      const pipelineCall = mockRunCreatorPipeline.mock.calls[0];
      expect(pipelineCall[1].complexity).toBe('L');
      // Iteration log should record original XL complexity
      expect(mockLogIteration).toHaveBeenCalledWith(expect.objectContaining({ complexity: 'XL' }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_project_creation_start',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'project_creation',
          title: 'Epic Project',
          project_name: 'The Last Librarian',
          estimated_iterations: 6,
          original_complexity: 'XL',
          effective_complexity: 'L',
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_project_creation_complete',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'project_creation',
          result: 'created',
          project_id: 'P001',
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('creates project for L project starter proposals without changing complexity', async () => {
      const proposal = {
        title: 'Serial Cabinet', domain: 'fiction', pitch: 'A compact serial archive',
        complexity: 'L' as const, why: 'A focused multi-iteration thread',
        project_id: null, stimulus_ref: null,
        xl_mode: 'project' as const,
        project: { name: 'Serial Cabinet', description: 'A linked fiction project', estimated_iterations: 4, structure: [{ file_1: 'Opening dossier' }] },
      };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Serial Cabinet', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Serial Cabinet', files: [{ path: 'opening.md', content: 'Opening dossier' }] },
        usage,
        phasesRun: ['plan', 'build-1', 'build-2'],
        phaseTokens: { plan: 30, 'build-1': 40, 'build-2': 40 },
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage, rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
          review: 'Strong project opening',
        },
        usage, rawText: '',
      });

      mockGetActiveProjects.mockResolvedValueOnce([{ project_id: 'P001', completed_iterations: 0 }]);

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(mockCreateProject).toHaveBeenCalledOnce();
      expect(mockCreateProject).toHaveBeenCalledWith(proposal.project, 1);
      const pipelineCall = mockRunCreatorPipeline.mock.calls[0];
      expect(pipelineCall[1].complexity).toBe('L');
      expect(mockLinkArtifactToProject).toHaveBeenCalledWith('P001', '0001', 'Serial Cabinet');
      expect(mockLogIteration).toHaveBeenCalledWith(expect.objectContaining({ complexity: 'L' }));
    });

    it('falls back to standalone when project starter metadata is missing a name', async () => {
      const proposal = {
        title: 'Nameless Serial', domain: 'fiction', pitch: 'A serial without valid project metadata',
        complexity: 'XL' as const, why: 'Tests invalid starter fallback',
        project_id: null, stimulus_ref: null,
        xl_mode: 'project' as const,
        project: { name: '', description: 'Missing name', estimated_iterations: 4, structure: [{ file_1: 'Opening dossier' }] },
      };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Nameless Serial', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);
      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Nameless Serial', files: [{ path: 'opening.md', content: 'Opening dossier' }] },
        usage,
        phasesRun: ['plan', 'build-1', 'build-2'],
        phaseTokens: { plan: 30, 'build-1': 40, 'build-2': 40 },
      });
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage, rawText: '',
      });
      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
          review: 'Strong standalone opening',
        },
        usage, rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('shipped');
      expect(mockCountActiveProjects).not.toHaveBeenCalled();
      expect(mockCreateProject).not.toHaveBeenCalled();
      expect(mockLinkArtifactToProject).not.toHaveBeenCalled();
      expect(mockRunCreatorPipeline.mock.calls[0][1].project_id).toBeNull();
      expect(mockAppendJournal).toHaveBeenCalledWith(expect.stringContaining('Project starter metadata missing name'));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_project_creation_invalid',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'project_creation',
          result: 'standalone',
          reason: 'missing_name',
          title: 'Nameless Serial',
          original_complexity: 'XL',
          effective_complexity: 'XL',
        }),
      }));
    });

    it('ignores Gate 1 complexity recommendations that would invalidate project starter metadata', async () => {
      const proposal = {
        title: 'Serial Cabinet', domain: 'fiction', pitch: 'A compact serial archive',
        complexity: 'L' as const, why: 'A focused multi-iteration thread',
        project_id: null, stimulus_ref: null,
        xl_mode: 'project' as const,
        project: { name: 'Serial Cabinet', description: 'A linked fiction project', estimated_iterations: 4, structure: [{ file_1: 'Opening dossier' }] },
      };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Serial Cabinet', decision: 'approve', sharpening_notes: '', reasons: '', recommended_complexity: 'M' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);

      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Serial Cabinet', files: [{ path: 'opening.md', content: 'Opening dossier' }] },
        usage,
        phasesRun: ['plan', 'build-1', 'build-2'],
        phaseTokens: { plan: 30, 'build-1': 40, 'build-2': 40 },
      });

      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage, rawText: '',
      });

      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
          review: 'Strong project opening',
        },
        usage, rawText: '',
      });

      mockGetActiveProjects.mockResolvedValueOnce([{ project_id: 'P001', completed_iterations: 0 }]);

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1);

      expect(result.outcome).toBe('shipped');
      expect(mockCreateProject).toHaveBeenCalledOnce();
      expect(mockCreateProject).toHaveBeenCalledWith(proposal.project, 1);
      expect(mockRunCreatorPipeline.mock.calls[0][1].complexity).toBe('L');
      expect(mockLogIteration).toHaveBeenCalledWith(expect.objectContaining({ complexity: 'L' }));
    });

    it('does not create a project when the active project cap is full', async () => {
      const config = makeConfig();
      config.projects.max_active = 2;
      mockCountActiveProjects.mockResolvedValueOnce(2);

      const proposal = {
        title: 'Overflow Serial', domain: 'fiction', pitch: 'A project starter when the queue is full',
        complexity: 'XL' as const, why: 'Tests project cap behavior',
        project_id: null, stimulus_ref: null,
        xl_mode: 'project' as const,
        project: { name: 'Overflow Serial', description: 'A capped project', estimated_iterations: 4, structure: [{ file_1: 'Opening dossier' }] },
      };

      mockDispatchIdeator.mockResolvedValueOnce({ data: { ideas: [proposal] }, usage, rawText: '' });
      mockDispatchCriticGate1.mockResolvedValueOnce({
        data: { evaluations: [{ title: 'Overflow Serial', decision: 'approve', sharpening_notes: '', reasons: '' }] },
        usage, rawText: '',
      });

      mockIsCodeDomain.mockReturnValue(false);
      mockRunCreatorPipeline.mockResolvedValueOnce({
        artifact: { title: 'Overflow Serial', files: [{ path: 'opening.md', content: 'Opening dossier' }] },
        usage,
        phasesRun: ['plan', 'build-1', 'build-2'],
        phaseTokens: { plan: 30, 'build-1': 40, 'build-2': 40 },
      });
      mockDispatchTesterLightweight.mockResolvedValueOnce({
        data: { verdict: 'pass', summary: 'OK', tests_run: [], issues: [] },
        usage, rawText: '',
      });
      mockDispatchCriticGate2.mockResolvedValueOnce({
        data: {
          decision: 'ship',
          ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
          review: 'Strong standalone opening',
        },
        usage, rawText: '',
      });

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(config, makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('shipped');
      expect(mockCountActiveProjects).toHaveBeenCalledOnce();
      expect(mockCreateProject).not.toHaveBeenCalled();
      expect(mockLinkArtifactToProject).not.toHaveBeenCalled();
      const pipelineCall = mockRunCreatorPipeline.mock.calls[0];
      expect(pipelineCall[1].complexity).toBe('L');
      expect(pipelineCall[1].project_id).toBeNull();
      expect(mockAppendJournal).toHaveBeenCalledWith(expect.stringContaining('Project cap reached'));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_project_creation_capped',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'project_creation',
          result: 'standalone',
          title: 'Overflow Serial',
          project_name: 'Overflow Serial',
          active_projects: 2,
          max_active_projects: 2,
          original_complexity: 'XL',
          effective_complexity: 'L',
        }),
      }));
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
      await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(mockRunCreatorPipeline.mock.calls[0][1].complexity).toBe('XL');
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_complexity_recommendation_applied',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'complexity_recommendation',
          source: 'ideator',
          result: 'applied',
          title: 'Too Small',
          from_complexity: 'M',
          to_complexity: 'XL',
        }),
      }));
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
      const result = await runIteration(config, makeModels(), 1, 3, {
        lifecycle: {
          mode: 'parallel',
          concurrency: 3,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('shipped');
      expect(result.token_usage).toEqual({ input: 600, output: 300 });
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_deadlock_override_start',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 3,
          max_idea_retries: 1,
          rejection_context_preview: expect.stringContaining('Boring'),
          rejection_context_length: expect.any(Number),
        }),
      }));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_deadlock_override_complete',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 3,
          start_iteration: 1,
          iteration: 1,
          slot: 3,
          result: 'forced',
          title: 'Forced Idea [FORCED]',
          domain: 'code-tool',
          complexity: 'M',
          token_usage: { input: 100, output: 50 },
          duration_ms: expect.any(Number),
        }),
      }));
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

      mockGetActiveProjects.mockResolvedValueOnce([{ project_id: 'P001', completed_iterations: 2 }]);
      mockLinkArtifactToProject.mockRejectedValueOnce(new Error('Project P001 not found'));

      const { runIteration } = await import('../src/iteration/runner.js');
      const result = await runIteration(makeConfig(), makeModels(), 1, undefined, {
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });

      expect(result.outcome).toBe('shipped');
      expect(mockWriteArtifact).toHaveBeenCalledOnce();
      expect(mockLinkArtifactToProject).toHaveBeenCalledWith('P001', '0001', 'Project Fail');
      expect(mockAppendJournal).toHaveBeenCalledWith(expect.stringContaining('Project P001 bookkeeping failed after shipping 0001'));
      expect(mockLogEvent).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'lifecycle',
        event: 'foundry_project_progress_failed',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          stage: 'project_progress',
          result: 'failed',
          project_id: 'P001',
          artifact_id: '0001',
          title: 'Project Fail',
          detail: 'Project P001 not found',
          duration_ms: expect.any(Number),
        }),
      }));
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
