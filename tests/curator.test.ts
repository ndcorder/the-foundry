import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setRootDir } from '../src/root.js';
import type { FoundryConfig, ModelsConfig, CuratorFullResponse, StimuliRefreshState } from '../src/types/index.js';

// ── Mocks ────────────────────────────────────────────────────────

const mockCallModel = vi.fn();
vi.mock('../src/model/index.js', () => ({
  callModel: mockCallModel,
}));

const mockBuildCuratorContext = vi.fn().mockResolvedValue({ full: 'full context', agentSpecific: 'specific context', shared: 'shared' });
vi.mock('../src/context/agent-context.js', () => ({
  buildCuratorContext: mockBuildCuratorContext,
}));

const mockLoadDomainsConfig = vi.fn().mockResolvedValue({
  domains: [
    { name: 'prose', description: 'Prose', weight: 1 },
    { name: 'code-tool', description: 'Code tools', weight: 1 },
  ],
});
vi.mock('../src/context/config.js', () => ({
  loadDomainsConfig: mockLoadDomainsConfig,
}));

const mockAppendJournal = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/files/journal.js', () => ({
  appendJournal: mockAppendJournal,
}));

const mockUpdateProjectStatus = vi.fn().mockResolvedValue(undefined);
const mockGetActiveProjects = vi.fn().mockResolvedValue([]);
vi.mock('../src/files/projects.js', () => ({
  updateProjectStatus: mockUpdateProjectStatus,
  getActiveProjects: mockGetActiveProjects,
}));

const mockRefreshSource = vi.fn().mockResolvedValue('refreshed');
const mockWriteSkillFile = vi.fn().mockResolvedValue(undefined);
const mockLoadStimuliConfig = vi.fn().mockResolvedValue({ mcp: {}, stimuli_ttl: 24, skills_per_context: 2 });
vi.mock('../src/stimuli/index.js', () => ({
  refreshSource: mockRefreshSource,
  writeSkillFile: mockWriteSkillFile,
  loadStimuliConfig: mockLoadStimuliConfig,
  summarizeStimuliRefreshHealth: vi.fn((config: any, states: Map<string, any>, currentIteration: number, enabled: boolean) => {
    const entries = Object.entries(config.mcp ?? {}).map(([source, sourceConfig]: [string, any]) => {
      const state = states.get(source) ?? {
        last_refresh_iteration: 0,
        consecutive_failures: 0,
        disabled: false,
      };
      const refreshInterval = Math.max(1, Math.floor(sourceConfig.refresh_interval));
      const lastRefreshIteration = Math.max(0, Math.floor(state.last_refresh_iteration));
      const iterationsSinceRefresh = Math.max(0, currentIteration - lastRefreshIteration);
      const due = !state.disabled && iterationsSinceRefresh >= refreshInterval;
      const sourceState = state.disabled
        ? 'disabled'
        : state.consecutive_failures > 0
          ? 'failing'
          : due
            ? 'due'
            : 'healthy';
      return {
        source,
        server: sourceConfig.server,
        refreshInterval,
        lastRefreshIteration,
        iterationsSinceRefresh,
        consecutiveFailures: state.consecutive_failures,
        disabled: state.disabled,
        due,
        state: sourceState,
      };
    });
    return {
      enabled,
      sources: entries.length,
      healthy: entries.filter((entry) => entry.state === 'healthy').length,
      due: entries.filter((entry) => entry.due).length,
      failing: entries.filter((entry) => entry.consecutiveFailures > 0 && !entry.disabled).length,
      disabled: entries.filter((entry) => entry.disabled).length,
      entries,
    };
  }),
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
  mockGetActiveProjects.mockReset();
  mockGetActiveProjects.mockResolvedValue([]);
  mockLoadDomainsConfig.mockReset();
  mockLoadDomainsConfig.mockResolvedValue({
    domains: [
      { name: 'prose', description: 'Prose', weight: 1 },
      { name: 'code-tool', description: 'Code tools', weight: 1 },
    ],
  });
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
      const curatorYaml = 'retrospective: "Good progress"\ncompressed_journal: "Summary of iterations"\nmanifesto_changes: []\ndomain_recommendations: "Diversify"\nproject_decisions: []\nstimuli_actions: []\nhuman_redirect: null';
      mockCallModel.mockResolvedValueOnce({ text: curatorYaml, usage: { input: 500, output: 200 } });

      const { dispatchCuratorFull } = await import('../src/curator/index.js');
      const stats = StatsTracker.fresh();
      const result = await dispatchCuratorFull(makeConfig(), makeModels(), 10, stats);

      expect(result.retrospective).toBe('Good progress');
      expect(result.compressed_journal).toBe('Summary of iterations');
    });

    it('injects critic artifact rejection pressure into the curator prompt', async () => {
      writeFileSync(
        path.join(tempDir, 'prompts', 'curator.md'),
        'Curator: {shared_context_full} {critic_rejection_rate}',
        'utf-8',
      );
      const curatorYaml = 'retrospective: "Review rejection pressure"\ncompressed_journal: "Summary"\nmanifesto_changes: []\ndomain_recommendations: ""\nproject_decisions: []\nstimuli_actions: []\nhuman_redirect: null';
      mockCallModel.mockResolvedValueOnce({ text: curatorYaml, usage: { input: 500, output: 200 } });
      const stats = StatsTracker.fresh();
      stats.recordCriticDecision(1, true);
      stats.recordCriticDecision(2, false);

      const { dispatchCuratorFull } = await import('../src/curator/index.js');
      await dispatchCuratorFull(makeConfig(), makeModels(), 10, stats);

      expect(mockCallModel.mock.calls[0][1]).toContain(
        '50% over last 2 artifact decisions (1 killed, 1 shipped). Above 40%; reflect on whether Critic standards are drifting.',
      );
    });

    it('injects deterministic stimuli source health into the curator prompt', async () => {
      writeFileSync(
        path.join(tempDir, 'prompts', 'curator.md'),
        'Curator stimuli: {stimuli_staleness}',
        'utf-8',
      );
      mockLoadStimuliConfig.mockResolvedValueOnce({
        mcp: {
          news: {
            server: 'tavily',
            query_template: 'interesting news',
            max_items: 5,
            refresh_interval: 10,
          },
          cultural: {
            server: 'tavily',
            queries: ['trending repos'],
            max_items: 5,
            refresh_interval: 20,
          },
          knowledge: {
            server: 'context7',
            strategy: 'random',
            max_items: 3,
            refresh_interval: 10,
          },
        },
        stimuli_ttl: 24,
        skills_per_context: 2,
      });
      const states = new Map([
        ['news', { source: 'news', last_refresh_iteration: 18, consecutive_failures: 2, disabled: false }],
        ['cultural', { source: 'cultural', last_refresh_iteration: 12, consecutive_failures: 3, disabled: true }],
        ['knowledge', { source: 'knowledge', last_refresh_iteration: 29, consecutive_failures: 0, disabled: false }],
      ]);
      const curatorYaml = 'retrospective: "Review stimuli"\ncompressed_journal: "Summary"\nmanifesto_changes: []\ndomain_recommendations: ""\nproject_decisions: []\nstimuli_actions: []\nhuman_redirect: null';
      mockCallModel.mockResolvedValueOnce({ text: curatorYaml, usage: { input: 500, output: 200 } });

      const { dispatchCuratorFull } = await import('../src/curator/index.js');
      await dispatchCuratorFull(makeConfig(), makeModels(), 30, StatsTracker.fresh(), states);

      const prompt = mockCallModel.mock.calls[0][1];
      expect(prompt).toContain('Stimuli sources: 3 (1 healthy, 1 due, 1 failing, 1 disabled).');
      expect(prompt).toContain('- news: failing, tavily, last #18, 12 iterations ago, every 10 iterations, 2 failures, due');
      expect(prompt).toContain('- cultural: disabled, tavily, last #12, 18 iterations ago, every 20 iterations, 3 failures');
      expect(prompt).toContain('- knowledge: healthy, context7, last #29, 1 iteration ago, every 10 iterations, no failures');
    });

    it('retries on invalid YAML', async () => {
      mockCallModel
        .mockResolvedValueOnce({ text: 'bad yaml {{{', usage: { input: 100, output: 50 } })
        .mockResolvedValueOnce({
          text: 'retrospective: "OK"\ncompressed_journal: "OK"\nmanifesto_changes: []\ndomain_recommendations: ""\nproject_decisions: []\nstimuli_actions: []\nhuman_redirect: null',
          usage: { input: 100, output: 50 },
        });

      const { dispatchCuratorFull } = await import('../src/curator/index.js');
      const stats = StatsTracker.fresh();
      const result = await dispatchCuratorFull(makeConfig(), makeModels(), 10, stats);
      expect(result.retrospective).toBe('OK');
      expect(mockCallModel).toHaveBeenCalledTimes(2);
    });

    it('retries when project decisions reference inactive projects', async () => {
      mockGetActiveProjects.mockResolvedValueOnce([{ project_id: 'P001', name: 'Active Project' }]);
      mockCallModel
        .mockResolvedValueOnce({
          text: 'retrospective: "OK"\ncompressed_journal: "OK"\nmanifesto_changes: []\ndomain_recommendations: ""\nproject_decisions:\n  - project_id: "P999"\n    action: "complete"\n    reason: "Looks done"\nstimuli_actions: []\nhuman_redirect: null',
          usage: { input: 100, output: 50 },
        })
        .mockResolvedValueOnce({
          text: 'retrospective: "OK"\ncompressed_journal: "OK"\nmanifesto_changes: []\ndomain_recommendations: ""\nproject_decisions:\n  - project_id: "P001"\n    action: "continue"\n    reason: "Still active"\nstimuli_actions: []\nhuman_redirect: null',
          usage: { input: 100, output: 50 },
        });

      const { dispatchCuratorFull } = await import('../src/curator/index.js');
      const result = await dispatchCuratorFull(makeConfig(), makeModels(), 10, StatsTracker.fresh());

      expect(mockCallModel).toHaveBeenCalledTimes(2);
      expect(result.project_decisions).toEqual([
        { project_id: 'P001', action: 'continue', reason: 'Still active' },
      ]);
    });

    it('retries when human redirects reference inactive projects', async () => {
      mockGetActiveProjects.mockResolvedValueOnce([{ project_id: 'P001', name: 'Active Project' }]);
      mockCallModel
        .mockResolvedValueOnce({
          text: 'retrospective: "OK"\ncompressed_journal: "OK"\nmanifesto_changes: []\ndomain_recommendations: ""\nproject_decisions: []\nstimuli_actions: []\nhuman_redirect:\n  proposal:\n    title: "Stale Redirect"\n    domain: prose\n    pitch: "Continue stale work"\n    complexity: S\n    why: "Human request"\n    project_id: "P999"\n    stimulus_ref: null\n    xl_mode: null\n    project: null',
          usage: { input: 100, output: 50 },
        })
        .mockResolvedValueOnce({
          text: 'retrospective: "OK"\ncompressed_journal: "OK"\nmanifesto_changes: []\ndomain_recommendations: ""\nproject_decisions: []\nstimuli_actions: []\nhuman_redirect:\n  proposal:\n    title: "Active Redirect"\n    domain: prose\n    pitch: "Continue active work"\n    complexity: S\n    why: "Human request"\n    project_id: "P001"\n    stimulus_ref: null\n    xl_mode: null\n    project: null',
          usage: { input: 100, output: 50 },
        });

      const { dispatchCuratorFull } = await import('../src/curator/index.js');
      const result = await dispatchCuratorFull(makeConfig(), makeModels(), 10, StatsTracker.fresh());

      expect(mockCallModel).toHaveBeenCalledTimes(2);
      expect(result.human_redirect?.proposal.project_id).toBe('P001');
    });

    it('retries when human redirects use domains outside the configured list', async () => {
      mockCallModel
        .mockResolvedValueOnce({
          text: 'retrospective: "OK"\ncompressed_journal: "OK"\nmanifesto_changes: []\ndomain_recommendations: ""\nproject_decisions: []\nstimuli_actions: []\nhuman_redirect:\n  proposal:\n    title: "Wrong Domain"\n    domain: dance\n    pitch: "Build outside the configured list"\n    complexity: M\n    why: "Human request"\n    project_id: null\n    stimulus_ref: null',
          usage: { input: 100, output: 50 },
        })
        .mockResolvedValueOnce({
          text: 'retrospective: "OK"\ncompressed_journal: "OK"\nmanifesto_changes: []\ndomain_recommendations: ""\nproject_decisions: []\nstimuli_actions: []\nhuman_redirect:\n  proposal:\n    title: "Allowed Domain"\n    domain: prose\n    pitch: "Build inside the configured list"\n    complexity: M\n    why: "Human request"\n    project_id: null\n    stimulus_ref: null',
          usage: { input: 100, output: 50 },
        });

      const { dispatchCuratorFull } = await import('../src/curator/index.js');
      const result = await dispatchCuratorFull(makeConfig(), makeModels(), 10, StatsTracker.fresh());

      expect(mockCallModel).toHaveBeenCalledTimes(2);
      expect(result.human_redirect?.proposal.domain).toBe('prose');
    });

    it('retries when human redirect project starters exceed the configured project cap', async () => {
      const config = makeConfig();
      config.projects.max_iterations_per_project = 4;
      mockCallModel
        .mockResolvedValueOnce({
          text: 'retrospective: "OK"\ncompressed_journal: "OK"\nmanifesto_changes: []\ndomain_recommendations: ""\nproject_decisions: []\nstimuli_actions: []\nhuman_redirect:\n  proposal:\n    title: "Too Long Project"\n    domain: prose\n    pitch: "Start a long project"\n    complexity: L\n    why: "Human request"\n    project_id: null\n    stimulus_ref: null\n    xl_mode: project\n    project:\n      name: "Too Long"\n      description: "Oversized project"\n      estimated_iterations: 99\n      structure:\n        - part_1: "Opening"',
          usage: { input: 100, output: 50 },
        })
        .mockResolvedValueOnce({
          text: 'retrospective: "OK"\ncompressed_journal: "OK"\nmanifesto_changes: []\ndomain_recommendations: ""\nproject_decisions: []\nstimuli_actions: []\nhuman_redirect:\n  proposal:\n    title: "Right Sized Project"\n    domain: prose\n    pitch: "Start a capped project"\n    complexity: L\n    why: "Human request"\n    project_id: null\n    stimulus_ref: null\n    xl_mode: project\n    project:\n      name: "Right Sized"\n      description: "Within cap"\n      estimated_iterations: 4\n      structure:\n        - part_1: "Opening"',
          usage: { input: 100, output: 50 },
        });

      const { dispatchCuratorFull } = await import('../src/curator/index.js');
      const result = await dispatchCuratorFull(config, makeModels(), 10, StatsTracker.fresh());

      expect(mockCallModel).toHaveBeenCalledTimes(2);
      expect(result.human_redirect?.proposal.project?.estimated_iterations).toBe(4);
    });

    it('retries when stimuli refresh actions target unknown sources', async () => {
      mockLoadStimuliConfig.mockResolvedValueOnce({
        mcp: { news: { server: 'tavily', max_items: 5, refresh_interval: 10 } },
        stimuli_ttl: 24,
        skills_per_context: 2,
      });
      mockCallModel
        .mockResolvedValueOnce({
          text: 'retrospective: "OK"\ncompressed_journal: "OK"\nmanifesto_changes: []\ndomain_recommendations: ""\nproject_decisions: []\nstimuli_actions:\n  - action: "refresh"\n    target: "unknown"\nhuman_redirect: null',
          usage: { input: 100, output: 50 },
        })
        .mockResolvedValueOnce({
          text: 'retrospective: "OK"\ncompressed_journal: "OK"\nmanifesto_changes: []\ndomain_recommendations: ""\nproject_decisions: []\nstimuli_actions:\n  - action: "refresh"\n    target: "news"\nhuman_redirect: null',
          usage: { input: 100, output: 50 },
        });

      const { dispatchCuratorFull } = await import('../src/curator/index.js');
      const result = await dispatchCuratorFull(makeConfig(), makeModels(), 10, StatsTracker.fresh());

      expect(mockCallModel).toHaveBeenCalledTimes(2);
      expect(result.stimuli_actions).toEqual([{ action: 'refresh', target: 'news' }]);
    });

    it('retries when commissioned skill actions omit content', async () => {
      mockCallModel
        .mockResolvedValueOnce({
          text: 'retrospective: "OK"\ncompressed_journal: "OK"\nmanifesto_changes: []\ndomain_recommendations: ""\nproject_decisions: []\nstimuli_actions:\n  - action: "commission_skill"\n    target: "poetics"\nhuman_redirect: null',
          usage: { input: 100, output: 50 },
        })
        .mockResolvedValueOnce({
          text: 'retrospective: "OK"\ncompressed_journal: "OK"\nmanifesto_changes: []\ndomain_recommendations: ""\nproject_decisions: []\nstimuli_actions:\n  - action: "commission_skill"\n    target: "poetics"\n    content: "# Poetics\\n\\nSpecific techniques."\nhuman_redirect: null',
          usage: { input: 100, output: 50 },
        });

      const { dispatchCuratorFull } = await import('../src/curator/index.js');
      const result = await dispatchCuratorFull(makeConfig(), makeModels(), 10, StatsTracker.fresh());

      expect(mockCallModel).toHaveBeenCalledTimes(2);
      expect(result.stimuli_actions).toEqual([
        { action: 'commission_skill', target: 'poetics', content: '# Poetics\n\nSpecific techniques.' },
      ]);
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

    it('skips blank retrospective entries', async () => {
      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: '   ',
        compressed_journal: 'Compressed version',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [],
        human_redirect: null,
      };

      await applyCuratorCycle(response, 10);

      expect(mockAppendJournal).not.toHaveBeenCalledWith(expect.stringContaining('RETROSPECTIVE'));
      expect(mockAppendJournal).toHaveBeenCalledWith('[CURATOR] Full cycle complete at iteration 10');
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

    it('does not overwrite compressed journal with blank content', async () => {
      writeFileSync(path.join(tempDir, 'identity', 'journal-compressed.md'), 'Existing memory', 'utf-8');

      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro',
        compressed_journal: '   ',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [],
        human_redirect: null,
      };

      await applyCuratorCycle(response, 10);

      const compressed = readFileSync(path.join(tempDir, 'identity', 'journal-compressed.md'), 'utf-8');
      expect(compressed).toBe('Existing memory');
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

    it('skips manifesto changes with blank old text', async () => {
      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro',
        compressed_journal: 'Compressed',
        manifesto_changes: [
          { section: 'Values', old: '', new: 'Injected prefix', reason: 'Bad diff' },
        ],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [],
        human_redirect: null,
      };

      await applyCuratorCycle(response, 10);

      const manifesto = readFileSync(path.join(tempDir, 'identity', 'manifesto.md'), 'utf-8');
      expect(manifesto.startsWith('Injected prefix')).toBe(false);
      expect(manifesto).toContain('Integrity');
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

    it('updates stimuli refresh state after successful curator refresh action', async () => {
      mockLoadStimuliConfig.mockResolvedValueOnce({
        mcp: { news: { server: 'tavily', max_items: 5, refresh_interval: 10 } },
        stimuli_ttl: 24,
        skills_per_context: 2,
      });

      const states = new Map<string, StimuliRefreshState>([
        ['news', {
          source: 'news',
          last_refresh_iteration: 12,
          consecutive_failures: 2,
          disabled: false,
        }],
      ]);

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

      await applyCuratorCycle(response, 42, states);

      expect(mockRefreshSource).toHaveBeenCalled();
      expect(states.get('news')).toEqual({
        source: 'news',
        last_refresh_iteration: 42,
        consecutive_failures: 0,
        disabled: false,
      });
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

    it('handles appendJournal failure in retrospective', async () => {
      mockAppendJournal.mockRejectedValueOnce(new Error('disk full'));
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro', compressed_journal: 'Compressed',
        manifesto_changes: [], domain_recommendations: '',
        project_decisions: [], stimuli_actions: [], human_redirect: null,
      };

      await applyCuratorCycle(response, 10);
      const errOutput = errSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(errOutput).toContain('Failed to append retrospective');
      errSpy.mockRestore();
    });

    it('handles writeFile failure for compressed journal', async () => {
      // To fail writeFile for compressed journal, we make the identity dir unwritable
      // Simpler approach: remove the identity dir
      rmSync(path.join(tempDir, 'identity'), { recursive: true, force: true });
      // writeFile will fail if intermediate dir is missing and no recursive create
      // Actually writeFile just needs the dir to exist. Let's make the path a file instead.
      writeFileSync(path.join(tempDir, 'identity'), 'not a dir');

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro', compressed_journal: 'Compressed',
        manifesto_changes: [], domain_recommendations: '',
        project_decisions: [], stimuli_actions: [], human_redirect: null,
      };

      await applyCuratorCycle(response, 10);
      const errOutput = errSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(errOutput).toContain('Failed to write compressed journal');
      errSpy.mockRestore();
      // Restore identity dir for other tests
      rmSync(path.join(tempDir, 'identity'), { force: true });
      mkdirSync(path.join(tempDir, 'identity'), { recursive: true });
      writeFileSync(path.join(tempDir, 'identity', 'manifesto.md'), '# Manifesto\n', 'utf-8');
    });

    it('handles writeFile failure for domain recommendations', async () => {
      // Make curator-recommendations.md a directory so writeFile fails
      mkdirSync(path.join(tempDir, 'curator-recommendations.md'), { recursive: true });

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro', compressed_journal: 'Compressed',
        manifesto_changes: [], domain_recommendations: 'Recs',
        project_decisions: [], stimuli_actions: [], human_redirect: null,
      };

      await applyCuratorCycle(response, 10);
      const errOutput = errSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(errOutput).toContain('Failed to write domain recommendations');
      errSpy.mockRestore();
      rmSync(path.join(tempDir, 'curator-recommendations.md'), { recursive: true, force: true });
    });

    it('handles project decision failure', async () => {
      mockUpdateProjectStatus.mockRejectedValueOnce(new Error('project not found'));
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro', compressed_journal: 'Compressed',
        manifesto_changes: [], domain_recommendations: '',
        project_decisions: [{ project_id: 'P999', action: 'complete', reason: 'Done' }],
        stimuli_actions: [], human_redirect: null,
      };

      await applyCuratorCycle(response, 10);
      const errOutput = errSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(errOutput).toContain('Failed to apply project decision P999');
      errSpy.mockRestore();
    });

    it('handles stimuli refresh action failure', async () => {
      mockLoadStimuliConfig.mockResolvedValueOnce({
        mcp: { news: { server: 'tavily', max_items: 5, refresh_interval: 10 } },
        stimuli_ttl: 24, skills_per_context: 2,
      });
      mockRefreshSource.mockRejectedValueOnce(new Error('refresh failed'));
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro', compressed_journal: 'Compressed',
        manifesto_changes: [], domain_recommendations: '',
        project_decisions: [], stimuli_actions: [{ action: 'refresh', target: 'news' }],
        human_redirect: null,
      };

      await applyCuratorCycle(response, 10);
      const errOutput = errSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(errOutput).toContain('Failed to apply stimuli action');
      errSpy.mockRestore();
    });

    it('updates stimuli refresh state after failed curator refresh action', async () => {
      mockLoadStimuliConfig.mockResolvedValueOnce({
        mcp: { news: { server: 'tavily', max_items: 5, refresh_interval: 10 } },
        stimuli_ttl: 24,
        skills_per_context: 2,
      });
      mockRefreshSource.mockRejectedValueOnce(new Error('refresh failed'));
      const states = new Map<string, StimuliRefreshState>([
        ['news', {
          source: 'news',
          last_refresh_iteration: 12,
          consecutive_failures: 2,
          disabled: false,
        }],
      ]);
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

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

      await applyCuratorCycle(response, 42, states);

      expect(states.get('news')).toEqual({
        source: 'news',
        last_refresh_iteration: 12,
        consecutive_failures: 3,
        disabled: true,
      });
      errSpy.mockRestore();
    });

    it('handles summary journal entry failure', async () => {
      // Make the last appendJournal call fail
      // appendJournal is called multiple times; we need the last one to fail
      mockAppendJournal
        .mockResolvedValueOnce(undefined) // retrospective
        .mockRejectedValueOnce(new Error('disk full')); // summary
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro', compressed_journal: 'Compressed',
        manifesto_changes: [], domain_recommendations: '',
        project_decisions: [], stimuli_actions: [], human_redirect: null,
      };

      await applyCuratorCycle(response, 10);
      const errOutput = errSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(errOutput).toContain('Failed to log summary');
      errSpy.mockRestore();
    });

    it('handles manifesto change error in applyManifestoChange', async () => {
      // Make identity dir a file so readFile for manifesto fails
      rmSync(path.join(tempDir, 'identity', 'manifesto.md'), { force: true });
      // Make manifesto path a directory so readFile fails
      mkdirSync(path.join(tempDir, 'identity', 'manifesto.md'), { recursive: true });

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { applyCuratorCycle } = await import('../src/curator/index.js');
      const response: CuratorFullResponse = {
        retrospective: 'Retro', compressed_journal: 'Compressed',
        manifesto_changes: [{ section: 'Values', old: 'x', new: 'y', reason: 'test' }],
        domain_recommendations: '', project_decisions: [],
        stimuli_actions: [], human_redirect: null,
      };

      await applyCuratorCycle(response, 10);
      const errOutput = errSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(errOutput).toContain('Failed to apply manifesto change');
      errSpy.mockRestore();
      // Restore
      rmSync(path.join(tempDir, 'identity', 'manifesto.md'), { recursive: true, force: true });
      writeFileSync(path.join(tempDir, 'identity', 'manifesto.md'), '# Manifesto\n', 'utf-8');
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

    it('does not create stimuli refresh state for unknown curator refresh source', async () => {
      mockLoadStimuliConfig.mockResolvedValueOnce({
        mcp: {},
        stimuli_ttl: 24,
        skills_per_context: 2,
      });

      const states = new Map<string, StimuliRefreshState>();
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

      await applyCuratorCycle(response, 10, states);

      expect(mockRefreshSource).not.toHaveBeenCalled();
      expect(states.has('nonexistent-source')).toBe(false);
    });
  });
});
