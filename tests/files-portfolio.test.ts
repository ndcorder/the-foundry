import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setRootDir } from '../src/root.js';
import {
  isCodeDomain,
  getNextArtifactId,
  writeArtifact,
  updatePortfolioIndex,
  writeKilledArtifact,
} from '../src/files/portfolio.js';
import type { CriticRatings, CreatorFile } from '../src/types/index.js';

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-test-'));
  setRootDir(tempDir);
  mkdirSync(path.join(tempDir, 'portfolio', 'projects'), { recursive: true });
  mkdirSync(path.join(tempDir, 'portfolio', 'code'), { recursive: true });
  mkdirSync(path.join(tempDir, 'portfolio', 'fiction'), { recursive: true });
  mkdirSync(path.join(tempDir, 'portfolio', 'killed'), { recursive: true });
});
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

describe('isCodeDomain', () => {
  it('returns true for code-tool', () => expect(isCodeDomain('code-tool')).toBe(true));
  it('returns true for code-game', () => expect(isCodeDomain('code-game')).toBe(true));
  it('returns true for code-art', () => expect(isCodeDomain('code-art')).toBe(true));
  it('returns false for fiction', () => expect(isCodeDomain('fiction')).toBe(false));
  it('returns false for poetry', () => expect(isCodeDomain('poetry')).toBe(false));
  it('returns false for empty string', () => expect(isCodeDomain('')).toBe(false));
});

describe('getNextArtifactId', () => {
  it('returns 0001 when no index exists', async () => {
    expect(await getNextArtifactId()).toBe('0001');
  });

  it('returns next id from existing index', async () => {
    const index = [
      '| ID | Title | Domain | Rating | Date | Project |',
      '|---|---|---|---|---|---|',
      '| 0001 | Story One | fiction | 7.0 | 2026-01-01 | — |',
      '| 0002 | Tool Two | code-tool | 8.0 | 2026-01-02 | — |',
    ].join('\n');
    writeFileSync(path.join(tempDir, 'portfolio', 'index.md'), index);
    expect(await getNextArtifactId()).toBe('0003');
  });

  it('pads id to 4 digits', async () => {
    const index = '| 0009 | Nine | fiction | 5.0 | 2026-01-01 | — |';
    writeFileSync(path.join(tempDir, 'portfolio', 'index.md'), index);
    expect(await getNextArtifactId()).toBe('0010');
  });
});

describe('writeArtifact', () => {
  it('creates artifact directory with files and README', async () => {
    const files: CreatorFile[] = [
      { path: 'main.py', content: 'print("hello")' },
      { path: 'lib/util.py', content: 'def helper(): pass' },
    ];
    const ratings: CriticRatings = {
      originality: 8,
      specificity: 7,
      craft: 9,
      surprise: 6,
      coherence: 8,
      portfolio_fit: 7,
      technical_quality: 8,
    };
    const dir = await writeArtifact({
      id: '0001',
      title: 'Test Tool',
      domain: 'code-tool',
      files,
      review: 'Great artifact',
      ratings,
      testerReport: 'All tests pass',
      proposal: 'Build a test tool',
    });

    expect(existsSync(path.join(dir, 'main.py'))).toBe(true);
    expect(readFileSync(path.join(dir, 'main.py'), 'utf-8')).toBe('print("hello")');
    expect(existsSync(path.join(dir, 'lib', 'util.py'))).toBe(true);

    const readme = readFileSync(path.join(dir, 'README.md'), 'utf-8');
    expect(readme).toContain('# Test Tool');
    expect(readme).toContain('**Domain:** code-tool');
    expect(readme).toContain('Great artifact');
    expect(readme).toContain('All tests pass');
    expect(readme).toContain('Build a test tool');
    expect(readme).toContain('originality');
  });

  it('uses code dir for code- domains', async () => {
    const dir = await writeArtifact({
      id: '0001',
      title: 'Game',
      domain: 'code-game',
      files: [{ path: 'game.js', content: 'play()' }],
      review: 'Fun',
      ratings: { originality: 5, specificity: 5, craft: 5, surprise: 5, coherence: 5, portfolio_fit: 5 },
      testerReport: '',
      proposal: 'Make a game',
    });
    expect(dir).toContain(path.join('portfolio', 'code'));
  });

  it('uses domain name dir for non-code domains', async () => {
    const dir = await writeArtifact({
      id: '0002',
      title: 'Poem',
      domain: 'poetry',
      files: [{ path: 'poem.md', content: 'roses' }],
      review: 'Beautiful',
      ratings: { originality: 9, specificity: 8, craft: 9, surprise: 7, coherence: 8, portfolio_fit: 7 },
      testerReport: '',
      proposal: 'Write a poem',
    });
    expect(dir).toContain(path.join('portfolio', 'poetry'));
  });

  it('shows non-code placeholder when tester report is empty', async () => {
    const dir = await writeArtifact({
      id: '0003',
      title: 'Essay',
      domain: 'essay',
      files: [{ path: 'essay.md', content: 'thoughts' }],
      review: 'Insightful',
      ratings: { originality: 7, specificity: 7, craft: 7, surprise: 7, coherence: 7, portfolio_fit: 7 },
      testerReport: '',
      proposal: 'Write essay',
    });
    const readme = readFileSync(path.join(dir, 'README.md'), 'utf-8');
    expect(readme).toContain('*No test report (non-code artifact).*');
  });

  it('calculates mean rating', async () => {
    const dir = await writeArtifact({
      id: '0004',
      title: 'Calc',
      domain: 'fiction',
      files: [{ path: 'story.md', content: 'once' }],
      review: 'ok',
      ratings: { originality: 10, specificity: 10, craft: 10, surprise: 10, coherence: 10, portfolio_fit: 10 },
      testerReport: '',
      proposal: 'p',
    });
    const readme = readFileSync(path.join(dir, 'README.md'), 'utf-8');
    expect(readme).toContain('**Mean rating:** 10.0');
  });
});

describe('updatePortfolioIndex', () => {
  it('creates index when file does not exist', async () => {
    await updatePortfolioIndex('0001', 'My Story', 'fiction', '7.5');
    const content = readFileSync(path.join(tempDir, 'portfolio', 'index.md'), 'utf-8');
    expect(content).toContain('Portfolio Index');
    expect(content).toContain('| 0001 | My Story | fiction | 7.5 |');
  });

  it('appends to existing index', async () => {
    const existing = [
      '# Portfolio Index',
      '',
      '| ID | Title | Domain | Rating | Date | Project |',
      '|---|---|---|---|---|---|',
      '| 0001 | First | fiction | 6.0 | 2026-01-01 | — |',
    ].join('\n');
    writeFileSync(path.join(tempDir, 'portfolio', 'index.md'), existing);
    await updatePortfolioIndex('0002', 'Second', 'poetry', '8.0');
    const content = readFileSync(path.join(tempDir, 'portfolio', 'index.md'), 'utf-8');
    expect(content).toContain('| 0001 | First |');
    expect(content).toContain('| 0002 | Second | poetry | 8.0 |');
  });

  it('removes "No artifacts yet" placeholder', async () => {
    const existing = '# Portfolio Index\n\n*No artifacts yet.*\n';
    writeFileSync(path.join(tempDir, 'portfolio', 'index.md'), existing);
    await updatePortfolioIndex('0001', 'First', 'fiction', '7.0');
    const content = readFileSync(path.join(tempDir, 'portfolio', 'index.md'), 'utf-8');
    expect(content).not.toContain('*No artifacts yet.*');
    expect(content).toContain('| 0001 | First |');
  });
});

describe('writeKilledArtifact', () => {
  it('creates a killed artifact with post-mortem', async () => {
    await writeKilledArtifact('0099', 'Bad Idea', 'fiction', 'Too generic', 'Original proposal');
    const dir = path.join(tempDir, 'portfolio', 'killed', '0099-bad-idea');
    expect(existsSync(dir)).toBe(true);
    const readme = readFileSync(path.join(dir, 'README.md'), 'utf-8');
    expect(readme).toContain('# Bad Idea (KILLED)');
    expect(readme).toContain('Too generic');
    expect(readme).toContain('Original proposal');
    expect(readme).toContain('**Domain:** fiction');
  });
});
