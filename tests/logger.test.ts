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
  });

  describe('ensureLogsDir', () => {
    it('creates logs directory if it does not exist', async () => {
      expect(existsSync(path.join(tempDir, 'logs'))).toBe(false);
      const { logIteration } = await import('../src/logging/logger.js');
      await logIteration({ init: true });
      expect(existsSync(path.join(tempDir, 'logs'))).toBe(true);
    });
  });
});
