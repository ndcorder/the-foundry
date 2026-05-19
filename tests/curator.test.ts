import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setRootDir } from '../src/root.js';
import type { FoundryConfig, ModelsConfig, CuratorFullResponse } from '../src/types/index.js';

// ── Mocks ────────────────────────────────────────────────────────

const mockCallModel = vi.fn();
vi.mock('../src/model/index.js', () => ({
  callModel: mockCallModel,
}));

const mockBuildCuratorContext = vi.fn().mockResolvedValue({ full: 'full context', agentSpecific: 'specific context', shared: 'shared' });
vi.mock('../src/context/agent-context.js', () => ({
  buildCuratorContext: mockBuildCuratorContext,
}));

const mockAppendJournal = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/files/journal.js', () => ({
  appendJournal: mockAppendJournal,
}));

const mockUpdateProjectStatus = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/files/projects.js', () => ({
  updateProjectStatus: mockUpdateProjectStatus,
}));

const mockRefreshSource = vi.fn().mockResolvedValue('refreshed');
const mockWriteSkillFile = vi.fn().mockResolvedValue(undefined);
const mockLoadStimuliConfig = vi.fn().mockResolvedValue({ mcp: {}, stimuli_ttl: 24, skills_per_context: 2 });
vi.mock('../src/stimuli/index.js', () => ({
  refreshSource: mockRefreshSource,
  writeSkillFile: mockWriteSkillFile,
  loadStimuliConfig: mockLoadStimuliConfig,
}));

import { StatsTracker } from '../src/stats/index.js';

// ── Fixtures ─────────────────────────────────────────────────────

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-curator-'));
  setRootDir(tempDir);
  vi.clearAllMocks();

  // Create required dirs and files
  mkdirSync(path.join(tempDir, 'prompts'), { recursive: true });
  mkdirSync(path.join(tempDir, 'identity'), { recursive: true });
  writeFileSync(path.join(tempDir, 'prompts', 'curator.md'), 'Curator: {shared_context_full} {curator_interval} {compression_cutoff} {domain_stats} {project_statuses} {stimuli_staleness} {requests_content}', 'utf-8');
  writeFileSync(path.join(tempDir, 'identity', 'manifesto.md'), '# Manifesto\n\nOld text here.\n\n## Values\n\nIntegrity', 'utf-8');
  writeFileSync(path.join(tempDir, 'identity', 'journal.md'), '# Journal\n', 'utf-8');
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

describe('curator', () => {
  describe('shouldRunCurator', () => {
    it('returns true when interval has elapsed', async () => {
      const { shouldRunCurator } = await import('../src/curator/index.js');
      const config = makeConfig();
      config.iteration.curator_interval = 10;
      expect(shouldRunCurator(20, 10, config)).toBe(true);
      expect(shouldRunCurator(21, 10, config)).toBe(true);
    });

    it('returns false when interval has not elapsed', async () => {
      const { shouldRunCurator } = await import('../src/curator/index.js');
      const config = makeConfig();
      config.iteration.curator_interval = 10;
      expect(shouldRunCurator(15, 10, config)).toBe(false);
    });

    it('returns true at exactly the interval boundary', async () => {
      const { shouldRunCurator } = await import('../src/curator/index.js');
      const config = makeConfig();
      config.iteration.curator_interval = 10;
      expect(shouldRunCurator(10, 0, config)).toBe(true);
    });
  });

  describe('dispatchCuratorFull', () => {
    it('calls model and returns parsed response', async () => {
      const curatorYaml = 'retrospective: "Good progress"\ncompressed_journal: "Summary of iterations"\nmanifesto_changes: []\ndomain_recommendations: "Diversify"\nproject_decisions: []\nstimuli_actions: []';
      mockCallModel.mockResolvedValueOnce({ text: curatorYaml, usage: { input: 500, output: 200 } });

      const { dispatchCuratorFull } = await import('../src/curator/index.js');
      const stats = StatsTracker.fresh();
      const result = await dispatchCuratorFull(makeConfig(), makeModels(), 10, stats);

      expect(result.retrospective).toBe('Good progress');
      expect(result.compressed_journal).toBe('Summary of iterations');
    });

    it('retries on invalid YAML', async () => {
      mockCallModel
        .mockResolvedValueOnce({ text: 'bad yaml {{{', usage: { input: 100, output: 50 } })
        .mockResolvedValueOnce({
          text: 'retrospective: "OK"\ncompressed_journal: "OK"\nmanifesto_changes: []\ndomain_recommendations: ""\nproject_decisions: []\nstimuli_actions: []',
          usage: { input: 100, output: 50 },
        });

      const { dispatchCuratorFull } = await import('../src/curator/index.js');
      const stats = StatsTracker.fresh();
      const result = await dispatchCuratorFull(makeConfig(), makeModels(), 10, stats);
      expect(result.retrospective).toBe('OK');
      expect(mockCallModel).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting retries', async () => {
      mockCallModel.mockResolvedValue({ text: 'garbage', usage: { input: 10, output: 5 } });

      const { dispatchCuratorFull } = await import('../src/curator/index.js');
      const stats = StatsTracker.fresh();
      await expect(dispatchCuratorFull(makeConfig(), makeModels(), 10, stats)).rejects.toThrow('Failed to get valid YAML');
    });
  });

  describe('applyCuratorCycle', () => {
    it('writes retrospective to journal', async () => {
      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'A good run',
        compressed_journal: 'Compressed version',
        manifesto_changes: [],
        domain_recommendations: 'Try more prose',
        project_decisions: [],
        stimuli_actions: [],
        human_redirect: null,
      };

      await applyCuratorCycle(response, 10);

      expect(mockAppendJournal).toHaveBeenCalledWith(expect.stringContaining('RETROSPECTIVE'));
    });

    it('writes compressed journal file', async () => {
      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro',
        compressed_journal: 'Compressed journal content',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [],
        human_redirect: null,
      };

      await applyCuratorCycle(response, 10);

      const compressed = readFileSync(path.join(tempDir, 'identity', 'journal-compressed.md'), 'utf-8');
      expect(compressed).toBe('Compressed journal content');
    });

    it('applies manifesto changes', async () => {
      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro',
        compressed_journal: 'Compressed',
        manifesto_changes: [
          { section: 'Values', old: 'Integrity', new: 'Integrity and curiosity', reason: 'Growth' },
        ],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [],
        human_redirect: null,
      };

      await applyCuratorCycle(response, 10);

      const manifesto = readFileSync(path.join(tempDir, 'identity', 'manifesto.md'), 'utf-8');
      expect(manifesto).toContain('Integrity and curiosity');
    });

    it('writes domain recommendations file', async () => {
      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro',
        compressed_journal: 'Compressed',
        manifesto_changes: [],
        domain_recommendations: 'Focus on code-art',
        project_decisions: [],
        stimuli_actions: [],
        human_redirect: null,
      };

      await applyCuratorCycle(response, 10);

      const recs = readFileSync(path.join(tempDir, 'curator-recommendations.md'), 'utf-8');
      expect(recs).toBe('Focus on code-art');
    });

    it('applies project decisions - complete', async () => {
      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro',
        compressed_journal: 'Compressed',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [
          { project_id: 'P001', action: 'complete', reason: 'Done' },
        ],
        stimuli_actions: [],
        human_redirect: null,
      };

      await applyCuratorCycle(response, 10);

      expect(mockUpdateProjectStatus).toHaveBeenCalledWith('P001', expect.objectContaining({ status: 'complete' }));
    });

    it('applies project decisions - abandon', async () => {
      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro',
        compressed_journal: 'Compressed',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [
          { project_id: 'P002', action: 'abandon', reason: 'Not viable' },
        ],
        stimuli_actions: [],
        human_redirect: null,
      };

      await applyCuratorCycle(response, 10);

      expect(mockUpdateProjectStatus).toHaveBeenCalledWith('P002', expect.objectContaining({ status: 'abandoned', abandoned_reason: 'Not viable' }));
    });

    it('handles stimuli refresh action', async () => {
      mockLoadStimuliConfig.mockResolvedValueOnce({
        mcp: { news: { server: 'tavily', max_items: 5, refresh_interval: 10 } },
        stimuli_ttl: 24,
        skills_per_context: 2,
      });

      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro',
        compressed_journal: 'Compressed',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [{ action: 'refresh', target: 'news' }],
        human_redirect: null,
      };

      await applyCuratorCycle(response, 10);

      expect(mockRefreshSource).toHaveBeenCalled();
    });

    it('handles stimuli commission_skill action', async () => {
      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro',
        compressed_journal: 'Compressed',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [{ action: 'commission_skill', target: 'new-skill', content: '# Skill content' }],
        human_redirect: null,
      };

      await applyCuratorCycle(response, 10);

      expect(mockWriteSkillFile).toHaveBeenCalledWith('new-skill', '# Skill content');
    });

    it('logs summary journal entry', async () => {
      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro',
        compressed_journal: 'Compressed',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [],
        human_redirect: null,
      };

      await applyCuratorCycle(response, 42);

      expect(mockAppendJournal).toHaveBeenCalledWith(expect.stringContaining('iteration 42'));
    });

    it('handles manifesto change when old text not found', async () => {
      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro',
        compressed_journal: 'Compressed',
        manifesto_changes: [
          { section: 'Missing', old: 'text that does not exist', new: 'new text', reason: 'test' },
        ],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [],
        human_redirect: null,
      };

      // Should not throw - just skip
      await applyCuratorCycle(response, 10);

      // manifesto should be unchanged
      const manifesto = readFileSync(path.join(tempDir, 'identity', 'manifesto.md'), 'utf-8');
      expect(manifesto).not.toContain('new text');
    });

    it('handles commission_skill with no content gracefully', async () => {
      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro',
        compressed_journal: 'Compressed',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [{ action: 'commission_skill', target: 'empty-skill' }],
        human_redirect: null,
      };

      await applyCuratorCycle(response, 10);
      expect(mockWriteSkillFile).not.toHaveBeenCalled();
    });

    it('handles project decision - continue (no status update)', async () => {
      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro',
        compressed_journal: 'Compressed',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [
          { project_id: 'P003', action: 'continue', reason: 'Going well' },
        ],
        stimuli_actions: [],
        human_redirect: null,
      };

      await applyCuratorCycle(response, 10);
      // Continue/extend don't call updateProjectStatus
      expect(mockUpdateProjectStatus).not.toHaveBeenCalled();
    });

    it('handles unknown stimuli refresh source gracefully', async () => {
      mockLoadStimuliConfig.mockResolvedValueOnce({
        mcp: {},
        stimuli_ttl: 24,
        skills_per_context: 2,
      });

      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro',
        compressed_journal: 'Compressed',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [{ action: 'refresh', target: 'nonexistent-source' }],
        human_redirect: null,
      };

      // Should not throw
      await applyCuratorCycle(response, 10);
      expect(mockRefreshSource).not.toHaveBeenCalled();
    });
  });
});
