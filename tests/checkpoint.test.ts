import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setRootDir } from '../src/root.js';
import {
  checkpointPath,
  saveCheckpoint,
  loadCheckpoint,
  deleteCheckpoint,
} from '../src/checkpoint/index.js';
import type { CheckpointState } from '../src/types/state.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-test-'));
  setRootDir(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeState(overrides: Partial<CheckpointState> = {}): CheckpointState {
  return {
    iteration: 1,
    active_project_ids: [],
    domain_counts: {},
    last_stimuli_refresh: {},
    last_curator_run: 0,
    stats: {
      iteration: 1,
      shipped: 0,
      killed: 0,
      skipped: 0,
      domain_counts: {},
      recent_outcomes: [],
      critic_rejection_window: [],
      total_tokens: { input: 0, output: 0 },
    },
    saved_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('checkpoint', () => {
  describe('checkpointPath', () => {
    it('returns checkpoint.json under root', () => {
      expect(checkpointPath()).toBe(path.join(tempDir, 'checkpoint.json'));
    });
  });

  describe('saveCheckpoint', () => {
    it('writes state as JSON to checkpoint.json', async () => {
      const state = makeState({ iteration: 42 });
      await saveCheckpoint(state);
      const raw = readFileSync(checkpointPath(), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.iteration).toBe(42);
    });

    it('overwrites previous checkpoint', async () => {
      await saveCheckpoint(makeState({ iteration: 1 }));
      await saveCheckpoint(makeState({ iteration: 2 }));
      const parsed = JSON.parse(readFileSync(checkpointPath(), 'utf-8'));
      expect(parsed.iteration).toBe(2);
    });

    it('uses atomic write via tmp file', async () => {
      // After save, the tmp file should not remain
      await saveCheckpoint(makeState());
      const tmpPath = path.join(tempDir, 'checkpoint.tmp.json');
      expect(() => readFileSync(tmpPath)).toThrow();
    });
  });

  describe('loadCheckpoint', () => {
    it('returns null when file does not exist', async () => {
      const result = await loadCheckpoint();
      expect(result).toBeNull();
    });

    it('loads saved state', async () => {
      const state = makeState({ iteration: 7, active_project_ids: ['p1'] });
      await saveCheckpoint(state);
      const loaded = await loadCheckpoint();
      expect(loaded).not.toBeNull();
      expect(loaded!.iteration).toBe(7);
      expect(loaded!.active_project_ids).toEqual(['p1']);
    });

    it('returns null and logs on corrupt JSON', async () => {
      writeFileSync(checkpointPath(), '{not valid json!!!', 'utf-8');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await loadCheckpoint();
      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('corrupt checkpoint.json'),
      );
      consoleSpy.mockRestore();
    });

    it('rethrows non-ENOENT read errors', async () => {
      // Make checkpointPath a directory so readFile fails with EISDIR
      const { mkdirSync } = await import('node:fs');
      mkdirSync(checkpointPath(), { recursive: true });
      await expect(loadCheckpoint()).rejects.toThrow();
    });
  });

  describe('deleteCheckpoint', () => {
    it('deletes an existing checkpoint', async () => {
      await saveCheckpoint(makeState());
      await deleteCheckpoint();
      const result = await loadCheckpoint();
      expect(result).toBeNull();
    });

    it('does nothing when file does not exist', async () => {
      // Should not throw
      await expect(deleteCheckpoint()).resolves.toBeUndefined();
    });

    it('rethrows non-ENOENT unlink errors', async () => {
      // Make checkpoint path a non-empty directory so unlink fails with EPERM/EISDIR
      const { mkdirSync, writeFileSync: wfs } = await import('node:fs');
      mkdirSync(checkpointPath(), { recursive: true });
      wfs(path.join(checkpointPath(), 'child'), 'x');
      await expect(deleteCheckpoint()).rejects.toThrow();
    });
  });

  describe('save/load/delete cycle', () => {
    it('full lifecycle works end-to-end', async () => {
      // Initially empty
      expect(await loadCheckpoint()).toBeNull();

      // Save
      const state = makeState({ iteration: 10 });
      await saveCheckpoint(state);

      // Load
      const loaded = await loadCheckpoint();
      expect(loaded!.iteration).toBe(10);

      // Delete
      await deleteCheckpoint();
      expect(await loadCheckpoint()).toBeNull();
    });
  });
});
