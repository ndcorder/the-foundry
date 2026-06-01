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

  it('reserves ids already used by killed artifacts', async () => {
    mkdirSync(path.join(tempDir, 'portfolio', 'killed', '0007-killed-piece'), { recursive: true });
    writeFileSync(path.join(tempDir, 'portfolio', 'index.md'), '| 0003 | Shipped | fiction | 5.0 | 2026-01-01 | — |');
    expect(await getNextArtifactId()).toBe('0008');
  });
});

describe('writeArtifact', () => {
  it('creates artifact directory with files and README', async () => {
    const files: CreatorFile[] = [
      { path: 'main.py', content: 'print("hello")' },
      { path: 'lib/util.py', content: 'def helper(): pass' },
    ];
    const ratings: CriticRatings = {
      originality: 4,
      specificity: 4,
      craft: 5,
      surprise: 4,
      coherence: 4,
      portfolio_fit: 4,
      technical_quality: 4,
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
      ratings: { originality: 4, specificity: 4, craft: 5, surprise: 4, coherence: 4, portfolio_fit: 4 },
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
      ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
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
      ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
      testerReport: '',
      proposal: 'p',
    });
    const readme = readFileSync(path.join(dir, 'README.md'), 'utf-8');
    expect(readme).toContain('**Mean rating:** 4.0');
  });

  it('rejects shipped ratings outside the Critic Gate 2 range', async () => {
    await expect(writeArtifact({
      id: '0004',
      title: 'Bad Rating',
      domain: 'fiction',
      files: [{ path: 'story.md', content: 'once' }],
      review: 'ok',
      ratings: { originality: 6, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
      testerReport: '',
      proposal: 'p',
    })).rejects.toThrow(/rating/i);
  });

  it('rejects shipped ratings below the Critic Gate 2 ship threshold', async () => {
    await expect(writeArtifact({
      id: '0004',
      title: 'Almost Rating',
      domain: 'fiction',
      files: [{ path: 'story.md', content: 'once' }],
      review: 'ok',
      ratings: { originality: 3, specificity: 3, craft: 3, surprise: 2, coherence: 3, portfolio_fit: 3 },
      testerReport: '',
      proposal: 'p',
    })).rejects.toThrow(/ship threshold/i);
  });

  it('writes refinery lineage into the artifact README', async () => {
    const dir = await writeArtifact({
      id: '0006',
      title: 'Clock Complaint Ledger Reforged [refined]',
      domain: 'prose',
      files: [{ path: 'README.md', content: '# Reforged' }],
      review: 'Sharper on the second pass',
      ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
      testerReport: 'Complete',
      proposal: 'Refine the clock dream',
      refinery: {
        source_type: 'dream',
        source_id: '0007',
        source_title: 'Clock Complaint Ledger',
        refinement_type: 'resurrected',
        original_rating: 3.1,
      },
    });
    const readme = readFileSync(path.join(dir, 'README.md'), 'utf-8');
    expect(readme).toContain('## Refinery Lineage');
    expect(readme).toContain('Refined from dream #0007: Clock Complaint Ledger.');
    expect(readme).toContain('Refinement type: resurrected.');
    expect(readme).toContain('Original rating: 3.1.');
  });

  it('rejects artifact file paths that escape the artifact directory', async () => {
    await expect(writeArtifact({
      id: '0005',
      title: 'Escape',
      domain: 'fiction',
      files: [{ path: '../../../escaped.txt', content: 'owned' }],
      review: 'bad',
      ratings: { originality: 4, specificity: 4, craft: 4, surprise: 4, coherence: 4, portfolio_fit: 4 },
      testerReport: '',
      proposal: 'p',
    })).rejects.toThrow(/path traversal/i);
    expect(existsSync(path.join(tempDir, 'escaped.txt'))).toBe(false);
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

  it('includes projectId when provided', async () => {
    await updatePortfolioIndex('0001', 'Project Art', 'code-tool', '8.0', 'P001');
    const content = readFileSync(path.join(tempDir, 'portfolio', 'index.md'), 'utf-8');
    expect(content).toContain('| P001 |');
    expect(content).not.toContain('| — |');
  });

  it('uses dash when projectId is omitted', async () => {
    await updatePortfolioIndex('0002', 'Solo Art', 'fiction', '6.0');
    const content = readFileSync(path.join(tempDir, 'portfolio', 'index.md'), 'utf-8');
    expect(content).toContain('| — |');
  });

  it('adds a refined-from column when indexing a refined artifact', async () => {
    const existing = [
      '# Portfolio Index',
      '',
      '| ID | Title | Domain | Rating | Date | Project |',
      '|---|---|---|---|---|---|',
      '| 0001 | First | fiction | 6.0 | 2026-01-01 | — |',
    ].join('\n');
    writeFileSync(path.join(tempDir, 'portfolio', 'index.md'), existing);

    await updatePortfolioIndex(
      '0002',
      'Second [refined]',
      'poetry',
      '8.0',
      undefined,
      { refined_from: '0001' },
    );

    const content = readFileSync(path.join(tempDir, 'portfolio', 'index.md'), 'utf-8');
    expect(content).toContain('| ID | Title | Domain | Rating | Date | Project | Refined From |');
    expect(content).toContain('| 0001 | First | fiction | 6.0 | 2026-01-01 | — | — |');
    expect(content).toContain('| 0002 | Second [refined] | poetry | 8.0 |');
    expect(content).toContain('| #0001 |');
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
