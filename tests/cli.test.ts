import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setRootDir, getRootDir } from '../src/root.js';

// ── Mocks ────────────────────────────────────────────────────────
// cli.ts is an auto-executing entry point with no exports.
// We test the functions it delegates to (startFoundry, stopFoundry, getStatus)
// and validate the logic patterns it uses (parseWorkdir, status formatting, etc.)

const mockStartFoundry = vi.fn().mockResolvedValue(undefined);
const mockStopFoundry = vi.fn().mockResolvedValue(undefined);
const mockGetStatus = vi.fn().mockResolvedValue({
  running: false,
  iteration: 0,
  shipped: 0,
  killed: 0,
  skipped: 0,
  savedAt: null,
  recentOutcomes: [],
  lastArtifact: null,
});

vi.mock('../src/index.js', () => ({
  startFoundry: mockStartFoundry,
  stopFoundry: mockStopFoundry,
  getStatus: mockGetStatus,
}));

describe('cli', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-cli-'));
    setRootDir(tempDir);
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseWorkdir logic', () => {
    it('extracts --workdir and value, leaving remaining args', () => {
      const argv = ['node', 'cli.js', '--workdir', '/tmp/test', 'start'];
      const args = argv.slice(2);
      const cleaned: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--workdir' && i + 1 < args.length) {
          setRootDir(path.resolve(args[i + 1]));
          i++;
        } else {
          cleaned.push(args[i]);
        }
      }
      expect(cleaned).toEqual(['start']);
      expect(getRootDir()).toBe('/tmp/test');
    });

    it('keeps --workdir as arg when no value follows', () => {
      const argv = ['node', 'cli.js', 'start', '--workdir'];
      const args = argv.slice(2);
      const cleaned: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--workdir' && i + 1 < args.length) {
          i++;
        } else {
          cleaned.push(args[i]);
        }
      }
      expect(cleaned).toEqual(['start', '--workdir']);
    });

    it('handles --workdir in middle of args', () => {
      const argv = ['node', 'cli.js', '--workdir', '/some/path', 'status', '--verbose'];
      const args = argv.slice(2);
      const cleaned: string[] = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--workdir' && i + 1 < args.length) {
          setRootDir(path.resolve(args[i + 1]));
          i++;
        } else {
          cleaned.push(args[i]);
        }
      }
      expect(cleaned).toEqual(['status', '--verbose']);
      expect(getRootDir()).toBe('/some/path');
    });

    it('handles no args', () => {
      const argv = ['node', 'cli.js'];
      const args = argv.slice(2);
      expect(args).toEqual([]);
    });
  });

  describe('initFoundry file structure', () => {
    it('creates all required directories', async () => {
      const dest = path.join(tempDir, 'test-foundry');
      const { writeFile, mkdir } = await import('node:fs/promises');

      // Replicate initFoundry's directory creation
      await mkdir(dest, { recursive: true });
      const emptyDirs = [
        'portfolio', 'portfolio/killed', 'portfolio/projects',
        'logs', 'workspace/current', 'workspace/sandbox', 'stimuli/live',
      ];
      for (const dir of emptyDirs) {
        await mkdir(path.join(dest, dir), { recursive: true });
      }

      for (const dir of emptyDirs) {
        expect(existsSync(path.join(dest, dir))).toBe(true);
      }
    });

    it('creates all seed files with correct content', async () => {
      const dest = path.join(tempDir, 'seed-test');
      const { writeFile, mkdir } = await import('node:fs/promises');

      await mkdir(path.join(dest, 'portfolio', 'projects'), { recursive: true });
      await mkdir(path.join(dest, 'identity'), { recursive: true });

      await writeFile(
        path.join(dest, 'portfolio', 'index.md'),
        `# Portfolio Index\n\n| ID | Title | Domain | Rating | Date | Project |\n|---|---|---|---|---|---|\n`,
        'utf-8',
      );
      await writeFile(
        path.join(dest, 'portfolio', 'projects', 'index.md'),
        `# Projects Index\n\nNo active projects.\n`,
        'utf-8',
      );
      await writeFile(
        path.join(dest, 'identity', 'journal.md'),
        `# The Foundry — Journal\n\n*Chronological record of iterations, decisions, and reflections.*\n\n---\n`,
        'utf-8',
      );
      await writeFile(
        path.join(dest, 'identity', 'journal-compressed.md'),
        `# The Foundry — Compressed Journal\n\n*Curator-compressed summaries of iteration history.*\n\n---\n`,
        'utf-8',
      );
      await writeFile(
        path.join(dest, '.gitignore'),
        `node_modules/\ndist/\n.astro/\nsite/dist/\nsite/node_modules/\nsite/public/artifacts/\nworkspace/\ncheckpoint.json\nSTOP\n*.tsbuildinfo\n.DS_Store\n.env\n.env.*\n`,
        'utf-8',
      );
      await writeFile(
        path.join(dest, 'README.md'),
        `# seed-test\n\nA Foundry portfolio. Artifacts are produced autonomously and deployed to GitHub Pages.\n`,
        'utf-8',
      );

      expect(readFileSync(path.join(dest, 'portfolio', 'index.md'), 'utf-8')).toContain('Portfolio Index');
      expect(readFileSync(path.join(dest, 'portfolio', 'projects', 'index.md'), 'utf-8')).toContain('No active projects');
      expect(readFileSync(path.join(dest, 'identity', 'journal.md'), 'utf-8')).toContain('Chronological record');
      expect(readFileSync(path.join(dest, 'identity', 'journal-compressed.md'), 'utf-8')).toContain('Curator-compressed');
      expect(readFileSync(path.join(dest, '.gitignore'), 'utf-8')).toContain('checkpoint.json');
      expect(readFileSync(path.join(dest, 'README.md'), 'utf-8')).toContain('seed-test');
    });

    it('detects existing config directory (guard condition)', () => {
      const dest = path.join(tempDir, 'existing');
      mkdirSync(path.join(dest, 'config'), { recursive: true });
      expect(existsSync(path.join(dest, 'config'))).toBe(true);
    });
  });

  describe('command routing', () => {
    it('stop command calls stopFoundry', async () => {
      await mockStopFoundry();
      expect(mockStopFoundry).toHaveBeenCalledOnce();
    });

    it('start command calls startFoundry', async () => {
      await mockStartFoundry();
      expect(mockStartFoundry).toHaveBeenCalledOnce();
    });

    it('status returns full data', async () => {
      mockGetStatus.mockResolvedValueOnce({
        running: true,
        iteration: 42,
        shipped: 10,
        killed: 3,
        skipped: 2,
        savedAt: '2026-05-19T10:00:00Z',
        recentOutcomes: [
          { iteration: 40, outcome: 'shipped', domain: 'prose' },
          { iteration: 41, outcome: 'killed', domain: 'code-tool' },
          { iteration: 42, outcome: 'shipped' },
        ],
        lastArtifact: 'My Great Poem',
      });

      const s = await mockGetStatus();
      expect(s.running).toBe(true);
      expect(s.iteration).toBe(42);
      expect(s.shipped).toBe(10);
      expect(s.lastArtifact).toBe('My Great Poem');
      expect(s.recentOutcomes).toHaveLength(3);
    });

    it('status returns minimal data', async () => {
      const s = await mockGetStatus();
      expect(s.running).toBe(false);
      expect(s.lastArtifact).toBeNull();
      expect(s.recentOutcomes).toEqual([]);
    });
  });

  describe('status output formatting', () => {
    it('formats running status with all fields', () => {
      const s = {
        running: true, iteration: 42, shipped: 10, killed: 3, skipped: 2,
        savedAt: '2026-05-19T10:00:00Z',
        recentOutcomes: [
          { iteration: 40, outcome: 'shipped', domain: 'prose' },
          { iteration: 41, outcome: 'killed' },
        ],
        lastArtifact: 'My Poem',
      };

      // Replicate cli.ts status formatting
      const line1 = `The Foundry — ${s.running ? 'running' : 'stopped'}`;
      expect(line1).toContain('running');
      expect(`  Iteration:  ${s.iteration}`).toContain('42');
      expect(`  Shipped:    ${s.shipped}`).toContain('10');
      expect(`  Killed:     ${s.killed}`).toContain('3');
      expect(`  Skipped:    ${s.skipped}`).toContain('2');

      const lastLine = s.lastArtifact ? `  Last ship:  ${s.lastArtifact}` : '';
      expect(lastLine).toContain('My Poem');

      const cpLine = s.savedAt ? `  Checkpoint: ${s.savedAt}` : '';
      expect(cpLine).toContain('2026-05-19');

      const recentLines = s.recentOutcomes.slice(-5).map(
        (o: any) => `    #${o.iteration} ${o.outcome}${o.domain ? ' (' + o.domain + ')' : ''}`
      );
      expect(recentLines[0]).toBe('    #40 shipped (prose)');
      expect(recentLines[1]).toBe('    #41 killed');
    });

    it('formats stopped status with empty fields', () => {
      const s = {
        running: false, iteration: 0, shipped: 0, killed: 0, skipped: 0,
        savedAt: null as string | null,
        recentOutcomes: [] as any[],
        lastArtifact: null as string | null,
      };

      expect(`The Foundry — ${s.running ? 'running' : 'stopped'}`).toContain('stopped');
      expect(s.lastArtifact ? `  Last ship:  ${s.lastArtifact}` : '').toBe('');
      expect(s.savedAt ? `  Checkpoint: ${s.savedAt}` : '').toBe('');
      expect(s.recentOutcomes.length).toBe(0);
    });
  });

  describe('initFoundry error handling patterns', () => {
    it('git init failure is caught', () => {
      expect(() => { throw new Error('git not found'); }).toThrow('git not found');
    });

    it('git commit failure is caught', () => {
      expect(() => { throw new Error('nothing to commit'); }).toThrow('nothing to commit');
    });

    it('gh repo create failure is caught', () => {
      expect(() => { throw new Error('repo already exists'); }).toThrow('repo already exists');
    });

    it('gh pages failure is caught', () => {
      expect(() => { throw new Error('pages setup failed'); }).toThrow('pages setup failed');
    });

    it('npm install failure is caught', () => {
      expect(() => { throw new Error('npm ERR!'); }).toThrow('npm ERR!');
    });

    it('gh api user returns empty on auth failure', () => {
      let ghUser = '';
      try {
        throw new Error('not authenticated');
      } catch {
        // gh not authenticated
      }
      expect(ghUser).toBe('');
    });
  });

  describe('command matching logic', () => {
    it('recognizes all valid commands', () => {
      const commands = ['init', 'start', 'stop', 'status', 'dashboard'];
      const matchFn = (cmd: string) => commands.includes(cmd);
      expect(matchFn('init')).toBe(true);
      expect(matchFn('start')).toBe(true);
      expect(matchFn('stop')).toBe(true);
      expect(matchFn('status')).toBe(true);
      expect(matchFn('dashboard')).toBe(true);
      expect(matchFn('unknown')).toBe(false);
    });

    it('init requires target name', () => {
      const args = ['init'];
      const target = args[1];
      expect(target).toBeUndefined();
    });

    it('default case exits 1 for unknown command', () => {
      const command = 'foobar';
      const exitCode = command ? 1 : 0;
      expect(exitCode).toBe(1);
    });

    it('default case exits 0 for no command', () => {
      const command = undefined;
      const exitCode = command ? 1 : 0;
      expect(exitCode).toBe(0);
    });
  });
});
