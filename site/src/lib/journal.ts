import fs from 'node:fs';
import path from 'node:path';

import type { JournalEntry } from './types.ts';

const JOURNAL_PATH = path.resolve(import.meta.dirname, '../../..', 'identity', 'journal.md');

export async function loadJournal(): Promise<JournalEntry[]> {
  const content = fs.readFileSync(JOURNAL_PATH, 'utf-8');
  const entries: JournalEntry[] = [];

  const entryBlocks = content.split(/^### /m).filter(b => b.trim());

  for (const block of entryBlocks) {
    const lines = block.split('\n');
    const timestamp = lines[0]?.trim() ?? '';
    if (!timestamp.match(/^\d{4}-/)) continue;

    const body = lines.slice(1).join('\n').trim();

    let status: 'shipped' | 'killed' | 'failed' = 'failed';
    let iteration = 0;
    let title = '';
    let domain = '';
    let artifactId = '';
    let rating: number | null = null;
    let reviewSnippet = '';
    let tokenUsage = '';

    const shippedMatch = body.match(/\*\*Iteration (\d+) — SHIPPED:\*\*\s*"(.+?)"\s*\[(.+?)\]\s*as (\d+)/);
    const killedMatch = body.match(/\*\*Iteration (\d+) — KILLED:\*\*\s*"(.+?)"\s*\[(.+?)\]/);
    const failedMatch = body.match(/\*\*Iteration (\d+):\*\*/);

    if (shippedMatch) {
      status = 'shipped';
      iteration = parseInt(shippedMatch[1], 10);
      title = shippedMatch[2];
      domain = shippedMatch[3];
      artifactId = shippedMatch[4].padStart(4, '0');
      const ratingM = body.match(/Rating:\s*([\d.]+)/);
      rating = ratingM ? parseFloat(ratingM[1]) : null;
      const reviewM = body.match(/Review:\s*(.+?)(?:\. Token|$)/);
      reviewSnippet = reviewM?.[1]?.trim() ?? '';
    } else if (killedMatch) {
      status = 'killed';
      iteration = parseInt(killedMatch[1], 10);
      title = killedMatch[2];
      domain = killedMatch[3];
    } else if (failedMatch) {
      status = 'failed';
      iteration = parseInt(failedMatch[1], 10);
    } else {
      continue;
    }

    const tokenM = body.match(/Token usage:\s*(.+)/);
    tokenUsage = tokenM?.[1]?.trim() ?? '';

    entries.push({ timestamp, iteration, status, title, domain, artifactId, rating, reviewSnippet, tokenUsage });
  }

  return entries;
}
