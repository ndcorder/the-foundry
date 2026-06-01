import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setRootDir } from '../src/root.js';
import { checkStopFile, readRequests, clearRequests, writeRequests } from '../src/files/intervention.js';
import type { FoundryConfig } from '../src/types/config.js';

let tempDir: string;

function makeConfig(overrides?: Partial<FoundryConfig['intervention']>): FoundryConfig {
  return {
    intervention: {
      stop_file: 'STOP',
      requests_file: 'requests.md',
      ...overrides,
    },
  } as FoundryConfig;
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-test-'));
  setRootDir(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('intervention', () => {
  describe('checkStopFile', () => {
    it('returns false when STOP file does not exist', async () => {
      const result = await checkStopFile(makeConfig());
      expect(result).toBe(false);
    });

    it('returns true when STOP file exists', async () => {
      writeFileSync(path.join(tempDir, 'STOP'), '', 'utf-8');
      const result = await checkStopFile(makeConfig());
      expect(result).toBe(true);
    });

    it('works with custom stop file path', async () => {
      writeFileSync(path.join(tempDir, 'halt.txt'), '', 'utf-8');
      const result = await checkStopFile(makeConfig({ stop_file: 'halt.txt' }));
      expect(result).toBe(true);
    });
  });

  describe('readRequests', () => {
    it('returns empty string when requests file does not exist', async () => {
      const result = await readRequests(makeConfig());
      expect(result).toBe('');
    });

    it('returns trimmed content of requests file', async () => {
      writeFileSync(path.join(tempDir, 'requests.md'), '  Build a game  \n', 'utf-8');
      const result = await readRequests(makeConfig());
      expect(result).toBe('Build a game');
    });

    it('returns empty string for empty requests file', async () => {
      writeFileSync(path.join(tempDir, 'requests.md'), '', 'utf-8');
      const result = await readRequests(makeConfig());
      expect(result).toBe('');
    });

    it('returns empty string for whitespace-only requests file', async () => {
      writeFileSync(path.join(tempDir, 'requests.md'), '   \n\n  ', 'utf-8');
      const result = await readRequests(makeConfig());
      expect(result).toBe('');
    });
  });

  describe('clearRequests', () => {
    it('empties the requests file', async () => {
      writeFileSync(path.join(tempDir, 'requests.md'), 'Some request', 'utf-8');
      await clearRequests(makeConfig());
      const result = await readRequests(makeConfig());
      expect(result).toBe('');
    });

    it('creates the file if it does not exist', async () => {
      await clearRequests(makeConfig());
      const result = await readRequests(makeConfig());
      expect(result).toBe('');
    });
  });

  describe('writeRequests', () => {
    it('writes trimmed request content with a trailing newline', async () => {
      await writeRequests(makeConfig(), '  Build a clockwork atlas  ');

      expect(readFileSync(path.join(tempDir, 'requests.md'), 'utf-8')).toBe('Build a clockwork atlas\n');
      await expect(readRequests(makeConfig())).resolves.toBe('Build a clockwork atlas');
    });

    it('creates parent directories for custom request file paths', async () => {
      await writeRequests(
        makeConfig({ requests_file: 'ops/human/requests.md' }),
        'Build a brass compass',
      );

      expect(existsSync(path.join(tempDir, 'ops', 'human'))).toBe(true);
      await expect(readRequests(makeConfig({ requests_file: 'ops/human/requests.md' })))
        .resolves.toBe('Build a brass compass');
    });
  });
});
