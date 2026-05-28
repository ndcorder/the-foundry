import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { setRootDir } from '../src/root.js';
import {
  loadStimuliConfig,
  initRefreshStates,
  refreshStatesToRecord,
  recordToRefreshStates,
  writeSkillFile,
  refreshAllStale,
} from '../src/stimuli/index.js';
import type { StimuliConfig, StimuliRefreshState, StimuliSourceConfig } from '../src/types/index.js';

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-test-'));
  setRootDir(tempDir);
  mkdirSync(path.join(tempDir, 'stimuli', 'skills'), { recursive: true });
  mkdirSync(path.join(tempDir, 'stimuli', 'live'), { recursive: true });
  mkdirSync(path.join(tempDir, 'config'), { recursive: true });
});
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

function writeStimuliConfig(config: StimuliConfig) {
  writeFileSync(
    path.join(tempDir, 'stimuli', 'stimuli.yml'),
    yaml.stringify(config),
  );
}

const sampleConfig: StimuliConfig = {
  mcp: {
    news: {
      server: 'tavily',
      query_template: 'interesting news',
      max_items: 5,
      refresh_interval: 15,
    },
    knowledge: {
      server: 'context7',
      strategy: 'random',
      max_items: 3,
      refresh_interval: 10,
    },
  },
  stimuli_ttl: 30,
  skills_per_context: 2,
};

describe('loadStimuliConfig', () => {
  it('loads and parses stimuli.yml', async () => {
    writeStimuliConfig(sampleConfig);
    const config = await loadStimuliConfig();
    expect(config.mcp.news.server).toBe('tavily');
    expect(config.mcp.knowledge.server).toBe('context7');
    expect(config.stimuli_ttl).toBe(30);
  });

  it('throws when file is missing', async () => {
    await expect(loadStimuliConfig()).rejects.toThrow();
  });
});

describe('initRefreshStates', () => {
  it('creates a state entry for each MCP source', () => {
    const states = initRefreshStates(sampleConfig);
    expect(states.size).toBe(2);
    expect(states.get('news')).toEqual({
      source: 'news',
      last_refresh_iteration: 0,
      consecutive_failures: 0,
      disabled: false,
    });
    expect(states.get('knowledge')).toEqual({
      source: 'knowledge',
      last_refresh_iteration: 0,
      consecutive_failures: 0,
      disabled: false,
    });
  });

  it('returns empty map for empty config', () => {
    const states = initRefreshStates({ mcp: {}, stimuli_ttl: 30, skills_per_context: 2 });
    expect(states.size).toBe(0);
  });
});

describe('refreshStatesToRecord', () => {
  it('converts states map to record of last_refresh_iteration', () => {
    const states = new Map<string, StimuliRefreshState>([
      ['news', { source: 'news', last_refresh_iteration: 5, consecutive_failures: 0, disabled: false }],
      ['knowledge', { source: 'knowledge', last_refresh_iteration: 12, consecutive_failures: 1, disabled: false }],
    ]);
    const record = refreshStatesToRecord(states);
    expect(record).toEqual({ news: 5, knowledge: 12 });
  });

  it('returns empty object for empty map', () => {
    expect(refreshStatesToRecord(new Map())).toEqual({});
  });
});

describe('recordToRefreshStates', () => {
  it('converts record back to states map', () => {
    const record = { news: 5, knowledge: 10 };
    const states = recordToRefreshStates(record, sampleConfig);
    expect(states.size).toBe(2);
    expect(states.get('news')!.last_refresh_iteration).toBe(5);
    expect(states.get('knowledge')!.last_refresh_iteration).toBe(10);
    // consecutive_failures and disabled should be reset
    expect(states.get('news')!.consecutive_failures).toBe(0);
    expect(states.get('news')!.disabled).toBe(false);
  });

  it('defaults to 0 for missing record entries', () => {
    const record = {};
    const states = recordToRefreshStates(record, sampleConfig);
    expect(states.get('news')!.last_refresh_iteration).toBe(0);
    expect(states.get('knowledge')!.last_refresh_iteration).toBe(0);
  });

  it('ignores record keys not in config', () => {
    const record = { news: 5, knowledge: 10, extra: 99 };
    const states = recordToRefreshStates(record, sampleConfig);
    expect(states.size).toBe(2);
    expect(states.has('extra')).toBe(false);
  });
});

describe('writeSkillFile', () => {
  it('writes skill content to stimuli/skills/<name>.md', async () => {
    await writeSkillFile('test-skill', '# Test Skill\nContent here.');
    const written = readFileSync(path.join(tempDir, 'stimuli', 'skills', 'test-skill.md'), 'utf-8');
    expect(written).toBe('# Test Skill\nContent here.');
  });

  it('creates parent directories if needed', async () => {
    rmSync(path.join(tempDir, 'stimuli', 'skills'), { recursive: true, force: true });
    await writeSkillFile('deep-skill', 'content');
    expect(existsSync(path.join(tempDir, 'stimuli', 'skills', 'deep-skill.md'))).toBe(true);
  });

  it('rejects skill names that escape stimuli/skills', async () => {
    await expect(writeSkillFile('../outside', 'content')).rejects.toThrow(/invalid skill name/i);
    expect(existsSync(path.join(tempDir, 'stimuli', 'outside.md'))).toBe(false);
  });
});

import { refreshSource } from '../src/stimuli/index.js';

// Mock child_process.execFile to prevent real external calls
import { promisify } from 'node:util';

const { mockExecFileFn } = vi.hoisted(() => {
  const mockExecFileFn = vi.fn((...args: unknown[]) => {
    const cb = args.find((a) => typeof a === 'function') as
      | ((err: Error | null, stdout: string, stderr: string) => void)
      | undefined;
    if (cb) {
      cb(new Error('mock: external tool not available'), '', '');
    } else {
      throw new Error('mock: external tool not available');
    }
  });
  // Add custom promisify to match Node's execFile behavior (returns {stdout, stderr})
  (mockExecFileFn as any)[Symbol.for('nodejs.util.promisify.custom')] = (...args: unknown[]) => {
    return new Promise((resolve, reject) => {
      mockExecFileFn(...args, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(Object.assign(err, { stdout, stderr }));
        else resolve({ stdout, stderr });
      });
    });
  };
  return { mockExecFileFn };
});

vi.mock('node:child_process', async (importOriginal) => {
  const orig = await importOriginal<typeof import('node:child_process')>();
  return {
    ...orig,
    execFile: mockExecFileFn,
  };
});

describe('refreshSource', () => {
  it('throws for unknown server type', async () => {
    const config: StimuliSourceConfig = {
      server: 'unknown-server',
      max_items: 5,
      refresh_interval: 10,
    };
    await expect(refreshSource('test', config)).rejects.toThrow('Unknown stimuli server');
  });

  it('handles tavily failure (execFile mock rejects)', async () => {
    const config: StimuliSourceConfig = {
      server: 'tavily',
      query_template: 'test query',
      max_items: 5,
      refresh_interval: 10,
    };
    // runFirecrawl will fail because execFile is mocked to error
    await expect(refreshSource('test', config)).rejects.toThrow();
  });

  it('handles context7 failure gracefully and writes fallback', async () => {
    const config: StimuliSourceConfig = {
      server: 'context7',
      strategy: 'random',
      max_items: 3,
      refresh_interval: 10,
    };
    // context7 catches internal errors, so refreshSource should succeed
    const content = await refreshSource('knowledge-test', config);
    expect(content).toContain('Source unavailable');
    // Should have written the file
    expect(existsSync(path.join(tempDir, 'stimuli', 'live', 'knowledge-test.md'))).toBe(true);
  });

  it('handles tavily with multiple queries', async () => {
    const config: StimuliSourceConfig = {
      server: 'tavily',
      queries: ['query one', 'query two'],
      max_items: 5,
      refresh_interval: 10,
    };
    // All runFirecrawl calls will fail because execFile is mocked
    await expect(refreshSource('multi', config)).rejects.toThrow();
  });
});

describe('refreshSource - happy paths', () => {
  afterEach(() => {
    // Restore default error behavior after each happy-path test
    mockExecFileFn.mockImplementation((...args: unknown[]) => {
      const cb = args.find((a) => typeof a === 'function') as Function | undefined;
      if (cb) cb(new Error('mock: external tool not available'), '', '');
    });
  });

  it('succeeds with tavily single query when execFile succeeds', async () => {
    mockExecFileFn.mockImplementation((...args: unknown[]) => {
      const cb = args.find((a) => typeof a === 'function') as Function | undefined;
      if (cb) cb(null, 'search result content', '');
    });

    const config: StimuliSourceConfig = {
      server: 'tavily',
      query_template: 'test query',
      max_items: 5,
      refresh_interval: 10,
    };
    const content = await refreshSource('tavily-test', config);
    expect(content).toContain('search result content');
    expect(existsSync(path.join(tempDir, 'stimuli', 'live', 'tavily-test.md'))).toBe(true);
  });

  it('succeeds with tavily multiple queries when execFile succeeds', async () => {
    mockExecFileFn.mockImplementation((...args: unknown[]) => {
      const cb = args.find((a) => typeof a === 'function') as Function | undefined;
      if (cb) cb(null, 'multi result', '');
    });

    const config: StimuliSourceConfig = {
      server: 'tavily',
      queries: ['query one', 'query two'],
      max_items: 5,
      refresh_interval: 10,
    };
    const content = await refreshSource('multi-test', config);
    expect(content).toContain('multi result');
  });

  it('succeeds with context7 when execFile succeeds', async () => {
    mockExecFileFn.mockImplementation((...args: unknown[]) => {
      const cb = args.find((a) => typeof a === 'function') as Function | undefined;
      if (cb) cb(null, 'context7 knowledge', '');
    });

    const config: StimuliSourceConfig = {
      server: 'context7',
      strategy: 'random',
      max_items: 3,
      refresh_interval: 10,
    };
    const content = await refreshSource('ctx7-test', config);
    expect(content).toContain('context7 knowledge');
  });
});

describe('refreshAllStale', () => {
  it('returns existing states when config is missing', async () => {
    // No stimuli.yml written
    const states = new Map<string, StimuliRefreshState>();
    const result = await refreshAllStale(1, states);
    expect(result.size).toBe(0);
  });

  it('skips sources that are not stale yet', async () => {
    writeStimuliConfig(sampleConfig);
    const states = new Map<string, StimuliRefreshState>([
      ['news', { source: 'news', last_refresh_iteration: 1, consecutive_failures: 0, disabled: false }],
      ['knowledge', { source: 'knowledge', last_refresh_iteration: 1, consecutive_failures: 0, disabled: false }],
    ]);
    // currentIteration=5, refresh_interval for news=15, knowledge=10 — neither stale
    const result = await refreshAllStale(5, states);
    // States should remain unchanged since nothing refreshed
    expect(result.get('news')!.last_refresh_iteration).toBe(1);
    expect(result.get('knowledge')!.last_refresh_iteration).toBe(1);
  });

  it('skips disabled sources', async () => {
    writeStimuliConfig(sampleConfig);
    const states = new Map<string, StimuliRefreshState>([
      ['news', { source: 'news', last_refresh_iteration: 0, consecutive_failures: 0, disabled: true }],
      ['knowledge', { source: 'knowledge', last_refresh_iteration: 0, consecutive_failures: 0, disabled: true }],
    ]);
    const result = await refreshAllStale(100, states);
    // Even though iteration is way past refresh_interval, disabled sources stay untouched
    expect(result.get('news')!.last_refresh_iteration).toBe(0);
  });

  it('increments consecutive_failures on refresh error and disables after 3', async () => {
    writeStimuliConfig(sampleConfig);
    const states = new Map<string, StimuliRefreshState>([
      ['news', { source: 'news', last_refresh_iteration: 0, consecutive_failures: 2, disabled: false }],
      ['knowledge', { source: 'knowledge', last_refresh_iteration: 0, consecutive_failures: 0, disabled: true }],
    ]);
    // news is stale (iteration 100 - 0 >= 15)
    const result = await refreshAllStale(100, states);
    expect(result.get('news')!.consecutive_failures).toBe(3);
    expect(result.get('news')!.disabled).toBe(true);
  });

  it('initializes missing state entries and records failures', async () => {
    writeStimuliConfig(sampleConfig);
    const states = new Map<string, StimuliRefreshState>();
    // Both sources will be stale (iteration 100 - 0 >= interval)
    const result = await refreshAllStale(100, states);
    expect(result.has('news')).toBe(true);
    expect(result.has('knowledge')).toBe(true);
    // news (tavily/firecrawl) fails because execFile throws
    expect(result.get('news')!.consecutive_failures).toBe(1);
    // context7 catches errors internally and returns fallback string, so it 'succeeds'
    expect(result.get('knowledge')!.consecutive_failures).toBe(0);
    expect(result.get('knowledge')!.last_refresh_iteration).toBe(100);
  });
});
