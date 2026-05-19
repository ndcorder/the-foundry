import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setRootDir } from '../src/root.js';
import {
  clearWorkspace,
  writeWorkspaceFile,
  readWorkspaceFiles,
} from '../src/files/workspace.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-test-'));
  setRootDir(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('workspace', () => {
  describe('clearWorkspace', () => {
    it('creates workspace/current if it does not exist', async () => {
      await clearWorkspace();
      expect(existsSync(path.join(tempDir, 'workspace', 'current'))).toBe(true);
    });

    it('removes existing files in workspace/current', async () => {
      const wsDir = path.join(tempDir, 'workspace', 'current');
      mkdirSync(wsDir, { recursive: true });
      writeFileSync(path.join(wsDir, 'old.txt'), 'old content', 'utf-8');
      await clearWorkspace();
      expect(existsSync(path.join(wsDir, 'old.txt'))).toBe(false);
      expect(existsSync(wsDir)).toBe(true);
    });

    it('removes nested directories', async () => {
      const nested = path.join(tempDir, 'workspace', 'current', 'sub', 'deep');
      mkdirSync(nested, { recursive: true });
      writeFileSync(path.join(nested, 'file.txt'), 'deep', 'utf-8');
      await clearWorkspace();
      expect(existsSync(path.join(tempDir, 'workspace', 'current', 'sub'))).toBe(false);
    });
  });

  describe('writeWorkspaceFile', () => {
    it('writes a file to workspace/current', async () => {
      await clearWorkspace();
      await writeWorkspaceFile('hello.txt', 'world');
      const content = readFileSync(
        path.join(tempDir, 'workspace', 'current', 'hello.txt'),
        'utf-8',
      );
      expect(content).toBe('world');
    });

    it('creates subdirectories as needed', async () => {
      await clearWorkspace();
      await writeWorkspaceFile('src/lib/utils.ts', 'export {}');
      const content = readFileSync(
        path.join(tempDir, 'workspace', 'current', 'src', 'lib', 'utils.ts'),
        'utf-8',
      );
      expect(content).toBe('export {}');
    });
  });

  describe('readWorkspaceFiles', () => {
    it('returns empty array when workspace is empty', async () => {
      await clearWorkspace();
      const files = await readWorkspaceFiles();
      expect(files).toEqual([]);
    });

    it('returns empty array when workspace does not exist', async () => {
      const files = await readWorkspaceFiles();
      expect(files).toEqual([]);
    });

    it('reads flat files', async () => {
      await clearWorkspace();
      await writeWorkspaceFile('a.txt', 'aaa');
      await writeWorkspaceFile('b.txt', 'bbb');
      const files = await readWorkspaceFiles();
      expect(files).toHaveLength(2);
      const sorted = files.sort((a, b) => a.path.localeCompare(b.path));
      expect(sorted[0]).toEqual({ path: 'a.txt', content: 'aaa' });
      expect(sorted[1]).toEqual({ path: 'b.txt', content: 'bbb' });
    });

    it('reads nested files with relative paths', async () => {
      await clearWorkspace();
      await writeWorkspaceFile('src/index.ts', 'main');
      await writeWorkspaceFile('src/lib/helper.ts', 'helper');
      const files = await readWorkspaceFiles();
      const paths = files.map((f) => f.path).sort();
      expect(paths).toEqual(['src/index.ts', 'src/lib/helper.ts']);
    });
  });
});
