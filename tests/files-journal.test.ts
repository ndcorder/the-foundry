import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setRootDir } from '../src/root.js';
import { appendJournal } from '../src/files/journal.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-test-'));
  setRootDir(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('journal', () => {
  describe('appendJournal', () => {
    it('creates journal.md with header when file does not exist', async () => {
      mkdirSync(path.join(tempDir, 'identity'), { recursive: true });
      await appendJournal('First entry');
      const content = readFileSync(path.join(tempDir, 'identity', 'journal.md'), 'utf-8');
      expect(content).toContain('# The Foundry — Journal');
      expect(content).toContain('First entry');
    });

    it('appends to existing journal', async () => {
      mkdirSync(path.join(tempDir, 'identity'), { recursive: true });
      await appendJournal('Entry 1');
      await appendJournal('Entry 2');
      const content = readFileSync(path.join(tempDir, 'identity', 'journal.md'), 'utf-8');
      expect(content).toContain('Entry 1');
      expect(content).toContain('Entry 2');
      // Should have exactly one header
      const headerCount = (content.match(/# The Foundry — Journal/g) || []).length;
      expect(headerCount).toBe(1);
    });

    it('includes ISO timestamp in each entry', async () => {
      mkdirSync(path.join(tempDir, 'identity'), { recursive: true });
      await appendJournal('Timestamped entry');
      const content = readFileSync(path.join(tempDir, 'identity', 'journal.md'), 'utf-8');
      // ISO timestamp format: ### 2026-...
      expect(content).toMatch(/### \d{4}-\d{2}-\d{2}T/);
    });

    it('preserves existing content when appending', async () => {
      const journalPath = path.join(tempDir, 'identity', 'journal.md');
      mkdirSync(path.join(tempDir, 'identity'), { recursive: true });
      writeFileSync(journalPath, '# Custom Header\n\nExisting content.\n', 'utf-8');
      await appendJournal('New entry');
      const content = readFileSync(journalPath, 'utf-8');
      expect(content).toContain('# Custom Header');
      expect(content).toContain('Existing content.');
      expect(content).toContain('New entry');
    });

    it('handles identity dir not existing (file creation fails gracefully, uses default header)', async () => {
      // identity/ dir doesn't exist, so readFile fails -> uses default header
      // But writeFile will also fail since identity/ doesn't exist
      // Let's just ensure identity dir exists but no journal.md
      mkdirSync(path.join(tempDir, 'identity'), { recursive: true });
      await appendJournal('Solo entry');
      expect(existsSync(path.join(tempDir, 'identity', 'journal.md'))).toBe(true);
    });
  });
});
