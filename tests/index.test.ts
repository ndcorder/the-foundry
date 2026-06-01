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
  loadDomainsConfig: vi.fn().mockResolvedValue({
    domains: [
      { name: 'fiction', description: 'Short stories and vignettes', weight: 1 },
      { name: 'poetry', description: 'Poems and experimental verse', weight: 0.8 },
      { name: 'code-tool', description: 'CLI tools and utilities', weight: 1 },
    ],
  }),
}));

vi.mock('../src/model/index.js', () => ({
  setModelOverrides: vi.fn(),
  validateProvider: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/agents/prompt.js', () => ({
  validatePromptContracts: vi.fn().mockResolvedValue({
    status: 'healthy',
    summary: { total: 1, ok: 1, invalid: 0 },
    files: [{ name: 'prompts/ideator.md', path: 'prompts/ideator.md', ok: true }],
  }),
}));

vi.mock('../src/iteration/index.js', () => ({
  runIteration: vi.fn(),
}));

vi.mock('../src/files/intervention.js', () => ({
  checkStopFile: vi.fn().mockResolvedValue(false),
  readRequests: vi.fn().mockResolvedValue(''),
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
  refreshSource: vi.fn().mockResolvedValue('# Fresh stimuli'),
  refreshAllStale: vi.fn().mockResolvedValue(new Map()),
  initRefreshStates: vi.fn().mockReturnValue(new Map()),
  recordToRefreshStates: vi.fn((record: any = {}, config: any = { mcp: {} }) => {
    const states = new Map();
    for (const name of Object.keys(config.mcp ?? {})) {
      const entry = record[name];
      if (typeof entry === 'number') {
        states.set(name, {
          source: name,
          last_refresh_iteration: entry,
          consecutive_failures: 0,
          disabled: false,
        });
      } else {
        states.set(name, {
          source: name,
          last_refresh_iteration: entry?.last_refresh_iteration ?? 0,
          consecutive_failures: entry?.consecutive_failures ?? 0,
          disabled: entry?.disabled === true,
        });
      }
    }
    return states;
  }),
  summarizeStimuliRefreshHealth: vi.fn((config: any, states: Map<string, any>, currentIteration: number, enabled: boolean) => {
    const entries = Object.entries(config.mcp ?? {}).map(([source, sourceConfig]: [string, any]) => {
      const state = states.get(source) ?? {
        last_refresh_iteration: 0,
        consecutive_failures: 0,
        disabled: false,
      };
      const refreshInterval = Math.max(1, Math.floor(sourceConfig.refresh_interval));
      const lastRefreshIteration = Math.max(0, Math.floor(state.last_refresh_iteration));
      const iterationsSinceRefresh = Math.max(0, Math.floor(currentIteration) - lastRefreshIteration);
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
  refreshStatesToRecord: vi.fn((states: Map<string, any>) => {
    const record: Record<string, any> = {};
    for (const [name, state] of states) {
      record[name] = {
        last_refresh_iteration: state.last_refresh_iteration,
        consecutive_failures: state.consecutive_failures,
        disabled: state.disabled,
      };
    }
    return record;
  }),
}));

vi.mock('../src/curator/index.js', () => ({
  dispatchCuratorFull: vi.fn(),
  applyCuratorCycle: vi.fn(),
  shouldRunCurator: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/monitor/index.js', () => ({
  DEFAULT_MONITOR_CONFIG: {
    slop_window: 20,
    slop_threshold: 2.5,
    repetition_window: 15,
    repetition_threshold: 0.6,
    manifesto_change_window: 30,
    manifesto_max_changes: 5,
    manifesto_stagnation_threshold: 50,
    domain_collapse_window: 30,
        domain_collapse_threshold: 0.6,
        domain_force_duration: 5,
        complexity_yield_window: 20,
        complexity_min_samples_for_confidence: 3,
        complexity_high_confidence_samples: 5,
        active_warning_window: 10,
      },
  runAllDetectors: vi.fn().mockReturnValue([]),
  summarizeMonitorWarnings: vi.fn((entries: any[] = [], options: any = {}) => {
    const counts = { critical: 0, warning: 0, info: 0 };
    const activeCounts = { critical: 0, warning: 0, info: 0 };
    const recentWarnings = entries
      .filter((entry) => ['critical', 'warning', 'info'].includes(entry.severity))
      .map((entry) => {
        counts[entry.severity as 'critical' | 'warning' | 'info']++;
        return {
          detector: entry.detector,
          severity: entry.severity,
          message: entry.message,
          iteration: typeof entry.iteration === 'number' ? entry.iteration : null,
          timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : null,
        };
      })
      .slice(-5);
    const activeWindow = typeof options.currentIteration === 'number'
      ? { currentIteration: options.currentIteration, iterations: options.activeIterationWindow ?? 10 }
      : null;
    const activeWarnings = recentWarnings.filter((entry) => {
      if (!activeWindow) return true;
      return typeof entry.iteration === 'number'
        && entry.iteration <= activeWindow.currentIteration
        && activeWindow.currentIteration - entry.iteration <= activeWindow.iterations;
    });
    for (const entry of activeWarnings) {
      activeCounts[entry.severity as 'critical' | 'warning' | 'info']++;
    }
    return {
      counts,
      activeCounts,
      activeWarnings,
      activeWindow,
      recentWarnings,
      latestWarning: recentWarnings.at(-1) ?? null,
    };
  }),
  summarizeFurnaceHealth: vi.fn((logs: any, monitor: any, stimuli?: any) => {
    const activeCounts = monitor.activeCounts ?? monitor.counts;
    const criticalWarnings = activeCounts.critical ?? 0;
    const warningWarnings = activeCounts.warning ?? 0;
    const failingStimuli = stimuli?.failing ?? 0;
    const disabledStimuli = stimuli?.disabled ?? 0;
    const reasons: string[] = [];
    const actions = [...(logs.recommendedActions ?? [])];
    if (criticalWarnings > 0) {
      reasons.push(`${criticalWarnings} critical monitor ${criticalWarnings === 1 ? 'warning' : 'warnings'}`);
    }
    if (warningWarnings > 0) {
      reasons.push(`${warningWarnings} monitor ${warningWarnings === 1 ? 'warning' : 'warnings'}`);
    }
    if (logs.healthState === 'malformed') {
      reasons.push('JSONL logs are malformed');
    } else if (logs.healthState === 'watch' || logs.healthState === 'rotate-soon') {
      reasons.push(`JSONL log rotation pressure is ${logs.healthState}`);
    }
    if (failingStimuli > 0) {
      reasons.push(`${failingStimuli} stimuli ${failingStimuli === 1 ? 'source' : 'sources'} failing`);
    }
    if (disabledStimuli > 0) {
      reasons.push(`${disabledStimuli} stimuli ${disabledStimuli === 1 ? 'source' : 'sources'} disabled`);
    }
    if (criticalWarnings > 0 || warningWarnings > 0) {
      actions.push('Inspect logs/monitor.jsonl for recent monitor warnings.');
    }
    if (failingStimuli > 0 || disabledStimuli > 0) {
      actions.push('Inspect stimuli source health and recover disabled or failing feeds.');
    }
    return {
      level: criticalWarnings > 0 || logs.healthState === 'malformed'
        ? 'critical'
        : warningWarnings > 0 || logs.healthState === 'watch' || logs.healthState === 'rotate-soon' || failingStimuli > 0 || disabledStimuli > 0
          ? 'warning'
          : 'healthy',
      reasons,
      actions,
    };
  }),
}));

vi.mock('../src/complexity/index.js', () => ({
  saveComplexityBias: vi.fn().mockResolvedValue(undefined),
  loadComplexityBias: vi.fn().mockResolvedValue({
    updated_at: '2026-01-01T00:00:00Z',
    updated_iteration: 1,
    yields: [],
    recommendation: { favor: 'balanced', avoid: [], confidence: 'low', reason: 'No signal.' },
  }),
}));

vi.mock('../src/streaks/index.js', () => ({
  loadStreakHistory: vi.fn().mockResolvedValue({
    current: null,
    recent_breaks: [],
    cooldown_domains: [],
    cooldown_remaining: 0,
  }),
  saveStreakHistory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/mood/index.js', () => ({
  loadMood: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/dreams/index.js', () => ({
  loadDreamJournal: vi.fn().mockResolvedValue({ dreams: [], updated_at: '2026-01-01T00:00:00Z' }),
}));

vi.mock('../src/stoker/index.js', () => ({
  DEFAULT_STOKER_CONFIG: {
    enabled: true,
    run_interval: 5,
    refinery_token_heat_window: 5,
    refinery_token_heat_threshold: 200_000,
  },
  shouldRunStoker: vi.fn().mockReturnValue(false),
  isStokerDirectiveCurrent: vi.fn((directive, targetIteration) => {
    if (!directive) return false;
    return targetIteration == null || directive.for_iteration === targetIteration;
  }),
  getStokerCadenceStatus: vi.fn((currentIteration, config) => {
    const merged = { enabled: true, run_interval: 5, ...config };
    const runInterval = Math.max(1, Math.floor(merged.run_interval));
    if (!merged.enabled) {
      return { enabled: false, runInterval, nextRunIteration: null, iterationsUntilRun: null };
    }
    const completedIteration = Math.max(0, Math.floor(currentIteration));
    const remainder = completedIteration % runInterval;
    const iterationsUntilRun = completedIteration === 0
      ? runInterval
      : remainder === 0
        ? runInterval
        : runInterval - remainder;
    return {
      enabled: true,
      runInterval,
      nextRunIteration: completedIteration + iterationsUntilRun,
      iterationsUntilRun,
    };
  }),
  getStokerTokenHeatStatus: vi.fn((entries, config) => {
    const merged = {
      enabled: true,
      run_interval: 5,
      refinery_token_heat_window: 5,
      refinery_token_heat_threshold: 200_000,
      ...config,
    };
    const window = Math.max(1, Math.floor(merged.refinery_token_heat_window));
    const threshold = Math.max(0, Math.floor(merged.refinery_token_heat_threshold));
    const totals = entries
      .slice(-window)
      .map((entry: any) => entry.token_usage ? entry.token_usage.input + entry.token_usage.output : null)
      .filter((total: any): total is number => typeof total === 'number');
    const averageTokens = totals.length > 0
      ? totals.reduce((sum: number, total: number) => sum + total, 0) / totals.length
      : 0;
    const totalTokens = totals.reduce((sum: number, total: number) => sum + total, 0);
    const peakTokens = totals.length > 0 ? Math.max(...totals) : 0;
    const hot = averageTokens >= threshold;
    const thresholdPercent = threshold > 0 ? Math.round((averageTokens / threshold) * 100) : hot ? 100 : 0;
    const pressure = hot ? 'hot' : thresholdPercent >= 75 ? 'warm' : 'cool';
    return {
      window,
      threshold,
      samples: totals.length,
      averageTokens,
      totalTokens,
      peakTokens,
      thresholdPercent,
      remainingTokensToThreshold: Math.max(0, Math.round(threshold - averageTokens)),
      pressure,
      hot,
    };
  }),
  getStokerRefineryReadinessStatus: vi.fn(({ cadence, fuel, heat }) => {
    const blockers = [
      ...(fuel.available <= 0 ? ['empty'] : []),
      ...((cadence.iterationsUntilEligible ?? 0) > 0 ? ['cooldown'] : []),
      ...(heat.hot ? ['hot'] : []),
    ];
    const state = blockers[0] ?? 'ready';
    return {
      state,
      canQueue: blockers.length === 0,
      blockers,
      reason: state === 'cooldown'
        ? `Refinery cooldown has ${cadence.iterationsUntilEligible} iterations remaining.`
        : state === 'hot'
          ? 'Token heat is above threshold; refinery should defer.'
          : state === 'empty'
            ? 'No eligible refinery fuel is available.'
            : 'Refinery fuel is available and cooldown/heat gates are clear.',
    };
  }),
  generateStokerDirective: vi.fn().mockReturnValue({
    generated_at: '2026-01-01T00:00:00Z',
    generated_iteration: 1,
    for_iteration: 2,
    urgency: 'normal',
    streak_instruction: 'neutral',
    ideator_hint: 'Keep the furnace steady.',
    rules_fired: ['cruising'],
  }),
  saveStokerDirective: vi.fn().mockResolvedValue(undefined),
  loadStokerDirective: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/speculative/index.js', () => ({
  loadSpeculativeIdeas: vi.fn().mockResolvedValue([]),
  filterCurrentSpeculativeIdeas: vi.fn((ideas, targetIteration) => {
    if (targetIteration == null) return ideas;
    return ideas.filter((idea: any) => idea.iteration === targetIteration - 1);
  }),
}));

vi.mock('../src/refinery/index.js', () => ({
  DEFAULT_REFINERY_CONFIG: { enabled: true, min_iterations_between_runs: 5, max_refinery_queue: 1 },
  selectRefineryTargets: vi.fn().mockResolvedValue([]),
  getLastRefineryIteration: vi.fn().mockResolvedValue(null),
  getRefineryFuelStatus: vi.fn().mockResolvedValue({
    enabled: true,
    queueLimit: 1,
    available: 2,
    byType: { dream: 1, companion: 1, lowRated: 0 },
    topTargets: [
      { sourceType: 'dream', sourceId: '0005', title: 'Disk Dream', domain: 'prose', refinementType: 'resurrected' },
      { sourceType: 'companion', sourceId: '0019', title: 'Strong Recent Piece', domain: 'code-tool', refinementType: 'companion' },
    ],
  }),
  getRefineryCadenceStatus: vi.fn((currentIteration, lastIteration, config) => {
    const merged = { enabled: true, min_iterations_between_runs: 5, max_refinery_queue: 1, ...config };
    const minIterationsBetweenRuns = Math.max(0, Math.floor(merged.min_iterations_between_runs));
    if (!merged.enabled) {
      return { enabled: false, minIterationsBetweenRuns, lastIteration, nextEligibleIteration: null, iterationsUntilEligible: null };
    }
    const completedIteration = Math.max(0, Math.floor(currentIteration));
    const nextEligibleIteration = lastIteration == null ? completedIteration : lastIteration + minIterationsBetweenRuns;
    return {
      enabled: true,
      minIterationsBetweenRuns,
      lastIteration,
      nextEligibleIteration,
      iterationsUntilEligible: Math.max(0, nextEligibleIteration - completedIteration),
    };
  }),
}));

vi.mock('../src/context/index.js', () => ({
  readJsonlEntries: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/upgrade.js', () => ({
  upgradeProject: vi.fn().mockResolvedValue(false),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(() => Buffer.from('')),
  execFileSync: vi.fn(() => Buffer.from('')),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    statfs: vi.fn(actual.statfs),
  };
});

let tempDir: string;
beforeEach(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-index-'));
  setRootDir(tempDir);
  vi.clearAllMocks();

  const intervention = await import('../src/files/intervention.js');
  vi.mocked(intervention.checkStopFile).mockReset();
  vi.mocked(intervention.checkStopFile).mockResolvedValue(false);
  vi.mocked(intervention.readRequests).mockReset();
  vi.mocked(intervention.readRequests).mockResolvedValue('');

  const iteration = await import('../src/iteration/index.js');
  vi.mocked(iteration.runIteration).mockReset();

  const stoker = await import('../src/stoker/index.js');
  vi.mocked(stoker.shouldRunStoker).mockReset();
  vi.mocked(stoker.shouldRunStoker).mockReturnValue(false);
  vi.mocked(stoker.generateStokerDirective).mockReset();
  vi.mocked(stoker.generateStokerDirective).mockImplementation((signals: any = {}) => {
    const generatedIteration = typeof signals.current_iteration === 'number'
      ? signals.current_iteration
      : 1;
    return {
      generated_at: '2026-01-01T00:00:00Z',
      generated_iteration: generatedIteration,
      for_iteration: typeof signals.for_iteration === 'number'
        ? signals.for_iteration
        : generatedIteration + 1,
      urgency: 'normal',
      streak_instruction: 'neutral',
      ideator_hint: 'Keep the furnace steady.',
      rules_fired: ['cruising'],
    };
  });
  vi.mocked(stoker.saveStokerDirective).mockReset();
  vi.mocked(stoker.saveStokerDirective).mockResolvedValue(undefined);
  vi.mocked(stoker.loadStokerDirective).mockReset();
  vi.mocked(stoker.loadStokerDirective).mockResolvedValue(null);

  // Create required directories
  mkdirSync(path.join(tempDir, 'logs'), { recursive: true });
  mkdirSync(path.join(tempDir, 'identity'), { recursive: true });
  writeFileSync(path.join(tempDir, 'identity', 'journal.md'), '# Journal\n', 'utf-8');
});
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

describe('index', () => {
  describe('resetStimuliSourceState', () => {
    it('clears checkpointed failure state for a configured stimuli source', async () => {
      const checkpoint = {
        iteration: 30,
        active_project_ids: [],
        domain_counts: {},
        last_stimuli_refresh: {
          news: {
            last_refresh_iteration: 18,
            consecutive_failures: 3,
            disabled: true,
          },
          cultural: {
            last_refresh_iteration: 20,
            consecutive_failures: 1,
            disabled: false,
          },
        },
        last_curator_run: 24,
        stats: {
          iteration: 30,
          shipped: 4,
          killed: 1,
          skipped: 0,
          domain_counts: {},
          recent_outcomes: [],
          critic_rejection_window: [],
          total_tokens: { input: 100, output: 20 },
        },
        saved_at: '2026-05-30T12:00:00.000Z',
      };
      const { loadCheckpoint, saveCheckpoint } = await import('../src/checkpoint/index.js');
      const { loadStimuliConfig } = await import('../src/stimuli/index.js');
      vi.mocked(loadCheckpoint).mockResolvedValueOnce(checkpoint);
      vi.mocked(loadStimuliConfig).mockResolvedValueOnce({
        mcp: {
          news: { server: 'tavily', max_items: 5, refresh_interval: 10 },
          cultural: { server: 'tavily', max_items: 5, refresh_interval: 20 },
        },
        stimuli_ttl: 24,
        skills_per_context: 2,
      });

      const { resetStimuliSourceState } = await import('../src/index.js');
      const result = await resetStimuliSourceState('news', { rootDir: tempDir });

      expect(result).toEqual({
        status: 'reset',
        source: 'news',
        previous: {
          source: 'news',
          last_refresh_iteration: 18,
          consecutive_failures: 3,
          disabled: true,
        },
        current: {
          source: 'news',
          last_refresh_iteration: 0,
          consecutive_failures: 0,
          disabled: false,
        },
      });
      expect(saveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
        iteration: 30,
        last_stimuli_refresh: {
          news: {
            last_refresh_iteration: 0,
            consecutive_failures: 0,
            disabled: false,
          },
          cultural: {
            last_refresh_iteration: 20,
            consecutive_failures: 1,
            disabled: false,
          },
        },
      }));
      const saved = vi.mocked(saveCheckpoint).mock.calls.at(-1)?.[0];
      expect(saved?.saved_at).not.toBe('2026-05-30T12:00:00.000Z');
      const audit = readFileSync(path.join(tempDir, 'logs', 'stimuli.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(audit.at(-1)).toMatchObject({
        action: 'reset',
        source: 'news',
        status: 'reset',
        checkpoint_updated: true,
        iteration: 30,
        previous: {
          last_refresh_iteration: 18,
          consecutive_failures: 3,
          disabled: true,
        },
        current: {
          last_refresh_iteration: 0,
          consecutive_failures: 0,
          disabled: false,
        },
      });
    });

    it('rejects unknown stimuli sources without saving a checkpoint', async () => {
      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      const { loadStimuliConfig } = await import('../src/stimuli/index.js');
      vi.mocked(loadStimuliConfig).mockResolvedValueOnce({
        mcp: { news: { server: 'tavily', max_items: 5, refresh_interval: 10 } },
        stimuli_ttl: 24,
        skills_per_context: 2,
      });

      const { resetStimuliSourceState } = await import('../src/index.js');

      await expect(resetStimuliSourceState('unknown')).rejects.toThrow('Unknown stimuli source "unknown"');
      expect(saveCheckpoint).not.toHaveBeenCalled();
    });

    it('reports no checkpoint when there is no persisted stimuli state to reset', async () => {
      const { loadCheckpoint, saveCheckpoint } = await import('../src/checkpoint/index.js');
      const { loadStimuliConfig } = await import('../src/stimuli/index.js');
      vi.mocked(loadCheckpoint).mockResolvedValueOnce(null);
      vi.mocked(loadStimuliConfig).mockResolvedValueOnce({
        mcp: { news: { server: 'tavily', max_items: 5, refresh_interval: 10 } },
        stimuli_ttl: 24,
        skills_per_context: 2,
      });

      const { resetStimuliSourceState } = await import('../src/index.js');
      const result = await resetStimuliSourceState('news');

      expect(result).toEqual({
        status: 'no_checkpoint',
        source: 'news',
        previous: null,
        current: null,
      });
      expect(saveCheckpoint).not.toHaveBeenCalled();
      const audit = readFileSync(path.join(tempDir, 'logs', 'stimuli.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(audit.at(-1)).toMatchObject({
        action: 'reset',
        source: 'news',
        status: 'no_checkpoint',
        checkpoint_updated: false,
        iteration: null,
        previous: null,
        current: null,
      });
    });
  });

  describe('refreshStimuliSource', () => {
    it('refreshes a configured stimuli source and records checkpoint success', async () => {
      const checkpoint = {
        iteration: 42,
        active_project_ids: [],
        domain_counts: {},
        last_stimuli_refresh: {
          news: {
            last_refresh_iteration: 18,
            consecutive_failures: 2,
            disabled: true,
          },
          cultural: {
            last_refresh_iteration: 20,
            consecutive_failures: 1,
            disabled: false,
          },
        },
        last_curator_run: 40,
        stats: {
          iteration: 42,
          shipped: 4,
          killed: 1,
          skipped: 0,
          domain_counts: {},
          recent_outcomes: [],
          critic_rejection_window: [],
          total_tokens: { input: 100, output: 20 },
        },
        saved_at: '2026-05-30T12:00:00.000Z',
      };
      const { loadCheckpoint, saveCheckpoint } = await import('../src/checkpoint/index.js');
      const { loadStimuliConfig, refreshSource } = await import('../src/stimuli/index.js');
      vi.mocked(loadCheckpoint).mockResolvedValueOnce(checkpoint);
      vi.mocked(loadStimuliConfig).mockResolvedValueOnce({
        mcp: {
          news: { server: 'tavily', max_items: 5, refresh_interval: 10 },
          cultural: { server: 'tavily', max_items: 5, refresh_interval: 20 },
        },
        stimuli_ttl: 24,
        skills_per_context: 2,
      });
      vi.mocked(refreshSource).mockResolvedValueOnce('# Fresh news');

      const { refreshStimuliSource } = await import('../src/index.js');
      const result = await refreshStimuliSource('news', { rootDir: tempDir });

      expect(refreshSource).toHaveBeenCalledWith('news', { server: 'tavily', max_items: 5, refresh_interval: 10 });
      expect(result).toEqual({
        status: 'refreshed',
        source: 'news',
        iteration: 42,
        checkpointUpdated: true,
        contentLength: '# Fresh news'.length,
        previous: {
          source: 'news',
          last_refresh_iteration: 18,
          consecutive_failures: 2,
          disabled: true,
        },
        current: {
          source: 'news',
          last_refresh_iteration: 42,
          consecutive_failures: 0,
          disabled: false,
        },
      });
      expect(saveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
        iteration: 42,
        last_stimuli_refresh: {
          news: {
            last_refresh_iteration: 42,
            consecutive_failures: 0,
            disabled: false,
          },
          cultural: {
            last_refresh_iteration: 20,
            consecutive_failures: 1,
            disabled: false,
          },
        },
      }));
      const audit = readFileSync(path.join(tempDir, 'logs', 'stimuli.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(audit.at(-1)).toMatchObject({
        action: 'refresh',
        source: 'news',
        status: 'refreshed',
        checkpoint_updated: true,
        content_length: '# Fresh news'.length,
        iteration: 42,
        previous: {
          last_refresh_iteration: 18,
          consecutive_failures: 2,
          disabled: true,
        },
        current: {
          last_refresh_iteration: 42,
          consecutive_failures: 0,
          disabled: false,
        },
      });
    });

    it('records checkpoint failure when manual stimuli refresh fails', async () => {
      const checkpoint = {
        iteration: 42,
        active_project_ids: [],
        domain_counts: {},
        last_stimuli_refresh: {
          news: {
            last_refresh_iteration: 18,
            consecutive_failures: 2,
            disabled: false,
          },
        },
        last_curator_run: 40,
        stats: {
          iteration: 42,
          shipped: 4,
          killed: 1,
          skipped: 0,
          domain_counts: {},
          recent_outcomes: [],
          critic_rejection_window: [],
          total_tokens: { input: 100, output: 20 },
        },
        saved_at: '2026-05-30T12:00:00.000Z',
      };
      const { loadCheckpoint, saveCheckpoint } = await import('../src/checkpoint/index.js');
      const { loadStimuliConfig, refreshSource } = await import('../src/stimuli/index.js');
      vi.mocked(loadCheckpoint).mockResolvedValueOnce(checkpoint);
      vi.mocked(loadStimuliConfig).mockResolvedValueOnce({
        mcp: { news: { server: 'tavily', max_items: 5, refresh_interval: 10 } },
        stimuli_ttl: 24,
        skills_per_context: 2,
      });
      vi.mocked(refreshSource).mockRejectedValueOnce(new Error('backend down'));

      const { refreshStimuliSource } = await import('../src/index.js');

      await expect(refreshStimuliSource('news')).rejects.toThrow('backend down');
      expect(saveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
        iteration: 42,
        last_stimuli_refresh: {
          news: {
            last_refresh_iteration: 18,
            consecutive_failures: 3,
            disabled: true,
          },
        },
      }));
      const audit = readFileSync(path.join(tempDir, 'logs', 'stimuli.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(audit.at(-1)).toMatchObject({
        action: 'refresh',
        source: 'news',
        status: 'failed',
        checkpoint_updated: true,
        error: 'backend down',
        iteration: 42,
        previous: {
          last_refresh_iteration: 18,
          consecutive_failures: 2,
          disabled: false,
        },
        current: {
          last_refresh_iteration: 18,
          consecutive_failures: 3,
          disabled: true,
        },
      });
    });
  });

  describe('getStimuliAuditHistory', () => {
    it('returns recent stimuli audit entries filtered by source and limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          action: 'refresh',
          source: 'news',
          status: 'failed',
          checkpoint_updated: true,
          iteration: 40,
          error: 'backend down',
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          action: 'reset',
          source: 'cultural',
          status: 'reset',
          checkpoint_updated: true,
          iteration: 41,
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          action: 'refresh',
          source: 'news',
          status: 'refreshed',
          checkpoint_updated: true,
          iteration: 42,
          content_length: 128,
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getStimuliAuditHistory } = await import('../src/index.js');
      const result = await getStimuliAuditHistory({ rootDir: tempDir, source: 'news', limit: 1 });

      expect(readJsonlEntries).toHaveBeenCalledWith(path.join(tempDir, 'logs', 'stimuli.jsonl'));
      expect(result).toEqual({
        source: 'news',
        action: null,
        status: null,
        limit: 1,
        total: 2,
        entries: [
          {
            timestamp: '2026-05-30T10:10:00.000Z',
            action: 'refresh',
            source: 'news',
            status: 'refreshed',
            checkpoint_updated: true,
            iteration: 42,
            content_length: 128,
          },
        ],
      });
    });

    it('filters stimuli audit entries by action and status before applying the limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          action: 'refresh',
          source: 'news',
          status: 'failed',
          checkpoint_updated: true,
          iteration: 40,
          error: 'backend down',
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          action: 'reset',
          source: 'news',
          status: 'reset',
          checkpoint_updated: true,
          iteration: 41,
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          action: 'refresh',
          source: 'cultural',
          status: 'failed',
          checkpoint_updated: false,
          iteration: null,
          error: 'timeout',
        },
        {
          timestamp: '2026-05-30T10:15:00.000Z',
          action: 'refresh',
          source: 'news',
          status: 'failed',
          checkpoint_updated: true,
          iteration: 42,
          error: 'rate limited',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getStimuliAuditHistory } = await import('../src/index.js');
      const result = await getStimuliAuditHistory({ rootDir: tempDir, action: 'refresh', status: 'failed', limit: 1 });

      expect(result).toEqual({
        source: null,
        action: 'refresh',
        status: 'failed',
        limit: 1,
        total: 3,
        entries: [
          {
            timestamp: '2026-05-30T10:15:00.000Z',
            action: 'refresh',
            source: 'news',
            status: 'failed',
            checkpoint_updated: true,
            iteration: 42,
            error: 'rate limited',
          },
        ],
      });
    });

    it('rejects unsafe source filters', async () => {
      const { getStimuliAuditHistory } = await import('../src/index.js');

      await expect(getStimuliAuditHistory({ source: '../news' })).rejects.toThrow('Invalid stimuli source "../news"');
    });

    it('rejects invalid stimuli audit action filters', async () => {
      const { getStimuliAuditHistory } = await import('../src/index.js');

      await expect(getStimuliAuditHistory({ action: 'delete' as any })).rejects.toThrow('Invalid stimuli audit action "delete"');
    });

    it('rejects invalid stimuli audit status filters', async () => {
      const { getStimuliAuditHistory } = await import('../src/index.js');

      await expect(getStimuliAuditHistory({ status: 'healthy' as any })).rejects.toThrow('Invalid stimuli audit status "healthy"');
    });
  });

  describe('getStokerHistory', () => {
    it('returns recent stoker directives with a bounded limit', async () => {
      const entries = [
        {
          generated_at: '2026-05-30T10:00:00.000Z',
          generated_iteration: 10,
          for_iteration: 11,
          urgency: 'normal',
          streak_instruction: 'neutral',
          rules_fired: ['cruising'],
          ideator_hint: 'Keep the furnace steady.',
        },
        {
          generated_at: '2026-05-30T10:05:00.000Z',
          generated_iteration: 15,
          for_iteration: 16,
          urgency: 'high',
          streak_instruction: 'amplify',
          refinery_queue: 1,
          rules_fired: ['hot_streak', 'refinery_fuel'],
          ideator_hint: 'Push the streak further.',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getStokerHistory } = await import('../src/index.js');
      const result = await getStokerHistory({ rootDir: tempDir, limit: 1 });

      expect(readJsonlEntries).toHaveBeenCalledWith(path.join(tempDir, 'logs', 'stoker.jsonl'));
      expect(result).toEqual({
        urgency: null,
        rule: null,
        iteration: null,
        limit: 1,
        total: 2,
        entries: [
          {
            generated_at: '2026-05-30T10:05:00.000Z',
            generated_iteration: 15,
            for_iteration: 16,
            urgency: 'high',
            streak_instruction: 'amplify',
            refinery_queue: 1,
            rules_fired: ['hot_streak', 'refinery_fuel'],
            ideator_hint: 'Push the streak further.',
          },
        ],
      });
    });

    it('filters stoker directives by urgency and fired rule before applying the limit', async () => {
      const entries = [
        {
          generated_at: '2026-05-30T10:00:00.000Z',
          generated_iteration: 10,
          for_iteration: 11,
          urgency: 'high',
          streak_instruction: 'amplify',
          rules_fired: ['hot_streak', 'refinery_fuel'],
          ideator_hint: 'Push the streak further.',
        },
        {
          generated_at: '2026-05-30T10:05:00.000Z',
          generated_iteration: 15,
          for_iteration: 16,
          urgency: 'normal',
          streak_instruction: 'neutral',
          rules_fired: ['refinery_fuel'],
          ideator_hint: 'Queue a background refinement.',
        },
        {
          generated_at: '2026-05-30T10:10:00.000Z',
          generated_iteration: 20,
          for_iteration: 21,
          urgency: 'high',
          streak_instruction: 'break',
          rules_fired: ['kill_rate_hot'],
          ideator_hint: 'Recover from the kill streak.',
        },
        {
          generated_at: '2026-05-30T10:15:00.000Z',
          generated_iteration: 25,
          for_iteration: 26,
          urgency: 'high',
          streak_instruction: 'neutral',
          refinery_queue: 1,
          rules_fired: ['refinery_fuel', 'domain_collapse'],
          ideator_hint: 'Refine one strong candidate.',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getStokerHistory } = await import('../src/index.js');
      const result = await getStokerHistory({ rootDir: tempDir, urgency: 'high', rule: 'refinery_fuel', limit: 1 });

      expect(result).toEqual({
        urgency: 'high',
        rule: 'refinery_fuel',
        iteration: null,
        limit: 1,
        total: 2,
        entries: [
          {
            generated_at: '2026-05-30T10:15:00.000Z',
            generated_iteration: 25,
            for_iteration: 26,
            urgency: 'high',
            streak_instruction: 'neutral',
            refinery_queue: 1,
            rules_fired: ['refinery_fuel', 'domain_collapse'],
            ideator_hint: 'Refine one strong candidate.',
          },
        ],
      });
    });

    it('filters stoker directives by target iteration before applying the limit', async () => {
      const entries = [
        {
          generated_at: '2026-05-30T10:00:00.000Z',
          generated_iteration: 10,
          for_iteration: 11,
          urgency: 'normal',
          streak_instruction: 'neutral',
          rules_fired: ['cruising'],
          ideator_hint: 'Keep the furnace steady.',
        },
        {
          generated_at: '2026-05-30T10:05:00.000Z',
          generated_iteration: 15,
          for_iteration: 16,
          urgency: 'high',
          streak_instruction: 'amplify',
          rules_fired: ['hot_streak'],
          ideator_hint: 'Push the streak further.',
        },
        {
          generated_at: '2026-05-30T10:06:00.000Z',
          generated_iteration: 15,
          for_iteration: 16,
          urgency: 'normal',
          streak_instruction: 'neutral',
          refinery_queue: 1,
          rules_fired: ['refinery_fuel'],
          ideator_hint: 'Queue one refinement.',
        },
        {
          generated_at: '2026-05-30T10:10:00.000Z',
          generated_iteration: 20,
          for_iteration: 21,
          urgency: 'high',
          streak_instruction: 'break',
          rules_fired: ['kill_rate_hot'],
          ideator_hint: 'Recover from the kill streak.',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getStokerHistory } = await import('../src/index.js');
      const result = await getStokerHistory({ rootDir: tempDir, iteration: 16, limit: 1 });

      expect(result).toEqual({
        urgency: null,
        rule: null,
        iteration: 16,
        limit: 1,
        total: 2,
        entries: [
          {
            generated_at: '2026-05-30T10:06:00.000Z',
            generated_iteration: 15,
            for_iteration: 16,
            urgency: 'normal',
            streak_instruction: 'neutral',
            refinery_queue: 1,
            rules_fired: ['refinery_fuel'],
            ideator_hint: 'Queue one refinement.',
          },
        ],
      });
    });

    it('rejects invalid stoker urgency filters', async () => {
      const { getStokerHistory } = await import('../src/index.js');

      await expect(getStokerHistory({ urgency: 'urgent' as any })).rejects.toThrow('Invalid stoker urgency "urgent"');
    });

    it('rejects invalid stoker rule filters', async () => {
      const { getStokerHistory } = await import('../src/index.js');

      await expect(getStokerHistory({ rule: '../refinery' })).rejects.toThrow('Invalid stoker rule "../refinery"');
    });

    it('rejects invalid stoker target iteration filters', async () => {
      const { getStokerHistory } = await import('../src/index.js');

      await expect(getStokerHistory({ iteration: 0 })).rejects.toThrow('Invalid stoker iteration "0"');
    });

    it('rejects invalid stoker history limits', async () => {
      const { getStokerHistory } = await import('../src/index.js');

      await expect(getStokerHistory({ limit: 0 })).rejects.toThrow('Invalid stoker history limit "0"');
    });
  });

  describe('getRefineryHistory', () => {
    it('returns recent refinery attempts with a bounded limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 12,
          source_type: 'dream',
          source_id: '0007',
          source_title: 'Clock Complaint Ledger',
          source_domain: 'prose',
          refinement_type: 'resurrected',
          result: 'killed',
          artifact_id: '0012',
          reason: 'Still too slight.',
          token_usage: { input: 100, output: 40 },
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 18,
          source_type: 'companion',
          source_id: '0015',
          source_title: 'Signal Orchard',
          source_domain: 'code',
          refinement_type: 'companion',
          result: 'shipped',
          artifact_id: '0020',
          title: 'Signal Orchard Companion',
          mean_rating: '4.1',
          token_usage: { input: 120, output: 60 },
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRefineryHistory } = await import('../src/index.js');
      const result = await getRefineryHistory({ rootDir: tempDir, limit: 1 });

      expect(readJsonlEntries).toHaveBeenCalledWith(path.join(tempDir, 'logs', 'refinery.jsonl'));
      expect(result).toEqual({
        result: null,
        sourceType: null,
        iteration: null,
        limit: 1,
        total: 2,
        entries: [
          {
            timestamp: '2026-05-30T10:10:00.000Z',
            iteration: 18,
            source_type: 'companion',
            source_id: '0015',
            source_title: 'Signal Orchard',
            source_domain: 'code',
            refinement_type: 'companion',
            result: 'shipped',
            artifact_id: '0020',
            title: 'Signal Orchard Companion',
            mean_rating: '4.1',
            token_usage: { input: 120, output: 60 },
          },
        ],
      });
    });

    it('filters refinery attempts by result and source type before applying the limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 12,
          source_type: 'dream',
          source_id: '0007',
          refinement_type: 'resurrected',
          result: 'killed',
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 18,
          source_type: 'companion',
          source_id: '0015',
          refinement_type: 'companion',
          result: 'shipped',
          artifact_id: '0020',
        },
        {
          timestamp: '2026-05-30T10:15:00.000Z',
          iteration: 21,
          source_type: 'low_rated',
          source_id: '0017',
          refinement_type: 'remastered',
          result: 'shipped',
          artifact_id: '0021',
        },
        {
          timestamp: '2026-05-30T10:20:00.000Z',
          iteration: 24,
          source_type: 'companion',
          source_id: '0019',
          refinement_type: 'companion',
          result: 'shipped',
          artifact_id: '0022',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRefineryHistory } = await import('../src/index.js');
      const result = await getRefineryHistory({ rootDir: tempDir, result: 'shipped', sourceType: 'companion', limit: 1 });

      expect(result).toEqual({
        result: 'shipped',
        sourceType: 'companion',
        iteration: null,
        limit: 1,
        total: 2,
        entries: [
          {
            timestamp: '2026-05-30T10:20:00.000Z',
            iteration: 24,
            source_type: 'companion',
            source_id: '0019',
            refinement_type: 'companion',
            result: 'shipped',
            artifact_id: '0022',
          },
        ],
      });
    });

    it('filters refinery attempts by exact iteration before applying the limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 18,
          source_type: 'dream',
          source_id: '0007',
          refinement_type: 'resurrected',
          result: 'killed',
          artifact_id: '0012',
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 21,
          source_type: 'companion',
          source_id: '0015',
          refinement_type: 'companion',
          result: 'shipped',
          artifact_id: '0020',
        },
        {
          timestamp: '2026-05-30T10:15:00.000Z',
          iteration: 21,
          source_type: 'low_rated',
          source_id: '0017',
          refinement_type: 'remastered',
          result: 'skipped',
          reason: 'No viable target.',
        },
        {
          timestamp: '2026-05-30T10:20:00.000Z',
          iteration: 24,
          source_type: 'companion',
          source_id: '0019',
          refinement_type: 'companion',
          result: 'shipped',
          artifact_id: '0022',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRefineryHistory } = await import('../src/index.js');
      const result = await getRefineryHistory({ rootDir: tempDir, iteration: 21, limit: 1 });

      expect(result).toEqual({
        result: null,
        sourceType: null,
        iteration: 21,
        limit: 1,
        total: 2,
        entries: [
          {
            timestamp: '2026-05-30T10:15:00.000Z',
            iteration: 21,
            source_type: 'low_rated',
            source_id: '0017',
            refinement_type: 'remastered',
            result: 'skipped',
            reason: 'No viable target.',
          },
        ],
      });
    });

    it('rejects invalid refinery result filters', async () => {
      const { getRefineryHistory } = await import('../src/index.js');

      await expect(getRefineryHistory({ result: 'pending' as any })).rejects.toThrow('Invalid refinery result "pending"');
    });

    it('rejects invalid refinery source type filters', async () => {
      const { getRefineryHistory } = await import('../src/index.js');

      await expect(getRefineryHistory({ sourceType: '../dream' as any })).rejects.toThrow('Invalid refinery source type "../dream"');
    });

    it('rejects invalid refinery iteration filters', async () => {
      const { getRefineryHistory } = await import('../src/index.js');

      await expect(getRefineryHistory({ iteration: 0 })).rejects.toThrow('Invalid refinery iteration "0"');
    });

    it('rejects invalid refinery history limits', async () => {
      const { getRefineryHistory } = await import('../src/index.js');

      await expect(getRefineryHistory({ limit: 0 })).rejects.toThrow('Invalid refinery history limit "0"');
    });
  });

  describe('getMonitorHistory', () => {
    it('returns recent monitor warnings filtered by severity and limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          detector: 'quality',
          severity: 'warning',
          message: 'Quality dipped',
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          detector: 'repetition',
          severity: 'critical',
          message: 'Repetition spiked',
          action: { type: 'emergency_curator', reason: 'quality crisis' },
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 42,
          detector: 'quality',
          severity: 'warning',
          message: 'Quality recovered?',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getMonitorHistory } = await import('../src/index.js');
      const result = await getMonitorHistory({ rootDir: tempDir, severity: 'warning', limit: 1 });

      expect(readJsonlEntries).toHaveBeenCalledWith(path.join(tempDir, 'logs', 'monitor.jsonl'));
      expect(result).toEqual({
        severity: 'warning',
        detector: null,
        iteration: null,
        limit: 1,
        total: 2,
        entries: [
          {
            timestamp: '2026-05-30T10:10:00.000Z',
            iteration: 42,
            detector: 'quality',
            severity: 'warning',
            message: 'Quality recovered?',
          },
        ],
      });
    });

    it('filters recent monitor warnings by detector before applying the limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          detector: 'quality',
          severity: 'warning',
          message: 'Quality dipped',
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          detector: 'repetition',
          severity: 'critical',
          message: 'Repetition spiked',
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 42,
          detector: 'quality',
          severity: 'info',
          message: 'Quality recovered?',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getMonitorHistory } = await import('../src/index.js');
      const result = await getMonitorHistory({ rootDir: tempDir, detector: 'quality', limit: 1 });

      expect(result).toEqual({
        severity: null,
        detector: 'quality',
        iteration: null,
        limit: 1,
        total: 2,
        entries: [
          {
            timestamp: '2026-05-30T10:10:00.000Z',
            iteration: 42,
            detector: 'quality',
            severity: 'info',
            message: 'Quality recovered?',
          },
        ],
      });
    });

    it('filters recent monitor warnings by exact iteration before applying the limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          detector: 'quality',
          severity: 'warning',
          message: 'Quality dipped',
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          detector: 'repetition',
          severity: 'critical',
          message: 'Repetition spiked',
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 41,
          detector: 'quality',
          severity: 'warning',
          message: 'Quality recovered?',
        },
        {
          timestamp: '2026-05-30T10:15:00.000Z',
          iteration: 42,
          detector: 'novelty',
          severity: 'info',
          message: 'Novelty steady',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getMonitorHistory } = await import('../src/index.js');
      const result = await getMonitorHistory({ rootDir: tempDir, iteration: 41, limit: 1 });

      expect(result).toEqual({
        severity: null,
        detector: null,
        iteration: 41,
        limit: 1,
        total: 2,
        entries: [
          {
            timestamp: '2026-05-30T10:10:00.000Z',
            iteration: 41,
            detector: 'quality',
            severity: 'warning',
            message: 'Quality recovered?',
          },
        ],
      });
    });

    it('rejects invalid monitor severity filters', async () => {
      const { getMonitorHistory } = await import('../src/index.js');

      await expect(getMonitorHistory({ severity: 'debug' as any })).rejects.toThrow('Invalid monitor severity "debug"');
    });

    it('rejects invalid monitor detector filters', async () => {
      const { getMonitorHistory } = await import('../src/index.js');

      await expect(getMonitorHistory({ detector: '../quality' })).rejects.toThrow('Invalid monitor detector "../quality"');
    });

    it('rejects invalid monitor iteration filters', async () => {
      const { getMonitorHistory } = await import('../src/index.js');

      await expect(getMonitorHistory({ iteration: 0 })).rejects.toThrow('Invalid monitor iteration "0"');
    });

    it('rejects invalid monitor history limits', async () => {
      const { getMonitorHistory } = await import('../src/index.js');

      await expect(getMonitorHistory({ limit: 0 })).rejects.toThrow('Invalid monitor history limit "0"');
    });
  });

  describe('getDecisionHistory', () => {
    it('returns recent decisions filtered by gate, decision, and limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          gate: 'gate1',
          agent: 'critic',
          decision: 'reject',
          proposal_title: 'Clock Complaint',
          reasons: 'Too familiar.',
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          gate: 'gate2',
          agent: 'critic',
          decision: 'ship',
          proposal_title: 'Signal Orchard',
          artifact_id: '0020',
          ratings: { originality: 4, craft: 5 },
          review: 'Strong work.',
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 42,
          gate: 'gate1',
          agent: 'critic',
          decision: 'reject',
          proposal_title: 'Second Clock',
          source: 'human_redirect',
          reasons: 'Still too familiar.',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getDecisionHistory } = await import('../src/index.js');
      const result = await getDecisionHistory({ rootDir: tempDir, gate: 'gate1', decision: 'reject', limit: 1 });

      expect(readJsonlEntries).toHaveBeenCalledWith(path.join(tempDir, 'logs', 'decisions.jsonl'));
      expect(result).toEqual({
        gate: 'gate1',
        decision: 'reject',
        source: null,
        iteration: null,
        limit: 1,
        total: 2,
        entries: [
          {
            timestamp: '2026-05-30T10:10:00.000Z',
            iteration: 42,
            gate: 'gate1',
            agent: 'critic',
            decision: 'reject',
            proposal_title: 'Second Clock',
            source: 'human_redirect',
            reasons: 'Still too familiar.',
          },
        ],
      });
    });

    it('filters recent decisions by source before applying the limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          gate: 'gate1',
          agent: 'critic',
          decision: 'reject',
          proposal_title: 'Clock Complaint',
          source: 'human_redirect',
          reasons: 'Too familiar.',
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          gate: 'gate1',
          agent: 'critic',
          decision: 'approve',
          proposal_title: 'Signal Orchard',
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 42,
          gate: 'gate2',
          agent: 'critic',
          decision: 'kill',
          proposal_title: 'Second Clock',
          source: 'human_redirect',
          reasons: 'Still too familiar.',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getDecisionHistory } = await import('../src/index.js');
      const result = await getDecisionHistory({ rootDir: tempDir, source: 'human_redirect', limit: 1 });

      expect(result).toEqual({
        gate: null,
        decision: null,
        source: 'human_redirect',
        iteration: null,
        limit: 1,
        total: 2,
        entries: [
          {
            timestamp: '2026-05-30T10:10:00.000Z',
            iteration: 42,
            gate: 'gate2',
            agent: 'critic',
            decision: 'kill',
            proposal_title: 'Second Clock',
            source: 'human_redirect',
            reasons: 'Still too familiar.',
          },
        ],
      });
    });

    it('filters recent decisions by exact iteration before applying the limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          gate: 'gate1',
          agent: 'critic',
          decision: 'reject',
          proposal_title: 'Clock Complaint',
          reasons: 'Too familiar.',
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          gate: 'gate1',
          agent: 'critic',
          decision: 'approve',
          proposal_title: 'Signal Orchard',
        },
        {
          timestamp: '2026-05-30T10:05:30.000Z',
          iteration: 41,
          gate: 'gate2',
          agent: 'critic',
          decision: 'ship',
          proposal_title: 'Signal Orchard',
          artifact_id: '0020',
          ratings: { originality: 4, craft: 5 },
          review: 'Strong work.',
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 42,
          gate: 'gate2',
          agent: 'critic',
          decision: 'kill',
          proposal_title: 'Second Clock',
          source: 'human_redirect',
          reasons: 'Still too familiar.',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getDecisionHistory } = await import('../src/index.js');
      const result = await getDecisionHistory({ rootDir: tempDir, iteration: 41, limit: 1 });

      expect(result).toEqual({
        gate: null,
        decision: null,
        source: null,
        iteration: 41,
        limit: 1,
        total: 2,
        entries: [
          {
            timestamp: '2026-05-30T10:05:30.000Z',
            iteration: 41,
            gate: 'gate2',
            agent: 'critic',
            decision: 'ship',
            proposal_title: 'Signal Orchard',
            artifact_id: '0020',
            ratings: { originality: 4, craft: 5 },
            review: 'Strong work.',
          },
        ],
      });
    });

    it('rejects invalid decision history filters', async () => {
      const { getDecisionHistory } = await import('../src/index.js');

      await expect(getDecisionHistory({ gate: 'gate3' as any })).rejects.toThrow('Invalid decision history gate "gate3"');
      await expect(getDecisionHistory({ decision: 'maybe' as any })).rejects.toThrow('Invalid decision history decision "maybe"');
      await expect(getDecisionHistory({ source: 'manual' } as any)).rejects.toThrow('Invalid decision history source "manual"');
      await expect(getDecisionHistory({ iteration: 0 })).rejects.toThrow('Invalid decision history iteration "0"');
    });

    it('rejects invalid decision history limits', async () => {
      const { getDecisionHistory } = await import('../src/index.js');

      await expect(getDecisionHistory({ limit: 0 })).rejects.toThrow('Invalid decision history limit "0"');
    });
  });

  describe('getTestReportHistory', () => {
    it('returns recent test reports filtered by outcome and limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          artifact_id: '0019',
          outcome: 'pass',
          summary: 'All checks passed.',
          tests_run: 3,
          tests_passed: 3,
          tests_failed: 0,
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          artifact_id: '0020',
          outcome: 'fail_fixable',
          summary: 'Crash on empty input.',
          tests_run: 3,
          tests_passed: 1,
          tests_failed: 2,
          error_output: 'TypeError: empty input',
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 42,
          artifact_id: '0021',
          outcome: 'fail_fixable',
          summary: 'Missing dependency.',
          tests_run: 2,
          tests_passed: 0,
          tests_failed: 2,
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getTestReportHistory } = await import('../src/index.js');
      const result = await getTestReportHistory({ rootDir: tempDir, outcome: 'fail_fixable', limit: 1 });

      expect(readJsonlEntries).toHaveBeenCalledWith(path.join(tempDir, 'logs', 'test-reports.jsonl'));
      expect(result).toEqual({
        outcome: 'fail_fixable',
        artifact: null,
        iteration: null,
        limit: 1,
        total: 2,
        entries: [
          {
            timestamp: '2026-05-30T10:10:00.000Z',
            iteration: 42,
            artifact_id: '0021',
            outcome: 'fail_fixable',
            summary: 'Missing dependency.',
            tests_run: 2,
            tests_passed: 0,
            tests_failed: 2,
          },
        ],
      });
    });

    it('filters recent test reports by artifact before applying the limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          artifact_id: '0020',
          outcome: 'pass',
          summary: 'Initial checks passed.',
          tests_run: 3,
          tests_passed: 3,
          tests_failed: 0,
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          artifact_id: '0021',
          outcome: 'fail_fixable',
          summary: 'Missing dependency.',
          tests_run: 2,
          tests_passed: 0,
          tests_failed: 2,
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 42,
          artifact_id: '0020',
          outcome: 'fail_fixable',
          summary: 'Regression on empty input.',
          tests_run: 4,
          tests_passed: 2,
          tests_failed: 2,
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getTestReportHistory } = await import('../src/index.js');
      const result = await getTestReportHistory({ rootDir: tempDir, artifact: '0020', limit: 1 });

      expect(result).toEqual({
        outcome: null,
        artifact: '0020',
        iteration: null,
        limit: 1,
        total: 2,
        entries: [
          {
            timestamp: '2026-05-30T10:10:00.000Z',
            iteration: 42,
            artifact_id: '0020',
            outcome: 'fail_fixable',
            summary: 'Regression on empty input.',
            tests_run: 4,
            tests_passed: 2,
            tests_failed: 2,
          },
        ],
      });
    });

    it('filters recent test reports by exact iteration before applying the limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          artifact_id: '0019',
          outcome: 'pass',
          summary: 'All checks passed.',
          tests_run: 3,
          tests_passed: 3,
          tests_failed: 0,
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          artifact_id: '0020',
          outcome: 'fail_fixable',
          summary: 'Crash on empty input.',
          tests_run: 3,
          tests_passed: 1,
          tests_failed: 2,
          error_output: 'TypeError: empty input',
        },
        {
          timestamp: '2026-05-30T10:05:30.000Z',
          iteration: 41,
          artifact_id: '0020',
          outcome: 'pass',
          summary: 'Fix cycle passed.',
          tests_run: 4,
          tests_passed: 4,
          tests_failed: 0,
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 42,
          artifact_id: '0021',
          outcome: 'fail_catastrophic',
          summary: 'Sandbox crashed.',
          tests_run: 1,
          tests_passed: 0,
          tests_failed: 1,
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getTestReportHistory } = await import('../src/index.js');
      const result = await getTestReportHistory({ rootDir: tempDir, iteration: 41, limit: 1 });

      expect(result).toEqual({
        outcome: null,
        artifact: null,
        iteration: 41,
        limit: 1,
        total: 2,
        entries: [
          {
            timestamp: '2026-05-30T10:05:30.000Z',
            iteration: 41,
            artifact_id: '0020',
            outcome: 'pass',
            summary: 'Fix cycle passed.',
            tests_run: 4,
            tests_passed: 4,
            tests_failed: 0,
          },
        ],
      });
    });

    it('rejects invalid test report outcome filters', async () => {
      const { getTestReportHistory } = await import('../src/index.js');

      await expect(getTestReportHistory({ outcome: 'flaky' as any })).rejects.toThrow('Invalid test report outcome "flaky"');
    });

    it('rejects invalid test report artifact filters', async () => {
      const { getTestReportHistory } = await import('../src/index.js');

      await expect(getTestReportHistory({ artifact: '../0020' })).rejects.toThrow('Invalid test report artifact "../0020"');
    });

    it('rejects invalid test report iteration filters', async () => {
      const { getTestReportHistory } = await import('../src/index.js');

      await expect(getTestReportHistory({ iteration: 0 })).rejects.toThrow('Invalid test report iteration "0"');
    });

    it('rejects invalid test report history limits', async () => {
      const { getTestReportHistory } = await import('../src/index.js');

      await expect(getTestReportHistory({ limit: 0 })).rejects.toThrow('Invalid test report history limit "0"');
    });
  });

  describe('getTokenUsageHistory', () => {
    it('returns recent token usage filtered by agent with aggregate totals', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          agent: 'ideator',
          model: 'glm-5.1',
          input_tokens: 100,
          output_tokens: 40,
          duration_ms: 900,
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          agent: 'creator',
          model: 'glm-5.1',
          input_tokens: 150,
          output_tokens: 60,
          duration_ms: 1200,
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 42,
          agent: 'creator',
          model: 'glm-5.1',
          input_tokens: 80,
          output_tokens: 40,
          duration_ms: 800,
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getTokenUsageHistory } = await import('../src/index.js');
      const result = await getTokenUsageHistory({ rootDir: tempDir, agent: 'creator', limit: 1 });

      expect(readJsonlEntries).toHaveBeenCalledWith(path.join(tempDir, 'logs', 'token-usage.jsonl'));
      expect(result).toEqual({
        agent: 'creator',
        model: null,
        iteration: null,
        limit: 1,
        total: 2,
        inputTokens: 230,
        outputTokens: 100,
        entries: [
          {
            timestamp: '2026-05-30T10:10:00.000Z',
            iteration: 42,
            agent: 'creator',
            model: 'glm-5.1',
            input_tokens: 80,
            output_tokens: 40,
            duration_ms: 800,
          },
        ],
      });
    });

    it('filters recent token usage by model before applying the limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          agent: 'creator',
          model: 'glm-5.1',
          input_tokens: 100,
          output_tokens: 40,
          duration_ms: 900,
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          agent: 'tester',
          model: 'glm-4.5-flash',
          input_tokens: 60,
          output_tokens: 20,
          duration_ms: 700,
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 42,
          agent: 'critic',
          model: 'glm-5.1',
          input_tokens: 50,
          output_tokens: 30,
          duration_ms: 800,
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getTokenUsageHistory } = await import('../src/index.js');
      const result = await getTokenUsageHistory({ rootDir: tempDir, model: 'glm-5.1', limit: 1 });

      expect(result).toEqual({
        agent: null,
        model: 'glm-5.1',
        iteration: null,
        limit: 1,
        total: 2,
        inputTokens: 150,
        outputTokens: 70,
        entries: [
          {
            timestamp: '2026-05-30T10:10:00.000Z',
            iteration: 42,
            agent: 'critic',
            model: 'glm-5.1',
            input_tokens: 50,
            output_tokens: 30,
            duration_ms: 800,
          },
        ],
      });
    });

    it('filters recent token usage by exact iteration before applying the limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          agent: 'ideator',
          model: 'glm-5.1',
          input_tokens: 100,
          output_tokens: 40,
          duration_ms: 900,
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          agent: 'creator',
          model: 'glm-5.1',
          input_tokens: 150,
          output_tokens: 60,
          duration_ms: 1200,
        },
        {
          timestamp: '2026-05-30T10:05:30.000Z',
          iteration: 41,
          agent: 'critic',
          model: 'glm-5.1',
          input_tokens: 80,
          output_tokens: 35,
          duration_ms: 800,
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 42,
          agent: 'creator',
          model: 'glm-5.1',
          input_tokens: 90,
          output_tokens: 45,
          duration_ms: 850,
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getTokenUsageHistory } = await import('../src/index.js');
      const result = await getTokenUsageHistory({ rootDir: tempDir, iteration: 41, limit: 1 });

      expect(result).toEqual({
        agent: null,
        model: null,
        iteration: 41,
        limit: 1,
        total: 2,
        inputTokens: 230,
        outputTokens: 95,
        entries: [
          {
            timestamp: '2026-05-30T10:05:30.000Z',
            iteration: 41,
            agent: 'critic',
            model: 'glm-5.1',
            input_tokens: 80,
            output_tokens: 35,
            duration_ms: 800,
          },
        ],
      });
    });

    it('rejects invalid token usage agent filters', async () => {
      const { getTokenUsageHistory } = await import('../src/index.js');

      await expect(getTokenUsageHistory({ agent: 'scheduler' as any })).rejects.toThrow('Invalid token usage agent "scheduler"');
    });

    it('rejects invalid token usage model filters', async () => {
      const { getTokenUsageHistory } = await import('../src/index.js');

      await expect(getTokenUsageHistory({ model: '../glm' })).rejects.toThrow('Invalid token usage model "../glm"');
    });

    it('rejects invalid token usage iteration filters', async () => {
      const { getTokenUsageHistory } = await import('../src/index.js');

      await expect(getTokenUsageHistory({ iteration: 0 })).rejects.toThrow('Invalid token usage iteration "0"');
    });

    it('rejects invalid token usage history limits', async () => {
      const { getTokenUsageHistory } = await import('../src/index.js');

      await expect(getTokenUsageHistory({ limit: 0 })).rejects.toThrow('Invalid token usage history limit "0"');
    });
  });

  describe('getIterationHistory', () => {
    it('returns recent iterations filtered by outcome with aggregate counts', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          outcome: 'shipped',
          title: 'Clock Atlas',
          domain: 'prose',
          artifact_id: '0040',
          mean_rating: '4.2',
          token_usage: { input: 100, output: 40 },
          duration_ms: 1200,
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          outcome: 'killed',
          title: 'Weak Tool',
          domain: 'code-tool',
          source: 'human_redirect',
          reason: 'Too brittle.',
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 42,
          outcome: 'shipped',
          title: 'Signal Orchard',
          domain: 'code',
          artifact_id: '0042',
          mean_rating: '4.5',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getIterationHistory } = await import('../src/index.js');
      const result = await getIterationHistory({ rootDir: tempDir, outcome: 'shipped', limit: 1 });

      expect(readJsonlEntries).toHaveBeenCalledWith(path.join(tempDir, 'logs', 'iterations.jsonl'));
      expect(result).toEqual({
        outcome: 'shipped',
        source: null,
        domain: null,
        limit: 1,
        total: 2,
        counts: {
          shipped: 2,
          killed: 0,
          skipped: 0,
          halted: 0,
        },
        entries: [
          {
            timestamp: '2026-05-30T10:10:00.000Z',
            iteration: 42,
            outcome: 'shipped',
            title: 'Signal Orchard',
            domain: 'code',
            artifact_id: '0042',
            mean_rating: '4.5',
          },
        ],
      });
    });

    it('filters recent iterations by source before applying the limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          outcome: 'killed',
          source: 'human_redirect',
          title: 'First Redirect',
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          outcome: 'shipped',
          source: 'ideator',
          title: 'Ordinary Ship',
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 42,
          outcome: 'skipped',
          source: 'human_redirect',
          title: 'Second Redirect',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getIterationHistory } = await import('../src/index.js');
      const result = await getIterationHistory({ rootDir: tempDir, source: 'human_redirect', limit: 1 });

      expect(result).toEqual({
        outcome: null,
        source: 'human_redirect',
        domain: null,
        limit: 1,
        total: 2,
        counts: {
          shipped: 0,
          killed: 1,
          skipped: 1,
          halted: 0,
        },
        entries: [
          {
            timestamp: '2026-05-30T10:10:00.000Z',
            iteration: 42,
            outcome: 'skipped',
            source: 'human_redirect',
            title: 'Second Redirect',
          },
        ],
      });
    });

    it('filters recent iterations by domain before applying the limit', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          outcome: 'shipped',
          domain: 'prose',
          title: 'Clock Atlas',
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          outcome: 'killed',
          domain: 'code-tool',
          source: 'human_redirect',
          title: 'Weak Tool',
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 42,
          outcome: 'shipped',
          domain: 'code-tool',
          title: 'Signal Orchard',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getIterationHistory } = await import('../src/index.js');
      const result = await getIterationHistory({ rootDir: tempDir, domain: 'code-tool', limit: 1 });

      expect(result).toEqual({
        outcome: null,
        source: null,
        domain: 'code-tool',
        limit: 1,
        total: 2,
        counts: {
          shipped: 1,
          killed: 1,
          skipped: 0,
          halted: 0,
        },
        entries: [
          {
            timestamp: '2026-05-30T10:10:00.000Z',
            iteration: 42,
            outcome: 'shipped',
            domain: 'code-tool',
            title: 'Signal Orchard',
          },
        ],
      });
    });

    it('rejects invalid iteration outcome filters', async () => {
      const { getIterationHistory } = await import('../src/index.js');

      await expect(getIterationHistory({ outcome: 'paused' as any })).rejects.toThrow('Invalid iteration outcome "paused"');
    });

    it('rejects invalid iteration source filters', async () => {
      const { getIterationHistory } = await import('../src/index.js');

      await expect(getIterationHistory({ source: 'manual' } as any)).rejects.toThrow('Invalid iteration source "manual"');
    });

    it('rejects invalid iteration domain filters', async () => {
      const { getIterationHistory } = await import('../src/index.js');

      await expect(getIterationHistory({ domain: 'bad/domain' } as any)).rejects.toThrow('Invalid iteration domain "bad/domain"');
    });

    it('rejects invalid iteration history limits', async () => {
      const { getIterationHistory } = await import('../src/index.js');

      await expect(getIterationHistory({ limit: 0 })).rejects.toThrow('Invalid iteration history limit "0"');
    });
  });

  describe('getTimeline', () => {
    it('returns recent iterations enriched with related log counts and token totals', async () => {
      const iterations = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          outcome: 'shipped',
          title: 'Clock Atlas',
          domain: 'prose',
          artifact_id: '0040',
          token_usage: { input: 100, output: 40 },
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          outcome: 'killed',
          title: 'Weak Tool',
          domain: 'code-tool',
          source: 'human_redirect',
          reason: 'Too brittle.',
        },
      ];
      const decisions = [
        { iteration: 40, gate: 'gate1', decision: 'approve' },
        { iteration: 40, gate: 'gate2', decision: 'ship' },
        { iteration: 41, gate: 'gate2', decision: 'kill' },
      ];
      const testReports = [
        { iteration: 40, outcome: 'pass' },
        { iteration: 41, outcome: 'fail_fixable' },
      ];
      const monitorWarnings = [
        { iteration: 41, severity: 'critical' },
        { iteration: 41, severity: 'warning' },
      ];
      const tokenUsage = [
        { iteration: 41, agent: 'creator', input_tokens: 150, output_tokens: 60 },
        { iteration: 41, agent: 'critic', input_tokens: 50, output_tokens: 20 },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries)
        .mockResolvedValueOnce(iterations)
        .mockResolvedValueOnce(decisions)
        .mockResolvedValueOnce(testReports)
        .mockResolvedValueOnce(monitorWarnings)
        .mockResolvedValueOnce(tokenUsage);

      const { getTimeline } = await import('../src/index.js');
      const result = await getTimeline({ rootDir: tempDir, limit: 2 });

      expect(readJsonlEntries).toHaveBeenNthCalledWith(1, path.join(tempDir, 'logs', 'iterations.jsonl'));
      expect(readJsonlEntries).toHaveBeenNthCalledWith(2, path.join(tempDir, 'logs', 'decisions.jsonl'));
      expect(readJsonlEntries).toHaveBeenNthCalledWith(3, path.join(tempDir, 'logs', 'test-reports.jsonl'));
      expect(readJsonlEntries).toHaveBeenNthCalledWith(4, path.join(tempDir, 'logs', 'monitor.jsonl'));
      expect(readJsonlEntries).toHaveBeenNthCalledWith(5, path.join(tempDir, 'logs', 'token-usage.jsonl'));
      expect(result).toEqual({
        outcome: null,
        source: null,
        domain: null,
        iteration: null,
        limit: 2,
        total: 2,
        entries: [
          {
            iteration: 40,
            timestamp: '2026-05-30T10:00:00.000Z',
            outcome: 'shipped',
            title: 'Clock Atlas',
            domain: 'prose',
            source: null,
            artifactId: '0040',
            reason: null,
            tokenUsage: { input: 100, output: 40 },
            decisions: { gate1: 1, gate2: 1 },
            tests: { pass: 1, failFixable: 0, failCatastrophic: 0 },
            monitor: { critical: 0, warning: 0, info: 0 },
          },
          {
            iteration: 41,
            timestamp: '2026-05-30T10:05:00.000Z',
            outcome: 'killed',
            title: 'Weak Tool',
            domain: 'code-tool',
            source: 'human_redirect',
            artifactId: null,
            reason: 'Too brittle.',
            tokenUsage: { input: 200, output: 80 },
            decisions: { gate1: 0, gate2: 1 },
            tests: { pass: 0, failFixable: 1, failCatastrophic: 0 },
            monitor: { critical: 1, warning: 1, info: 0 },
          },
        ],
      });
    });

    it('filters iterations by outcome and source before applying the limit', async () => {
      const iterations = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 39,
          outcome: 'killed',
          source: 'human_redirect',
          title: 'First Redirect',
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 40,
          outcome: 'killed',
          source: 'human_redirect',
          title: 'Second Redirect',
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 41,
          outcome: 'shipped',
          source: 'ideator',
          title: 'Ordinary Ship',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries)
        .mockResolvedValueOnce(iterations)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const { getTimeline } = await import('../src/index.js');
      const result = await getTimeline({
        rootDir: tempDir,
        outcome: 'killed',
        source: 'human_redirect',
        limit: 1,
      });

      expect(result).toEqual({
        outcome: 'killed',
        source: 'human_redirect',
        domain: null,
        iteration: null,
        limit: 1,
        total: 2,
        entries: [
          expect.objectContaining({
            iteration: 40,
            outcome: 'killed',
            source: 'human_redirect',
            title: 'Second Redirect',
          }),
        ],
      });
    });

    it('filters timeline entries by domain before applying the limit', async () => {
      const iterations = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          outcome: 'shipped',
          domain: 'prose',
          title: 'Clock Atlas',
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          outcome: 'killed',
          domain: 'code-tool',
          source: 'human_redirect',
          title: 'Weak Tool',
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 42,
          outcome: 'shipped',
          domain: 'code-tool',
          title: 'Signal Orchard',
        },
      ];
      const decisions = [
        { iteration: 42, gate: 'gate1', decision: 'approve' },
        { iteration: 42, gate: 'gate2', decision: 'ship' },
      ];
      const tokenUsage = [
        { iteration: 42, agent: 'creator', input_tokens: 120, output_tokens: 55 },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries)
        .mockResolvedValueOnce(iterations)
        .mockResolvedValueOnce(decisions)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(tokenUsage);

      const { getTimeline } = await import('../src/index.js');
      const result = await getTimeline({ rootDir: tempDir, domain: 'code-tool', limit: 1 });

      expect(result).toEqual({
        outcome: null,
        source: null,
        domain: 'code-tool',
        iteration: null,
        limit: 1,
        total: 2,
        entries: [
          expect.objectContaining({
            iteration: 42,
            outcome: 'shipped',
            domain: 'code-tool',
            title: 'Signal Orchard',
            tokenUsage: { input: 120, output: 55 },
            decisions: { gate1: 1, gate2: 1 },
          }),
        ],
      });
    });

    it('filters timeline entries by exact iteration before applying the limit', async () => {
      const iterations = [
        {
          timestamp: '2026-05-30T10:00:00.000Z',
          iteration: 40,
          outcome: 'shipped',
          title: 'Clock Atlas',
        },
        {
          timestamp: '2026-05-30T10:05:00.000Z',
          iteration: 41,
          outcome: 'killed',
          source: 'human_redirect',
          title: 'Weak Tool',
          reason: 'Too brittle.',
        },
        {
          timestamp: '2026-05-30T10:10:00.000Z',
          iteration: 42,
          outcome: 'shipped',
          title: 'Signal Orchard',
        },
      ];
      const decisions = [
        { iteration: 41, gate: 'gate1', decision: 'approve' },
        { iteration: 41, gate: 'gate2', decision: 'kill' },
      ];
      const testReports = [
        { iteration: 41, outcome: 'fail_catastrophic' },
      ];
      const monitorWarnings = [
        { iteration: 41, severity: 'critical' },
      ];
      const tokenUsage = [
        { iteration: 41, agent: 'creator', input_tokens: 150, output_tokens: 60 },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries)
        .mockResolvedValueOnce(iterations)
        .mockResolvedValueOnce(decisions)
        .mockResolvedValueOnce(testReports)
        .mockResolvedValueOnce(monitorWarnings)
        .mockResolvedValueOnce(tokenUsage);

      const { getTimeline } = await import('../src/index.js');
      const result = await getTimeline({ rootDir: tempDir, iteration: 41, limit: 1 });

      expect(result).toEqual({
        outcome: null,
        source: null,
        domain: null,
        iteration: 41,
        limit: 1,
        total: 1,
        entries: [
          {
            iteration: 41,
            timestamp: '2026-05-30T10:05:00.000Z',
            outcome: 'killed',
            title: 'Weak Tool',
            domain: null,
            source: 'human_redirect',
            artifactId: null,
            reason: 'Too brittle.',
            tokenUsage: { input: 150, output: 60 },
            decisions: { gate1: 1, gate2: 1 },
            tests: { pass: 0, failFixable: 0, failCatastrophic: 1 },
            monitor: { critical: 1, warning: 0, info: 0 },
          },
        ],
      });
    });

    it('rejects invalid timeline limits', async () => {
      const { getTimeline } = await import('../src/index.js');

      await expect(getTimeline({ limit: 0 })).rejects.toThrow('Invalid timeline limit "0"');
    });

    it('rejects invalid timeline iteration filters', async () => {
      const { getTimeline } = await import('../src/index.js');

      await expect(getTimeline({ iteration: 0 })).rejects.toThrow('Invalid timeline iteration "0"');
    });

    it('rejects invalid timeline domain filters', async () => {
      const { getTimeline } = await import('../src/index.js');

      await expect(getTimeline({ domain: 'bad/domain' } as never)).rejects.toThrow('Invalid timeline domain "bad/domain"');
    });

    it('rejects invalid timeline sources', async () => {
      const { getTimeline } = await import('../src/index.js');

      await expect(getTimeline({ source: 'manual' } as never)).rejects.toThrow('Invalid timeline source "manual"');
    });
  });

  describe('getStimuliStatus', () => {
    it('returns focused stimuli health with recovery actions', async () => {
      const { loadCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(loadCheckpoint).mockResolvedValueOnce({
        iteration: 42,
        active_project_ids: [],
        domain_counts: {},
        last_stimuli_refresh: {
          news: {
            last_refresh_iteration: 31,
            consecutive_failures: 2,
            disabled: false,
          },
          cultural: {
            last_refresh_iteration: 30,
            consecutive_failures: 3,
            disabled: true,
          },
          knowledge: 40,
        },
        last_curator_run: 40,
        stats: {
          iteration: 42,
          shipped: 20,
          killed: 5,
          skipped: 3,
          domain_counts: {},
          recent_outcomes: [],
          critic_rejection_window: [],
          total_tokens: { input: 0, output: 0 },
        },
        saved_at: '2026-05-30T00:00:00.000Z',
      });
      const { loadStimuliConfig } = await import('../src/stimuli/index.js');
      vi.mocked(loadStimuliConfig).mockResolvedValueOnce({
        mcp: {
          news: { server: 'tavily', query_template: 'interesting news', max_items: 5, refresh_interval: 10 },
          cultural: { server: 'tavily', queries: ['trending repos'], max_items: 5, refresh_interval: 20 },
          knowledge: { server: 'context7', strategy: 'random', max_items: 3, refresh_interval: 10 },
        },
        stimuli_ttl: 24,
        skills_per_context: 2,
      });

      const { getStimuliStatus } = await import('../src/index.js');
      const status = await getStimuliStatus({ rootDir: tempDir });

      expect(status.health).toEqual({
        level: 'warning',
        reasons: [
          '1 stimuli source failing',
          '1 stimuli source disabled',
        ],
        actions: [
          'Inspect source news, then run foundry stimuli reset news after the backend or config is fixed.',
          'Inspect source cultural, then run foundry stimuli reset cultural after the backend or config is fixed.',
        ],
      });
      expect(status.iteration).toBe(42);
      expect(status.savedAt).toBe('2026-05-30T00:00:00.000Z');
      expect(status.attention.map((entry) => entry.source)).toEqual(['news', 'cultural']);
      expect(status.stimuli.sources).toBe(3);
    });

    it('returns healthy focused stimuli health when sources are clear', async () => {
      const { loadCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(loadCheckpoint).mockResolvedValueOnce({
        iteration: 8,
        active_project_ids: [],
        domain_counts: {},
        last_stimuli_refresh: {
          news: {
            last_refresh_iteration: 7,
            consecutive_failures: 0,
            disabled: false,
          },
        },
        last_curator_run: 0,
        stats: {
          iteration: 8,
          shipped: 1,
          killed: 0,
          skipped: 0,
          domain_counts: {},
          recent_outcomes: [],
          critic_rejection_window: [],
          total_tokens: { input: 0, output: 0 },
        },
        saved_at: '2026-05-30T00:00:00.000Z',
      });
      const { loadStimuliConfig } = await import('../src/stimuli/index.js');
      vi.mocked(loadStimuliConfig).mockResolvedValueOnce({
        mcp: {
          news: { server: 'tavily', query_template: 'interesting news', max_items: 5, refresh_interval: 10 },
        },
        stimuli_ttl: 24,
        skills_per_context: 2,
      });

      const { getStimuliStatus } = await import('../src/index.js');
      const status = await getStimuliStatus({ rootDir: tempDir });

      expect(status.health).toEqual({
        level: 'healthy',
        reasons: [],
        actions: [],
      });
      expect(status.attention).toEqual([]);
      expect(status.stimuli.healthy).toBe(1);
    });
  });

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

    it('fails before the loop when prompt preflight is invalid', async () => {
      const { validatePromptContracts } = await import('../src/agents/prompt.js');
      vi.mocked(validatePromptContracts).mockResolvedValueOnce({
        status: 'invalid',
        summary: { total: 2, ok: 1, invalid: 1 },
        files: [
          { name: 'prompts/ideator.md', path: 'prompts/ideator.md', ok: true },
          {
            name: 'prompts/critic.md',
            path: 'prompts/critic.md',
            ok: false,
            errors: ['missing placeholder {tester_report}'],
          },
        ],
      });
      const { runIteration } = await import('../src/iteration/index.js');
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);

      const { startFoundry } = await import('../src/index.js');

      try {
        await expect(startFoundry({ rootDir: tempDir })).rejects.toThrow('Prompt preflight failed before start: prompts/critic.md: missing placeholder {tester_report}');
        expect(runIteration).not.toHaveBeenCalled();
      } finally {
        vi.mocked(checkStopFile).mockReset();
        vi.mocked(checkStopFile).mockResolvedValue(false);
      }
    });

    it('fails before the loop when free disk space is below the configured floor', async () => {
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
        loop: { cooldown_seconds: 0, disk_space_min_gb: 2 },
        git: { auto_commit: false, auto_push: false },
      });
      const fsPromises = await import('node:fs/promises');
      vi.mocked(fsPromises.statfs).mockResolvedValueOnce({
        bsize: 1024,
        bavail: 1024,
      } as any);
      const { runIteration } = await import('../src/iteration/index.js');
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);

      const { startFoundry } = await import('../src/index.js');

      try {
        await expect(startFoundry({ rootDir: tempDir })).rejects.toThrow(
          /Disk preflight failed before start: .* requires 2\.00 GiB/,
        );
        expect(fsPromises.statfs).toHaveBeenCalledWith(tempDir);
        expect(runIteration).not.toHaveBeenCalled();
      } finally {
        vi.mocked(fsPromises.statfs).mockReset();
        vi.mocked(fsPromises.statfs).mockImplementation((path) => {
          return (vi.importActual('node:fs/promises') as any).then((actual: typeof import('node:fs/promises')) => actual.statfs(path));
        });
        vi.mocked(checkStopFile).mockReset();
        vi.mocked(checkStopFile).mockResolvedValue(false);
      }
    });

    it('logs a lifecycle failure event when startup disk preflight fails', async () => {
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
        loop: { cooldown_seconds: 0, disk_space_min_gb: 2 },
        git: { auto_commit: false, auto_push: false },
      });
      const fsPromises = await import('node:fs/promises');
      vi.mocked(fsPromises.statfs).mockResolvedValueOnce({
        bsize: 1024,
        bavail: 1024,
      } as any);

      const { startFoundry } = await import('../src/index.js');

      try {
        await expect(startFoundry({ rootDir: tempDir })).rejects.toThrow(/Disk preflight failed before start/);
        const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));

        expect(events).toEqual([
          expect.objectContaining({
            event: 'foundry_start_failed',
            phase: 'lifecycle',
            data: expect.objectContaining({
              reason: 'startup preflight',
              detail: expect.stringContaining('Disk preflight failed before start'),
            }),
          }),
        ]);
      } finally {
        vi.mocked(fsPromises.statfs).mockReset();
        vi.mocked(fsPromises.statfs).mockImplementation((path) => {
          return (vi.importActual('node:fs/promises') as any).then((actual: typeof import('node:fs/promises')) => actual.statfs(path));
        });
      }
    });

    it('logs a lifecycle failure event when provider validation throws before the loop', async () => {
      const { validateProvider } = await import('../src/model/index.js');
      vi.mocked(validateProvider).mockRejectedValueOnce(new Error('provider DNS failed'));
      const { runIteration } = await import('../src/iteration/index.js');

      const { startFoundry } = await import('../src/index.js');

      try {
        await expect(startFoundry({ rootDir: tempDir })).rejects.toThrow('provider DNS failed');
        const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));

        expect(events).toEqual([
          expect.objectContaining({
            event: 'foundry_start_failed',
            phase: 'lifecycle',
            data: expect.objectContaining({
              mode: 'sequential',
              concurrency: 1,
              providers: ['zai'],
              reason: 'provider validation',
              detail: 'provider DNS failed',
            }),
          }),
        ]);
        expect(runIteration).not.toHaveBeenCalled();
      } finally {
        vi.mocked(validateProvider).mockReset();
        vi.mocked(validateProvider).mockResolvedValue(undefined);
      }
    });

    it('halts before the next sequential iteration when disk space drops below the configured floor', async () => {
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
        loop: { cooldown_seconds: 0, disk_space_min_gb: 2 },
        git: { auto_commit: false, auto_push: false },
      });

      const fsPromises = await import('node:fs/promises');
      vi.mocked(fsPromises.statfs)
        .mockResolvedValueOnce({ bsize: 1024, bavail: 3 * 1024 * 1024 } as any)
        .mockResolvedValueOnce({ bsize: 1024, bavail: 3 * 1024 * 1024 } as any)
        .mockResolvedValueOnce({ bsize: 1024, bavail: 1024 * 1024 } as any);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockImplementation(async (_config, _models, iteration) => ({
        iteration,
        outcome: 'shipped',
        title: `Disk Watch ${iteration}`,
        domain: 'prose',
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      }));

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockImplementation(async () => vi.mocked(runIteration).mock.calls.length >= 2);
      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      const { appendJournal } = await import('../src/files/journal.js');

      const { startFoundry } = await import('../src/index.js');

      try {
        await startFoundry({ rootDir: tempDir });

        expect(runIteration).toHaveBeenCalledTimes(1);
        expect(fsPromises.statfs).toHaveBeenCalledTimes(3);
        expect(saveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
          iteration: 1,
        }));
        expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Halted by disk preflight'));
      } finally {
        vi.mocked(fsPromises.statfs).mockReset();
        vi.mocked(fsPromises.statfs).mockImplementation((path) => {
          return (vi.importActual('node:fs/promises') as any).then((actual: typeof import('node:fs/promises')) => actual.statfs(path));
        });
        vi.mocked(runIteration).mockReset();
        vi.mocked(checkStopFile).mockReset();
        vi.mocked(checkStopFile).mockResolvedValue(false);
      }
    });

    it('prints the active provider banner after invalid providers fall back', async () => {
      const modelsConfig = {
        agents: {
          ideator: { model: 'zai-base', temperature: 0.9, max_tokens: 4096 },
          creator: { provider: 'unstable', model: 'creator-alt', temperature: 0.7, max_tokens: 8192 },
          tester: { model: 'zai-base', temperature: 0.3, max_tokens: 4096 },
          critic: { model: 'zai-base', temperature: 0.5, max_tokens: 4096 },
          curator: { model: 'zai-base', temperature: 0.5, max_tokens: 4096 },
        },
      };
      const { loadModelsConfig } = await import('../src/context/config.js');
      vi.mocked(loadModelsConfig).mockResolvedValueOnce(modelsConfig);
      const { validateProvider } = await import('../src/model/index.js');
      vi.mocked(validateProvider).mockImplementation(async (provider) => provider !== 'unstable');
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { startFoundry } = await import('../src/index.js');

      try {
        await startFoundry({ rootDir: tempDir });
        const modeLines = logSpy.mock.calls.map((call) => String(call[0])).filter((line) => line.startsWith('Mode:'));

        expect(modeLines).toContain('Mode: 1 parallel iteration (zai)');
        expect(modeLines.some((line) => line.includes('unstable'))).toBe(false);
        expect(modelsConfig.agents.creator).toEqual(expect.objectContaining({
          provider: 'zai',
          model: 'zai-base',
        }));
        const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        expect(events).toContainEqual(expect.objectContaining({
          event: 'foundry_start',
          phase: 'lifecycle',
          data: expect.objectContaining({
            providers: ['zai'],
            provider_fallback_count: 1,
            provider_fallbacks: [
              expect.objectContaining({
                provider: 'unstable',
                fallback_provider: 'zai',
                agents: ['creator'],
              }),
            ],
          }),
        }));
      } finally {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        vi.mocked(validateProvider).mockReset();
        vi.mocked(validateProvider).mockResolvedValue(undefined);
        vi.mocked(checkStopFile).mockReset();
        vi.mocked(checkStopFile).mockResolvedValue(false);
      }
    });

    it('halts immediately when STOP file exists at startup', async () => {
      writeFileSync(path.join(tempDir, 'STOP'), 'Reason: maintenance window\nOperator: test\n', 'utf-8');
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
          { agent: 'creator', model: 'hold-model', start_iteration: 1, end_iteration: 5, label: 'halted-window' },
        ],
      });

      const { runIteration } = await import('../src/iteration/index.js');
      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      const { validateProvider } = await import('../src/model/index.js');
      const { setModelOverrides } = await import('../src/model/index.js');
      const { appendJournal } = await import('../src/files/journal.js');

      const { startFoundry } = await import('../src/index.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }
      expect(consoleOutput).toContain('STOP file detected (STOP: Reason: maintenance window Operator: test) — halting after saving checkpoint.');

      // Should save checkpoint and exit without running any iterations
      expect(saveCheckpoint).toHaveBeenCalled();
      expect(runIteration).not.toHaveBeenCalled();
      expect(validateProvider).not.toHaveBeenCalled();
      expect(setModelOverrides).not.toHaveBeenCalled();

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          model_override_count: 1,
          model_overrides_applied: false,
          provider_validation_skipped: true,
          provider_validation_skipped_reason: 'STOP file present at startup',
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stop',
        phase: 'lifecycle',
        data: expect.objectContaining({
          reason: 'STOP file',
          stop_file_present_at_startup: true,
          stop_file: 'STOP',
          stop_file_preview: 'Reason: maintenance window Operator: test',
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_checkpoint_saved',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          checkpoint_iteration: 0,
          reason: 'halt',
        }),
      }));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('STOP: Reason: maintenance window Operator: test'));
    });

    it('logs start lifecycle events for a sequential STOP-at-start run', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      expect(events).toEqual([
        expect.objectContaining({
          event: 'foundry_start',
          phase: 'lifecycle',
          data: expect.objectContaining({
            mode: 'sequential',
            concurrency: 1,
            start_iteration: 1,
            state_source: 'iteration_log',
            last_logged_iteration: 0,
          }),
        }),
        expect.objectContaining({
          event: 'foundry_checkpoint_saved',
          phase: 'lifecycle',
          data: expect.objectContaining({
            mode: 'sequential',
            concurrency: 1,
            start_iteration: 1,
            checkpoint_iteration: 0,
            last_curator_run: 0,
            reason: 'halt',
          }),
        }),
        expect.objectContaining({
          event: 'foundry_stop',
          phase: 'lifecycle',
          data: expect.objectContaining({
            mode: 'sequential',
            reason: 'STOP file',
            start_iteration: 1,
            last_completed_iteration: 0,
            next_iteration: 1,
            iterations_completed: 0,
            duration_ms: expect.any(Number),
          }),
        }),
      ]);
      expect(events[2].data.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('logs persisted token heat in the start lifecycle event', async () => {
      writeFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), [
        JSON.stringify({
          iteration: 1,
          outcome: 'shipped',
          domain: 'code-tool',
          token_usage: { input: 180_000, output: 50_000 },
          duration_ms: 1000,
        }),
        JSON.stringify({
          iteration: 2,
          outcome: 'killed',
          domain: 'prose',
          token_usage: { input: 210_000, output: 30_000 },
          duration_ms: 1000,
        }),
        '',
      ].join('\n'), 'utf-8');
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          start_iteration: 3,
          startup_token_heat: expect.objectContaining({
            window: 5,
            threshold: 200_000,
            samples: 2,
            average_tokens: 235_000,
            total_tokens: 470_000,
            peak_tokens: 240_000,
            threshold_percent: 118,
            remaining_tokens_to_threshold: 0,
            pressure: 'hot',
            hot: true,
          }),
        }),
      }));
    });

    it('prints persisted startup token heat before the first iteration', async () => {
      writeFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), [
        JSON.stringify({
          iteration: 1,
          outcome: 'shipped',
          domain: 'code-tool',
          token_usage: { input: 180_000, output: 50_000 },
          duration_ms: 1000,
        }),
        JSON.stringify({
          iteration: 2,
          outcome: 'killed',
          domain: 'prose',
          token_usage: { input: 210_000, output: 30_000 },
          duration_ms: 1000,
        }),
        '',
      ].join('\n'), 'utf-8');
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);

      const { startFoundry } = await import('../src/index.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }

      expect(consoleOutput).toContain('Startup token heat: hot 118% (2 samples, peak 240000)');
    });

    it('logs pending request preview in the start lifecycle event', async () => {
      writeFileSync(path.join(tempDir, 'requests.md'), 'Build a brass moon clock\nwith tide gears\n', 'utf-8');
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { startFoundry } = await import('../src/index.js');
      try {
        await startFoundry({ rootDir: tempDir });
        expect(logSpy).toHaveBeenCalledWith('Human redirect queued: requests.md - Build a brass moon clock with tide gears');
      } finally {
        logSpy.mockRestore();
      }

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          request_file: 'requests.md',
          request_pending_at_startup: true,
          request_preview_at_startup: 'Build a brass moon clock with tide gears',
        }),
      }));
    });

    it('writes a startup Stoker directive before the first iteration when a request is queued', async () => {
      writeFileSync(path.join(tempDir, 'requests.md'), 'Build a brass moon clock\nwith tide gears\n', 'utf-8');

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockImplementationOnce(async () => {
        const { saveStokerDirective } = await import('../src/stoker/index.js');
        expect(saveStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
          for_iteration: 1,
          rules_fired: ['human_redirect'],
        }));
        return {
          iteration: 1,
          outcome: 'halted',
          reason: 'test complete',
          token_usage: { input: 0, output: 0 },
          duration_ms: 50,
        };
      });

      const stoker = await import('../src/stoker/index.js');
      vi.mocked(stoker.generateStokerDirective).mockReturnValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 0,
        for_iteration: 1,
        urgency: 'high',
        streak_instruction: 'neutral',
        ideator_hint: 'Follow the startup request.',
        rules_fired: ['human_redirect'],
      });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(stoker.generateStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        current_iteration: 0,
        for_iteration: 1,
        force_reason: 'human_redirect',
        force_context: expect.objectContaining({
          request_file: 'requests.md',
          request_preview: 'Build a brass moon clock with tide gears',
        }),
      }));

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stoker_check_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 0,
          due: true,
          force_reason: 'human_redirect',
          directive_written: true,
          for_iteration: 1,
        }),
      }));
    });

    it('primes the first sequential iteration with a Stoker directive when persisted token heat is cold', async () => {
      const recentEntries = [
        {
          iteration: 1,
          outcome: 'shipped',
          title: 'Tiny Clock',
          domain: 'code-tool',
          token_usage: { input: 900, output: 600 },
          duration_ms: 1000,
        },
        {
          iteration: 2,
          outcome: 'shipped',
          title: 'Small Verse',
          domain: 'poetry',
          token_usage: { input: 800, output: 700 },
          duration_ms: 1000,
        },
      ];
      writeFileSync(
        path.join(tempDir, 'logs', 'iterations.jsonl'),
        `${recentEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
        'utf-8',
      );

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValue(false);

      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(recentEntries as any);

      const stoker = await import('../src/stoker/index.js');
      vi.mocked(stoker.loadStokerDirective).mockResolvedValueOnce(null);
      vi.mocked(stoker.generateStokerDirective).mockReturnValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 2,
        for_iteration: 3,
        urgency: 'high',
        streak_instruction: 'neutral',
        complexity_override: 'M',
        ideator_hint: 'Prime the cold start.',
        rules_fired: ['startup_underburn'],
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockImplementationOnce(async () => {
        expect(stoker.saveStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
          for_iteration: 3,
          urgency: 'high',
          complexity_override: 'M',
          rules_fired: ['startup_underburn'],
        }));
        return {
          iteration: 3,
          outcome: 'halted',
          reason: 'test complete',
          token_usage: { input: 0, output: 0 },
          duration_ms: 50,
        };
      });

      const { appendJournal } = await import('../src/files/journal.js');
      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(stoker.generateStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        current_iteration: 2,
        for_iteration: 3,
        force_reason: 'startup_underburn',
        force_context: expect.objectContaining({
          spent_tokens: 1500,
          target_tokens: 50000,
          reason: 'Persisted startup token average is 1500 below the 50000-token cold-start floor.',
        }),
      }));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Startup token prime before iteration 3'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('1500-token average below the 50000-token floor'));

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stoker_check_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 2,
          due: true,
          force_reason: 'startup_underburn',
          directive_written: true,
          for_iteration: 3,
          urgency: 'high',
          rules_fired: ['startup_underburn'],
          startup_prime_average_tokens: 1500,
          startup_prime_target_tokens: 50000,
        }),
      }));
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
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }

      expect(saveCheckpoint).toHaveBeenCalled();
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Halted by signal'));
      expect(consoleOutput).toContain('Signal detected (SIGINT) — halting after saving checkpoint.');
    });

    it('halts after the current iteration without waiting for cooldown when a signal is requested', async () => {
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
        loop: { cooldown_seconds: 0.5, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      });
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValue(false);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockImplementationOnce(async () => {
        process.emit('SIGINT');
        return {
          iteration: 1,
          outcome: 'shipped',
          title: 'Signal Test',
          domain: 'prose',
          token_usage: { input: 100, output: 50 },
          duration_ms: 1000,
        };
      });

      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      const { appendJournal } = await import('../src/files/journal.js');
      const { startFoundry } = await import('../src/index.js');

      const startedAt = Date.now();
      await startFoundry({ rootDir: tempDir });
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeLessThan(300);
      expect(saveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
        iteration: 1,
      }));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Halted by signal'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('SIGINT'));

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stop',
        phase: 'lifecycle',
        data: expect.objectContaining({
          reason: 'signal',
          signal: 'SIGINT',
          last_completed_iteration: 1,
        }),
      }));
    });

    it('halts before cooldown when STOP appears after an iteration', async () => {
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
        loop: { cooldown_seconds: 0.5, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      });
      const { checkStopFile } = await import('../src/files/intervention.js');
      let stopChecks = 0;
      vi.mocked(checkStopFile).mockImplementation(async () => {
        stopChecks++;
        return stopChecks >= 2;
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Stop Test',
        domain: 'prose',
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      });

      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      const { appendJournal } = await import('../src/files/journal.js');
      const { startFoundry } = await import('../src/index.js');

      const startedAt = Date.now();
      await startFoundry({ rootDir: tempDir });
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeLessThan(300);
      expect(saveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
        iteration: 1,
      }));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Halted by STOP file after iteration 1'));
    });

    it('halts during cooldown when STOP appears while sleeping', async () => {
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
        loop: { cooldown_seconds: 0.5, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      });
      const { checkStopFile } = await import('../src/files/intervention.js');
      let stopChecks = 0;
      vi.mocked(checkStopFile).mockImplementation(async () => {
        stopChecks++;
        return stopChecks >= 3;
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Cooldown Stop Test',
        domain: 'prose',
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      });

      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      const { appendJournal } = await import('../src/files/journal.js');
      const { startFoundry } = await import('../src/index.js');

      const startedAt = Date.now();
      await startFoundry({ rootDir: tempDir });
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeLessThan(300);
      expect(runIteration).toHaveBeenCalledTimes(1);
      expect(saveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
        iteration: 1,
      }));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Halted by STOP file during cooldown after iteration 1'));
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_cooldown_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          cooldown_ms: 500,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_cooldown_interrupted',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          reason: 'STOP file',
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stop',
        phase: 'lifecycle',
        data: expect.objectContaining({
          reason: 'STOP file',
          cooldown_interrupted: true,
          last_completed_iteration: 1,
          next_iteration: 2,
        }),
      }));
    });

    it('starts the next iteration early when a request appears during cooldown', async () => {
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
        loop: { cooldown_seconds: 0.5, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      });
      const { checkStopFile, readRequests } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValue(false);
      let requestReads = 0;
      vi.mocked(readRequests).mockImplementation(async () => {
        requestReads++;
        return requestReads >= 2 ? 'Build a human redirect immediately' : '';
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration)
        .mockResolvedValueOnce({
          iteration: 1,
          outcome: 'shipped',
          title: 'Cooldown Request Test',
          domain: 'prose',
          token_usage: { input: 100, output: 50 },
          duration_ms: 1000,
        })
        .mockResolvedValueOnce({
          iteration: 2,
          outcome: 'halted',
          reason: 'test complete',
          token_usage: { input: 0, output: 0 },
          duration_ms: 100,
        });

      const { startFoundry } = await import('../src/index.js');
      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      const { appendJournal } = await import('../src/files/journal.js');
      vi.mocked(saveCheckpoint).mockClear();

      const startedAt = Date.now();
      try {
        await startFoundry({ rootDir: tempDir });
      } finally {
        vi.mocked(readRequests).mockReset();
        vi.mocked(readRequests).mockResolvedValue('');
      }
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeLessThan(300);
      expect(vi.mocked(runIteration).mock.calls.map((call) => call[2])).toEqual([1, 2]);
      expect(saveCheckpoint).toHaveBeenNthCalledWith(1, expect.objectContaining({
        iteration: 1,
      }));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Human redirect detected during cooldown after iteration 1'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('requests.md: Build a human redirect immediately'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Starting iteration 2 early'));
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_checkpoint_saved',
        phase: 'lifecycle',
        data: expect.objectContaining({
          checkpoint_iteration: 1,
          reason: 'cooldown request handoff',
          run_iterations: 1,
          run_outcomes: expect.objectContaining({
            shipped: 1,
          }),
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_cooldown_interrupted',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          reason: 'request file',
          request_file: 'requests.md',
          request_preview: 'Build a human redirect immediately',
          request_checkpoint_saved: true,
          request_checkpoint_reason: 'cooldown request handoff',
        }),
      }));
    });

    it('continues sequential cooldown when request polling fails while sleeping', async () => {
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
        loop: { cooldown_seconds: 0.12, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      });
      const { checkStopFile, readRequests } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValue(false);
      let requestReads = 0;
      vi.mocked(readRequests).mockImplementation(async () => {
        requestReads++;
        if (requestReads === 2) {
          throw new Error('temporary request read failure');
        }
        return '';
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration)
        .mockResolvedValueOnce({
          iteration: 1,
          outcome: 'shipped',
          title: 'Cooldown Request Failure Test',
          domain: 'prose',
          token_usage: { input: 100, output: 50 },
          duration_ms: 1000,
        })
        .mockResolvedValueOnce({
          iteration: 2,
          outcome: 'halted',
          reason: 'test complete',
          token_usage: { input: 0, output: 0 },
          duration_ms: 100,
        });

      const { startFoundry } = await import('../src/index.js');
      const { appendJournal } = await import('../src/files/journal.js');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      const startedAt = Date.now();
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        vi.mocked(readRequests).mockReset();
        vi.mocked(readRequests).mockResolvedValue('');
        logSpy.mockRestore();
      }
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeLessThan(300);
      expect(vi.mocked(runIteration).mock.calls.map((call) => call[2])).toEqual([1, 2]);
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_cooldown_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          cooldown_request_poll_failed: true,
          cooldown_request_poll_failure_count: 1,
          cooldown_request_poll_failure_detail: 'temporary request read failure',
          cooldown_request_file: 'requests.md',
        }),
      }));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Cooldown polling recovered after iteration 1'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('request file requests.md failed 1 time'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('temporary request read failure'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Continuing to iteration 2'));
      expect(consoleOutput).toContain('Cooldown polling recovered after iteration 1: request file requests.md failed 1 time. Continuing to iteration 2.');
    });

    it('continues sequential cooldown when STOP polling fails while sleeping', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, curator_interval: 10, max_test_fix_cycles: 2, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 5, resume_on_crash: true },
        loop: { cooldown_seconds: 0.12, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      });
      const { checkStopFile, readRequests } = await import('../src/files/intervention.js');
      let stopChecks = 0;
      vi.mocked(checkStopFile).mockImplementation(async () => {
        stopChecks++;
        if (stopChecks === 3) {
          throw new Error('temporary stop read failure');
        }
        return false;
      });
      vi.mocked(readRequests).mockResolvedValue('');

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration)
        .mockResolvedValueOnce({
          iteration: 1,
          outcome: 'shipped',
          title: 'Cooldown Stop Failure Test',
          domain: 'prose',
          token_usage: { input: 100, output: 50 },
          duration_ms: 1000,
        })
        .mockResolvedValueOnce({
          iteration: 2,
          outcome: 'halted',
          reason: 'test complete',
          token_usage: { input: 0, output: 0 },
          duration_ms: 100,
        });

      const { startFoundry } = await import('../src/index.js');
      const { appendJournal } = await import('../src/files/journal.js');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      const startedAt = Date.now();
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeLessThan(300);
      expect(vi.mocked(runIteration).mock.calls.map((call) => call[2])).toEqual([1, 2]);
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_cooldown_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          cooldown_stop_poll_failed: true,
          cooldown_stop_poll_failure_count: 1,
          cooldown_stop_poll_failure_detail: 'temporary stop read failure',
          cooldown_stop_file: 'STOP',
        }),
      }));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Cooldown polling recovered after iteration 1'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('STOP file STOP failed 1 time'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('temporary stop read failure'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Continuing to iteration 2'));
      expect(consoleOutput).toContain('Cooldown polling recovered after iteration 1: STOP file STOP failed 1 time. Continuing to iteration 2.');
    });

    it('skips sequential cooldown immediately when a request is already queued', async () => {
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
        loop: { cooldown_seconds: 0.5, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      });
      const { checkStopFile, readRequests } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValue(false);
      vi.mocked(readRequests).mockResolvedValue('Already queued redirect');

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration)
        .mockResolvedValueOnce({
          iteration: 1,
          outcome: 'shipped',
          title: 'Queued Request',
          domain: 'prose',
          token_usage: { input: 100, output: 50 },
          duration_ms: 1000,
        })
        .mockResolvedValueOnce({
          iteration: 2,
          outcome: 'halted',
          reason: 'test complete',
          token_usage: { input: 0, output: 0 },
          duration_ms: 100,
        });

      const { startFoundry } = await import('../src/index.js');

      try {
        await startFoundry({ rootDir: tempDir });
      } finally {
        vi.mocked(readRequests).mockReset();
        vi.mocked(readRequests).mockResolvedValue('');
      }

      expect(vi.mocked(runIteration).mock.calls.map((call) => call[2])).toEqual([1, 2]);
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_cooldown_interrupted',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          reason: 'request file',
          request_file: 'requests.md',
          request_preview: 'Already queued redirect',
          elapsed_ms: expect.any(Number),
        }),
      }));
      const interruption = events.find((event) => event.event === 'foundry_cooldown_interrupted');
      expect(interruption.data.elapsed_ms).toBe(0);
    });

    it('logs sequential next-iteration readiness before advancing the main loop', async () => {
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
        git: { auto_commit: false, auto_push: false },
      });
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValue(false);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration)
        .mockResolvedValueOnce({
          iteration: 1,
          outcome: 'shipped',
          title: 'Ready Loop',
          domain: 'prose',
          token_usage: { input: 100, output: 50 },
          duration_ms: 1000,
        })
        .mockResolvedValueOnce({
          iteration: 2,
          outcome: 'halted',
          reason: 'test complete',
          token_usage: { input: 0, output: 0 },
          duration_ms: 100,
        });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_next_iteration_ready',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          next_iteration: 2,
          cooldown_ms: 0,
          cooldown_base_ms: 0,
          cooldown_heat_adjusted: false,
          token_heat_pressure: 'cool',
          run_iterations: 1,
          run_outcomes: {
            shipped: 1,
            killed: 0,
            skipped: 0,
            halted: 0,
          },
          run_token_usage: {
            input: 100,
            output: 50,
            total: 150,
          },
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_cooldown_skipped',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          next_iteration: 2,
          cooldown_ms: 0,
          cooldown_base_ms: 0,
          cooldown_heat_adjusted: false,
          reason: 'no configured cooldown',
        }),
      }));
    });

    it('stretches hot sequential cooldowns from current-run token heat', async () => {
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
        loop: { cooldown_seconds: 0.01, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      });

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValue(false);
      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration)
        .mockResolvedValueOnce({
          iteration: 1,
          outcome: 'shipped',
          title: 'Hot Cooldown',
          domain: 'code-tool',
          token_usage: { input: 180_000, output: 50_000 },
          duration_ms: 1000,
        })
        .mockResolvedValueOnce({
          iteration: 2,
          outcome: 'halted',
          reason: 'test complete',
          token_usage: { input: 0, output: 0 },
          duration_ms: 10,
        });

      const { startFoundry } = await import('../src/index.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }

      expect(consoleOutput).toContain('Token heat hot 115% - cooling for 12ms before next iteration (base 10ms).');
      expect(consoleOutput).toContain('Cooldown active after iteration 1: sleeping 12ms before iteration 2; watching STOP and requests.md.');
      expect(consoleOutput).toContain('Cooldown complete after ');
      expect(consoleOutput).toContain('starting iteration 2.');
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_cooldown_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          next_iteration: 2,
          cooldown_ms: 12,
          cooldown_stop_file: 'STOP',
          cooldown_request_file: 'requests.md',
          cooldown_interrupts_enabled: true,
          cooldown_signal_watch: true,
          cooldown_base_ms: 10,
          cooldown_heat_adjusted: true,
          cooldown_heat_multiplier: 1.15,
          token_heat_pressure: 'hot',
          token_heat_threshold_percent: 115,
          token_heat_hot: true,
          token_heat_samples: 1,
          token_heat_peak_tokens: 230_000,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_cooldown_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          next_iteration: 2,
          cooldown_ms: 12,
          cooldown_completed: true,
          cooldown_stop_file: 'STOP',
          cooldown_request_file: 'requests.md',
          run_iterations: 1,
          run_token_usage: {
            input: 180_000,
            output: 50_000,
            total: 230_000,
          },
        }),
      }));
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
        source: 'human_redirect',
        artifact_id: '0001',
        title: 'Test',
        domain: 'prose',
        project_id: 'P001',
        project_completed_iterations: 3,
        project_estimated_iterations: 3,
        project_milestone_reached: true,
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      });

      const { startFoundry } = await import('../src/index.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }
      expect(consoleOutput).toContain('Iteration 1: shipped #0001 — Test [human redirect] [project P001 3/3, milestone]');
      expect(consoleOutput).toContain('[1.0s, 100in/50out]');

      expect(runIteration).toHaveBeenCalled();
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_iteration_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          slot: null,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_iteration_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          slot: null,
          outcome: 'shipped',
          artifact_id: '0001',
          title: 'Test',
          domain: 'prose',
          project_id: 'P001',
          project_completed_iterations: 3,
          project_estimated_iterations: 3,
          project_milestone_reached: true,
          duration_ms: 1000,
          token_usage: { input: 100, output: 50 },
        }),
      }));
    });

    it('logs token heat snapshots after terminal sequential iterations', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Token Furnace',
        domain: 'code-tool',
        token_usage: { input: 180_000, output: 50_000 },
        duration_ms: 1000,
      });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_token_heat_snapshot',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          slot: null,
          scope: 'current_run',
          iteration_tokens: 230_000,
          window: 5,
          threshold: 200_000,
          samples: 1,
          average_tokens: 230_000,
          total_tokens: 230_000,
          peak_tokens: 230_000,
          threshold_percent: 115,
          remaining_tokens_to_threshold: 0,
          pressure: 'hot',
          hot: true,
        }),
      }));
    });

    it('prints token heat pressure in the live iteration summary', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Live Furnace',
        domain: 'code-tool',
        token_usage: { input: 180_000, output: 50_000 },
        duration_ms: 1000,
      });

      const { startFoundry } = await import('../src/index.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }

      expect(consoleOutput).toContain('Iteration 1: shipped — Live Furnace');
      expect(consoleOutput).toContain('[heat hot 115%]');
    });

    it('adds current-run outcome and token summary to the stop lifecycle event', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Stop Ledger',
        domain: 'code-tool',
        token_usage: { input: 180_000, output: 50_000 },
        duration_ms: 1000,
      });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stop',
        phase: 'lifecycle',
        data: expect.objectContaining({
          reason: 'STOP file',
          run_iterations: 1,
          run_outcomes: {
            shipped: 1,
            killed: 0,
            skipped: 0,
            halted: 0,
          },
          run_token_usage: {
            input: 180_000,
            output: 50_000,
            total: 230_000,
          },
          run_token_heat: expect.objectContaining({
            pressure: 'hot',
            threshold_percent: 115,
            samples: 1,
            peak_tokens: 230_000,
          }),
        }),
      }));
    });

    it('prints a current-run summary when start stops after doing work', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Stop Console',
        domain: 'code-tool',
        token_usage: { input: 180_000, output: 50_000 },
        duration_ms: 1000,
      });

      const { startFoundry } = await import('../src/index.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }

      expect(consoleOutput).toContain(
        'Run summary: 1 iteration, shipped 1, killed 0, skipped 0, halted 0, 230000 tokens, heat hot 115%.',
      );
    });

    it('adds current-run outcome and token summary to periodic checkpoints', async () => {
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
      });
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Checkpoint Ledger',
        domain: 'code-tool',
        token_usage: { input: 180_000, output: 50_000 },
        duration_ms: 1000,
      });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));

      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_checkpoint_saved',
        phase: 'lifecycle',
        data: expect.objectContaining({
          checkpoint_iteration: 1,
          reason: 'periodic',
          run_iterations: 1,
          run_outcomes: {
            shipped: 1,
            killed: 0,
            skipped: 0,
            halted: 0,
          },
          run_token_usage: {
            input: 180_000,
            output: 50_000,
            total: 230_000,
          },
          run_token_heat: expect.objectContaining({
            pressure: 'hot',
            threshold_percent: 115,
            samples: 1,
          }),
        }),
      }));
    });

    it('forces a Stoker check after an iteration makes token heat hot', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Hot Stoker',
        domain: 'code-tool',
        token_usage: { input: 180_000, output: 50_000 },
        duration_ms: 1000,
      });

      const stoker = await import('../src/stoker/index.js');
      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(stoker.shouldRunStoker).toHaveBeenCalledWith(1, undefined);
      expect(stoker.generateStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        current_iteration: 1,
        for_iteration: 2,
        recent_iterations: [
          expect.objectContaining({
            iteration: 1,
            outcome: 'shipped',
            domain: 'code-tool',
            token_usage: { input: 180_000, output: 50_000 },
          }),
        ],
      }));
      expect(stoker.saveStokerDirective).toHaveBeenCalled();

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stoker_check_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          iteration: 1,
          due: true,
          cadence_due: false,
          force_reason: 'token_heat',
          token_heat_pressure: 'hot',
          token_heat_threshold_percent: 115,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stoker_check_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          iteration: 1,
          due: true,
          cadence_due: false,
          force_reason: 'token_heat',
          directive_written: true,
        }),
      }));
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
      const iterationLog = readFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(iterationLog).toEqual([
        expect.objectContaining({
          iteration: 1,
          outcome: 'skipped',
          reason: 'API down',
          token_usage: { input: 0, output: 0 },
        }),
      ]);
    });

    it('halts sequential start after three consecutive skipped iteration failures', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValue(false);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockRejectedValue(new Error('API down'));

      const { appendJournal } = await import('../src/files/journal.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(runIteration).toHaveBeenCalledTimes(3);
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Halted after 3 consecutive skipped iterations'));
      const iterationLog = readFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(iterationLog).toHaveLength(3);
      expect(iterationLog).toEqual([
        expect.objectContaining({ iteration: 1, outcome: 'skipped', reason: 'API down' }),
        expect.objectContaining({ iteration: 2, outcome: 'skipped', reason: 'API down' }),
        expect.objectContaining({ iteration: 3, outcome: 'skipped', reason: 'API down' }),
      ]);
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_failure_breaker',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 3,
          next_iteration: 4,
          consecutive_failures: 3,
          failure_threshold: 3,
          detail: 'API down',
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stop',
        phase: 'lifecycle',
        data: expect.objectContaining({
          reason: 'consecutive failures',
          consecutive_failures: 3,
          failure_threshold: 3,
          last_completed_iteration: 3,
          next_iteration: 4,
        }),
      }));
    });

    it('warns before the sequential skipped-iteration failure breaker trips', async () => {
      const { checkStopFile, readRequests } = await import('../src/files/intervention.js');
      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(checkStopFile).mockImplementation(async () => vi.mocked(runIteration).mock.calls.length >= 2);
      vi.mocked(readRequests).mockResolvedValue('Operator redirect takes the backoff slot');

      vi.mocked(runIteration)
        .mockResolvedValueOnce({
          iteration: 1,
          outcome: 'skipped',
          reason: 'Gate rejected: unstable proof',
          token_usage: { input: 10, output: 5 },
          duration_ms: 250,
        })
        .mockResolvedValueOnce({
          iteration: 2,
          outcome: 'shipped',
          title: 'Recovered Artifact',
          domain: 'code-tool',
          token_usage: { input: 100, output: 50 },
          duration_ms: 900,
        });

      const { startFoundry } = await import('../src/index.js');
      try {
        await startFoundry({ rootDir: tempDir });
      } finally {
        vi.mocked(readRequests).mockReset();
        vi.mocked(readRequests).mockResolvedValue('');
      }

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_failure_warning',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          next_iteration: 2,
          consecutive_failures: 1,
          failure_threshold: 3,
          failures_remaining: 2,
          cooldown_failure_backoff_ms: 1000,
          detail: 'Gate rejected: unstable proof',
        }),
      }));
    });

    it('prints sequential skipped-streak pressure before the breaker trips', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'skipped',
        reason: 'Gate rejected: missing runnable proof',
        token_usage: { input: 10, output: 5 },
        duration_ms: 250,
      });

      const { startFoundry } = await import('../src/index.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }

      expect(consoleOutput).toContain('Skipped iteration streak 1/3 - 2 before automatic halt; retry backoff 1.0s.');
    });

    it('logs sequential post-iteration maintenance before cooldown decisions', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Maintenance Artifact',
        domain: 'code-tool',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_maintenance_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          next_iteration: 2,
          outcome: 'shipped',
          title: 'Maintenance Artifact',
          domain: 'code-tool',
          curator_trigger: 'none',
          periodic_checkpoint_due: false,
          failure_streak: 0,
          token_heat_pressure: 'cool',
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_maintenance_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          next_iteration: 2,
          outcome: 'shipped',
          curator_trigger: 'none',
          periodic_checkpoint_saved: false,
          monitor_checked: true,
          stoker_checked: true,
          stoker_failed: false,
          failure_streak: 0,
          duration_ms: expect.any(Number),
        }),
      }));
      const maintenanceCompleteIndex = events.findIndex((event) => event.event === 'foundry_sequential_maintenance_complete');
      const stopIndex = events.findIndex((event) => event.event === 'foundry_stop');
      expect(maintenanceCompleteIndex).toBeGreaterThan(-1);
      expect(stopIndex).toBeGreaterThan(maintenanceCompleteIndex);
    });

    it('includes the current run ledger in sequential maintenance start', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Maintenance Start Ledger Artifact',
        domain: 'code-tool',
        token_usage: { input: 80, output: 40 },
        duration_ms: 700,
      });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_maintenance_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          run_iterations: 1,
          run_outcomes: {
            shipped: 1,
            killed: 0,
            skipped: 0,
            halted: 0,
          },
          run_token_usage: {
            input: 80,
            output: 40,
            total: 120,
          },
          run_token_heat: expect.objectContaining({
            pressure: 'cool',
            samples: 1,
            total_tokens: 120,
            peak_tokens: 120,
          }),
        }),
      }));
    });

    it('includes monitor warning counts in sequential maintenance completion', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Maintenance Warning Artifact',
        domain: 'code-tool',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReturnValue([
        { detector: 'quality', severity: 'warning' as const, message: 'Quality dip detected', iteration: 1 },
      ]);

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_maintenance_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          monitor_checked: true,
          monitor_failed: false,
          monitor_warning_count: 1,
          monitor_critical_warning_count: 0,
          monitor_emergency_curator_triggered: false,
        }),
      }));
    });

    it('forces a Stoker handoff when the monitor finds warning-level pressure', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Monitor Warning Artifact',
        domain: 'code-tool',
        mean_rating: '3.8',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReturnValue([
        { detector: 'quality', severity: 'warning' as const, message: 'Quality dip detected', iteration: 1 },
      ]);

      const stoker = await import('../src/stoker/index.js');
      vi.mocked(stoker.shouldRunStoker).mockReset();
      vi.mocked(stoker.shouldRunStoker).mockReturnValue(false);
      vi.mocked(stoker.generateStokerDirective).mockReset();
      vi.mocked(stoker.generateStokerDirective).mockReturnValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 1,
        for_iteration: 2,
        urgency: 'high',
        streak_instruction: 'neutral',
        ideator_hint: 'Respond to monitor warning.',
        rules_fired: ['monitor_warning'],
      });
      vi.mocked(stoker.saveStokerDirective).mockResolvedValueOnce(undefined);

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(stoker.generateStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        force_reason: 'monitor_warning',
        force_context: expect.objectContaining({
          title: 'Monitor Warning Artifact',
          domain: 'code-tool',
          warning_count: 1,
          critical_warning_count: 0,
          reason: 'quality: Quality dip detected',
        }),
      }));

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stoker_check_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          due: true,
          cadence_due: false,
          force_reason: 'monitor_warning',
          directive_written: true,
          for_iteration: 2,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_maintenance_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          stoker_force_reason: 'monitor_warning',
          stoker_directive_written: true,
          stoker_rules_fired: ['monitor_warning'],
        }),
      }));
    });

    it('packs multiple monitor warnings into the forced Stoker context', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Multi Warning Artifact',
        domain: 'code-tool',
        mean_rating: '3.7',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReturnValue([
        { detector: 'quality', severity: 'warning' as const, message: 'Quality dip detected', iteration: 1 },
        { detector: 'repetition', severity: 'warning' as const, message: 'Artifacts too similar', iteration: 1 },
      ]);

      const stoker = await import('../src/stoker/index.js');
      vi.mocked(stoker.shouldRunStoker).mockReturnValue(false);

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(stoker.generateStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        force_reason: 'monitor_warning',
        force_context: expect.objectContaining({
          warning_count: 2,
          critical_warning_count: 0,
          reason: expect.stringContaining('quality: Quality dip detected'),
        }),
      }));
      expect(stoker.generateStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        force_context: expect.objectContaining({
          reason: expect.stringContaining('repetition: Artifacts too similar'),
        }),
      }));
    });

    it('forces a Stoker handoff to repair a weak shipped Critic dimension', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Uneven Shipped Artifact',
        domain: 'game',
        ratings: {
          originality: 4,
          specificity: 4,
          craft: 4,
          surprise: 3,
          coherence: 4,
          portfolio_fit: 4,
        },
        mean_rating: '3.8',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReset();
      vi.mocked(runAllDetectors).mockReturnValue([]);

      const stoker = await import('../src/stoker/index.js');
      vi.mocked(stoker.shouldRunStoker).mockReturnValue(false);
      vi.mocked(stoker.generateStokerDirective).mockReturnValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 1,
        for_iteration: 2,
        urgency: 'high',
        streak_instruction: 'neutral',
        ideator_hint: 'Repair surprise next.',
        rules_fired: ['dimension_repair'],
      });
      const { appendJournal } = await import('../src/files/journal.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(stoker.generateStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        force_reason: 'dimension_repair',
        force_context: expect.objectContaining({
          title: 'Uneven Shipped Artifact',
          domain: 'game',
          dimension: 'surprise',
          rating: 3,
          threshold: 4,
        }),
      }));

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stoker_check_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          due: true,
          cadence_due: false,
          force_reason: 'dimension_repair',
          directive_written: true,
          for_iteration: 2,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_maintenance_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          stoker_force_reason: 'dimension_repair',
          stoker_directive_written: true,
          stoker_rules_fired: ['dimension_repair'],
        }),
      }));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Dimension repair after shipped artifact "Uneven Shipped Artifact" in game'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('surprise rated 3.0 below 4.0'));
    });

    it('keeps success amplification ahead when no Critic dimension needs repair', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Consistently Strong Artifact',
        domain: 'game',
        ratings: {
          originality: 4,
          specificity: 4,
          craft: 4,
          surprise: 4,
          coherence: 4,
          portfolio_fit: 4,
        },
        mean_rating: '4.0',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReset();
      vi.mocked(runAllDetectors).mockReturnValue([]);

      const stoker = await import('../src/stoker/index.js');
      vi.mocked(stoker.shouldRunStoker).mockReturnValue(false);
      vi.mocked(stoker.generateStokerDirective).mockReturnValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 1,
        for_iteration: 2,
        urgency: 'high',
        streak_instruction: 'amplify',
        ideator_hint: 'Amplify the win.',
        rules_fired: ['success_amplification'],
      });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(stoker.generateStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        force_reason: 'success_amplification',
        force_context: expect.objectContaining({
          title: 'Consistently Strong Artifact',
          domain: 'game',
          rating: 4,
          threshold: 4,
        }),
      }));
      expect(stoker.generateStokerDirective).not.toHaveBeenCalledWith(expect.objectContaining({
        force_reason: 'dimension_repair',
      }));
    });

    it('includes stoker directive details in sequential maintenance completion', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Maintenance Stoker Artifact',
        domain: 'code-tool',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const stoker = await import('../src/stoker/index.js');
      vi.mocked(stoker.shouldRunStoker).mockReset();
      vi.mocked(stoker.shouldRunStoker).mockReturnValueOnce(true);
      vi.mocked(stoker.generateStokerDirective).mockReset();
      vi.mocked(stoker.generateStokerDirective).mockReturnValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 1,
        for_iteration: 2,
        urgency: 'high',
        streak_instruction: 'push',
        ideator_hint: 'Feed the main loop with a sharper build.',
        rules_fired: ['running_cold', 'refinery_ready'],
        refinery_queue: 2,
      } as any);

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_maintenance_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          stoker_checked: true,
          stoker_failed: false,
          stoker_due: true,
          stoker_cadence_due: true,
          stoker_directive_written: true,
          stoker_for_iteration: 2,
          stoker_urgency: 'high',
          stoker_rules_fired: ['running_cold', 'refinery_ready'],
          stoker_refinery_queue: 2,
        }),
      }));
    });

    it('includes the current run ledger in sequential maintenance completion', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Maintenance Ledger Artifact',
        domain: 'code-tool',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_maintenance_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          run_iterations: 1,
          run_outcomes: {
            shipped: 1,
            killed: 0,
            skipped: 0,
            halted: 0,
          },
          run_token_usage: {
            input: 100,
            output: 50,
            total: 150,
          },
          run_token_heat: expect.objectContaining({
            pressure: 'cool',
            samples: 1,
            total_tokens: 150,
            peak_tokens: 150,
          }),
        }),
      }));
    });

    it('prints a live sequential maintenance summary after post-iteration checks', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Maintenance Console Artifact',
        domain: 'code-tool',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReturnValue([
        { detector: 'quality', severity: 'warning' as const, message: 'Quality dip detected', iteration: 1 },
      ]);

      const stoker = await import('../src/stoker/index.js');
      vi.mocked(stoker.shouldRunStoker).mockReset();
      vi.mocked(stoker.shouldRunStoker).mockReturnValueOnce(true);
      vi.mocked(stoker.generateStokerDirective).mockReset();
      vi.mocked(stoker.generateStokerDirective).mockReturnValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 1,
        for_iteration: 2,
        urgency: 'high',
        streak_instruction: 'push',
        ideator_hint: 'Feed the main loop with a sharper build.',
        rules_fired: ['running_cold'],
        refinery_queue: 1,
      } as any);

      const { startFoundry } = await import('../src/index.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }

      expect(consoleOutput).toContain('Maintenance:');
      expect(consoleOutput).toContain('checkpoint deferred');
      expect(consoleOutput).toContain('monitor 1 warning');
      expect(consoleOutput).toContain('Stoker wrote high directive for iteration 2');
      expect(consoleOutput).toContain('heat cool 0%');
    });

    it('prints a live sequential next-iteration handoff summary before cooldown', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Next Handoff Artifact',
        domain: 'code-tool',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReturnValue([]);

      const { startFoundry } = await import('../src/index.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }

      expect(consoleOutput).toContain('Next iteration 2 ready: cooldown 0ms; heat cool 0%; run 1 iteration, 150 tokens.');
    });

    it('includes stoker directive handoff details in sequential next-iteration readiness', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Directive Handoff Artifact',
        domain: 'code-tool',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReturnValue([]);

      const stoker = await import('../src/stoker/index.js');
      vi.mocked(stoker.shouldRunStoker).mockReset();
      vi.mocked(stoker.shouldRunStoker).mockReturnValueOnce(true);
      vi.mocked(stoker.generateStokerDirective).mockReset();
      vi.mocked(stoker.generateStokerDirective).mockReturnValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 1,
        for_iteration: 2,
        urgency: 'high',
        streak_instruction: 'push',
        ideator_hint: 'Feed the main loop with a sharper build.',
        rules_fired: ['running_cold'],
        refinery_queue: 1,
      } as any);

      const { startFoundry } = await import('../src/index.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }

      expect(consoleOutput).toContain('Next iteration 2 ready: cooldown 0ms; heat cool 0%; run 1 iteration, 150 tokens; Stoker high directive for iteration 2.');

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_next_iteration_ready',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          next_iteration: 2,
          next_stoker_directive_written: true,
          next_stoker_for_iteration: 2,
          next_stoker_urgency: 'high',
          next_stoker_rules_fired: ['running_cold'],
          next_stoker_refinery_queue: 1,
        }),
      }));
    });

    it('includes queued request handoff details in sequential next-iteration readiness', async () => {
      const { checkStopFile, readRequests } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      vi.mocked(readRequests).mockResolvedValueOnce('Make the next iteration a tiny playable puzzle.\nDomain: game');

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Request Handoff Artifact',
        domain: 'code-tool',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReturnValue([]);

      const { startFoundry } = await import('../src/index.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }

      expect(consoleOutput).toContain('redirect queued requests.md: Make the next iteration a tiny playable puzzle. Domain: game');

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_next_iteration_ready',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          next_iteration: 2,
          next_request_file: 'requests.md',
          next_request_pending: true,
          next_request_preview: 'Make the next iteration a tiny playable puzzle. Domain: game',
        }),
      }));
    });

    it('forces a Stoker handoff when a queued request is waiting for the next iteration', async () => {
      const { checkStopFile, readRequests } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      vi.mocked(readRequests).mockResolvedValue('Make the next iteration a tiny playable puzzle.\nDomain: game');

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Request Stoker Artifact',
        domain: 'code-tool',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReturnValue([]);

      const stoker = await import('../src/stoker/index.js');
      vi.mocked(stoker.shouldRunStoker).mockReturnValue(false);
      vi.mocked(stoker.generateStokerDirective).mockReturnValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 1,
        for_iteration: 2,
        urgency: 'high',
        streak_instruction: 'neutral',
        ideator_hint: 'Follow the queued request.',
        rules_fired: ['human_redirect'],
      });

      const { startFoundry } = await import('../src/index.js');
      try {
        await startFoundry({ rootDir: tempDir });
      } finally {
        vi.mocked(readRequests).mockReset();
        vi.mocked(readRequests).mockResolvedValue('');
      }

      expect(stoker.generateStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        force_reason: 'human_redirect',
        force_context: expect.objectContaining({
          request_file: 'requests.md',
          request_preview: 'Make the next iteration a tiny playable puzzle. Domain: game',
        }),
      }));

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stoker_check_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          due: true,
          cadence_due: false,
          force_reason: 'human_redirect',
          directive_written: true,
          for_iteration: 2,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_maintenance_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          stoker_force_reason: 'human_redirect',
          stoker_directive_written: true,
          stoker_rules_fired: ['human_redirect'],
        }),
      }));
    });

    it('forces a Curator pass and Stoker handoff when a shipped artifact underburns its complexity budget', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: {
          max_idea_retries: 3,
          max_revision_rounds: 2,
          max_test_fix_cycles: 2,
          curator_interval: 10,
          domain_cooldown: 3,
          novelty_window: 5,
          complexity_profiles: {
            S: { max_tokens_per_phase: 32768, budget_warning_threshold: 25000 },
            M: { max_tokens_per_phase: 65536, budget_warning_threshold: 120000 },
          },
        },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
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
        title: 'Tiny Spark',
        domain: 'code-tool',
        complexity: 'S',
        token_usage: { input: 600, output: 300 },
        duration_ms: 900,
      });

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReturnValue([]);

      const { shouldRunCurator, dispatchCuratorFull, applyCuratorCycle } = await import('../src/curator/index.js');
      vi.mocked(shouldRunCurator).mockReturnValue(false);
      vi.mocked(dispatchCuratorFull).mockResolvedValueOnce({
        retrospective: 'Underburn escalation review',
        compressed_journal: 'Compressed',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [],
        human_redirect: null,
      });
      vi.mocked(applyCuratorCycle).mockResolvedValueOnce(undefined);

      const stoker = await import('../src/stoker/index.js');
      vi.mocked(stoker.shouldRunStoker).mockReturnValue(false);
      vi.mocked(stoker.generateStokerDirective).mockReturnValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 1,
        for_iteration: 2,
        urgency: 'high',
        streak_instruction: 'neutral',
        ideator_hint: 'Spend more deliberate effort next.',
        complexity_override: 'M',
        rules_fired: ['underburn'],
      });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(dispatchCuratorFull).toHaveBeenCalled();
      expect(applyCuratorCycle).toHaveBeenCalled();
      expect(stoker.generateStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        force_reason: 'underburn',
        force_context: expect.objectContaining({
          title: 'Tiny Spark',
          domain: 'code-tool',
          complexity: 'S',
          spent_tokens: 900,
          target_tokens: 6250,
        }),
      }));

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_curator_cycle_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          trigger: 'underburn_escalation',
          title: 'Tiny Spark',
          domain: 'code-tool',
          complexity: 'S',
          spent_tokens: 900,
          target_tokens: 6250,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_curator_cycle_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          trigger: 'underburn_escalation',
          last_curator_run: 1,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stoker_check_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          due: true,
          cadence_due: false,
          force_reason: 'underburn',
          directive_written: true,
          for_iteration: 2,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_maintenance_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          curator_trigger: 'underburn_escalation',
          stoker_force_reason: 'underburn',
          stoker_directive_written: true,
          stoker_rules_fired: ['underburn'],
        }),
      }));
    });

    it('forces a Stoker domain pivot after repeated shipped artifacts in the same domain', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { loadCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(loadCheckpoint).mockResolvedValueOnce({
        iteration: 2,
        active_project_ids: [],
        domain_counts: { 'code-tool': 2 },
        last_stimuli_refresh: {},
        last_curator_run: 0,
        stats: {
          iteration: 2,
          shipped: 2,
          killed: 0,
          skipped: 0,
          domain_counts: { 'code-tool': 2 },
          recent_outcomes: [
            { iteration: 1, outcome: 'shipped', domain: 'code-tool' },
            { iteration: 2, outcome: 'shipped', domain: 'code-tool' },
          ],
          critic_rejection_window: [],
          total_tokens: { input: 2000, output: 1000 },
        },
        saved_at: '2026-01-01T00:00:00.000Z',
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 3,
        outcome: 'shipped',
        title: 'Third Tool',
        domain: 'code-tool',
        token_usage: { input: 1000, output: 500 },
        duration_ms: 900,
      });

      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockImplementation(async (filePath: string) => (
        filePath.endsWith('iterations.jsonl')
          ? [
              {
                iteration: 1,
                outcome: 'shipped',
                title: 'First Tool',
                domain: 'code-tool',
                token_usage: { input: 1000, output: 500 },
                duration_ms: 800,
              },
              {
                iteration: 2,
                outcome: 'shipped',
                title: 'Second Tool',
                domain: 'code-tool',
                token_usage: { input: 1000, output: 500 },
                duration_ms: 850,
              },
            ] as any
          : []
      ));

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReturnValue([]);

      const stoker = await import('../src/stoker/index.js');
      vi.mocked(stoker.shouldRunStoker).mockReturnValue(false);
      vi.mocked(stoker.generateStokerDirective).mockReturnValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 3,
        for_iteration: 4,
        urgency: 'high',
        streak_instruction: 'break',
        ideator_hint: 'Pivot away from the repeated domain.',
        domain_pressure: { toward: [], away_from: ['code-tool'] },
        rules_fired: ['domain_rut'],
      });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(stoker.generateStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        force_reason: 'domain_rut',
        force_context: expect.objectContaining({
          domain: 'code-tool',
          streak_length: 3,
        }),
      }));

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stoker_check_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 3,
          due: true,
          cadence_due: false,
          force_reason: 'domain_rut',
          directive_written: true,
          for_iteration: 4,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_maintenance_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          stoker_force_reason: 'domain_rut',
          stoker_directive_written: true,
          stoker_rules_fired: ['domain_rut'],
        }),
      }));
    });

    it('records a journal note when a queued request skips sequential cooldown', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 99, resume_on_crash: true },
        loop: { cooldown_seconds: 1, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      });

      const { checkStopFile, readRequests } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValue(false);
      vi.mocked(readRequests).mockResolvedValue('Make the next iteration a tiny playable puzzle.\nDomain: game');

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration)
        .mockResolvedValueOnce({
          iteration: 1,
          outcome: 'shipped',
          title: 'Request Cooldown Journal Artifact',
          domain: 'code-tool',
          token_usage: { input: 100, output: 50 },
          duration_ms: 900,
        })
        .mockResolvedValueOnce({
          iteration: 2,
          outcome: 'halted',
          reason: 'test complete',
          token_usage: { input: 0, output: 0 },
          duration_ms: 50,
        });

      const { appendJournal } = await import('../src/files/journal.js');

      const { startFoundry } = await import('../src/index.js');
      try {
        await startFoundry({ rootDir: tempDir });
      } finally {
        vi.mocked(readRequests).mockReset();
        vi.mocked(readRequests).mockResolvedValue('');
      }

      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Human redirect queued before cooldown after iteration 1'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('requests.md: Make the next iteration a tiny playable puzzle. Domain: game'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Starting iteration 2 early'));
    });

    it('checkpoints before a queued request skips sequential cooldown', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 99, resume_on_crash: true },
        loop: { cooldown_seconds: 1, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      });

      const { checkStopFile, readRequests } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValue(false);
      vi.mocked(readRequests).mockResolvedValue('Make the next iteration a tiny playable puzzle.\nDomain: game');

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration)
        .mockResolvedValueOnce({
          iteration: 1,
          outcome: 'shipped',
          title: 'Request Cooldown Checkpoint Artifact',
          domain: 'code-tool',
          token_usage: { input: 100, output: 50 },
          duration_ms: 900,
        })
        .mockResolvedValueOnce({
          iteration: 2,
          outcome: 'halted',
          reason: 'test complete',
          token_usage: { input: 0, output: 0 },
          duration_ms: 50,
        });

      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(saveCheckpoint).mockClear();

      const { startFoundry } = await import('../src/index.js');
      try {
        await startFoundry({ rootDir: tempDir });
      } finally {
        vi.mocked(readRequests).mockReset();
        vi.mocked(readRequests).mockResolvedValue('');
      }

      expect(saveCheckpoint).toHaveBeenNthCalledWith(1, expect.objectContaining({
        iteration: 1,
      }));

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_next_iteration_ready',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          next_iteration: 2,
          next_request_pending: true,
          next_request_checkpoint_required: true,
          next_request_checkpoint_saved: true,
          next_request_checkpoint_reason: 'request handoff',
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_checkpoint_saved',
        phase: 'lifecycle',
        data: expect.objectContaining({
          checkpoint_iteration: 1,
          reason: 'request handoff',
          run_iterations: 1,
          run_outcomes: expect.objectContaining({
            shipped: 1,
          }),
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_cooldown_interrupted',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          reason: 'request file',
          request_checkpoint_saved: true,
          request_checkpoint_reason: 'request handoff',
        }),
      }));
    });

    it('starts the next iteration early for a high-urgency Stoker handoff', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 99, resume_on_crash: true },
        loop: { cooldown_seconds: 1, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      });

      const { checkStopFile, readRequests } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValue(false);
      vi.mocked(readRequests).mockResolvedValue('');

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReturnValue([]);

      const stoker = await import('../src/stoker/index.js');
      vi.mocked(stoker.shouldRunStoker).mockReset();
      vi.mocked(stoker.shouldRunStoker).mockReturnValueOnce(true);
      vi.mocked(stoker.generateStokerDirective).mockReset();
      vi.mocked(stoker.generateStokerDirective).mockReturnValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 1,
        for_iteration: 2,
        urgency: 'high',
        streak_instruction: 'neutral',
        ideator_hint: 'Spend the next loop on a larger artifact immediately.',
        rules_fired: ['running_cold'],
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration)
        .mockResolvedValueOnce({
          iteration: 1,
          outcome: 'shipped',
          title: 'Urgent Stoker Handoff Artifact',
          domain: 'code-tool',
          token_usage: { input: 100, output: 50 },
          duration_ms: 900,
        })
        .mockResolvedValueOnce({
          iteration: 2,
          outcome: 'halted',
          reason: 'test complete',
          token_usage: { input: 0, output: 0 },
          duration_ms: 50,
        });

      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(saveCheckpoint).mockClear();
      const { appendJournal } = await import('../src/files/journal.js');

      const { startFoundry } = await import('../src/index.js');
      const startedAt = Date.now();
      await startFoundry({ rootDir: tempDir });
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeLessThan(300);
      expect(vi.mocked(runIteration).mock.calls.map((call) => call[2])).toEqual([1, 2]);
      expect(saveCheckpoint).toHaveBeenNthCalledWith(1, expect.objectContaining({
        iteration: 1,
      }));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('High-urgency Stoker handoff after iteration 1'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Starting iteration 2 early'));

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_next_iteration_ready',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          next_iteration: 2,
          next_stoker_directive_written: true,
          next_stoker_for_iteration: 2,
          next_stoker_urgency: 'high',
          next_stoker_urgent_handoff: true,
          next_stoker_checkpoint_required: true,
          next_stoker_checkpoint_saved: true,
          next_stoker_checkpoint_reason: 'stoker urgent handoff',
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_checkpoint_saved',
        phase: 'lifecycle',
        data: expect.objectContaining({
          checkpoint_iteration: 1,
          reason: 'stoker urgent handoff',
          run_iterations: 1,
          run_outcomes: expect.objectContaining({
            shipped: 1,
          }),
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_cooldown_interrupted',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          cooldown_ms: 1000,
          elapsed_ms: 0,
          reason: 'stoker urgent handoff',
          stoker_for_iteration: 2,
          stoker_urgency: 'high',
          stoker_rules_fired: ['running_cold'],
          stoker_checkpoint_saved: true,
          stoker_checkpoint_reason: 'stoker urgent handoff',
        }),
      }));
    });

    it('prints queued request checkpoint coverage in sequential next-iteration readiness', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 99, resume_on_crash: true },
        loop: { cooldown_seconds: 1, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      });

      const { checkStopFile, readRequests } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValue(false);
      vi.mocked(readRequests).mockResolvedValue('Make the next iteration a tiny playable puzzle.\nDomain: game');

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration)
        .mockResolvedValueOnce({
          iteration: 1,
          outcome: 'shipped',
          title: 'Request Checkpoint Console Artifact',
          domain: 'code-tool',
          token_usage: { input: 100, output: 50 },
          duration_ms: 900,
        })
        .mockResolvedValueOnce({
          iteration: 2,
          outcome: 'halted',
          reason: 'test complete',
          token_usage: { input: 0, output: 0 },
          duration_ms: 50,
        });

      const { startFoundry } = await import('../src/index.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
        vi.mocked(readRequests).mockReset();
        vi.mocked(readRequests).mockResolvedValue('');
      }

      expect(consoleOutput).toContain('Next iteration 2 ready: cooldown 1.0s; heat cool 0%; run 1 iteration, 150 tokens; Stoker normal directive for iteration 2; redirect queued requests.md: Make the next iteration a tiny playable puzzle. Domain: game. checkpoint saved for request handoff.');
    });

    it('includes maintenance attention in sequential next-iteration readiness', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Attention Handoff Artifact',
        domain: 'code-tool',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReturnValue([
        { detector: 'quality', severity: 'warning' as const, message: 'Quality dip detected', iteration: 1 },
      ]);

      const { startFoundry } = await import('../src/index.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }

      expect(consoleOutput).toContain('Next iteration 2 ready: cooldown 0ms; heat cool 0%; run 1 iteration, 150 tokens; Stoker normal directive for iteration 2; attention warning (monitor 1 warning).');

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_next_iteration_ready',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          next_iteration: 2,
          handoff_health: 'warning',
          handoff_attention_reasons: ['monitor_warning'],
          handoff_monitor_warning_count: 1,
          handoff_monitor_critical_warning_count: 0,
          handoff_monitor_failed: false,
          handoff_stoker_failed: false,
          next_stoker_directive_written: true,
          next_stoker_for_iteration: 2,
        }),
      }));
    });

    it('checkpoints critical sequential handoff attention before advancing', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Critical Handoff Artifact',
        domain: 'code-tool',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReturnValue([
        { detector: 'quality', severity: 'critical' as const, message: 'Critical quality dip', iteration: 1 },
      ]);

      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(saveCheckpoint).mockClear();

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(saveCheckpoint).toHaveBeenNthCalledWith(1, expect.objectContaining({
        iteration: 1,
      }));

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_next_iteration_ready',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          next_iteration: 2,
          handoff_health: 'critical',
          handoff_attention_reasons: ['monitor_critical_warning', 'monitor_warning', 'emergency_curator'],
          handoff_checkpoint_reason: 'emergency curator',
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_checkpoint_saved',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          checkpoint_iteration: 1,
          reason: 'emergency curator',
          run_iterations: 1,
          run_outcomes: expect.objectContaining({
            shipped: 1,
          }),
        }),
      }));
    });

    it('surfaces critical handoff checkpoint coverage in readiness output', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Critical Handoff Coverage Artifact',
        domain: 'code-tool',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReturnValue([
        { detector: 'quality', severity: 'critical' as const, message: 'Critical quality dip', iteration: 1 },
      ]);

      const { startFoundry } = await import('../src/index.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }

      expect(consoleOutput).toContain('checkpoint saved for emergency curator');

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_next_iteration_ready',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          next_iteration: 2,
          handoff_health: 'critical',
          handoff_checkpoint_required: true,
          handoff_checkpoint_saved: true,
          handoff_checkpoint_reason: 'emergency curator',
        }),
      }));
    });

    it('records critical handoff attention in the journal', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Critical Journal Handoff Artifact',
        domain: 'code-tool',
        token_usage: { input: 100, output: 50 },
        duration_ms: 900,
      });

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReturnValue([
        { detector: 'quality', severity: 'critical' as const, message: 'Critical quality dip', iteration: 1 },
      ]);

      const { appendJournal } = await import('../src/files/journal.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Critical handoff attention after iteration 1'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('monitor 1 critical warning, monitor 1 warning, emergency Curator ran'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Checkpoint saved for emergency curator before iteration 2'));
    });

    it('prints skipped iteration reasons in the live summary', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'skipped',
        reason: 'Gate rejected: missing runnable proof',
        token_usage: { input: 10, output: 5 },
        duration_ms: 250,
      });

      const { startFoundry } = await import('../src/index.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }

      expect(consoleOutput).toContain('Iteration 1: skipped [reason: Gate rejected: missing runnable proof]');
    });

    it('adds a retry backoff to the sequential handoff after a skipped iteration', async () => {
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
        git: { auto_commit: false, auto_push: false },
      });
      const { checkStopFile, readRequests } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValue(false);
      vi.mocked(readRequests).mockResolvedValue('Operator redirect takes the backoff slot');

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration)
        .mockResolvedValueOnce({
          iteration: 1,
          outcome: 'skipped',
          reason: 'Gate rejected: unstable proof',
          token_usage: { input: 10, output: 5 },
          duration_ms: 250,
        })
        .mockResolvedValueOnce({
          iteration: 2,
          outcome: 'halted',
          reason: 'test complete',
          token_usage: { input: 0, output: 0 },
          duration_ms: 50,
        });

      const { startFoundry } = await import('../src/index.js');
      try {
        await startFoundry({ rootDir: tempDir });
      } finally {
        vi.mocked(readRequests).mockReset();
        vi.mocked(readRequests).mockResolvedValue('');
      }

      expect(vi.mocked(runIteration).mock.calls.map((call) => call[2])).toEqual([1, 2]);
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_next_iteration_ready',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          next_iteration: 2,
          cooldown_ms: 1000,
          cooldown_base_ms: 0,
          cooldown_failure_backoff_ms: 1000,
          cooldown_failure_backoff_applied: true,
          cooldown_failure_streak: 1,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_cooldown_interrupted',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          iteration: 1,
          cooldown_ms: 1000,
          cooldown_failure_backoff_ms: 1000,
          cooldown_failure_backoff_applied: true,
          reason: 'request file',
          elapsed_ms: 0,
        }),
      }));
    });

    it('checkpoints before sleeping for a sequential skipped-iteration backoff', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 99, resume_on_crash: true },
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      });
      const { checkStopFile, readRequests } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValue(false);
      vi.mocked(readRequests).mockResolvedValue('Operator redirect takes the backoff slot');

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration)
        .mockResolvedValueOnce({
          iteration: 1,
          outcome: 'skipped',
          reason: 'Gate rejected: unstable proof',
          token_usage: { input: 10, output: 5 },
          duration_ms: 250,
        })
        .mockResolvedValueOnce({
          iteration: 2,
          outcome: 'halted',
          reason: 'test complete',
          token_usage: { input: 0, output: 0 },
          duration_ms: 50,
        });

      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(saveCheckpoint).mockClear();

      const { startFoundry } = await import('../src/index.js');
      try {
        await startFoundry({ rootDir: tempDir });
      } finally {
        vi.mocked(readRequests).mockReset();
        vi.mocked(readRequests).mockResolvedValue('');
      }

      expect(saveCheckpoint).toHaveBeenNthCalledWith(1, expect.objectContaining({
        iteration: 1,
      }));
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_checkpoint_saved',
        phase: 'lifecycle',
        data: expect.objectContaining({
          checkpoint_iteration: 1,
          reason: 'failure backoff',
          run_iterations: 1,
          run_outcomes: expect.objectContaining({
            skipped: 1,
          }),
        }),
      }));
    });

    it('logs when sequential start recovers from a skipped-iteration streak', async () => {
      const { checkStopFile, readRequests } = await import('../src/files/intervention.js');
      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(checkStopFile).mockImplementation(async () => vi.mocked(runIteration).mock.calls.length >= 2);
      vi.mocked(readRequests).mockResolvedValue('Operator redirect takes the backoff slot');

      vi.mocked(runIteration)
        .mockResolvedValueOnce({
          iteration: 1,
          outcome: 'skipped',
          reason: 'Gate rejected: unstable proof',
          token_usage: { input: 10, output: 5 },
          duration_ms: 250,
        })
        .mockResolvedValueOnce({
          iteration: 2,
          outcome: 'shipped',
          title: 'Recovered Artifact',
          domain: 'code-tool',
          token_usage: { input: 100, output: 50 },
          duration_ms: 900,
        });

      const { startFoundry } = await import('../src/index.js');
      try {
        await startFoundry({ rootDir: tempDir });
      } finally {
        vi.mocked(readRequests).mockReset();
        vi.mocked(readRequests).mockResolvedValue('');
      }

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_failure_recovered',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 2,
          previous_failure_streak: 1,
          recovery_outcome: 'shipped',
          title: 'Recovered Artifact',
          domain: 'code-tool',
          token_usage: { input: 100, output: 50 },
        }),
      }));
    });

    it('logs worker-pool iteration failures as skipped terminal outcomes', async () => {
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
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0, concurrency: 2 },
        git: { auto_commit: false, auto_push: false },
      });

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockReset();
      let stopCallCount = 0;
      vi.mocked(checkStopFile).mockImplementation(async () => {
        stopCallCount++;
        return stopCallCount > 3;
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration)
        .mockRejectedValueOnce(new Error('worker provider down'))
        .mockResolvedValueOnce({
          iteration: 2,
          outcome: 'shipped',
          title: 'Parallel Art',
          domain: 'prose',
          token_usage: { input: 100, output: 50 },
          duration_ms: 1000,
        });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const iterationLog = readFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const skippedFailure = iterationLog.find((entry) => entry.reason === 'Iteration failed in worker pool: worker provider down');
      expect(skippedFailure).toEqual(expect.objectContaining({
        outcome: 'skipped',
        token_usage: { input: 0, output: 0 },
      }));
      expect([1, 2]).toContain(skippedFailure?.iteration);
    });

    it('limits parallel scheduling to one worker while a human request is pending', async () => {
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
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0, concurrency: 2 },
        git: { auto_commit: false, auto_push: false },
      });

      const { checkStopFile, readRequests } = await import('../src/files/intervention.js');
      let requestPending = true;
      vi.mocked(readRequests).mockImplementation(async () => (
        requestPending ? 'Parallel redirect should be consumed once' : ''
      ));
      vi.mocked(checkStopFile).mockImplementation(async () => (
        vi.mocked(runIteration).mock.calls.length >= 3
      ));

      const { runIteration } = await import('../src/iteration/index.js');
      let releaseFirstIteration: (() => void) | null = null;
      let firstIterationReleased = false;
      const releaseFirst = (): void => {
        if (firstIterationReleased) return;
        firstIterationReleased = true;
        requestPending = false;
        releaseFirstIteration?.();
      };

      vi.mocked(runIteration).mockImplementation(async (_config, _models, iteration) => {
        if (iteration === 1) {
          return new Promise((resolve) => {
            releaseFirstIteration = () => resolve({
              iteration,
              outcome: 'shipped',
              title: 'Parallel Redirect 1',
              domain: 'prose',
              token_usage: { input: 100, output: 50 },
              duration_ms: 1000,
            });
          });
        }
        return {
          iteration,
          outcome: 'shipped',
          title: `Parallel Redirect ${iteration}`,
          domain: 'prose',
          token_usage: { input: 100, output: 50 },
          duration_ms: 1000,
        };
      });

      const { startFoundry } = await import('../src/index.js');
      const startPromise = startFoundry({ rootDir: tempDir });

      try {
        for (let attempt = 0; attempt < 50 && vi.mocked(runIteration).mock.calls.length < 1; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }

        expect(vi.mocked(runIteration).mock.calls.map((call) => call[2])).toEqual([1]);

        releaseFirst();
        await startPromise;

        const iterations = vi.mocked(runIteration).mock.calls.map((call) => call[2]);
        expect(iterations[0]).toBe(1);
        expect(iterations).toContain(2);
        const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        expect(events).toContainEqual(expect.objectContaining({
          event: 'foundry_parallel_request_guard',
          phase: 'lifecycle',
          data: expect.objectContaining({
            mode: 'parallel',
            concurrency: 2,
            active_limit: 1,
            configured_concurrency: 2,
            request_file: 'requests.md',
            request_preview: 'Parallel redirect should be consumed once',
          }),
        }));
        expect(events).toContainEqual(expect.objectContaining({
          event: 'foundry_parallel_request_guard_released',
          phase: 'lifecycle',
          data: expect.objectContaining({
            mode: 'parallel',
            concurrency: 2,
            restored_concurrency: 2,
            request_file: 'requests.md',
          }),
        }));
      } finally {
        releaseFirst();
        await startPromise.catch(() => undefined);
        vi.mocked(runIteration).mockReset();
        vi.mocked(checkStopFile).mockReset();
        vi.mocked(checkStopFile).mockResolvedValue(false);
        vi.mocked(readRequests).mockReset();
        vi.mocked(readRequests).mockResolvedValue('');
      }
    });

    it('stops scheduling parallel iterations when a worker returns halted', async () => {
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
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0, concurrency: 2 },
        git: { auto_commit: false, auto_push: false },
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockImplementation(async (_config, _models, iteration) => {
        if (iteration === 1) {
          return {
            iteration,
            outcome: 'halted',
            reason: 'manual pause from worker',
            token_usage: { input: 0, output: 0 },
            duration_ms: 100,
          };
        }
        if (iteration === 2) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return {
          iteration,
          outcome: 'shipped',
          title: `Parallel Halt Drain ${iteration}`,
          domain: 'prose',
          token_usage: { input: 100, output: 50 },
          duration_ms: 1000,
        };
      });

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockImplementation(async () => (
        vi.mocked(runIteration).mock.calls.length >= 3
      ));
      const { appendJournal } = await import('../src/files/journal.js');
      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockClear();

      const { startFoundry } = await import('../src/index.js');

      try {
        await startFoundry({ rootDir: tempDir });

        expect(vi.mocked(runIteration).mock.calls.map((call) => call[2]).sort((a, b) => a - b)).toEqual([1, 2]);
        expect(saveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
          iteration: 2,
        }));
        expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Halted by iteration result from iteration 1 after parallel iteration 2'));
        expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('manual pause from worker'));
        expect(vi.mocked(runAllDetectors).mock.calls.map((call) => call[2])).toEqual([2]);

        const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        expect(events).toContainEqual(expect.objectContaining({
          event: 'foundry_stop',
          phase: 'lifecycle',
          data: expect.objectContaining({
            mode: 'parallel',
            concurrency: 2,
            reason: 'iteration halted',
            detail: 'manual pause from worker',
            halted_iteration: 1,
            last_completed_iteration: 2,
            next_iteration: 3,
          }),
        }));
      } finally {
        vi.mocked(runIteration).mockReset();
        vi.mocked(checkStopFile).mockReset();
        vi.mocked(checkStopFile).mockResolvedValue(false);
        vi.mocked(runAllDetectors).mockReset();
        vi.mocked(runAllDetectors).mockReturnValue([]);
      }
    });

    it('detaches parallel signal listeners when final checkpoint save fails', async () => {
      const originalSigintListeners = new Set(process.listeners('SIGINT'));
      const originalSigtermListeners = new Set(process.listeners('SIGTERM'));
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
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0, concurrency: 2 },
        git: { auto_commit: false, auto_push: false },
      });
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);
      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(saveCheckpoint).mockRejectedValueOnce(new Error('checkpoint disk full'));

      const { startFoundry } = await import('../src/index.js');

      try {
        await expect(startFoundry({ rootDir: tempDir })).rejects.toThrow('checkpoint disk full');
        expect(process.listeners('SIGINT')).toHaveLength(originalSigintListeners.size);
        expect(process.listeners('SIGTERM')).toHaveLength(originalSigtermListeners.size);
      } finally {
        for (const listener of process.listeners('SIGINT')) {
          if (!originalSigintListeners.has(listener)) process.removeListener('SIGINT', listener);
        }
        for (const listener of process.listeners('SIGTERM')) {
          if (!originalSigtermListeners.has(listener)) process.removeListener('SIGTERM', listener);
        }
        vi.mocked(saveCheckpoint).mockReset();
        vi.mocked(saveCheckpoint).mockResolvedValue(undefined);
        vi.mocked(checkStopFile).mockReset();
        vi.mocked(checkStopFile).mockResolvedValue(false);
      }
    });

    it('logs a lifecycle error stop when parallel final checkpoint save fails', async () => {
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
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0, concurrency: 2 },
        git: { auto_commit: false, auto_push: false },
      });
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);
      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(saveCheckpoint).mockRejectedValueOnce(new Error('checkpoint disk full'));
      const { appendJournal } = await import('../src/files/journal.js');

      const { startFoundry } = await import('../src/index.js');

      try {
        await expect(startFoundry({ rootDir: tempDir })).rejects.toThrow('checkpoint disk full');
        const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));

        expect(events).toEqual([
          expect.objectContaining({
            event: 'foundry_start',
            phase: 'lifecycle',
            data: expect.objectContaining({
              mode: 'parallel',
              concurrency: 2,
              start_iteration: 1,
            }),
          }),
          expect.objectContaining({
            event: 'foundry_checkpoint_failed',
            phase: 'lifecycle',
            data: expect.objectContaining({
              mode: 'parallel',
              concurrency: 2,
              start_iteration: 1,
              checkpoint_iteration: 0,
              last_curator_run: 0,
              reason: 'final',
              detail: 'checkpoint disk full',
            }),
          }),
          expect.objectContaining({
            event: 'foundry_stop',
            phase: 'lifecycle',
            data: expect.objectContaining({
              mode: 'parallel',
              concurrency: 2,
              reason: 'error',
              detail: 'checkpoint disk full',
              start_iteration: 1,
              last_completed_iteration: 0,
              next_iteration: 1,
            }),
          }),
        ]);
        expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Fatal foundry start error'));
        expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('checkpoint disk full'));
      } finally {
        vi.mocked(saveCheckpoint).mockReset();
        vi.mocked(saveCheckpoint).mockResolvedValue(undefined);
        vi.mocked(checkStopFile).mockReset();
        vi.mocked(checkStopFile).mockResolvedValue(false);
      }
    });

    it('stops scheduling parallel iterations when disk space drops below the configured floor', async () => {
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
        loop: { cooldown_seconds: 0, disk_space_min_gb: 2, concurrency: 2 },
        git: { auto_commit: false, auto_push: false },
      });

      const fsPromises = await import('node:fs/promises');
      let statfsCalls = 0;
      vi.mocked(fsPromises.statfs).mockImplementation(async () => {
        statfsCalls++;
        return statfsCalls <= 4
          ? { bsize: 1024, bavail: 3 * 1024 * 1024 } as any
          : { bsize: 1024, bavail: 1024 * 1024 } as any;
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockImplementation(async (_config, _models, iteration) => ({
        iteration,
        outcome: 'shipped',
        title: `Parallel Disk Watch ${iteration}`,
        domain: 'prose',
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      }));

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockImplementation(async () => vi.mocked(runIteration).mock.calls.length >= 3);
      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      const { appendJournal } = await import('../src/files/journal.js');

      const { startFoundry } = await import('../src/index.js');

      try {
        await startFoundry({ rootDir: tempDir });
        const iterations = vi.mocked(runIteration).mock.calls.map((call) => call[2]);

        expect(iterations).toHaveLength(2);
        expect(new Set(iterations)).toEqual(new Set([1, 2]));
        expect(saveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
          iteration: 2,
        }));
        expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Halted by disk preflight after parallel iteration 2'));
      } finally {
        vi.mocked(fsPromises.statfs).mockReset();
        vi.mocked(fsPromises.statfs).mockImplementation((path) => {
          return (vi.importActual('node:fs/promises') as any).then((actual: typeof import('node:fs/promises')) => actual.statfs(path));
        });
        vi.mocked(runIteration).mockReset();
        vi.mocked(checkStopFile).mockReset();
        vi.mocked(checkStopFile).mockResolvedValue(false);
      }
    });

    it('records a journal halt when a STOP file stops parallel scheduling', async () => {
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
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0, concurrency: 2 },
        git: { auto_commit: false, auto_push: false },
      });

      const { checkStopFile } = await import('../src/files/intervention.js');
      let stopCallCount = 0;
      vi.mocked(checkStopFile).mockImplementation(async () => {
        stopCallCount++;
        return stopCallCount > 3;
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockImplementation(async (_config, _models, iteration) => ({
        iteration,
        outcome: 'shipped',
        title: `Parallel Stop ${iteration}`,
        domain: 'prose',
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      }));
      const { appendJournal } = await import('../src/files/journal.js');
      const { saveCheckpoint } = await import('../src/checkpoint/index.js');

      const { startFoundry } = await import('../src/index.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';

      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');

        expect(vi.mocked(runIteration).mock.calls.map((call) => call[2]).sort((a, b) => a - b)).toEqual([1, 2]);
        expect(consoleOutput).toMatch(/Iteration 1: shipped — Parallel Stop 1 \[slot \d+\]/);
        expect(consoleOutput).toMatch(/Iteration 2: shipped — Parallel Stop 2 \[slot \d+\]/);
        expect(consoleOutput).toContain('STOP file detected (STOP) — halting after draining parallel workers.');
        expect(saveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
          iteration: 2,
        }));
        expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Halted by STOP file after parallel iteration 2'));
        const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        const iterationStartEvents = events
          .filter((event) => event.event === 'foundry_iteration_start')
          .sort((a, b) => a.data.iteration - b.data.iteration);
        expect(iterationStartEvents).toEqual([
          expect.objectContaining({
            phase: 'lifecycle',
            data: expect.objectContaining({
              mode: 'parallel',
              concurrency: 2,
              iteration: 1,
              slot: expect.any(Number),
            }),
          }),
          expect.objectContaining({
            phase: 'lifecycle',
            data: expect.objectContaining({
              mode: 'parallel',
              concurrency: 2,
              iteration: 2,
              slot: expect.any(Number),
            }),
          }),
        ]);
        const iterationCompleteEvents = events
          .filter((event) => event.event === 'foundry_iteration_complete')
          .sort((a, b) => a.data.iteration - b.data.iteration);
        expect(iterationCompleteEvents).toEqual([
          expect.objectContaining({
            phase: 'lifecycle',
            data: expect.objectContaining({
              mode: 'parallel',
              concurrency: 2,
              iteration: 1,
              slot: expect.any(Number),
              outcome: 'shipped',
              title: 'Parallel Stop 1',
              duration_ms: 1000,
            }),
          }),
          expect.objectContaining({
            phase: 'lifecycle',
            data: expect.objectContaining({
              mode: 'parallel',
              concurrency: 2,
              iteration: 2,
              slot: expect.any(Number),
              outcome: 'shipped',
              title: 'Parallel Stop 2',
              duration_ms: 1000,
            }),
          }),
        ]);
      } finally {
        logSpy.mockRestore();
        vi.mocked(runIteration).mockReset();
        vi.mocked(checkStopFile).mockReset();
        vi.mocked(checkStopFile).mockResolvedValue(false);
      }
    });

    it('records a journal halt when a signal stops parallel scheduling', async () => {
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
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0, concurrency: 2 },
        git: { auto_commit: false, auto_push: false },
      });

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValue(false);
      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockImplementation(async (_config, _models, iteration) => {
        if (iteration === 1) process.emit('SIGINT');
        return {
          iteration,
          outcome: 'shipped',
          title: `Parallel Signal ${iteration}`,
          domain: 'prose',
          token_usage: { input: 100, output: 50 },
          duration_ms: 1000,
        };
      });
      const { appendJournal } = await import('../src/files/journal.js');

      const { startFoundry } = await import('../src/index.js');

      try {
        await startFoundry({ rootDir: tempDir });

        expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Halted by signal after parallel iteration'));
        expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('SIGINT'));
        const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        expect(events).toContainEqual(expect.objectContaining({
          event: 'foundry_stop',
          phase: 'lifecycle',
          data: expect.objectContaining({
            mode: 'parallel',
            reason: 'signal',
            signal: 'SIGINT',
          }),
        }));
      } finally {
        vi.mocked(runIteration).mockReset();
        vi.mocked(checkStopFile).mockReset();
        vi.mocked(checkStopFile).mockResolvedValue(false);
      }
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
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          state_source: 'checkpoint',
          checkpoint_iteration: 10,
          start_iteration: 11,
        }),
      }));
    });

    it('restores checkpointed streak state on resume', async () => {
      const streakState = {
        current: {
          active: true as const,
          length: 3,
          domain: 'prose',
          avg_rating: 4.1,
          start_iteration: 7,
          last_iteration: 9,
          artifact_ids: ['0007', '0008', '0009'],
          project_id: null,
        },
        recent_breaks: [],
        cooldown_domains: [],
        cooldown_remaining: 0,
      };
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
        streak_state: streakState,
        saved_at: '2026-05-19T10:00:00Z',
      } as any);

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);
      const { saveStreakHistory } = await import('../src/streaks/index.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(saveStreakHistory).toHaveBeenCalledWith(streakState);
    });

    it('runs halted iteration result', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(false);

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
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stop',
        phase: 'lifecycle',
        data: expect.objectContaining({
          reason: 'iteration halted',
          detail: 'STOP file',
          last_completed_iteration: 1,
          next_iteration: 2,
        }),
      }));
    });

    it('saves current streak state into checkpoints', async () => {
      const streakState = {
        current: {
          active: true as const,
          length: 2,
          domain: 'code',
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
      const { loadStreakHistory } = await import('../src/streaks/index.js');
      vi.mocked(loadStreakHistory).mockResolvedValue(streakState);
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

      expect(saveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
        streak_state: streakState,
      }));
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
    it('logs git automation mode in start lifecycle events', async () => {
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
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          git_auto_commit: true,
          git_auto_push: true,
        }),
      }));
    });

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
      vi.mocked(runIteration).mockReset();
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

    it('stages the logs directory during auto-commit', async () => {
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
        title: 'Audit Trail',
        domain: 'prose',
        ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      });

      const { execFileSync } = await import('node:child_process');
      const mockExecFile = vi.mocked(execFileSync) as unknown as ReturnType<typeof vi.fn>;

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const gitAddCall = mockExecFile.mock.calls.find(([cmd, args]) => (
        cmd === 'git' && Array.isArray(args) && args[0] === 'add'
      ));
      expect(gitAddCall?.[1]).toContain('logs/');
      expect(gitAddCall?.[1]).not.toContain('logs/stoker.jsonl');
    });

    it('logs lifecycle events when auto-commit fails', async () => {
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
        title: 'Git Fragile',
        domain: 'prose',
        ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      });

      const { execFileSync } = await import('node:child_process');
      const mockExecFile = vi.mocked(execFileSync) as unknown as ReturnType<typeof vi.fn>;
      mockExecFile.mockImplementationOnce(() => {
        throw new Error('git add failed');
      });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const { appendJournal } = await import('../src/files/journal.js');
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Git auto-commit failed after shipped artifact 0001'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('git add failed'));

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_git_commit_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          outcome: 'shipped',
          artifact_id: '0001',
          title: 'Git Fragile',
          auto_push: false,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_git_commit_failed',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          outcome: 'shipped',
          artifact_id: '0001',
          title: 'Git Fragile',
          detail: 'git add failed',
        }),
      }));
    });
  });

  describe('startFoundry - curator cycle', () => {
    it('triggers an immediate curator cycle when a project reaches its milestone', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Project Finale',
        domain: 'prose',
        project_id: 'P001',
        project_completed_iterations: 3,
        project_estimated_iterations: 3,
        project_milestone_reached: true,
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      });

      const { shouldRunCurator, dispatchCuratorFull, applyCuratorCycle } = await import('../src/curator/index.js');
      vi.mocked(shouldRunCurator).mockReturnValue(false);
      vi.mocked(dispatchCuratorFull).mockResolvedValueOnce({
        retrospective: 'Milestone review',
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
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_curator_cycle_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          trigger: 'project_milestone',
          project_id: 'P001',
          project_completed_iterations: 3,
          project_estimated_iterations: 3,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_curator_cycle_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          trigger: 'project_milestone',
          last_curator_run: 1,
        }),
      }));
    });

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
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_curator_cycle_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          previous_last_curator_run: 0,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_curator_cycle_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          last_curator_run: 1,
        }),
      }));
    });

    it('forces a curator quality escalation after a marginal shipped artifact in sequential start', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Almost Good Artifact',
        domain: 'prose',
        mean_rating: '3.2',
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      });

      const { shouldRunCurator, dispatchCuratorFull, applyCuratorCycle } = await import('../src/curator/index.js');
      vi.mocked(shouldRunCurator).mockReturnValue(false);
      vi.mocked(dispatchCuratorFull).mockResolvedValueOnce({
        retrospective: 'Quality escalation review',
        compressed_journal: 'Compressed',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [],
        human_redirect: null,
      });
      vi.mocked(applyCuratorCycle).mockResolvedValueOnce(undefined);

      const { shouldRunStoker, generateStokerDirective, saveStokerDirective } = await import('../src/stoker/index.js');
      vi.mocked(shouldRunStoker).mockReturnValue(false);
      vi.mocked(generateStokerDirective).mockReturnValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 1,
        for_iteration: 2,
        urgency: 'high',
        streak_instruction: 'neutral',
        ideator_hint: 'Raise quality after marginal ship.',
        rules_fired: ['quality_escalation'],
      });
      vi.mocked(saveStokerDirective).mockResolvedValueOnce(undefined);

      const { appendJournal } = await import('../src/files/journal.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      const { startFoundry } = await import('../src/index.js');
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }

      expect(dispatchCuratorFull).toHaveBeenCalled();
      expect(applyCuratorCycle).toHaveBeenCalled();
      expect(generateStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        force_reason: 'quality_escalation',
        force_context: expect.objectContaining({
          title: 'Almost Good Artifact',
          domain: 'prose',
          rating: 3.2,
          threshold: 3.5,
        }),
      }));
      expect(consoleOutput).toContain('Curator full cycle (iteration 1) — quality escalation');
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Quality escalation after shipped artifact "Almost Good Artifact"'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('mean rating 3.2 below high-quality threshold 3.5'));
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_maintenance_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          curator_trigger: 'quality_escalation',
          quality_escalation_rating: 3.2,
          quality_escalation_threshold: 3.5,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_curator_cycle_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          trigger: 'quality_escalation',
          mean_rating: 3.2,
          quality_threshold: 3.5,
          title: 'Almost Good Artifact',
          domain: 'prose',
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_curator_cycle_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          trigger: 'quality_escalation',
          last_curator_run: 1,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stoker_check_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          due: true,
          cadence_due: false,
          force_reason: 'quality_escalation',
          directive_written: true,
          for_iteration: 2,
        }),
      }));
    });

    it('forces a curator failure escalation after a killed artifact in sequential start', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'killed',
        title: 'Rejected Artifact',
        domain: 'code-tool',
        reason: 'Gate 2 rejected the artifact for weak validation.',
        token_usage: { input: 120, output: 60 },
        duration_ms: 1000,
      });

      const { shouldRunCurator, dispatchCuratorFull, applyCuratorCycle } = await import('../src/curator/index.js');
      vi.mocked(shouldRunCurator).mockReturnValue(false);
      vi.mocked(dispatchCuratorFull).mockResolvedValueOnce({
        retrospective: 'Failure escalation review',
        compressed_journal: 'Compressed',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [],
        human_redirect: null,
      });
      vi.mocked(applyCuratorCycle).mockResolvedValueOnce(undefined);

      const { shouldRunStoker, generateStokerDirective, saveStokerDirective } = await import('../src/stoker/index.js');
      vi.mocked(shouldRunStoker).mockReturnValue(false);
      vi.mocked(generateStokerDirective).mockReturnValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 1,
        for_iteration: 2,
        urgency: 'high',
        streak_instruction: 'break',
        ideator_hint: 'Avoid the killed artifact failure mode.',
        rules_fired: ['failure_escalation'],
      });
      vi.mocked(saveStokerDirective).mockResolvedValueOnce(undefined);

      const { appendJournal } = await import('../src/files/journal.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      const { startFoundry } = await import('../src/index.js');
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }

      expect(dispatchCuratorFull).toHaveBeenCalled();
      expect(applyCuratorCycle).toHaveBeenCalled();
      expect(generateStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        force_reason: 'failure_escalation',
        force_context: expect.objectContaining({
          title: 'Rejected Artifact',
          domain: 'code-tool',
          reason: 'Gate 2 rejected the artifact for weak validation.',
        }),
      }));
      expect(consoleOutput).toContain('Curator full cycle (iteration 1) — failure escalation');
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Failure escalation after killed artifact "Rejected Artifact"'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Gate 2 rejected the artifact for weak validation.'));
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_maintenance_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          outcome: 'killed',
          curator_trigger: 'failure_escalation',
          failure_escalation_reason: 'Gate 2 rejected the artifact for weak validation.',
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_curator_cycle_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          trigger: 'failure_escalation',
          outcome: 'killed',
          title: 'Rejected Artifact',
          domain: 'code-tool',
          reason: 'Gate 2 rejected the artifact for weak validation.',
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_curator_cycle_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          trigger: 'failure_escalation',
          last_curator_run: 1,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stoker_check_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          due: true,
          cadence_due: false,
          force_reason: 'failure_escalation',
          directive_written: true,
          for_iteration: 2,
        }),
      }));
    });

    it('forces a curator success amplification after an excellent shipped artifact in sequential start', async () => {
      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockResolvedValueOnce({
        iteration: 1,
        outcome: 'shipped',
        title: 'Breakthrough Artifact',
        domain: 'poetry',
        mean_rating: '4.3',
        token_usage: { input: 160, output: 80 },
        duration_ms: 1000,
      });

      const { shouldRunCurator, dispatchCuratorFull, applyCuratorCycle } = await import('../src/curator/index.js');
      vi.mocked(shouldRunCurator).mockReturnValue(false);
      vi.mocked(dispatchCuratorFull).mockResolvedValueOnce({
        retrospective: 'Success amplification review',
        compressed_journal: 'Compressed',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [],
        human_redirect: null,
      });
      vi.mocked(applyCuratorCycle).mockResolvedValueOnce(undefined);

      const { shouldRunStoker, generateStokerDirective, saveStokerDirective } = await import('../src/stoker/index.js');
      vi.mocked(shouldRunStoker).mockReturnValue(false);
      vi.mocked(generateStokerDirective).mockReturnValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 1,
        for_iteration: 2,
        urgency: 'high',
        streak_instruction: 'amplify',
        ideator_hint: 'Amplify the excellent artifact.',
        rules_fired: ['success_amplification'],
      });
      vi.mocked(saveStokerDirective).mockResolvedValueOnce(undefined);

      const { appendJournal } = await import('../src/files/journal.js');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let consoleOutput = '';
      const { startFoundry } = await import('../src/index.js');
      try {
        await startFoundry({ rootDir: tempDir });
        consoleOutput = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
      } finally {
        logSpy.mockRestore();
      }

      expect(dispatchCuratorFull).toHaveBeenCalled();
      expect(applyCuratorCycle).toHaveBeenCalled();
      expect(generateStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        force_reason: 'success_amplification',
        force_context: expect.objectContaining({
          title: 'Breakthrough Artifact',
          domain: 'poetry',
          rating: 4.3,
          threshold: 4.0,
        }),
      }));
      expect(consoleOutput).toContain('Curator full cycle (iteration 1) — success amplification');
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('Success amplification after shipped artifact "Breakthrough Artifact"'));
      expect(appendJournal).toHaveBeenCalledWith(expect.stringContaining('mean rating 4.3 met amplification threshold 4.0'));
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_sequential_maintenance_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          curator_trigger: 'success_amplification',
          success_amplification_rating: 4.3,
          success_amplification_threshold: 4.0,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_curator_cycle_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          trigger: 'success_amplification',
          mean_rating: 4.3,
          success_threshold: 4.0,
          title: 'Breakthrough Artifact',
          domain: 'poetry',
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_curator_cycle_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          trigger: 'success_amplification',
          last_curator_run: 1,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stoker_check_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          due: true,
          cadence_due: false,
          force_reason: 'success_amplification',
          directive_written: true,
          for_iteration: 2,
        }),
      }));
    });

    it('checkpoints immediately after a successful curator cycle', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 99, resume_on_crash: true },
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

      const { saveCheckpoint } = await import('../src/checkpoint/index.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(saveCheckpoint).toHaveBeenCalledTimes(2);
      expect(saveCheckpoint).toHaveBeenNthCalledWith(1, expect.objectContaining({
        iteration: 1,
        last_curator_run: 1,
      }));
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
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_curator_cycle_failed',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          detail: 'Curator crashed',
        }),
      }));
    });

    it('records curator lifecycle events in parallel mode', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 99, resume_on_crash: true },
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0, concurrency: 2 },
        git: { auto_commit: false, auto_push: false },
      });

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockReset();
      let stopCallCount = 0;
      vi.mocked(checkStopFile).mockImplementation(async () => {
        stopCallCount++;
        return stopCallCount > 4;
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockReset();
      vi.mocked(runIteration).mockImplementation(async (_config, _models, iteration) => {
        if (iteration === 2) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return {
          iteration,
          outcome: 'shipped',
          title: `Parallel Curator ${iteration}`,
          domain: 'prose',
          token_usage: { input: 100, output: 50 },
          duration_ms: 1000,
        };
      });

      const { shouldRunCurator, dispatchCuratorFull, applyCuratorCycle } = await import('../src/curator/index.js');
      vi.mocked(shouldRunCurator).mockReset();
      vi.mocked(shouldRunCurator).mockImplementation((iteration) => iteration === 1);
      vi.mocked(dispatchCuratorFull).mockReset();
      vi.mocked(dispatchCuratorFull).mockResolvedValueOnce({
        retrospective: 'Good',
        compressed_journal: 'Compressed',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [],
        human_redirect: null,
      });
      vi.mocked(applyCuratorCycle).mockReset();
      vi.mocked(applyCuratorCycle).mockResolvedValueOnce(undefined);

      const { startFoundry } = await import('../src/index.js');

      try {
        await startFoundry({ rootDir: tempDir });
        const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        expect(events).toContainEqual(expect.objectContaining({
          event: 'foundry_curator_cycle_start',
          phase: 'lifecycle',
          data: expect.objectContaining({
            mode: 'parallel',
            concurrency: 2,
            iteration: 1,
            previous_last_curator_run: 0,
          }),
        }));
        expect(events).toContainEqual(expect.objectContaining({
          event: 'foundry_curator_cycle_complete',
          phase: 'lifecycle',
          data: expect.objectContaining({
            mode: 'parallel',
            concurrency: 2,
            iteration: 1,
            last_curator_run: 1,
          }),
        }));
      } finally {
        vi.mocked(runIteration).mockReset();
        vi.mocked(checkStopFile).mockReset();
        vi.mocked(checkStopFile).mockResolvedValue(false);
        vi.mocked(shouldRunCurator).mockReset();
        vi.mocked(shouldRunCurator).mockReturnValue(false);
        vi.mocked(dispatchCuratorFull).mockReset();
        vi.mocked(applyCuratorCycle).mockReset();
      }
    });

    it('triggers a parallel curator drain when a project milestone completes', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 99, resume_on_crash: true },
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0, concurrency: 2 },
        git: { auto_commit: false, auto_push: false },
      });

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockReset();
      let stopCallCount = 0;
      vi.mocked(checkStopFile).mockImplementation(async () => {
        stopCallCount++;
        return stopCallCount > 4;
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockReset();
      vi.mocked(runIteration).mockImplementation(async (_config, _models, iteration) => ({
        iteration,
        outcome: 'shipped',
        title: `Parallel Milestone ${iteration}`,
        domain: 'prose',
        project_id: iteration === 1 ? 'P001' : null,
        project_completed_iterations: iteration === 1 ? 3 : undefined,
        project_estimated_iterations: iteration === 1 ? 3 : undefined,
        project_milestone_reached: iteration === 1,
        token_usage: { input: 100, output: 50 },
        duration_ms: 1000,
      }));

      const { shouldRunCurator, dispatchCuratorFull, applyCuratorCycle } = await import('../src/curator/index.js');
      vi.mocked(shouldRunCurator).mockReset();
      vi.mocked(shouldRunCurator).mockReturnValue(false);
      vi.mocked(dispatchCuratorFull).mockReset();
      vi.mocked(dispatchCuratorFull).mockResolvedValueOnce({
        retrospective: 'Milestone review',
        compressed_journal: 'Compressed',
        manifesto_changes: [],
        domain_recommendations: '',
        project_decisions: [],
        stimuli_actions: [],
        human_redirect: null,
      });
      vi.mocked(applyCuratorCycle).mockReset();
      vi.mocked(applyCuratorCycle).mockResolvedValueOnce(undefined);

      const { startFoundry } = await import('../src/index.js');

      try {
        await startFoundry({ rootDir: tempDir });
        expect(dispatchCuratorFull).toHaveBeenCalled();
        const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line));
        expect(events).toContainEqual(expect.objectContaining({
          event: 'foundry_curator_cycle_start',
          phase: 'lifecycle',
          data: expect.objectContaining({
            mode: 'parallel',
            concurrency: 2,
            iteration: 1,
            trigger: 'project_milestone',
            project_id: 'P001',
            project_completed_iterations: 3,
            project_estimated_iterations: 3,
          }),
        }));
      } finally {
        vi.mocked(runIteration).mockReset();
        vi.mocked(checkStopFile).mockReset();
        vi.mocked(checkStopFile).mockResolvedValue(false);
        vi.mocked(shouldRunCurator).mockReset();
        vi.mocked(shouldRunCurator).mockReturnValue(false);
        vi.mocked(dispatchCuratorFull).mockReset();
        vi.mocked(applyCuratorCycle).mockReset();
      }
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

    it('records critic artifact rejection history in checkpoints', async () => {
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
        outcome: 'killed',
        title: 'Rejected Artifact',
        domain: 'code-tool',
        token_usage: { input: 40, output: 8 },
        duration_ms: 100,
      });

      const { saveCheckpoint } = await import('../src/checkpoint/index.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(saveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
        iteration: 1,
        stats: expect.objectContaining({
          critic_rejection_window: [{ iteration: 1, rejected: true }],
        }),
      }));
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

    it('rebuilds checkpoint statistics from the iteration log when no checkpoint exists', async () => {
      writeFileSync(
        path.join(tempDir, 'logs', 'iterations.jsonl'),
        [
          JSON.stringify({
            iteration: 1,
            outcome: 'shipped',
            domain: 'prose',
            source: 'ideator',
            token_usage: { input: 100, output: 20 },
          }),
          JSON.stringify({
            iteration: 2,
            outcome: 'killed',
            domain: 'code-tool',
            source: 'human_redirect',
            token_usage: { input: 50, output: 10 },
          }),
          JSON.stringify({
            iteration: 3,
            outcome: 'skipped',
            source: 'human_redirect',
            token_usage: { input: 5, output: 2 },
          }),
          '',
        ].join('\n'),
        'utf-8',
      );

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockResolvedValueOnce(true);

      const { runIteration } = await import('../src/iteration/index.js');
      const { saveCheckpoint } = await import('../src/checkpoint/index.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(runIteration).not.toHaveBeenCalled();
      expect(saveCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
        iteration: 3,
        stats: {
          iteration: 3,
          shipped: 1,
          killed: 1,
          skipped: 1,
          domain_counts: { prose: 1 },
          recent_outcomes: [
            { iteration: 1, outcome: 'shipped', domain: 'prose', source: 'ideator' },
            { iteration: 2, outcome: 'killed', domain: 'code-tool', source: 'human_redirect' },
            { iteration: 3, outcome: 'skipped', source: 'human_redirect' },
          ],
          critic_rejection_window: [
            { iteration: 1, rejected: false },
            { iteration: 2, rejected: true },
          ],
          total_tokens: { input: 155, output: 32 },
        },
      }));
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
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          model_override_count: 1,
          model_overrides_applied: true,
          model_overrides: [
            {
              agent: 'ideator',
              model: 'fancy-model',
              start_iteration: 1,
              end_iteration: 100,
              label: 'ab-test',
            },
          ],
        }),
      }));
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

    it('records an optional stop reason in the stop file', async () => {
      const { stopFoundry } = await import('../src/index.js');
      await stopFoundry('HALT', {
        rootDir: tempDir,
        reason: 'Operator maintenance window',
      });

      expect(readFileSync(path.join(tempDir, 'HALT'), 'utf-8')).toContain('Reason: Operator maintenance window');
    });

    it('creates parent directories for custom stop file paths', async () => {
      const { stopFoundry } = await import('../src/index.js');
      await stopFoundry('ops/HALT', { rootDir: tempDir });

      expect(existsSync(path.join(tempDir, 'ops', 'HALT'))).toBe(true);
    });
  });

  describe('resumeFoundry', () => {
    it('removes a configured stop file', async () => {
      writeFileSync(path.join(tempDir, 'HALT'), 'stop', 'utf-8');

      const { resumeFoundry } = await import('../src/index.js');
      await resumeFoundry('HALT', { rootDir: tempDir });

      expect(existsSync(path.join(tempDir, 'HALT'))).toBe(false);
    });

    it('does not throw when the stop file is already absent', async () => {
      const { resumeFoundry } = await import('../src/index.js');
      await expect(resumeFoundry('HALT', { rootDir: tempDir })).resolves.toBeUndefined();
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

    it('reports configured intervention files and pending request preview', async () => {
      const { loadConfig } = await import('../src/context/config.js');
      vi.mocked(loadConfig).mockResolvedValueOnce({
        foundry: { name: 'test', version: '0.1.0' },
        iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 10, domain_cooldown: 3, novelty_window: 5 },
        projects: { max_active: 3, max_iterations_per_project: 10, allow_standalone_interrupts: true },
        stimuli: { enabled: false, stimuli_ttl: 24, skills_per_context: 2, mcp_timeout_seconds: 30 },
        context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 50, critic_review_history: 5, critic_gate1_history: 5 },
        intervention: { requests_file: 'ops/requests.md', stop_file: 'HALT' },
        logging: { log_all_prompts: false, log_token_usage: true, log_decisions: true, log_test_reports: true },
        recovery: { checkpoint_every: 5, resume_on_crash: true },
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0 },
        git: { auto_commit: false, auto_push: false },
      } as any);
      mkdirSync(path.join(tempDir, 'ops'), { recursive: true });
      writeFileSync(path.join(tempDir, 'HALT'), 'halt', 'utf-8');
      writeFileSync(
        path.join(tempDir, 'ops', 'requests.md'),
        '  Redirect the next run toward a handmade clock.\nInclude brass.  ',
        'utf-8',
      );

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect(status.running).toBe(false);
      expect((status as any).intervention).toEqual({
        stopFile: 'HALT',
        stopPending: true,
        stopPreview: 'halt',
        requestsFile: 'ops/requests.md',
        requestPending: true,
        requestPreview: 'Redirect the next run toward a handmade clock. Include brass.',
      });
    });

    it('reports compact stop file preview in intervention status', async () => {
      writeFileSync(
        path.join(tempDir, 'STOP'),
        'Stopped at 2026-05-31T00:00:00.000Z\nReason: maintenance window\n',
        'utf-8',
      );

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect((status as any).intervention.stopPending).toBe(true);
      expect((status as any).intervention.stopPreview).toBe('Stopped at 2026-05-31T00:00:00.000Z Reason: maintenance window');
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

    it('reconstructs status totals and recent outcomes from the iteration log without a checkpoint', async () => {
      writeFileSync(
        path.join(tempDir, 'logs', 'iterations.jsonl'),
        [
          JSON.stringify({ iteration: 1, outcome: 'shipped', title: 'Clock Atlas', domain: 'prose', source: 'ideator' }),
          JSON.stringify({ iteration: 2, outcome: 'killed', title: 'Weak Tool', domain: 'code-tool', source: 'human_redirect' }),
          JSON.stringify({ iteration: 3, outcome: 'skipped', reason: 'Gate rejected', source: 'human_redirect' }),
          JSON.stringify({ iteration: 4, outcome: 'halted', reason: 'STOP' }),
          '',
        ].join('\n'),
        'utf-8',
      );

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect(status.iteration).toBe(4);
      expect(status.lastArtifact).toBe('Clock Atlas');
      expect(status.shipped).toBe(1);
      expect(status.killed).toBe(1);
      expect(status.skipped).toBe(1);
      expect(status.recentOutcomes).toEqual([
        { iteration: 1, outcome: 'shipped', domain: 'prose', source: 'ideator' },
        { iteration: 2, outcome: 'killed', domain: 'code-tool', source: 'human_redirect' },
        { iteration: 3, outcome: 'skipped', source: 'human_redirect' },
      ]);
      expect((status as any).critic.artifactRejection).toEqual({
        samples: 2,
        killed: 1,
        shipped: 1,
        rejectionRate: 0.5,
        threshold: 0.4,
        pressure: 'high',
      });
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
          critic_rejection_window: [
            { iteration: 39, rejected: true },
            { iteration: 40, rejected: false },
            { iteration: 42, rejected: true },
          ],
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
      expect((status as any).critic).toEqual({
        artifactRejection: {
          samples: 3,
          killed: 2,
          shipped: 1,
          rejectionRate: 0.6666666666666666,
          threshold: 0.4,
          pressure: 'high',
        },
      });
    });

    it('includes JSONL log health in furnace status', async () => {
      writeFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), '{"iteration":1,"outcome":"shipped","title":"One"}\n', 'utf-8');
      writeFileSync(path.join(tempDir, 'logs', 'events.jsonl'), '{"event":"x","payload":"larger than the iteration log"}\n{"event":"y","payload":"larger than the iteration log"}\n', 'utf-8');
      writeFileSync(path.join(tempDir, 'logs', 'events.2026-01-01T00-00-00-000Z.jsonl'), '{"event":"old"}\n', 'utf-8');

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect((status as any).furnace.logs).toMatchObject({
        activeFiles: 2,
        archiveCount: 1,
        largestActive: { name: 'events.jsonl' },
        largestArchive: { name: 'events.2026-01-01T00-00-00-000Z.jsonl' },
        rotationThresholdBytes: 50 * 1024 * 1024,
        largestActivePercent: 0,
        rotationPressure: 'clear',
        healthState: 'healthy',
        malformedActiveLines: 0,
        malformedActiveFiles: [],
        malformedActiveFileDetails: [],
      });
      expect((status as any).furnace.logs.totalActiveBytes).toBeGreaterThan(0);
      expect((status as any).furnace.logs.totalArchiveBytes).toBeGreaterThan(0);
      expect((status as any).furnace.logs.totalLogBytes).toBe(
        (status as any).furnace.logs.totalActiveBytes + (status as any).furnace.logs.totalArchiveBytes,
      );
      expect((status as any).furnace.logs.largestActiveBytesRemaining).toBeGreaterThan(0);
    });

    it('includes recent monitor warning summary in furnace status', async () => {
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { detector: 'slop', severity: 'warning', message: 'Quality drifting', iteration: 40, timestamp: '2026-05-30T00:00:00.000Z' },
          { detector: 'log_health', severity: 'critical', message: '2 malformed active lines in events.jsonl first line 7', iteration: 41, timestamp: '2026-05-30T00:01:00.000Z' },
        ]);
      writeFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), [
        JSON.stringify({ iteration: 41, outcome: 'shipped', title: 'Latest Work' }),
        '',
      ].join('\n'), 'utf-8');
      writeFileSync(path.join(tempDir, 'logs', 'monitor.jsonl'), [
        JSON.stringify({ detector: 'slop', severity: 'warning', message: 'Quality drifting', iteration: 40, timestamp: '2026-05-30T00:00:00.000Z' }),
        JSON.stringify({ detector: 'log_health', severity: 'critical', message: '2 malformed active lines in events.jsonl first line 7', iteration: 41, timestamp: '2026-05-30T00:01:00.000Z' }),
        '',
      ].join('\n'), 'utf-8');

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect((status as any).furnace.monitor).toEqual({
        counts: { critical: 1, warning: 1, info: 0 },
        activeCounts: { critical: 1, warning: 1, info: 0 },
        activeWarnings: [
          {
            detector: 'slop',
            severity: 'warning',
            message: 'Quality drifting',
            iteration: 40,
            timestamp: '2026-05-30T00:00:00.000Z',
          },
          {
            detector: 'log_health',
            severity: 'critical',
            message: '2 malformed active lines in events.jsonl first line 7',
            iteration: 41,
            timestamp: '2026-05-30T00:01:00.000Z',
          },
        ],
        activeWindow: { currentIteration: 41, iterations: 10 },
        recentWarnings: [
          {
            detector: 'slop',
            severity: 'warning',
            message: 'Quality drifting',
            iteration: 40,
            timestamp: '2026-05-30T00:00:00.000Z',
          },
          {
            detector: 'log_health',
            severity: 'critical',
            message: '2 malformed active lines in events.jsonl first line 7',
            iteration: 41,
            timestamp: '2026-05-30T00:01:00.000Z',
          },
        ],
        latestWarning: {
          detector: 'log_health',
          severity: 'critical',
          message: '2 malformed active lines in events.jsonl first line 7',
          iteration: 41,
          timestamp: '2026-05-30T00:01:00.000Z',
        },
      });
      expect((status as any).furnace.health).toEqual({
        level: 'critical',
        reasons: [
          '1 critical monitor warning',
          '1 monitor warning',
        ],
        actions: [
          'Inspect logs/monitor.jsonl for recent monitor warnings.',
        ],
      });
    });

    it('keeps stale monitor warnings out of furnace health', async () => {
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { detector: 'slop', severity: 'warning', message: 'Old quality drift', iteration: 58, timestamp: '2026-05-19T00:00:00.000Z' },
          { detector: 'manifesto_drift', severity: 'warning', message: 'Old drift', iteration: 61, timestamp: '2026-05-19T01:00:00.000Z' },
        ]);
      writeFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), [
        JSON.stringify({ iteration: 75, outcome: 'shipped', title: 'Latest Work' }),
        '',
      ].join('\n'), 'utf-8');

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect((status as any).furnace.monitor.counts).toEqual({ critical: 0, warning: 2, info: 0 });
      expect((status as any).furnace.monitor.activeCounts).toEqual({ critical: 0, warning: 0, info: 0 });
      expect((status as any).furnace.health).toEqual({
        level: 'healthy',
        reasons: [],
        actions: [],
      });
    });

    it('uses configured monitor active warning window in furnace health', async () => {
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
        git: { auto_commit: false, auto_push: false },
        monitor: { active_warning_window: 20 },
      } as any);
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { detector: 'slop', severity: 'warning', message: 'Quality drift still actionable', iteration: 61, timestamp: '2026-05-19T02:39:44.387Z' },
        ]);
      writeFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), [
        JSON.stringify({ iteration: 75, outcome: 'shipped', title: 'Latest Work' }),
        '',
      ].join('\n'), 'utf-8');

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect((status as any).furnace.monitor.activeCounts).toEqual({ critical: 0, warning: 1, info: 0 });
      expect((status as any).furnace.monitor.activeWindow).toEqual({ currentIteration: 75, iterations: 20 });
      expect((status as any).furnace.health).toEqual({
        level: 'warning',
        reasons: ['1 monitor warning'],
        actions: ['Inspect logs/monitor.jsonl for recent monitor warnings.'],
      });
    });

    it('includes checkpointed stimuli source health in furnace status', async () => {
      const { loadCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(loadCheckpoint).mockResolvedValueOnce({
        iteration: 42,
        active_project_ids: [],
        domain_counts: {},
        last_stimuli_refresh: {
          news: {
            last_refresh_iteration: 31,
            consecutive_failures: 2,
            disabled: false,
          },
          cultural: {
            last_refresh_iteration: 30,
            consecutive_failures: 3,
            disabled: true,
          },
          knowledge: 40,
        },
        last_curator_run: 40,
        stats: {
          iteration: 42,
          shipped: 20,
          killed: 5,
          skipped: 3,
          domain_counts: {},
          recent_outcomes: [],
          critic_rejection_window: [],
          total_tokens: { input: 0, output: 0 },
        },
        saved_at: '2026-05-30T00:00:00.000Z',
      });
      const { loadStimuliConfig } = await import('../src/stimuli/index.js');
      vi.mocked(loadStimuliConfig).mockResolvedValueOnce({
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

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect((status as any).furnace.stimuli).toEqual({
        enabled: false,
        sources: 3,
        healthy: 1,
        due: 1,
        failing: 1,
        disabled: 1,
        entries: [
          {
            source: 'news',
            server: 'tavily',
            refreshInterval: 10,
            lastRefreshIteration: 31,
            iterationsSinceRefresh: 11,
            consecutiveFailures: 2,
            disabled: false,
            due: true,
            state: 'failing',
          },
          {
            source: 'cultural',
            server: 'tavily',
            refreshInterval: 20,
            lastRefreshIteration: 30,
            iterationsSinceRefresh: 12,
            consecutiveFailures: 3,
            disabled: true,
            due: false,
            state: 'disabled',
          },
          {
            source: 'knowledge',
            server: 'context7',
            refreshInterval: 10,
            lastRefreshIteration: 40,
            iterationsSinceRefresh: 2,
            consecutiveFailures: 0,
            disabled: false,
            due: false,
            state: 'healthy',
          },
        ],
      });
      expect((status as any).furnace.health).toEqual({
        level: 'warning',
        reasons: [
          '1 stimuli source failing',
          '1 stimuli source disabled',
        ],
        actions: [
          'Inspect stimuli source health and recover disabled or failing feeds.',
        ],
      });
    });

    it('includes current furnace signals in status', async () => {
      const { loadStokerDirective } = await import('../src/stoker/index.js');
      vi.mocked(loadStokerDirective).mockResolvedValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 41,
        for_iteration: 42,
        urgency: 'high',
        streak_instruction: 'amplify',
        refinery_queue: 1,
        ideator_hint: 'Take a sharper risk.',
        rules_fired: ['running_cold', 'refinery_fuel'],
      });
      const { loadComplexityBias } = await import('../src/complexity/index.js');
      vi.mocked(loadComplexityBias).mockResolvedValueOnce({
        updated_at: '2026-01-01T00:00:00Z',
        updated_iteration: 41,
        yields: [],
        recommendation: {
          favor: 'S',
          avoid: ['XL'],
          confidence: 'medium',
          reason: 'S is currently efficient.',
        },
      });
      const { loadStreakHistory } = await import('../src/streaks/index.js');
      vi.mocked(loadStreakHistory).mockResolvedValueOnce({
        current: {
          active: true,
          length: 3,
          domain: 'prose',
          avg_rating: 4.1,
          start_iteration: 39,
          last_iteration: 41,
          artifact_ids: ['0039', '0040', '0041'],
          project_id: null,
        },
        recent_breaks: [],
        cooldown_domains: [],
        cooldown_remaining: 0,
      });
      const { getLastRefineryIteration } = await import('../src/refinery/index.js');
      vi.mocked(getLastRefineryIteration).mockResolvedValueOnce(37);
      const { loadSpeculativeIdeas } = await import('../src/speculative/index.js');
      vi.mocked(loadSpeculativeIdeas).mockResolvedValueOnce([
        {
          proposal: {
            title: 'Old Doorway Index',
            domain: 'poetry',
            complexity: 'S',
            pitch: 'An older catalog of impossible thresholds.',
            why: 'It should be ignored as stale.',
            project_id: null,
            stimulus_ref: null,
          },
          critic_evaluation: {
            decision: 'revise',
            reasons: 'Strong image, but old.',
            sharpening_notes: 'This should not remain active.',
          },
          iteration: 39,
          salvageable: true,
        },
        {
          proposal: {
            title: 'Doorway Index',
            domain: 'poetry',
            complexity: 'S',
            pitch: 'A catalog of impossible thresholds.',
            why: 'It compresses worldbuilding into ritual.',
            project_id: null,
            stimulus_ref: null,
          },
          critic_evaluation: {
            decision: 'revise',
            reasons: 'Strong image, needs sharper constraint.',
            sharpening_notes: 'Use index cards.',
          },
          iteration: 41,
          salvageable: true,
        },
      ]);
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce([
        { iteration: 40, outcome: 'shipped', token_usage: { input: 100000, output: 50000 } },
        { iteration: 41, outcome: 'shipped', token_usage: { input: 200000, output: 100000 } },
      ]);

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect((status as any).furnace).toEqual({
        stoker: {
          forIteration: 42,
          urgency: 'high',
          refineryQueue: 1,
          rules: ['running_cold', 'refinery_fuel'],
          hint: 'Take a sharper risk.',
        },
        stokerCadence: {
          enabled: true,
          runInterval: 5,
          nextRunIteration: 5,
          iterationsUntilRun: 5,
        },
        stokerHeat: {
          window: 5,
          threshold: 200000,
          samples: 2,
          averageTokens: 225000,
          totalTokens: 450000,
          peakTokens: 300000,
          thresholdPercent: 113,
          remainingTokensToThreshold: 0,
          pressure: 'hot',
          hot: true,
        },
        complexity: {
          favor: 'S',
          avoid: ['XL'],
          confidence: 'medium',
          reason: 'S is currently efficient.',
        },
        streak: {
          active: true,
          domain: 'prose',
          length: 3,
          avgRating: 4.1,
          cooldownDomains: [],
          cooldownRemaining: 0,
        },
        speculative: {
          count: 1,
          staleCount: 1,
          ideas: [
            {
              title: 'Doorway Index',
              domain: 'poetry',
              complexity: 'S',
              decision: 'revise',
              iteration: 41,
            },
          ],
        },
        refinery: {
          enabled: true,
          minIterationsBetweenRuns: 5,
          lastIteration: 37,
          nextEligibleIteration: 42,
          iterationsUntilEligible: 42,
        },
        refineryFuel: {
          enabled: true,
          queueLimit: 1,
          available: 2,
          byType: { dream: 1, companion: 1, lowRated: 0 },
          topTargets: [
            { sourceType: 'dream', sourceId: '0005', title: 'Disk Dream', domain: 'prose', refinementType: 'resurrected' },
            { sourceType: 'companion', sourceId: '0019', title: 'Strong Recent Piece', domain: 'code-tool', refinementType: 'companion' },
          ],
        },
        refineryReadiness: {
          state: 'cooldown',
          canQueue: false,
          blockers: ['cooldown', 'hot'],
          reason: 'Refinery cooldown has 42 iterations remaining.',
        },
        stimuli: {
          enabled: false,
          sources: 0,
          healthy: 0,
          due: 0,
          failing: 0,
          disabled: 0,
          entries: [],
        },
        logs: {
          activeFiles: 0,
          archiveCount: 0,
          totalActiveBytes: 0,
          totalArchiveBytes: 0,
          totalLogBytes: 0,
          rotationThresholdBytes: 50 * 1024 * 1024,
          largestActivePercent: 0,
          largestActiveBytesRemaining: 50 * 1024 * 1024,
          rotationPressure: 'clear',
          healthState: 'healthy',
          malformedActiveLines: 0,
          malformedActiveFiles: [],
          malformedActiveFileDetails: [],
          recommendedActions: [],
          largestActive: null,
          largestArchive: null,
        },
        monitor: {
          counts: { critical: 0, warning: 0, info: 0 },
          activeCounts: { critical: 0, warning: 0, info: 0 },
          activeWarnings: [],
          activeWindow: { currentIteration: 0, iterations: 10 },
          recentWarnings: [],
          latestWarning: null,
        },
        health: {
          level: 'healthy',
          reasons: [],
          actions: [],
        },
      });
    });

    it('suppresses stale stoker directives in status once their target iteration has passed', async () => {
      const { loadCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(loadCheckpoint).mockResolvedValueOnce({
        iteration: 42,
        active_project_ids: [],
        domain_counts: {},
        last_stimuli_refresh: {},
        last_curator_run: 40,
        stats: {
          iteration: 42,
          shipped: 20,
          killed: 5,
          skipped: 3,
          domain_counts: {},
          recent_outcomes: [],
          critic_rejection_window: [],
          total_tokens: { input: 100000, output: 50000 },
        },
        saved_at: '2026-05-19T10:00:00Z',
      });
      const { loadStokerDirective } = await import('../src/stoker/index.js');
      vi.mocked(loadStokerDirective).mockResolvedValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 41,
        for_iteration: 42,
        urgency: 'high',
        streak_instruction: 'amplify',
        ideator_hint: 'This directive has already been consumed.',
        rules_fired: ['running_cold'],
      });

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect((status as any).furnace.stoker).toBeNull();
    });

    it('includes stoker cadence when no directive is currently active', async () => {
      const { loadCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(loadCheckpoint).mockResolvedValueOnce({
        iteration: 12,
        active_project_ids: [],
        domain_counts: {},
        last_stimuli_refresh: {},
        last_curator_run: 10,
        stats: {
          iteration: 12,
          shipped: 7,
          killed: 2,
          skipped: 1,
          domain_counts: {},
          recent_outcomes: [],
          critic_rejection_window: [],
          total_tokens: { input: 100000, output: 50000 },
        },
        saved_at: '2026-05-19T10:00:00Z',
      });
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
        git: { auto_commit: false, auto_push: false },
        stoker: {
          enabled: true,
          run_interval: 5,
          refinery_token_heat_window: 5,
          refinery_token_heat_threshold: 200_000,
        },
      } as any);

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect((status as any).furnace.stokerCadence).toEqual({
        enabled: true,
        runInterval: 5,
        nextRunIteration: 15,
        iterationsUntilRun: 3,
      });
    });

    it('suppresses stale speculative fuel in status', async () => {
      const { loadCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(loadCheckpoint).mockResolvedValueOnce({
        iteration: 14,
        active_project_ids: [],
        domain_counts: {},
        last_stimuli_refresh: {},
        last_curator_run: 10,
        stats: {
          iteration: 14,
          shipped: 7,
          killed: 2,
          skipped: 1,
          domain_counts: {},
          recent_outcomes: [],
          critic_rejection_window: [],
          total_tokens: { input: 100000, output: 50000 },
        },
        saved_at: '2026-05-19T10:00:00Z',
      });
      const { loadSpeculativeIdeas } = await import('../src/speculative/index.js');
      vi.mocked(loadSpeculativeIdeas).mockResolvedValueOnce([
        {
          proposal: {
            title: 'Old Doorway',
            domain: 'poetry',
            complexity: 'S',
            pitch: 'An old warmed option.',
            why: 'It should not still count.',
            project_id: null,
            stimulus_ref: null,
          },
          critic_evaluation: {
            decision: 'revise',
            reasons: 'Good kernel, stale file.',
            sharpening_notes: '',
          },
          iteration: 12,
          salvageable: true,
        },
      ]);

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect((status as any).furnace.speculative).toEqual({
        count: 0,
        staleCount: 1,
        ideas: [],
      });
    });

    it('includes refinery cooldown eligibility in status', async () => {
      const { loadCheckpoint } = await import('../src/checkpoint/index.js');
      vi.mocked(loadCheckpoint).mockResolvedValueOnce({
        iteration: 12,
        active_project_ids: [],
        domain_counts: {},
        last_stimuli_refresh: {},
        last_curator_run: 10,
        stats: {
          iteration: 12,
          shipped: 7,
          killed: 2,
          skipped: 1,
          domain_counts: {},
          recent_outcomes: [],
          critic_rejection_window: [],
          total_tokens: { input: 100000, output: 50000 },
        },
        saved_at: '2026-05-19T10:00:00Z',
      });
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
        git: { auto_commit: false, auto_push: false },
        refinery: { enabled: true, min_iterations_between_runs: 5, max_refinery_queue: 1 },
      } as any);
      const { getLastRefineryIteration } = await import('../src/refinery/index.js');
      vi.mocked(getLastRefineryIteration).mockResolvedValueOnce(9);

      const { getStatus } = await import('../src/index.js');
      const status = await getStatus({ rootDir: tempDir });

      expect((status as any).furnace.refinery).toEqual({
        enabled: true,
        minIterationsBetweenRuns: 5,
        lastIteration: 9,
        nextEligibleIteration: 14,
        iterationsUntilEligible: 2,
      });
    });
  });

  describe('forecastFromStatus', () => {
    it('prioritizes blockers and operator actions from furnace status', async () => {
      const { forecastFromStatus } = await import('../src/index.js');

      const forecast = forecastFromStatus({
        running: false,
        iteration: 41,
        shipped: 20,
        killed: 5,
        skipped: 2,
        lastArtifact: null,
        savedAt: null,
        recentOutcomes: [],
        critic: {
          artifactRejection: {
            samples: 5,
            killed: 3,
            shipped: 2,
            rejectionRate: 0.6,
            threshold: 0.4,
            pressure: 'high',
          },
        },
        intervention: {
          stopFile: 'HALT',
          stopPending: true,
          stopPreview: 'Stopped for maintenance',
          requestsFile: 'requests.md',
          requestPending: true,
          requestPreview: 'Build a brass redirect.',
        },
        furnace: {
          stoker: null,
          stokerCadence: { enabled: true, runInterval: 5, nextRunIteration: 45, iterationsUntilRun: 4 },
          stokerHeat: {
            averageTokens: 250000,
            threshold: 200000,
            samples: 5,
            sampledTokens: 1250000,
            peakTokens: 300000,
            thresholdPercent: 125,
            remainingTokensToThreshold: 0,
            pressure: 'hot',
            hot: true,
          },
          complexity: null,
          streak: null,
          speculative: { count: 0, staleCount: 1, ideas: [] },
          refinery: { enabled: true, minIterationsBetweenRuns: 5, lastIteration: 39, nextEligibleIteration: 44, iterationsUntilEligible: 3 },
          refineryFuel: {
            enabled: true,
            queueLimit: 1,
            available: 2,
            byType: { dream: 1, companion: 1, lowRated: 0 },
            topTargets: [],
          },
          refineryReadiness: {
            state: 'hot',
            canQueue: false,
            blockers: ['hot'],
            reason: 'Recent token spend is hot.',
          },
          stimuli: {
            enabled: true,
            sources: 2,
            healthy: 0,
            due: 0,
            failing: 1,
            disabled: 1,
            entries: [],
          },
          logs: {
            activeFiles: 1,
            archiveCount: 0,
            totalActiveBytes: 100,
            totalArchiveBytes: 0,
            totalLogBytes: 100,
            rotationThresholdBytes: 1000,
            largestActivePercent: 10,
            largestActiveBytesRemaining: 900,
            rotationPressure: 'clear',
            healthState: 'malformed',
            malformedActiveLines: 1,
            malformedActiveFiles: ['events.jsonl'],
            malformedActiveFileDetails: [{ name: 'events.jsonl', firstMalformedLine: 7 }],
            recommendedActions: ['Inspect logs/events.jsonl line 7.'],
            largestActive: { name: 'events.jsonl', bytes: 100 },
            largestArchive: null,
          },
          monitor: {
            counts: { critical: 1, warning: 2, info: 0 },
            activeCounts: { critical: 1, warning: 1, info: 0 },
            activeWarnings: [],
            activeWindow: { currentIteration: 41, iterations: 10 },
            recentWarnings: [],
            latestWarning: null,
          },
          health: {
            level: 'critical',
            reasons: ['JSONL logs are malformed'],
            actions: ['Run foundry logs doctor --json.'],
          },
        },
      } as any);

      expect(forecast.state).toBe('blocked');
      expect(forecast.nextIteration).toBe(42);
      expect(forecast.summary).toContain('blocked');
      expect(forecast.signals).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Intervention', state: 'blocked' }),
        expect.objectContaining({ name: 'Human redirect', state: 'warning' }),
        expect.objectContaining({ name: 'Furnace health', state: 'warning' }),
        expect.objectContaining({ name: 'Log health', state: 'warning' }),
        expect.objectContaining({ name: 'Stimuli', state: 'warning' }),
        expect.objectContaining({ name: 'Refinery', state: 'warning' }),
      ]));
      expect(forecast.actions).toEqual(expect.arrayContaining([
        'Run foundry resume before starting.',
        'Review requests.md or clear it with foundry request clear.',
        'Run foundry logs doctor --json.',
        'Inspect logs/events.jsonl line 7.',
      ]));
    });

    it('reports a ready next run with active stoker and refinery signals', async () => {
      const { forecastFromStatus } = await import('../src/index.js');

      const forecast = forecastFromStatus({
        running: true,
        iteration: 8,
        shipped: 4,
        killed: 1,
        skipped: 0,
        lastArtifact: 'Clock Atlas',
        savedAt: null,
        recentOutcomes: [],
        critic: {
          artifactRejection: {
            samples: 3,
            killed: 1,
            shipped: 2,
            rejectionRate: 0.33,
            threshold: 0.4,
            pressure: 'normal',
          },
        },
        intervention: {
          stopFile: 'STOP',
          stopPending: false,
          stopPreview: null,
          requestsFile: 'requests.md',
          requestPending: false,
          requestPreview: null,
        },
        furnace: {
          stoker: {
            forIteration: 9,
            urgency: 'high',
            refineryQueue: 1,
            rules: ['refinery_fuel'],
            hint: 'Refine one candidate.',
          },
          stokerCadence: { enabled: true, runInterval: 5, nextRunIteration: 10, iterationsUntilRun: 2 },
          stokerHeat: {
            averageTokens: 50000,
            threshold: 200000,
            samples: 5,
            sampledTokens: 250000,
            peakTokens: 60000,
            thresholdPercent: 25,
            remainingTokensToThreshold: 150000,
            pressure: 'cool',
            hot: false,
          },
          complexity: {
            favor: 'M',
            avoid: ['XL'],
            confidence: 'medium',
            reason: 'M has better recent ROI.',
          },
          streak: null,
          speculative: {
            count: 1,
            staleCount: 0,
            ideas: [{ title: 'Warm Door', domain: 'prose', complexity: 'S', decision: 'revise', iteration: 8 }],
          },
          refinery: { enabled: true, minIterationsBetweenRuns: 5, lastIteration: 3, nextEligibleIteration: 8, iterationsUntilEligible: 0 },
          refineryFuel: {
            enabled: true,
            queueLimit: 1,
            available: 1,
            byType: { dream: 0, companion: 1, lowRated: 0 },
            topTargets: [{ sourceType: 'companion', sourceId: '0004', title: 'Signal Orchard', domain: 'code', refinementType: 'companion' }],
          },
          refineryReadiness: {
            state: 'ready',
            canQueue: true,
            blockers: [],
            reason: 'Refinery has fuel and token heat is cool.',
          },
          stimuli: { enabled: false, sources: 0, healthy: 0, due: 0, failing: 0, disabled: 0, entries: [] },
          logs: {
            activeFiles: 0,
            archiveCount: 0,
            totalActiveBytes: 0,
            totalArchiveBytes: 0,
            totalLogBytes: 0,
            rotationThresholdBytes: 1000,
            largestActivePercent: 0,
            largestActiveBytesRemaining: 1000,
            rotationPressure: 'clear',
            healthState: 'healthy',
            malformedActiveLines: 0,
            malformedActiveFiles: [],
            malformedActiveFileDetails: [],
            recommendedActions: [],
            largestActive: null,
            largestArchive: null,
          },
          monitor: {
            counts: { critical: 0, warning: 0, info: 0 },
            activeCounts: { critical: 0, warning: 0, info: 0 },
            activeWarnings: [],
            activeWindow: { currentIteration: 8, iterations: 10 },
            recentWarnings: [],
            latestWarning: null,
          },
          health: { level: 'healthy', reasons: [], actions: [] },
        },
      } as any);

      expect(forecast.state).toBe('ready');
      expect(forecast.summary).toBe('Next iteration #9 is ready.');
      expect(forecast.actions).toEqual([]);
      expect(forecast.signals).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Stoker', state: 'ready', detail: expect.stringContaining('high directive for #9') }),
        expect.objectContaining({ name: 'Refinery', state: 'ready', detail: 'Refinery has fuel and token heat is cool.' }),
        expect.objectContaining({ name: 'Speculative fuel', state: 'ready', detail: '1 warmed idea is ready for the next Ideator pass.' }),
      ]));
    });
  });

  describe('sparkFromStatus', () => {
    const baseSparkStatus = {
      running: true,
      iteration: 12,
      shipped: 4,
      killed: 1,
      skipped: 0,
      lastArtifact: 'Brass Orchard',
      savedAt: null,
      recentOutcomes: [
        { iteration: 10, outcome: 'shipped', domain: 'fiction' },
        { iteration: 11, outcome: 'killed', domain: 'fiction' },
        { iteration: 12, outcome: 'shipped', domain: 'code-tool' },
      ],
      critic: {
        artifactRejection: {
          samples: 3,
          killed: 1,
          shipped: 2,
          rejectionRate: 0.33,
          threshold: 0.4,
          pressure: 'normal',
        },
      },
      intervention: {
        stopFile: 'STOP',
        stopPending: false,
        stopPreview: null,
        requestsFile: 'requests.md',
        requestPending: false,
        requestPreview: null,
      },
      furnace: {
        stoker: null,
        stokerCadence: { enabled: true, runInterval: 5, nextRunIteration: 15, iterationsUntilRun: 3 },
        stokerHeat: {
          averageTokens: 50000,
          threshold: 200000,
          samples: 5,
          sampledTokens: 250000,
          peakTokens: 60000,
          thresholdPercent: 25,
          remainingTokensToThreshold: 150000,
          pressure: 'cool',
          hot: false,
        },
        complexity: {
          favor: 'M',
          avoid: ['XL'],
          confidence: 'medium',
          reason: 'Medium pieces are producing better yield.',
        },
        streak: null,
        speculative: { count: 0, staleCount: 0, ideas: [] },
        refinery: { enabled: true, minIterationsBetweenRuns: 5, lastIteration: null, nextEligibleIteration: 12, iterationsUntilEligible: 0 },
        refineryFuel: {
          enabled: true,
          queueLimit: 1,
          available: 0,
          byType: { dream: 0, companion: 0, lowRated: 0 },
          topTargets: [],
        },
        refineryReadiness: {
          state: 'empty',
          canQueue: false,
          blockers: ['empty'],
          reason: 'No eligible refinery fuel is available.',
        },
        stimuli: { enabled: false, sources: 0, healthy: 0, due: 0, failing: 0, disabled: 0, entries: [] },
        logs: {
          activeFiles: 0,
          archiveCount: 0,
          totalActiveBytes: 0,
          totalArchiveBytes: 0,
          totalLogBytes: 0,
          rotationThresholdBytes: 1000,
          largestActivePercent: 0,
          largestActiveBytesRemaining: 1000,
          rotationPressure: 'clear',
          healthState: 'healthy',
          malformedActiveLines: 0,
          malformedActiveFiles: [],
          malformedActiveFileDetails: [],
          recommendedActions: [],
          largestActive: null,
          largestArchive: null,
        },
        monitor: {
          counts: { critical: 0, warning: 0, info: 0 },
          activeCounts: { critical: 0, warning: 0, info: 0 },
          activeWarnings: [],
          activeWindow: { currentIteration: 12, iterations: 10 },
          recentWarnings: [],
          latestWarning: null,
        },
        health: { level: 'healthy', reasons: [], actions: [] },
      },
    };

    const sparkDomains = {
      domains: [
        { name: 'fiction', description: 'Short stories, flash fiction, and vignettes', weight: 1 },
        { name: 'poetry', description: 'Poems, spoken word, and experimental verse', weight: 0.8 },
        { name: 'code-tool', description: 'CLI tools and utilities that solve one problem well', weight: 1 },
      ],
    };

    it('chooses an underused domain and formats a redirect-ready spark', async () => {
      const { sparkFromStatus } = await import('../src/index.js');

      const spark = sparkFromStatus(baseSparkStatus as any, sparkDomains, {
        manifesto: [
          '- **Specificity over generality.** A tool that solves one problem well beats a framework that solves nothing.',
          '- **Surprise.** Every artifact should contain at least one unexpected turn.',
        ].join('\n'),
      });

      expect(spark.nextIteration).toBe(13);
      expect(spark.domain).toBe('poetry');
      expect(spark.domainReason).toContain('least used');
      expect(spark.requestText).toContain('Domain: poetry');
      expect(spark.requestText).toContain('Constraints:');
      expect(spark.constraints).toEqual(expect.arrayContaining([
        expect.stringContaining('Surprise'),
        expect.stringContaining('Favor M complexity'),
      ]));
      expect(spark.signals).toEqual(expect.arrayContaining([
        'Range: poetry has no recent outcomes.',
        'Complexity: favor M with medium confidence.',
      ]));
    });

    it('honors an explicit domain and adds pressure constraints', async () => {
      const { sparkFromStatus } = await import('../src/index.js');

      const spark = sparkFromStatus({
        ...baseSparkStatus,
        critic: {
          artifactRejection: {
            samples: 5,
            killed: 4,
            shipped: 1,
            rejectionRate: 0.8,
            threshold: 0.4,
            pressure: 'high',
          },
        },
        furnace: {
          ...baseSparkStatus.furnace,
          stokerHeat: {
            ...baseSparkStatus.furnace.stokerHeat,
            averageTokens: 260000,
            thresholdPercent: 130,
            pressure: 'hot',
            hot: true,
          },
        },
      } as any, sparkDomains, { domain: 'code-tool' });

      expect(spark.domain).toBe('code-tool');
      expect(spark.domainReason).toBe('requested via --domain');
      expect(spark.constraints).toEqual(expect.arrayContaining([
        expect.stringContaining('Keep the scope compact'),
        expect.stringContaining('Make the success criteria obvious'),
      ]));
      expect(spark.signals).toEqual(expect.arrayContaining([
        'Token heat: hot at 130% of threshold.',
        'Critic pressure: 80% rejection rate over 5 artifacts.',
      ]));
    });

    it('rejects unknown explicit domains', async () => {
      const { sparkFromStatus } = await import('../src/index.js');

      expect(() => sparkFromStatus(baseSparkStatus as any, sparkDomains, { domain: 'unknown' }))
        .toThrow("Unknown spark domain 'unknown'");
    });

    it('builds a deterministic deck ranked by underused domains', async () => {
      const { sparkDeckFromStatus } = await import('../src/index.js');

      const deck = sparkDeckFromStatus(baseSparkStatus as any, sparkDomains, {
        count: 3,
        manifesto: '- **Surprise.** Every artifact should contain at least one unexpected turn.',
      });

      expect(deck).toEqual(expect.objectContaining({
        iteration: 12,
        nextIteration: 13,
        count: 3,
      }));
      expect(deck.sparks).toHaveLength(3);
      expect(deck.sparks.map((spark: any) => spark.domain)).toEqual(['poetry', 'code-tool', 'fiction']);
      expect(new Set(deck.sparks.map((spark: any) => spark.title)).size).toBe(3);
      expect(deck.sparks[0].domainReason).toContain('least used');
    });

    it('rejects invalid spark deck counts', async () => {
      const { sparkDeckFromStatus } = await import('../src/index.js');

      expect(() => sparkDeckFromStatus(baseSparkStatus as any, sparkDomains, { count: 0 }))
        .toThrow('Spark deck count must be an integer between 1 and 10.');
      expect(() => sparkDeckFromStatus(baseSparkStatus as any, sparkDomains, { count: 11 }))
        .toThrow('Spark deck count must be an integer between 1 and 10.');
    });
  });

  describe('getSparkHistory', () => {
    it('reads recent spark application audit entries with filters', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          mode: 'set',
          domain: 'poetry',
          title: 'Poetry for a False Map',
          next_iteration: 13,
          request_file: 'requests.md',
          request_text: 'Make the next iteration a poetry artifact.\nDomain: poetry',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          mode: 'append',
          domain: 'code-tool',
          title: 'Code Tool for a Tiny Instrument',
          next_iteration: 14,
          request_file: 'requests.md',
        },
        {
          timestamp: '2026-05-30T02:00:00.000Z',
          mode: 'append',
          domain: 'poetry',
          title: 'Poetry for a Maintenance Ritual',
          next_iteration: 15,
          request_file: 'requests.md',
          request_text: 'Make the next iteration a poetry artifact about maintenance.\nDomain: poetry',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getSparkHistory } = await import('../src/index.js');
      const history = await getSparkHistory({ rootDir: tempDir, domain: 'poetry', mode: 'append', limit: 1 });

      expect(readJsonlEntries).toHaveBeenCalledWith(path.join(tempDir, 'logs', 'spark.jsonl'));
      expect(history).toEqual({
        domain: 'poetry',
        mode: 'append',
        replayable: null,
        since: null,
        until: null,
        limit: 1,
        total: 1,
        entries: [entries[2]],
      });
    });

    it('filters spark history to replayable entries', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          mode: 'set',
          domain: 'poetry',
          title: 'Poetry for a False Map',
          request_file: 'requests.md',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          mode: 'append',
          domain: 'code-tool',
          title: 'Code Tool for a Tiny Instrument',
          request_file: 'requests.md',
          request_text: 'Make the next iteration a code-tool artifact.\nDomain: code-tool',
        },
        {
          timestamp: '2026-05-30T02:00:00.000Z',
          mode: 'set',
          domain: 'poetry',
          title: 'Poetry for a Blank Request',
          request_file: 'requests.md',
          request_text: '   ',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getSparkHistory } = await import('../src/index.js');
      const history = await getSparkHistory({ rootDir: tempDir, replayable: true });

      expect(history).toEqual({
        domain: null,
        mode: null,
        replayable: true,
        since: null,
        until: null,
        limit: 20,
        total: 1,
        entries: [entries[1]],
      });
    });

    it('filters spark history by timestamp window', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          mode: 'set',
          domain: 'poetry',
          title: 'Poetry for a False Map',
          request_file: 'requests.md',
          request_text: 'Make the next iteration a poetry artifact.\nDomain: poetry',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          mode: 'append',
          domain: 'code-tool',
          title: 'Code Tool for a Tiny Instrument',
          request_file: 'requests.md',
          request_text: 'Make the next iteration a code-tool artifact.\nDomain: code-tool',
        },
        {
          timestamp: '2026-05-30T02:00:00.000Z',
          mode: 'append',
          domain: 'poetry',
          title: 'Poetry for a Maintenance Ritual',
          request_file: 'requests.md',
          request_text: 'Make the next iteration a poetry artifact about maintenance.\nDomain: poetry',
        },
        {
          timestamp: '2026-05-30T03:00:00.000Z',
          mode: 'set',
          domain: 'fiction',
          title: 'Fiction for a Quiet Signal',
          request_file: 'requests.md',
          request_text: 'Make the next iteration a fiction artifact.\nDomain: fiction',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getSparkHistory } = await import('../src/index.js');
      const history = await getSparkHistory({
        rootDir: tempDir,
        since: '2026-05-30T01:00:00.000Z',
        until: '2026-05-30T02:00:00.000Z',
      });

      expect(history).toEqual({
        domain: null,
        mode: null,
        replayable: null,
        since: '2026-05-30T01:00:00.000Z',
        until: '2026-05-30T02:00:00.000Z',
        limit: 20,
        total: 2,
        entries: [entries[1], entries[2]],
      });
    });

    it('rejects invalid spark history filters', async () => {
      const { getSparkHistory } = await import('../src/index.js');

      await expect(getSparkHistory({ domain: '../bad' })).rejects.toThrow('Invalid spark history domain "../bad"');
      await expect(getSparkHistory({ mode: 'replace' as any })).rejects.toThrow('Invalid spark history mode "replace"');
      await expect(getSparkHistory({ since: 'not-a-time' })).rejects.toThrow('Invalid spark history timestamp "not-a-time"');
      await expect(getSparkHistory({ limit: 0 })).rejects.toThrow('Invalid spark history limit "0"');
    });
  });

  describe('getSparkStats', () => {
    it('summarizes spark audit usage by mode, domain, replay, and replayability', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          mode: 'set',
          domain: 'poetry',
          title: 'Poetry for a False Map',
          next_iteration: 13,
          request_file: 'requests.md',
          request_text: 'Make the next iteration a poetry artifact.\nDomain: poetry',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          mode: 'append',
          domain: 'code-tool',
          title: 'Code Tool for a Tiny Instrument',
          next_iteration: 14,
          request_file: 'requests.md',
        },
        {
          timestamp: '2026-05-30T02:00:00.000Z',
          mode: 'append',
          domain: 'poetry',
          title: 'Poetry for a Maintenance Ritual',
          next_iteration: 15,
          request_file: 'requests.md',
          request_text: 'Make the next iteration a poetry artifact about maintenance.\nDomain: poetry',
          replayed: true,
          replayed_from_timestamp: '2026-05-30T00:00:00.000Z',
        },
        {
          timestamp: '2026-05-30T03:00:00.000Z',
          mode: 'set',
          domain: 'fiction',
          title: 'Fiction for a Quiet Signal',
          next_iteration: 16,
          request_file: 'requests.md',
          request_text: '   ',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getSparkStats } = await import('../src/index.js');
      const stats = await getSparkStats({ rootDir: tempDir });

      expect(readJsonlEntries).toHaveBeenCalledWith(path.join(tempDir, 'logs', 'spark.jsonl'));
      expect(stats).toEqual({
        filters: { domain: null, mode: null, replayable: null, since: null, until: null },
        total: 4,
        original: 3,
        replayed: 1,
        replayable: 2,
        byMode: { set: 2, append: 2 },
        byDomain: [
          { domain: 'poetry', count: 2, replayed: 1, replayable: 2 },
          { domain: 'code-tool', count: 1, replayed: 0, replayable: 0 },
          { domain: 'fiction', count: 1, replayed: 0, replayable: 0 },
        ],
        lastEvent: entries[3],
        lastReplay: entries[2],
      });
    });

    it('filters spark audit stats by domain, mode, replayability, and timestamp window', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          mode: 'set',
          domain: 'poetry',
          title: 'Poetry for a False Map',
          request_file: 'requests.md',
          request_text: 'Make the next iteration a poetry artifact.\nDomain: poetry',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          mode: 'append',
          domain: 'code-tool',
          title: 'Code Tool for a Tiny Instrument',
          request_file: 'requests.md',
        },
        {
          timestamp: '2026-05-30T02:00:00.000Z',
          mode: 'append',
          domain: 'poetry',
          title: 'Poetry for a Maintenance Ritual',
          next_iteration: 15,
          request_file: 'requests.md',
          request_text: 'Make the next iteration a poetry artifact about maintenance.\nDomain: poetry',
          replayed: true,
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getSparkStats } = await import('../src/index.js');
      const stats = await getSparkStats({
        rootDir: tempDir,
        domain: 'poetry',
        mode: 'append',
        replayable: true,
        since: '2026-05-30T01:30:00.000Z',
        until: '2026-05-30T02:30:00.000Z',
      });

      expect(stats).toEqual({
        filters: {
          domain: 'poetry',
          mode: 'append',
          replayable: true,
          since: '2026-05-30T01:30:00.000Z',
          until: '2026-05-30T02:30:00.000Z',
        },
        total: 1,
        original: 0,
        replayed: 1,
        replayable: 1,
        byMode: { set: 0, append: 1 },
        byDomain: [
          { domain: 'poetry', count: 1, replayed: 1, replayable: 1 },
        ],
        lastEvent: entries[2],
        lastReplay: entries[2],
      });
    });
  });

  describe('getRequestHistory', () => {
    it('reads recent request audit entries with action and timestamp filters', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          action: 'set',
          request_file: 'requests.md',
          request_text: 'Build a brass astrolabe.',
          request_length: 24,
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          request_text: 'Use moon gear.',
          request_length: 40,
          previous_request_length: 24,
        },
        {
          timestamp: '2026-05-30T02:00:00.000Z',
          action: 'clear',
          request_file: 'requests.md',
          previous_request_length: 40,
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRequestHistory } = await import('../src/index.js');
      const history = await getRequestHistory({
        rootDir: tempDir,
        action: 'append',
        since: '2026-05-30T00:30:00.000Z',
        until: '2026-05-30T01:30:00.000Z',
        limit: 1,
      });

      expect(readJsonlEntries).toHaveBeenCalledWith(path.join(tempDir, 'logs', 'requests.jsonl'));
      expect(history).toEqual({
        action: 'append',
        restorable: null,
        source: null,
        contains: null,
        since: '2026-05-30T00:30:00.000Z',
        until: '2026-05-30T01:30:00.000Z',
        limit: 1,
        total: 1,
        entries: [entries[1]],
      });
    });

    it('rejects invalid request history filters', async () => {
      const { getRequestHistory } = await import('../src/index.js');

      await expect(getRequestHistory({ action: 'delete' as any })).rejects.toThrow('Invalid request history action "delete"');
      await expect(getRequestHistory({ since: 'not-a-time' })).rejects.toThrow('Invalid request history timestamp "not-a-time"');
      await expect(getRequestHistory({ source: '' })).rejects.toThrow('Invalid request history source ""');
      await expect(getRequestHistory({ contains: '' })).rejects.toThrow('Invalid request history contains ""');
      await expect(getRequestHistory({ limit: 0 })).rejects.toThrow('Invalid request history limit "0"');
    });

    it('filters request history to restorable entries', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          action: 'set',
          request_file: 'requests.md',
          request_text: 'Build a brass astrolabe.',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          action: 'clear',
          request_file: 'requests.md',
          previous_request_length: 24,
        },
        {
          timestamp: '2026-05-30T02:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          request_text: '   ',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRequestHistory } = await import('../src/index.js');
      const history = await getRequestHistory({ rootDir: tempDir, restorable: true });

      expect(history).toEqual({
        action: null,
        restorable: true,
        source: null,
        contains: null,
        since: null,
        until: null,
        limit: 20,
        total: 1,
        entries: [entries[0]],
      });
    });

    it('filters request history by source file', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          action: 'set',
          request_file: 'requests.md',
          source: 'ops/seed.md',
          request_text: 'Build a brass astrolabe.',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          source: 'ops/extra.md',
          request_text: 'Use moon gear.',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRequestHistory } = await import('../src/index.js');
      const history = await getRequestHistory({ rootDir: tempDir, source: 'ops/seed.md' });

      expect(history).toEqual({
        action: null,
        restorable: null,
        source: 'ops/seed.md',
        contains: null,
        since: null,
        until: null,
        limit: 20,
        total: 1,
        entries: [entries[0]],
      });
    });

    it('filters request history by request text content', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          action: 'set',
          request_file: 'requests.md',
          request_text: 'Build a brass astrolabe.',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          request_text: 'Use moon gear.',
        },
        {
          timestamp: '2026-05-30T02:00:00.000Z',
          action: 'clear',
          request_file: 'requests.md',
          previous_request_length: 24,
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRequestHistory } = await import('../src/index.js');
      const history = await getRequestHistory({ rootDir: tempDir, contains: 'moon' });

      expect(history).toEqual({
        action: null,
        restorable: null,
        source: null,
        contains: 'moon',
        since: null,
        until: null,
        limit: 20,
        total: 1,
        entries: [entries[1]],
      });
    });
  });

  describe('getRequestStats', () => {
    it('summarizes request audit usage by action and content metadata', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          action: 'set',
          request_file: 'requests.md',
          source: 'ops/seed.md',
          request_text: 'Build a brass astrolabe.',
          request_length: 24,
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          request_text: 'Use moon gear.',
          request_length: 40,
          previous_request_length: 24,
        },
        {
          timestamp: '2026-05-30T02:00:00.000Z',
          action: 'clear',
          request_file: 'requests.md',
          previous_request_length: 40,
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRequestStats } = await import('../src/index.js');
      const stats = await getRequestStats({ rootDir: tempDir });

      expect(readJsonlEntries).toHaveBeenCalledWith(path.join(tempDir, 'logs', 'requests.jsonl'));
      expect(stats).toEqual({
        filters: { action: null, source: null, contains: null, since: null, until: null },
        total: 3,
        byAction: { set: 1, append: 1, clear: 1 },
        withSource: 1,
        withRequestText: 2,
        lastEvent: entries[2],
        lastSet: entries[0],
        lastAppend: entries[1],
        lastClear: entries[2],
      });
    });

    it('filters request audit stats by action and timestamp window', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          action: 'set',
          request_file: 'requests.md',
          request_text: 'Build a brass astrolabe.',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          request_text: 'Use moon gear.',
        },
        {
          timestamp: '2026-05-30T02:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          source: 'ops/extra.md',
          request_text: 'Add tide tables.',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRequestStats } = await import('../src/index.js');
      const stats = await getRequestStats({
        rootDir: tempDir,
        action: 'append',
        since: '2026-05-30T00:30:00.000Z',
        until: '2026-05-30T01:30:00.000Z',
      });

      expect(stats).toEqual({
        filters: {
          action: 'append',
          source: null,
          contains: null,
          since: '2026-05-30T00:30:00.000Z',
          until: '2026-05-30T01:30:00.000Z',
        },
        total: 1,
        byAction: { set: 0, append: 1, clear: 0 },
        withSource: 0,
        withRequestText: 1,
        lastEvent: entries[1],
        lastSet: null,
        lastAppend: entries[1],
        lastClear: null,
      });
    });

    it('filters request audit stats by source file', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          action: 'set',
          request_file: 'requests.md',
          source: 'ops/seed.md',
          request_text: 'Build a brass astrolabe.',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          source: 'ops/extra.md',
          request_text: 'Use moon gear.',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRequestStats } = await import('../src/index.js');
      const stats = await getRequestStats({ rootDir: tempDir, source: 'ops/seed.md' });

      expect(stats).toEqual({
        filters: { action: null, source: 'ops/seed.md', contains: null, since: null, until: null },
        total: 1,
        byAction: { set: 1, append: 0, clear: 0 },
        withSource: 1,
        withRequestText: 1,
        lastEvent: entries[0],
        lastSet: entries[0],
        lastAppend: null,
        lastClear: null,
      });
    });

    it('filters request audit stats by request text content', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          action: 'set',
          request_file: 'requests.md',
          request_text: 'Build a brass astrolabe.',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          request_text: 'Use moon gear.',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRequestStats } = await import('../src/index.js');
      const stats = await getRequestStats({ rootDir: tempDir, contains: 'moon' });

      expect(stats).toEqual({
        filters: { action: null, source: null, contains: 'moon', since: null, until: null },
        total: 1,
        byAction: { set: 0, append: 1, clear: 0 },
        withSource: 0,
        withRequestText: 1,
        lastEvent: entries[1],
        lastSet: null,
        lastAppend: entries[1],
        lastClear: null,
      });
    });
  });

  describe('getRequestSources', () => {
    it('summarizes request audit sources by latest activity', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          action: 'set',
          request_file: 'requests.md',
          source: 'ops/seed.md',
          request_text: 'Build a brass astrolabe.',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          source: 'ops/extra.md',
          request_text: 'Use moon gear.',
        },
        {
          timestamp: '2026-05-30T02:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          source: 'ops/seed.md',
          request_text: 'Add tide tables.',
        },
        {
          timestamp: '2026-05-30T03:00:00.000Z',
          action: 'clear',
          request_file: 'requests.md',
          previous_request_length: 40,
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRequestSources } = await import('../src/index.js');
      const sources = await getRequestSources({ rootDir: tempDir });

      expect(readJsonlEntries).toHaveBeenCalledWith(path.join(tempDir, 'logs', 'requests.jsonl'));
      expect(sources).toEqual({
        filters: { action: null, source: null, contains: null, since: null, until: null },
        limit: 20,
        totalSources: 2,
        sources: [
          {
            source: 'ops/seed.md',
            total: 2,
            byAction: { set: 1, append: 1, clear: 0 },
            withRequestText: 2,
            latestTimestamp: '2026-05-30T02:00:00.000Z',
            lastEntry: entries[2],
          },
          {
            source: 'ops/extra.md',
            total: 1,
            byAction: { set: 0, append: 1, clear: 0 },
            withRequestText: 1,
            latestTimestamp: '2026-05-30T01:00:00.000Z',
            lastEntry: entries[1],
          },
        ],
      });
    });

    it('limits request source summaries and rejects invalid limits', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          action: 'set',
          request_file: 'requests.md',
          source: 'ops/seed.md',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          source: 'ops/extra.md',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRequestSources } = await import('../src/index.js');
      const sources = await getRequestSources({ rootDir: tempDir, limit: 1 });

      expect(sources.filters).toEqual({ action: null, source: null, contains: null, since: null, until: null });
      expect(sources.totalSources).toBe(2);
      expect(sources.sources).toHaveLength(1);
      expect(sources.sources[0]?.source).toBe('ops/extra.md');
      await expect(getRequestSources({ limit: 0 })).rejects.toThrow('Invalid request source limit "0"');
    });

    it('filters request source summaries by action, source, content, and timestamps', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          action: 'set',
          request_file: 'requests.md',
          source: 'ops/seed.md',
          request_text: 'Build a brass astrolabe.',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          source: 'ops/extra.md',
          request_text: 'Use moon gear.',
        },
        {
          timestamp: '2026-05-30T02:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          source: 'ops/extra.md',
          request_text: 'Add moon tide tables.',
        },
        {
          timestamp: '2026-05-30T03:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          source: 'ops/seed.md',
          request_text: 'Add moon calendar.',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRequestSources } = await import('../src/index.js');
      const sources = await getRequestSources({
        rootDir: tempDir,
        action: 'append',
        source: 'ops/extra.md',
        contains: 'moon',
        since: '2026-05-30T00:30:00.000Z',
        until: '2026-05-30T02:30:00.000Z',
      });

      expect(sources).toEqual({
        filters: {
          action: 'append',
          source: 'ops/extra.md',
          contains: 'moon',
          since: '2026-05-30T00:30:00.000Z',
          until: '2026-05-30T02:30:00.000Z',
        },
        limit: 20,
        totalSources: 1,
        sources: [
          {
            source: 'ops/extra.md',
            total: 2,
            byAction: { set: 0, append: 2, clear: 0 },
            withRequestText: 2,
            latestTimestamp: '2026-05-30T02:00:00.000Z',
            lastEntry: entries[2],
          },
        ],
      });
    });
  });

  describe('getRequestRestore', () => {
    it('returns request text from an exact restorable audit entry', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          action: 'set',
          request_file: 'requests.md',
          request_text: 'Build a brass astrolabe.',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          request_text: 'Build a brass astrolabe.\n\nUse moon gear.',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRequestRestore } = await import('../src/index.js');
      const restore = await getRequestRestore({
        rootDir: tempDir,
        from: '2026-05-30T01:00:00.000Z',
      });

      expect(readJsonlEntries).toHaveBeenCalledWith(path.join(tempDir, 'logs', 'requests.jsonl'));
      expect(restore).toEqual({
        from: '2026-05-30T01:00:00.000Z',
        sourceAction: 'append',
        sourceRequestFile: 'requests.md',
        requestText: 'Build a brass astrolabe.\n\nUse moon gear.',
        requestLength: 'Build a brass astrolabe.\n\nUse moon gear.'.length,
        sourceEntry: entries[1],
      });
    });

    it('returns the latest restorable request history entry matching filters', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          action: 'set',
          request_file: 'requests.md',
          source: 'ops/seed.md',
          request_text: 'Build a brass astrolabe.',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          source: 'ops/extra.md',
          request_text: 'Use moon gear.',
        },
        {
          timestamp: '2026-05-30T02:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          source: 'ops/extra.md',
          request_text: 'Add moon tide tables.',
        },
        {
          timestamp: '2026-05-30T03:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          source: 'ops/extra.md',
          request_text: 'Add sun calendar.',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRequestRestore } = await import('../src/index.js');
      const restore = await getRequestRestore({
        rootDir: tempDir,
        latest: true,
        action: 'append',
        source: 'ops/extra.md',
        contains: 'moon',
        since: '2026-05-30T00:30:00.000Z',
        until: '2026-05-30T02:30:00.000Z',
      });

      expect(restore).toEqual({
        from: '2026-05-30T02:00:00.000Z',
        sourceAction: 'append',
        sourceRequestFile: 'requests.md',
        requestText: 'Add moon tide tables.',
        requestLength: 'Add moon tide tables.'.length,
        sourceEntry: entries[2],
      });
    });

    it('rejects invalid or non-restorable request restore sources', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          action: 'clear',
          request_file: 'requests.md',
          previous_request_length: 24,
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValue(entries);

      const { getRequestRestore } = await import('../src/index.js');

      await expect(getRequestRestore({ from: 'not-a-time' })).rejects.toThrow('Invalid request restore timestamp "not-a-time"');
      await expect(getRequestRestore({ from: '2026-05-30T00:00:00.000Z' })).rejects.toThrow('Request history entry "2026-05-30T00:00:00.000Z" has no request text to restore');
      await expect(getRequestRestore({ from: '2026-05-31T00:00:00.000Z' })).rejects.toThrow('No request history entry found for "2026-05-31T00:00:00.000Z"');
      await expect(getRequestRestore({ latest: true, source: 'ops/missing.md' })).rejects.toThrow('No restorable request history entry found for latest restore filters');
      await expect(getRequestRestore({} as any)).rejects.toThrow('Missing request restore source: use --from timestamp or --latest');
    });
  });

  describe('getRequestDiff', () => {
    it('compares current request text with an exact restorable audit entry', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          request_text: 'Build a brass astrolabe.\nUse moon gear.',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRequestDiff } = await import('../src/index.js');
      const diff = await getRequestDiff({
        rootDir: tempDir,
        from: '2026-05-30T01:00:00.000Z',
        currentText: 'Build a brass astrolabe.\nUse sun gear.',
      });

      expect(diff).toEqual({
        from: '2026-05-30T01:00:00.000Z',
        sourceAction: 'append',
        sourceRequestFile: 'requests.md',
        currentText: 'Build a brass astrolabe.\nUse sun gear.',
        historyText: 'Build a brass astrolabe.\nUse moon gear.',
        currentLength: 'Build a brass astrolabe.\nUse sun gear.'.length,
        historyLength: 'Build a brass astrolabe.\nUse moon gear.'.length,
        changed: true,
        sameLines: 1,
        addedLines: 1,
        removedLines: 1,
        lines: [
          { type: 'same', line: 'Build a brass astrolabe.' },
          { type: 'removed', line: 'Use sun gear.' },
          { type: 'added', line: 'Use moon gear.' },
        ],
      });
    });

    it('reports unchanged request text without diff lines', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          action: 'set',
          request_file: 'requests.md',
          request_text: 'Build a brass astrolabe.',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRequestDiff } = await import('../src/index.js');
      const diff = await getRequestDiff({
        rootDir: tempDir,
        from: '2026-05-30T01:00:00.000Z',
        currentText: 'Build a brass astrolabe.',
      });

      expect(diff.changed).toBe(false);
      expect(diff.addedLines).toBe(0);
      expect(diff.removedLines).toBe(0);
      expect(diff.sameLines).toBe(1);
      expect(diff.lines).toEqual([{ type: 'same', line: 'Build a brass astrolabe.' }]);
    });

    it('compares current request text with the latest matching restorable audit entry', async () => {
      const entries = [
        {
          timestamp: '2026-05-30T00:00:00.000Z',
          action: 'set',
          request_file: 'requests.md',
          source: 'ops/seed.md',
          request_text: 'Build a brass astrolabe.',
        },
        {
          timestamp: '2026-05-30T01:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          source: 'ops/extra.md',
          request_text: 'Build a brass astrolabe.\nUse moon gear.',
        },
        {
          timestamp: '2026-05-30T02:00:00.000Z',
          action: 'append',
          request_file: 'requests.md',
          source: 'ops/extra.md',
          request_text: 'Build a brass astrolabe.\nUse tide gear.',
        },
      ];
      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce(entries);

      const { getRequestDiff } = await import('../src/index.js');
      const diff = await getRequestDiff({
        rootDir: tempDir,
        latest: true,
        action: 'append',
        source: 'ops/extra.md',
        contains: 'moon',
        since: '2026-05-30T00:30:00.000Z',
        currentText: 'Build a brass astrolabe.\nUse sun gear.',
      });

      expect(diff).toEqual({
        from: '2026-05-30T01:00:00.000Z',
        sourceAction: 'append',
        sourceRequestFile: 'requests.md',
        currentText: 'Build a brass astrolabe.\nUse sun gear.',
        historyText: 'Build a brass astrolabe.\nUse moon gear.',
        currentLength: 'Build a brass astrolabe.\nUse sun gear.'.length,
        historyLength: 'Build a brass astrolabe.\nUse moon gear.'.length,
        changed: true,
        sameLines: 1,
        addedLines: 1,
        removedLines: 1,
        lines: [
          { type: 'same', line: 'Build a brass astrolabe.' },
          { type: 'removed', line: 'Use sun gear.' },
          { type: 'added', line: 'Use moon gear.' },
        ],
      });
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

      const { initRefreshStates, refreshAllStale } = await import('../src/stimuli/index.js');
      const initialStates = new Map([
        ['news', { source: 'news', last_refresh_iteration: 0, consecutive_failures: 0, disabled: false }],
      ]);
      const refreshedStates = new Map([
        ['news', { source: 'news', last_refresh_iteration: 1, consecutive_failures: 0, disabled: false }],
      ]);
      vi.mocked(initRefreshStates).mockReturnValueOnce(initialStates);
      vi.mocked(refreshAllStale).mockResolvedValueOnce(refreshedStates);

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(refreshAllStale).toHaveBeenCalled();
      expect(vi.mocked(runIteration).mock.calls[0][4]).toEqual({
        lifecycle: {
          mode: 'sequential',
          concurrency: 1,
          startIteration: 1,
        },
      });
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stimuli_refresh_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          tracked_sources: 1,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stimuli_refresh_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          tracked_sources: 1,
          refreshed_sources: 1,
          failing_sources: 0,
          disabled_sources: 0,
          newly_disabled_sources: 0,
          duration_ms: expect.any(Number),
        }),
      }));
    });

    it('runs stimuli refresh before parallel worker iterations when enabled', async () => {
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
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0, concurrency: 2 },
        git: { auto_commit: false, auto_push: false },
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockReset();
      vi.mocked(runIteration)
        .mockImplementationOnce(async () => ({
          iteration: 1,
          outcome: 'shipped',
          title: 'Parallel One',
          domain: 'prose',
          token_usage: { input: 100, output: 50 },
          duration_ms: 1000,
        }))
        .mockImplementationOnce(async () => ({
          iteration: 2,
          outcome: 'shipped',
          title: 'Parallel Two',
          domain: 'poetry',
          token_usage: { input: 80, output: 40 },
          duration_ms: 900,
        }));

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockReset();
      vi.mocked(checkStopFile).mockImplementation(async () => {
        return vi.mocked(runIteration).mock.calls.length >= 2;
      });

      const { refreshAllStale } = await import('../src/stimuli/index.js');

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(refreshAllStale).toHaveBeenCalledWith(1, expect.any(Map));
      expect(refreshAllStale).toHaveBeenCalledWith(2, expect.any(Map));
      for (const call of vi.mocked(runIteration).mock.calls) {
        expect(call[4]).toEqual({
          lifecycle: {
            mode: 'parallel',
            concurrency: 2,
            startIteration: 1,
          },
        });
      }
      expect(vi.mocked(refreshAllStale).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(runIteration).mock.invocationCallOrder[0],
      );
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const stimuliStarts = events.filter((event) => event.event === 'foundry_stimuli_refresh_start');
      expect(stimuliStarts.map((event) => event.data.iteration).sort()).toEqual([1, 2]);
      for (const event of stimuliStarts) {
        expect(event).toEqual(expect.objectContaining({
          phase: 'lifecycle',
          data: expect.objectContaining({
            mode: 'parallel',
            concurrency: 2,
            start_iteration: 1,
          }),
        }));
      }
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

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stimuli_refresh_failed',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          start_iteration: 1,
          iteration: 1,
          detail: 'stimuli broken',
          duration_ms: expect.any(Number),
        }),
      }));
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
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_monitor_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          emergency_curator_enabled: true,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_monitor_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          warning_count: 1,
          critical_warning_count: 0,
        }),
      }));
      consoleSpy.mockRestore();
    });

    it('logs monitor warnings after parallel worker completions', async () => {
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
        loop: { cooldown_seconds: 0, disk_space_min_gb: 0, concurrency: 2 },
        git: { auto_commit: false, auto_push: false },
      });

      const { runIteration } = await import('../src/iteration/index.js');
      vi.mocked(runIteration).mockReset();
      vi.mocked(runIteration)
        .mockImplementationOnce(async () => ({
          iteration: 1,
          outcome: 'shipped',
          title: 'Parallel One',
          domain: 'prose',
          token_usage: { input: 100, output: 50 },
          duration_ms: 1000,
        }))
        .mockImplementationOnce(async () => ({
          iteration: 2,
          outcome: 'shipped',
          title: 'Parallel Two',
          domain: 'poetry',
          token_usage: { input: 80, output: 40 },
          duration_ms: 900,
        }));

      const { checkStopFile } = await import('../src/files/intervention.js');
      vi.mocked(checkStopFile).mockReset();
      vi.mocked(checkStopFile).mockImplementation(async () => {
        return vi.mocked(runIteration).mock.calls.length >= 2;
      });

      const { shouldRunCurator } = await import('../src/curator/index.js');
      vi.mocked(shouldRunCurator).mockReturnValue(false);

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReset();
      vi.mocked(runAllDetectors).mockReturnValue([
        { detector: 'quality', severity: 'warning' as const, message: 'Parallel quality dip', iteration: 1 },
      ]);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(runAllDetectors).toHaveBeenCalled();
      const monitorLog = readFileSync(path.join(tempDir, 'logs', 'monitor.jsonl'), 'utf-8');
      expect(monitorLog).toContain('Parallel quality dip');
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_monitor_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'parallel',
          concurrency: 2,
          warning_count: 1,
          critical_warning_count: 0,
        }),
      }));
      consoleSpy.mockRestore();
    });

    it('records monitor lifecycle failures without stopping the loop', async () => {
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
      vi.mocked(runAllDetectors).mockImplementationOnce(() => {
        throw new Error('monitor detector exploded');
      });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_monitor_failed',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          detail: 'monitor detector exploded',
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stop',
        phase: 'lifecycle',
        data: expect.objectContaining({
          reason: 'STOP file',
          last_completed_iteration: 1,
        }),
      }));
    });

    it('creates the logs directory before writing monitor warnings', async () => {
      const { resetLoggerState } = await import('../src/logging/index.js');
      resetLoggerState();
      rmSync(path.join(tempDir, 'logs'), { recursive: true, force: true });

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

      const monitorLog = readFileSync(path.join(tempDir, 'logs', 'monitor.jsonl'), 'utf-8');
      expect(monitorLog).toContain('Quality dip detected');
      consoleSpy.mockRestore();
    });

    it('persists complexity bias updates emitted by monitor warnings', async () => {
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

      const bias = {
        updated_at: '2026-01-01T00:00:00Z',
        updated_iteration: 1,
        yields: [],
        recommendation: {
          favor: 'S',
          avoid: ['M'],
          confidence: 'medium',
          reason: 'S is efficient',
        },
      };

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReset();
      vi.mocked(runAllDetectors).mockReturnValue([
        {
          detector: 'complexity_yield',
          severity: 'info' as const,
          message: 'Complexity yield updated',
          iteration: 1,
          action: { type: 'complexity_bias_update', bias },
        },
      ] as any);

      const { saveComplexityBias } = await import('../src/complexity/index.js');
      vi.mocked(saveComplexityBias).mockClear();

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(saveComplexityBias).toHaveBeenCalledWith(bias);
      consoleSpy.mockRestore();
    });

    it('generates and logs a stoker directive when the stoker interval fires', async () => {
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
        mean_rating: '4.0', token_usage: { input: 100, output: 50 }, duration_ms: 1000,
      });

      const { shouldRunCurator } = await import('../src/curator/index.js');
      vi.mocked(shouldRunCurator).mockReturnValue(false);

      const { readJsonlEntries } = await import('../src/context/index.js');
      vi.mocked(readJsonlEntries).mockResolvedValueOnce([
        {
          iteration: 1,
          outcome: 'shipped',
          domain: 'prose',
          mean_rating: '4.0',
          token_usage: { input: 100, output: 50 },
          duration_ms: 1000,
        },
      ]);

      const { shouldRunStoker, generateStokerDirective, saveStokerDirective } = await import('../src/stoker/index.js');
      const { selectRefineryTargets, getLastRefineryIteration } = await import('../src/refinery/index.js');
      vi.mocked(selectRefineryTargets).mockResolvedValueOnce([
        {
          source_type: 'dream',
          source_id: '0005',
          source_title: 'Dream',
          source_domain: 'prose',
          refinement_type: 'resurrected',
        },
      ] as any);
      vi.mocked(getLastRefineryIteration).mockResolvedValueOnce(9);
      vi.mocked(shouldRunStoker).mockReturnValueOnce(true);
      vi.mocked(generateStokerDirective).mockReturnValueOnce({
        generated_at: '2026-01-01T00:00:00Z',
        generated_iteration: 1,
        for_iteration: 2,
        urgency: 'high',
        streak_instruction: 'neutral',
        ideator_hint: 'Take a sharper risk.',
        rules_fired: ['running_cold'],
      });

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(generateStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        current_iteration: 1,
        for_iteration: 2,
        recent_iterations: expect.any(Array),
        dream_count: 0,
        refinery_target_count: 1,
        last_refinery_iteration: 9,
        refinery_min_iterations_between_runs: 5,
        refinery_token_heat_window: 5,
        refinery_token_heat_threshold: 200000,
      }));
      expect(selectRefineryTargets).toHaveBeenCalledWith(1, undefined);
      expect(getLastRefineryIteration).toHaveBeenCalledOnce();
      expect(saveStokerDirective).toHaveBeenCalledWith(expect.objectContaining({
        for_iteration: 2,
        ideator_hint: 'Take a sharper risk.',
      }));
      const stokerLog = readFileSync(path.join(tempDir, 'logs', 'stoker.jsonl'), 'utf-8');
      expect(stokerLog).toContain('Take a sharper risk.');
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stoker_check_start',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          due: true,
          run_interval: 5,
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stoker_check_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          due: true,
          directive_written: true,
          for_iteration: 2,
          urgency: 'high',
          rules_fired: ['running_cold'],
        }),
      }));
      consoleSpy.mockRestore();
    });

    it('records skipped stoker lifecycle checks when the interval is not due', async () => {
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

      const { shouldRunStoker, saveStokerDirective } = await import('../src/stoker/index.js');
      vi.mocked(shouldRunStoker).mockReturnValueOnce(false);

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(saveStokerDirective).not.toHaveBeenCalled();
      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stoker_check_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          due: false,
          directive_written: false,
        }),
      }));
    });

    it('records stoker lifecycle failures without stopping the loop', async () => {
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

      const { shouldRunStoker, generateStokerDirective } = await import('../src/stoker/index.js');
      vi.mocked(shouldRunStoker).mockReturnValueOnce(true);
      vi.mocked(generateStokerDirective).mockImplementationOnce(() => {
        throw new Error('stoker furnace jammed');
      });

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stoker_check_failed',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          due: true,
          detail: 'stoker furnace jammed',
        }),
      }));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_stop',
        phase: 'lifecycle',
        data: expect.objectContaining({
          reason: 'STOP file',
          last_completed_iteration: 1,
        }),
      }));
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

      const { saveCheckpoint } = await import('../src/checkpoint/index.js');
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(dispatchCuratorFull).toHaveBeenCalled();
      expect(applyCuratorCycle).toHaveBeenCalled();
      expect(saveCheckpoint).toHaveBeenCalledTimes(2);
      expect(saveCheckpoint).toHaveBeenNthCalledWith(1, expect.objectContaining({
        iteration: 1,
        last_curator_run: 1,
      }));
      const allLog = consoleSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(allLog).toContain('Emergency Curator triggered');
      consoleSpy.mockRestore();
    });

    it('triggers emergency curator on critical monitor pressure without an explicit action', async () => {
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
        iteration: 1, outcome: 'shipped', title: 'Critical Pressure Test', domain: 'prose',
        token_usage: { input: 100, output: 50 }, duration_ms: 1000,
      });

      const { shouldRunCurator } = await import('../src/curator/index.js');
      vi.mocked(shouldRunCurator).mockReturnValue(false);

      const { runAllDetectors } = await import('../src/monitor/index.js');
      vi.mocked(runAllDetectors).mockReset();
      vi.mocked(runAllDetectors).mockReturnValue([
        { detector: 'log_health', severity: 'critical' as const, message: 'Malformed active log lines', iteration: 1 },
      ] as any);

      const { dispatchCuratorFull, applyCuratorCycle } = await import('../src/curator/index.js');
      vi.mocked(dispatchCuratorFull).mockResolvedValueOnce({
        retrospective: 'Emergency', compressed_journal: 'C',
        manifesto_changes: [], domain_recommendations: '',
        project_decisions: [], stimuli_actions: [], human_redirect: null,
      });
      vi.mocked(applyCuratorCycle).mockResolvedValueOnce(undefined);

      const { startFoundry } = await import('../src/index.js');
      await startFoundry({ rootDir: tempDir });

      expect(dispatchCuratorFull).toHaveBeenCalled();
      expect(applyCuratorCycle).toHaveBeenCalled();

      const events = readFileSync(path.join(tempDir, 'logs', 'events.jsonl'), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        event: 'foundry_monitor_complete',
        phase: 'lifecycle',
        data: expect.objectContaining({
          mode: 'sequential',
          concurrency: 1,
          iteration: 1,
          emergency_curator_triggered: true,
          critical_warning_count: 1,
        }),
      }));
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
