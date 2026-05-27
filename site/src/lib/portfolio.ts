import fs from 'node:fs';
import path from 'node:path';

import type { Artifact } from './types.ts';

const PORTFOLIO_ROOT = path.resolve(import.meta.dirname, '../../..', 'portfolio');

function parseReadme(readmeContent: string, dirPath: string, killed: boolean): Artifact | null {
  const lines = readmeContent.split('\n');

  const titleLine = lines.find(l => l.startsWith('# '));
  if (!titleLine) return null;
  const title = titleLine.replace(/^#\s+/, '').replace(/\s*\(KILLED\)\s*$/, '').trim();

  const domainMatch = readmeContent.match(/\*\*Domain:\*\*\s*(.+)/);
  const idMatch = readmeContent.match(/\*\*ID:\*\*\s*(\d+)/);
  const ratingMatch = readmeContent.match(/\*\*Mean rating:\*\*\s*([\d.]+)/);

  const domain = domainMatch?.[1]?.trim() ?? 'unknown';
  const id = idMatch?.[1]?.trim() ?? '0000';
  const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;

  const sections: Record<string, string> = {};
  let currentSection = '';
  let currentContent: string[] = [];
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentSection) sections[currentSection] = currentContent.join('\n').trim();
      currentSection = line.replace(/^##\s+/, '').trim();
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }
  if (currentSection) sections[currentSection] = currentContent.join('\n').trim();

  const ratingsMap: Record<string, number> = {};
  if (sections['Ratings']) {
    const ratingLines = sections['Ratings'].split('\n').filter(l => l.includes('|') && !l.includes('---'));
    for (const rl of ratingLines) {
      const parts = rl.split('|').map(s => s.trim()).filter(Boolean);
      if (parts.length === 2 && parts[0] !== 'Dimension') {
        ratingsMap[parts[0]] = parseInt(parts[1], 10);
      }
    }
  }

  const testerSection = sections['Tester Report'] ?? '';
  const verdictMatch = testerSection.match(/\*\*Verdict:\*\*\s*(.+)/);
  const summaryMatch = testerSection.match(/\*\*Summary:\*\*\s*(.+)/);
  const testsMatch = testerSection.match(/\*\*Tests:\*\*\s*(.+)/);

  const dirFiles = fs.readdirSync(dirPath);
  const htmlFile = dirFiles.find(f => f.endsWith('.html'));
  const hasInteractive = !!htmlFile;

  const contentFile = dirFiles.find(f =>
    f !== 'README.md' && !f.endsWith('.html') &&
    (f.endsWith('.md') || f.endsWith('.txt') || f.endsWith('.py') || f.endsWith('.js') ||
     f.endsWith('.ts') || f.endsWith('.rules') || f.endsWith('.css'))
  ) ?? '';

  const contentRaw = contentFile
    ? fs.readFileSync(path.join(dirPath, contentFile), 'utf-8')
    : '';

  const dirName = path.basename(dirPath);
  const slug = dirName.replace(/^\d+-/, '');

  return {
    id: id.padStart(4, '0'),
    title,
    domain,
    rating,
    killed,
    proposal: sections['Proposal'] ?? '',
    review: sections['Critic Review'] ?? '',
    killReason: sections['Kill Reason'] ?? '',
    ratings: ratingsMap,
    testerVerdict: verdictMatch?.[1]?.trim() ?? '',
    testerSummary: summaryMatch?.[1]?.trim() ?? '',
    testerTests: testsMatch?.[1]?.trim() ?? '',
    date: '',
    iteration: null,
    hasInteractive,
    interactivePath: htmlFile ? `/artifacts/${id.padStart(4, '0')}/${htmlFile}` : '',
    contentFile,
    contentRaw,
    slug,
  };
}

export async function loadPortfolio(): Promise<Artifact[]> {
  const artifacts: Artifact[] = [];
  const domainDirs = fs.readdirSync(PORTFOLIO_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'projects');

  for (const domainDir of domainDirs) {
    const killed = domainDir.name === 'killed';
    const domainPath = path.join(PORTFOLIO_ROOT, domainDir.name);
    const artifactDirs = fs.readdirSync(domainPath, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const artDir of artifactDirs) {
      const artPath = path.join(domainPath, artDir.name);
      const readmePath = path.join(artPath, 'README.md');
      if (!fs.existsSync(readmePath)) continue;

      const readme = fs.readFileSync(readmePath, 'utf-8');
      const artifact = parseReadme(readme, artPath, killed);
      if (artifact) artifacts.push(artifact);
    }
  }

  return artifacts.sort((a, b) => a.id.localeCompare(b.id));
}

export interface ArtifactAssetFile {
  id: string;
  sourcePath: string;
  routePath: string;
  fileName: string;
}

function walkArtifactFiles(dirPath: string, relPath = ''): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(path.join(dirPath, relPath), { withFileTypes: true });

  for (const entry of entries) {
    const entryRel = relPath ? `${relPath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...walkArtifactFiles(dirPath, entryRel));
    } else {
      results.push(entryRel);
    }
  }

  return results;
}

export function getArtifactAssetFiles(): ArtifactAssetFile[] {
  const results: ArtifactAssetFile[] = [];
  const domainDirs = fs.readdirSync(PORTFOLIO_ROOT, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'projects' && d.name !== 'killed');

  for (const domainDir of domainDirs) {
    const domainPath = path.join(PORTFOLIO_ROOT, domainDir.name);
    const artifactDirs = fs.readdirSync(domainPath, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const artDir of artifactDirs) {
      const artPath = path.join(domainPath, artDir.name);
      const readmePath = path.join(artPath, 'README.md');
      if (!fs.existsSync(readmePath)) continue;

      const artifactFiles = walkArtifactFiles(artPath);
      if (!artifactFiles.some(f => f.endsWith('.html'))) continue;

      const readme = fs.readFileSync(readmePath, 'utf-8');
      const idMatch = readme.match(/\*\*ID:\*\*\s*(\d+)/);
      const id = idMatch?.[1]?.padStart(4, '0') ?? '0000';

      for (const fileName of artifactFiles.filter(f => f !== 'README.md')) {
        results.push({
          id,
          sourcePath: path.join(artPath, fileName),
          routePath: `${id}/${fileName}`,
          fileName,
        });
      }
    }
  }

  return results;
}
