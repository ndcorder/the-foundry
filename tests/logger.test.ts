import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let tempDir: string;

beforeEach(async () => {
  vi.resetModules();
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-test-'));
  const { setRootDir } = await import('../src/root.js');
  setRootDir(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function readJsonl(filename: string): Record<string, unknown>[] {
  const filePath = path.join(tempDir, 'logs', filename);
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe('logger', () => {
  describe('logTokenUsage', () => {
    it('creates logs dir and writes to token-usage.jsonl', async () => {
      const { logTokenUsage } = await import('../src/logging/logger.js');
      await logTokenUsage({ model: 'glm-5.1', input: 100, output: 50 });
      const entries = readJsonl('token-usage.jsonl');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ model: 'glm-5.1', input: 100, output: 50 });
    });

    it('appends multiple entries', async () => {
      const { logTokenUsage } = await import('../src/logging/logger.js');
      await logTokenUsage({ call: 1 });
      await logTokenUsage({ call: 2 });
      const entries = readJsonl('token-usage.jsonl');
      expect(entries).toHaveLength(2);
    });
  });

  describe('logDecision', () => {
    it('writes to decisions.jsonl', async () => {
      const { logDecision } = await import('../src/logging/logger.js');
      await logDecision({ gate: 'gate1', decision: 'approve' });
      const entries = readJsonl('decisions.jsonl');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ gate: 'gate1', decision: 'approve' });
    });
  });

  describe('logIteration', () => {
    it('writes to iterations.jsonl', async () => {
      const { logIteration } = await import('../src/logging/logger.js');
      await logIteration({ iteration: 5, outcome: 'shipped' });
      const entries = readJsonl('iterations.jsonl');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ iteration: 5 });
    });
  });

  describe('logTestReport', () => {
    it('writes to test-reports.jsonl', async () => {
      const { logTestReport } = await import('../src/logging/logger.js');
      await logTestReport({ artifact_id: 'a1', outcome: 'pass' });
      const entries = readJsonl('test-reports.jsonl');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ artifact_id: 'a1', outcome: 'pass' });
    });
  });

  describe('logStoker', () => {
    it('writes to stoker.jsonl', async () => {
      const { logStoker } = await import('../src/logging/logger.js');
      await logStoker({ for_iteration: 8, urgency: 'high', rules_fired: ['running_cold'] });
      const entries = readJsonl('stoker.jsonl');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ for_iteration: 8, urgency: 'high' });
    });
  });

  describe('logStimuli', () => {
    it('writes to stimuli.jsonl', async () => {
      const { logStimuli } = await import('../src/logging/logger.js');
      await logStimuli({ action: 'refresh', source: 'news', status: 'refreshed' });
      const entries = readJsonl('stimuli.jsonl');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ action: 'refresh', source: 'news', status: 'refreshed' });
    });
  });

  describe('logSpark', () => {
    it('writes to spark.jsonl', async () => {
      const { logSpark } = await import('../src/logging/logger.js');
      await logSpark({ mode: 'set', domain: 'poetry', title: 'Poetry for a False Map' });
      const entries = readJsonl('spark.jsonl');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ mode: 'set', domain: 'poetry', title: 'Poetry for a False Map' });
    });
  });

  describe('logRequest', () => {
    it('writes to requests.jsonl', async () => {
      const { logRequest } = await import('../src/logging/logger.js');
      await logRequest({ action: 'set', request_file: 'requests.md', request_length: 24 });
      const entries = readJsonl('requests.jsonl');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ action: 'set', request_file: 'requests.md', request_length: 24 });
    });
  });

  describe('log rotation', () => {
    it('rotates file when size exceeds threshold', async () => {
      const { logDecision } = await import('../src/logging/logger.js');

      // Write a large decisions file to simulate exceeding 50MB threshold
      const { mkdirSync } = await import('node:fs');
      mkdirSync(path.join(tempDir, 'logs'), { recursive: true });
      const decisionsFile = path.join(tempDir, 'logs', 'decisions.jsonl');
      const bigContent = 'x'.repeat(51 * 1024 * 1024);
      writeFileSync(decisionsFile, bigContent, 'utf-8');

      // First call to logDecision will check rotation for decisions.jsonl
      await logDecision({ rotation_test: true });

      // The original large file should have been rotated and new small file created
      const decisionsContent = readFileSync(decisionsFile, 'utf-8');
      expect(decisionsContent).toContain('rotation_test');
      expect(decisionsContent.length).toBeLessThan(1024); // small new file

      // Archived file should exist
      const logFiles = readdirSync(path.join(tempDir, 'logs'));
      const archived = logFiles.filter(
        (f) => f.startsWith('decisions.') && f !== 'decisions.jsonl',
      );
      expect(archived.length).toBeGreaterThanOrEqual(1);
    });

    it('does not rotate small files', async () => {
      const { logTestReport } = await import('../src/logging/logger.js');
      await logTestReport({ small: true });

      const logFiles = readdirSync(path.join(tempDir, 'logs'));
      const archived = logFiles.filter(
        (f) => f.startsWith('test-reports.') && f !== 'test-reports.jsonl',
      );
      expect(archived).toHaveLength(0);
    });

    it('keeps both archives when two rotations happen in the same millisecond', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

      const { logDecision } = await import('../src/logging/logger.js');
      const { mkdirSync } = await import('node:fs');
      mkdirSync(path.join(tempDir, 'logs'), { recursive: true });
      const decisionsFile = path.join(tempDir, 'logs', 'decisions.jsonl');

      writeFileSync(decisionsFile, 'first\n' + 'x'.repeat(51 * 1024 * 1024), 'utf-8');
      await logDecision({ rotation_test: 1 });

      writeFileSync(decisionsFile, 'second\n' + 'x'.repeat(51 * 1024 * 1024), 'utf-8');
      await logDecision({ rotation_test: 2 });

      const archived = readdirSync(path.join(tempDir, 'logs')).filter(
        (f) => f.startsWith('decisions.2026-01-01T00-00-00-000Z') && f !== 'decisions.jsonl',
      );
      expect(archived).toHaveLength(2);
      expect(archived.some((file) => readFileSync(path.join(tempDir, 'logs', file), 'utf-8').startsWith('first'))).toBe(true);
      expect(archived.some((file) => readFileSync(path.join(tempDir, 'logs', file), 'utf-8').startsWith('second'))).toBe(true);
    });
  });

  describe('readJsonlLogHealth', () => {
    it('summarizes active logs and rotated archives', async () => {
      const { readJsonlLogHealth } = await import('../src/logging/logger.js');
      const { mkdirSync } = await import('node:fs');
      mkdirSync(path.join(tempDir, 'logs'), { recursive: true });
      writeFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), '{"iteration":1}\n', 'utf-8');
      writeFileSync(path.join(tempDir, 'logs', 'events.jsonl'), '{"event":"x"}\n{"event":"y"}\n', 'utf-8');
      const archiveEntry = '{"event":"old"}\n';
      writeFileSync(path.join(tempDir, 'logs', 'events.2026-01-01T00-00-00-000Z.jsonl'), archiveEntry, 'utf-8');

      const health = await readJsonlLogHealth();

      expect(health.activeFiles).toBe(2);
      expect(health.archiveCount).toBe(1);
      expect(health.totalActiveBytes).toBeGreaterThan(0);
      expect(health.totalArchiveBytes).toBe(Buffer.byteLength(archiveEntry));
      expect(health.totalLogBytes).toBe(health.totalActiveBytes + health.totalArchiveBytes);
      expect(health.largestActive?.name).toBe('events.jsonl');
      expect(health.largestArchive).toEqual({
        name: 'events.2026-01-01T00-00-00-000Z.jsonl',
        bytes: Buffer.byteLength(archiveEntry),
      });
      expect(health.rotationThresholdBytes).toBe(50 * 1024 * 1024);
      expect(health.largestActivePercent).toBe(0);
      expect(health.rotationPressure).toBe('clear');
      expect(health.healthState).toBe('healthy');
      expect(health.malformedActiveLines).toBe(0);
      expect(health.malformedActiveFiles).toEqual([]);
      expect(health.malformedActiveFileDetails).toEqual([]);
      expect(health.recommendedActions).toEqual([]);
      expect(health.largestActiveBytesRemaining).toBe(
        health.rotationThresholdBytes - (health.largestActive?.bytes ?? 0),
      );
    });

    it('reports malformed lines in active JSONL logs', async () => {
      const { readJsonlLogHealth } = await import('../src/logging/logger.js');
      const { mkdirSync } = await import('node:fs');
      mkdirSync(path.join(tempDir, 'logs'), { recursive: true });
      writeFileSync(path.join(tempDir, 'logs', 'events.jsonl'), '{"ok":true}\nnot json\n{"ok":false}\n{broken\n', 'utf-8');
      writeFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), '{"iteration":1}\n', 'utf-8');

      const health = await readJsonlLogHealth();

      expect(health.malformedActiveLines).toBe(2);
      expect(health.malformedActiveFiles).toEqual(['events.jsonl']);
      expect(health.malformedActiveFileDetails).toEqual([
        { name: 'events.jsonl', malformedLines: 2, firstMalformedLine: 2 },
      ]);
      expect(health.healthState).toBe('malformed');
      expect(health.recommendedActions).toEqual([
        'Repair or rotate malformed active JSONL logs before trusting monitor summaries.',
        'Inspect events.jsonl at line 2.',
      ]);
    });

    it('reports rotation pressure when the largest active log is near the threshold', async () => {
      const { readJsonlLogHealth } = await import('../src/logging/logger.js');
      const { mkdirSync } = await import('node:fs');
      mkdirSync(path.join(tempDir, 'logs'), { recursive: true });
      writeFileSync(
        path.join(tempDir, 'logs', 'events.jsonl'),
        `${JSON.stringify({ payload: 'x'.repeat(51 * 1024 * 1024) })}\n`,
        'utf-8',
      );

      const health = await readJsonlLogHealth();

      expect(health.largestActivePercent).toBe(100);
      expect(health.largestActiveBytesRemaining).toBe(0);
      expect(health.rotationPressure).toBe('rotate-soon');
      expect(health.healthState).toBe('rotate-soon');
      expect(health.malformedActiveFileDetails).toEqual([]);
      expect(health.recommendedActions).toEqual([
        'Rotate or archive active logs before the next long unattended run.',
      ]);
    });
  });

  describe('resetLoggerState', () => {
    it('causes logs directory to be re-ensured on next write', async () => {
      const { logIteration, resetLoggerState } = await import('../src/logging/logger.js');

      // First write creates the logs dir
      await logIteration({ first: true });
      expect(existsSync(path.join(tempDir, 'logs'))).toBe(true);

      // Remove the logs dir manually
      rmSync(path.join(tempDir, 'logs'), { recursive: true, force: true });
      expect(existsSync(path.join(tempDir, 'logs'))).toBe(false);

      // Without reset, the cached dirEnsured=true means mkdir is skipped,
      // so the write would fail. Reset forces re-check.
      resetLoggerState();

      // This should re-create the logs dir
      await logIteration({ after_reset: true });
      expect(existsSync(path.join(tempDir, 'logs'))).toBe(true);

      const entries = readJsonl('iterations.jsonl');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ after_reset: true });
    });
  });

  describe('ensureLogsDir', () => {
    it('creates logs directory if it does not exist', async () => {
      expect(existsSync(path.join(tempDir, 'logs'))).toBe(false);
      const { logIteration } = await import('../src/logging/logger.js');
      await logIteration({ init: true });
      expect(existsSync(path.join(tempDir, 'logs'))).toBe(true);
    });

    it('re-ensures the logs directory after the project root changes', async () => {
      const { logIteration } = await import('../src/logging/logger.js');
      await logIteration({ root: 'first' });

      const nextRoot = mkdtempSync(path.join(tmpdir(), 'foundry-test-next-'));
      try {
        const { setRootDir } = await import('../src/root.js');
        setRootDir(nextRoot);

        await logIteration({ root: 'second' });

        const entries = readFileSync(path.join(nextRoot, 'logs', 'iterations.jsonl'), 'utf-8');
        expect(entries).toContain('"root":"second"');
      } finally {
        rmSync(nextRoot, { recursive: true, force: true });
      }
    });
  });
});
