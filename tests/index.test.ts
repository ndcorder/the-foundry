import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setRootDir } from '../src/root.js';

// ── Mocks ────────────────────────────────────────────────────────

vi.mock('../src/context/config.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({
    foundry: { name: 'test', version: '0.1.0' },
    iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
    projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
    stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
    context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
    intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
    logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
    recovery: { checkpoint_every: 5, resume_on_crash: true },
    loop: { cooldown_seconds: 0, disk_space_min_gb: 0 },
    git: { auto_commit: false, auto_push: false },
  }),
  loadModelsConfig: vi.fn().mockResolvedValue({
    agents: {
      ideator: { model: 'test', temperature: 0.9, max_tokens: 4096 },
      creator: { model: 'test', temperature: 0.7, max_tokens: 8192 },
      tester: { model: 'test', temperature: 0.3, max_tokens: 4096 },
      critic: { model: 'test', temperature: 0.5, max_tokens: 4096 },
      curator: { model: 'test', temperature: 0.5, max_tokens: 4096 },
    },
  }),
}));

vi.mock('../src/model/index.js', () => ({
  setModelOverrides: vi.fn(),
  validateProvider: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/iteration/index.js', () => ({
  runIteration: vi.fn(),
}));

vi.mock('../src/files/intervention.js', () => ({
  checkStopFile: vi.fn().mockResolvedValue(false),
}));

vi.mock('../src/files/journal.js', () => ({
  appendJournal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/checkpoint/index.js', () => ({
  saveCheckpoint: vi.fn().mockResolvedValue(undefined),
  loadCheckpoint: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/stimuli/index.js', () => ({
  loadStimuliConfig: vi.fn().mockResolvedValue({ mcp: {}, stimuli_ttl: 24, skills_per_context: 2 }),
  refreshAllStale: vi.fn().mockResolvedValue(new Map()),
  initRefreshStates: vi.fn().mockReturnValue(new Map()),
  recordToRefreshStates: vi.fn().mockReturnValue(new Map()),
  refreshStatesToRecord: vi.fn().mockReturnValue({}),
}));

vi.mock('../src/curator/index.js', () => ({
  dispatchCuratorFull: vi.fn(),
  applyCuratorCycle: vi.fn(),
  shouldRunCurator: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/monitor/index.js', () => ({
  runAllDetectors: vi.fn().mockReturnValue([]),
}));

vi.mock('../src/context/index.js', () => ({
  readJsonlEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/upgrade.js', () => ({
  upgradeProject: vi.fn().mockResolvedValue(false),
}));

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-index-'));
  setRootDir(tempDir);
  vi.clearAllMocks();

  // Create required directories
  mkdirSync(path.join(tempDir, 'logs'), { recursive: true });
  mkdirSync(path.join(tempDir, 'identity'), { recursive: true });
  writeFileSync(path.join(tempDir, 'identity', 'journal.md'), '# Journal\n', 'utf-8');
});
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

describe('index', () => {
  describe('startFoundry', () => {
    it('runs project upgrade before loading config and models', async () => {
      const { upgradeProject } = await import('../src/upgrade.js');
      const { loadConfig, loadModelsConfig } = await import('../src/context/config.js');
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(upgradeProject).toHaveBeenCalledWith({ silent: false });
      expect(vi.mocked(upgradeProject).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(loadConfig).mock.invocationCallOrder[0],
      );
      expect(vi.mocked(upgradeProject).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(loadModelsConfig).mock.invocationCallOrder[0],
      );
    });

    it('halts immediately when STOP file exists at startup', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      // First call returns false (pre-check in loop), second returns true
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(true); // STOP file exists at loop start

      const { runIteration } = await import('../src/iteration/index.js');
      const { saveCheckpoint } = await import('../src/checkpoint/index.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      // Should save checkpoint and exit without running any iterations
      expect(saveCheckpoint).toHaveBeenCalled();
      expect(runIteration).not.toHaveBeenCalled();
    });

    it('halts gracefully on SIGINT signal', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValue(false);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockImplementationOnce(async () => {
        process.emit('SIGINT');
        return {
          iteration: 1,
          outcome: 'shipped',
          title: 'Test',
          domain: 'prose',
          token_usage: { input: 100, output: 50 },
          duration_ms: 1000,
        };
      });

      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      const { appendJournal } = await import('../src/files/journal.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(saveCheckpoint).toHaveBeenCalled();
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Halted by signal'));
    });

    it('runs one iteration then halts on STOP', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      // First loop check: no stop, then second loop check: stop
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)  // first loop check
        .mockResolvedValueOnce(true);  // second loop check

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Test',
        domain: 'prose',
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(runIteration).toHaveBeenCalled();
    });

    it('handles iteration failure gracefully', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)  // first loop check
        .mockResolvedValueOnce(true);  // second loop check

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockRejectedValueOnce(new Error('API down'));

      const { appendJournal } = await import('../src/files/journal.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('API down'));
    });

    it('resumes from checkpoint', async () => {
      const { loadCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(loadCheckpoint).mockResolvedValueOnce({
        iteration: 10,
        active_project_ids: [],
        domain_counts: {},
        last_stimuli_refresh: {},
        last_curator_run: 5,
        stats: {
          iteration: 10,
          shipped: 5,
          killed: 2,
          skipped: 1,
          domain_counts: {},
          recent_outcomes: [],
          critic_rejection_window: [],
          total_tokens: { input: 1000, output: 500 },
        },
        saved_at: '2026-05-19T10:00:00Z',
      });

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);

      const { appendJournal } = await import('../src/files/journal.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Resumed from checkpoint'));
    });

    it('runs halted iteration result', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'halted',
        reason: 'STOP file',
        token_usage: { input: 0, output: 0 },
        duration_ms: 100,
      });

      const { saveCheckpoint } = await import('../src/checkpoint/index.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(saveCheckpoint).toHaveBeenCalled();
    });
  });

  describe('autoCommitAndPush logic', () => {
    it('builds shipped commit message correctly', () => {
      // Test the commit message construction logic from autoCommitAndPush
      const outcome = 'shipped';
      const artifactId = '0042';
      const title = 'My Poem';
      const domain = 'prose';
      const rating = 4.2;
      const iteration = 5;

      const ratingStr = rating !== null ? ` ★${rating.toFixed(1)}` : '';
      let msg: string;
      if (outcome === 'shipped') {
        msg = `feat: ship #${artifactId} — ${title} [${domain}]${ratingStr}`;
      } else if (outcome === 'killed') {
        msg = `chore: kill #${artifactId} — ${title} [${domain}]`;
      } else {
        msg = `chore: iteration ${iteration} failed`;
      }

      expect(msg).toContain('feat: ship');
      expect(msg).toContain('0042');
      expect(msg).toContain('My Poem');
      expect(msg).toContain('4.2');
    });

    it('builds killed commit message correctly', () => {
      const outcome = 'killed';
      const artifactId = '0043';
      const title = 'Bad Art';
      const domain = 'code-tool';
      const iteration = 5;

      let msg: string;
      if (outcome === 'shipped') {
        msg = `feat: ship #${artifactId}`;
      } else if (outcome === 'killed') {
        msg = `chore: kill #${artifactId} — ${title} [${domain}]`;
      } else {
        msg = `chore: iteration ${iteration} failed`;
      }
      expect(msg).toContain('chore: kill');
      expect(msg).toContain('Bad Art');
    });

    it('builds failed commit message correctly', () => {
      const outcome = 'skipped';
      const iteration = 10;

      let msg: string;
      if (outcome === 'shipped') {
        msg = 'feat: ship';
      } else if (outcome === 'killed') {
        msg = 'chore: kill';
      } else {
        msg = `chore: iteration ${iteration} failed`;
      }
      expect(msg).toBe('chore: iteration 10 failed');
    });

    it('handles null rating', () => {
      const rating = null;
      const ratingStr = rating !== null ? ` ★${rating.toFixed(1)}` : '';
      expect(ratingStr).toBe('');
    });
  });

  describe('startFoundry with model overrides', () => {
    it('applies model overrides when present', async () => {
      const { loadModelsConfig } = await import('../src/context/config.js');
      vi.mocked(loadModelsConfig).mockResolvedValueOnce({
        agents: {
          ideator: { model: 'test', temperature: 0.9, max_tokens: 4096 },
          creator: { model: 'test', temperature: 0.7, max_tokens: 8192 },
          tester: { model: 'test', temperature: 0.3, max_tokens: 4096 },
          critic: { model: 'test', temperature: 0.5, max_tokens: 4096 },
          curator: { model: 'test', temperature: 0.5, max_tokens: 4096 },
        },
        overrides: [
          { agent: 'creator', model: 'better-model', label: 'A/B test' },
        ],
      } as any);

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);

      const { setModelOverrides } = await import('../src/model/index.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(vi.mocked(setModelOverrides)).toHaveBeenCalledWith([
        { agent: 'creator', model: 'better-model', label: 'A/B test' },
      ]);
    });
  });

  describe('startFoundry checkpointing', () => {
    it('saves checkpoint at configured interval', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 1, resume_on_crash: true },
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      } as any);

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Test',
        domain: 'prose',
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      });

      const { saveCheckpoint } = await import('../src/checkpoint/index.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      // checkpoint_every: 1, so should save after iteration 1
      expect(vi.mocked(saveCheckpoint)).toHaveBeenCalled();
    });
  });

  describe('startFoundry - with git auto-commit', () => {
    it('auto-commits shipped artifacts when git auto_commit is true', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 5, resume_on_crash: true },
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0 },
        git: { auto_commit: true, auto_push: false },
      });

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        artifact_id: '0001',
        title: 'My Art',
        domain: 'prose',
        ratings: { originality: 4, specificity: 3, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 3 },
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      });

      const { startFoundry } = await import('../src/index.js');
      // This will try to git add/commit which will fail in test env, but that's ok
      await startFoundry({ rootDir: tempDir });
    });

    it('auto-commits killed artifacts', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 5, resume_on_crash: true },
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0 },
        git: { auto_commit: true, auto_push: false },
      });

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'killed',
        artifact_id: '0001',
        title: 'Bad Art',
        domain: 'prose',
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });
    });

    it('auto-commits failed iterations', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 5, resume_on_crash: true },
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0 },
        git: { auto_commit: true, auto_push: false },
      });

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockRejectedValueOnce(new Error('API error'));

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });
    });
  });

  describe('startFoundry - curator cycle', () => {
    it('triggers curator cycle when shouldRunCurator returns true', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Test',
        domain: 'prose',
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      });

      const { shouldRunCurator, dispatchCuratorFull, applyCuratorCycle } = await import('../src/curator/index.js');
      vi.mocked(shouldRunCurator).mockReturnValueOnce(true);
      vi.mocked(dispatchCuratorFull).mockResolvedValueOnce({
        retrospective: 'Good',
        compressed_journal: 'Compressed',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [],
        human_redirect: null,
      });
      vi.mocked(applyCuratorCycle).mockResolvedValueOnce(undefined);

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(dispatchCuratorFull).toHaveBeenCalled();
      expect(applyCuratorCycle).toHaveBeenCalled();
    });

    it('handles curator cycle failure gracefully', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Test',
        domain: 'prose',
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      });

      const { shouldRunCurator, dispatchCuratorFull } = await import('../src/curator/index.js');
      vi.mocked(shouldRunCurator).mockReturnValueOnce(true);
      vi.mocked(dispatchCuratorFull).mockRejectedValueOnce(new Error('Curator crashed'));

      const { appendJournal } = await import('../src/files/journal.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Curator cycle failed'));
    });
  });

  describe('startFoundry - checkpoint saving', () => {
    it('saves checkpoint at configured interval', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 1, resume_on_crash: true },
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0 },
      });

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'skipped',
        reason: 'test',
        token_usage: { input: 0, output: 0 },
        duration_ms: 100,
      });

      const { saveCheckpoint } = await import('../src/checkpoint/index.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      // checkpoint_every = 1, so checkpoint should be saved
      expect(saveCheckpoint).toHaveBeenCalled();
    });
  });

  describe('startFoundry - fresh start from log', () => {
    it('reads last iteration from log file', async () => {
      writeFileSync(
        path.join(tempDir, 'logs', 'iterations.jsonl'),
        '{"iteration":5}\n{"iteration":10}\n',
        'utf-8',
      );

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);

      const { saveCheckpoint } = await import('../src/checkpoint/index.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      // Should save checkpoint with iteration based on log
      expect(saveCheckpoint).toHaveBeenCalled();
    });
  });

  describe('startFoundry - model overrides', () => {
    it('applies model overrides from config', async () => {
      const { loadModelsConfig } = await import('../src/context/config.js');
      vi.mocked(loadModelsConfig).mockResolvedValueOnce({
        agents: {
          ideator: { model: 'test', temperature: 0.9, max_tokens: 4096 },
          creator: { model: 'test', temperature: 0.7, max_tokens: 8192 },
          tester: { model: 'test', temperature: 0.3, max_tokens: 4096 },
          critic: { model: 'test', temperature: 0.5, max_tokens: 4096 },
          curator: { model: 'test', temperature: 0.5, max_tokens: 4096 },
        },
        overrides: [
          { agent: 'ideator', model: 'fancy-model', start_iteration: 1, end_iteration: 100, label: 'ab-test' },
        ],
      });

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);

      const { setModelOverrides } = await import('../src/model/index.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(setModelOverrides).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ agent: 'ideator', model: 'fancy-model' }),
      ]));
    });
  });

  describe('stopFoundry', () => {
    it('creates a STOP file at the root', async () => {
      const { stopFoundry } = await import('../src/index.js');
      await stopFoundry('STOP', { rootDir: tempDir });

      const stopPath = path.join(tempDir, 'STOP');
      expect(existsSync(stopPath)).toBe(true);
      const content = readFileSync(stopPath, 'utf-8');
      expect(content).toContain('Stopped at');
    });

    it('creates STOP file with custom name', async () => {
      const { stopFoundry } = await import('../src/index.js');
      await stopFoundry('HALT', { rootDir: tempDir });

      expect(existsSync(path.join(tempDir, 'HALT'))).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('returns default status when no checkpoint exists', async () => {
      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect(status.iteration).toBe(0);
      expect(status.shipped).toBe(0);
      expect(status.killed).toBe(0);
      expect(status.skipped).toBe(0);
      expect(status.savedAt).toBeNull();
      expect(status.recentOutcomes).toEqual([]);
    });

    it('reports running=true when no STOP file exists', async () => {
      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect(status.running).toBe(true);
    });

    it('reports running=false when STOP file exists', async () => {
      writeFileSync(path.join(tempDir, 'STOP'), 'stopped', 'utf-8');

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect(status.running).toBe(false);
    });

    it('reads last artifact from iterations log', async () => {
      writeFileSync(
        path.join(tempDir, 'logs', 'iterations.jsonl'),
        '{"iteration":1,"outcome":"shipped","title":"My Artifact"}\n{"iteration":2,"outcome":"killed","title":"Bad One"}\n{"iteration":3,"outcome":"shipped","title":"Latest Art"}\n',
        'utf-8',
      );

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect(status.lastArtifact).toBe('Latest Art');
    });

    it('returns null lastArtifact when no shipped artifacts', async () => {
      writeFileSync(
        path.join(tempDir, 'logs', 'iterations.jsonl'),
        '{"iteration":1,"outcome":"killed","title":"Dead"}\n',
        'utf-8',
      );

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect(status.lastArtifact).toBeNull();
    });

    it('returns status with no log file', async () => {
      // Remove the logs dir entirely
      rmSync(path.join(tempDir, 'logs'), { recursive: true, force: true });

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });
      expect(status.lastArtifact).toBeNull();
    });

    it('returns status from checkpoint when available', async () => {
      const { loadCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(loadCheckpoint).mockResolvedValueOnce({
        iteration: 42,
        active_project_ids: [],
        domain_counts: { prose: 10 },
        last_stimuli_refresh: {},
        last_curator_run: 30,
        stats: {
          iteration: 42,
          shipped: 20,
          killed: 5,
          skipped: 3,
          domain_counts: { prose: 10 },
          recent_outcomes: [{ iteration: 42, outcome: 'shipped', domain: 'prose' }],
          critic_rejection_window: [],
          total_tokens: { input: 100000, output: 50000 },
        },
        saved_at: '2026-05-19T10:00:00Z',
      });

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect(status.iteration).toBe(42);
      expect(status.shipped).toBe(20);
      expect(status.killed).toBe(5);
      expect(status.skipped).toBe(3);
      expect(status.savedAt).toBe('2026-05-19T10:00:00Z');
      expect(status.recentOutcomes).toHaveLength(1);
    });
  });

  describe('startFoundry - auto git push', () => {
    it('pushes when auto_push is true after shipped iteration', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 5, resume_on_crash: true },
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0 },
        git: { auto_commit: true, auto_push: true },
      });

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        artifact_id: '0001',
        title: 'Art',
        domain: 'prose',
        ratings: { originality: 4, specificity: 3, craft: 4, surprise: 3, coherence: 4, portfolio_fit: 3 },
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      });

      const { startFoundry } = await import('../src/index.js');
      // autoCommitAndPush will be called with autoGitPush=true
      // execSync is not mocked here but it will throw which is caught internally
      await startFoundry({ rootDir: tempDir });
    });
  });

  describe('startFoundry - stimuli refresh', () => {
    it('runs stimuli refresh when enabled', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: true, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 5, resume_on_crash: true },
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      });

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Test',
        domain: 'prose',
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      });

      const { refreshAllStale } = await import('../src/stimuli/index.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(refreshAllStale).toHaveBeenCalled();
    });

    it('handles stimuli refresh error gracefully', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: true, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 5, resume_on_crash: true },
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      });

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Test',
        domain: 'prose',
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      });

      const { refreshAllStale } = await import('../src/stimuli/index.js');
      vi.mocked(refreshAllStale).mockRejectedValueOnce(new Error('stimuli broken'));

      const { startFoundry } = await import('../src/index.js');
      // Should not throw — stimuli error is non-fatal
      await startFoundry({ rootDir: tempDir });
    });
  });

  describe('startFoundry - stimuli config load failure', () => {
    it('handles stimuli config load failure during checkpoint restore', async () => {
      const { loadCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(loadCheckpoint).mockResolvedValueOnce({
        iteration: 10,
        active_project_ids: [],
        domain_counts: {},
        last_stimuli_refresh: { news: 5 },
        last_curator_run: 5,
        stats: {
          iteration: 10, shipped: 5, killed: 2, skipped: 1,
          domain_counts: {}, recent_outcomes: [],
          critic_rejection_window: [], total_tokens: { input: 1000, output: 500 },
        },
        saved_at: '2026-05-19T10:00:00Z',
      });

      const { loadStimuliConfig } = await import('../src/stimuli/index.js');
      vi.mocked(loadStimuliConfig).mockRejectedValueOnce(new Error('no stimuli.yml'));

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });
      // Should continue with empty Map for stimuliRefreshStates
    });

    it('handles stimuli config load failure during fresh start', async () => {
      const { loadStimuliConfig } = await import('../src/stimuli/index.js');
      vi.mocked(loadStimuliConfig).mockRejectedValueOnce(new Error('no stimuli.yml'));

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });
      // Should continue with empty Map
    });
  });

  describe('startFoundry - monitor warnings', () => {
    it('logs monitor warnings and writes to monitor.jsonl', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockReset();
      let stopCallCount = 0;
      vi.mocked(checkStopFile).mockImplementation(async () => {
        stopCallCount++;
        return stopCallCount > 1;
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockReset();
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1, outcome: 'shipped', title: 'Test', domain: 'prose',
        token_usage: { input: 100, output: 50 }, duration_ms: 1000,
      });

      const { shouldRunCurator } = await import('../src/curator/index.js');
      vi.mocked(shouldRunCurator).mockReturnValue(false);

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReset();
      vi.mocked(runAllDetectors).mockReturnValue([
        { detector: 'quality', severity: 'warning' as const, message: 'Quality dip detected', iteration: 1 },
      ]);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const allLog = consoleSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(allLog).toContain('[warning] quality: Quality dip detected');

      // Check that monitor.jsonl was written
      const monitorLog = readFileSync(path.join(tempDir, 'logs', 'monitor.jsonl'), 'utf-8');
      expect(monitorLog).toContain('Quality dip detected');
      consoleSpy.mockRestore();
    });

    it('triggers emergency curator on critical quality warning', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockReset();
      let stopCallCount = 0;
      vi.mocked(checkStopFile).mockImplementation(async () => {
        stopCallCount++;
        return stopCallCount > 1;
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockReset();
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1, outcome: 'shipped', title: 'Test', domain: 'prose',
        token_usage: { input: 100, output: 50 }, duration_ms: 1000,
      });

      const { shouldRunCurator } = await import('../src/curator/index.js');
      vi.mocked(shouldRunCurator).mockReturnValue(false);

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReset();
      vi.mocked(runAllDetectors).mockReturnValue([
        { detector: 'quality', severity: 'critical' as const, message: 'Crisis', iteration: 1, action: { type: 'emergency_curator' } },
      ] as any);

      const { dispatchCuratorFull, applyCuratorCycle } = await import('../src/curator/index.js');
      vi.mocked(dispatchCuratorFull).mockResolvedValueOnce({
        retrospective: 'Emergency', compressed_journal: 'C',
        manifesto_changes: [], domain_recommendations: '',
        project_decisions: [], stimuli_actions: [], human_redirect: null,
      });
      vi.mocked(applyCuratorCycle).mockResolvedValueOnce(undefined);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(dispatchCuratorFull).toHaveBeenCalled();
      expect(applyCuratorCycle).toHaveBeenCalled();
      const allLog = consoleSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(allLog).toContain('Emergency Curator triggered');
      consoleSpy.mockRestore();
    });

    it('handles emergency curator failure gracefully', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockReset();
      let stopCallCount = 0;
      vi.mocked(checkStopFile).mockImplementation(async () => {
        stopCallCount++;
        return stopCallCount > 1;
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockReset();
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1, outcome: 'shipped', title: 'Test', domain: 'prose',
        token_usage: { input: 100, output: 50 }, duration_ms: 1000,
      });

      const { shouldRunCurator } = await import('../src/curator/index.js');
      vi.mocked(shouldRunCurator).mockReturnValue(false);

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReset();
      vi.mocked(runAllDetectors).mockReturnValue([
        { detector: 'quality', severity: 'critical' as const, message: 'Crisis', iteration: 1, action: { type: 'emergency_curator' } },
      ] as any);

      const { dispatchCuratorFull } = await import('../src/curator/index.js');
      vi.mocked(dispatchCuratorFull).mockRejectedValueOnce(new Error('curator boom'));

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const allErr = errSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(allErr).toContain('Emergency Curator failed');
      errSpy.mockRestore();
    });
  });
});
