import fs from 'node:fs';
import path from 'node:path';

import type { Stats, Artifact } from './types.ts';

const LOGS_DIR = path.resolve(import.meta.dirname, '../../..', 'logs');

function readJsonl(filename: string): unknown[] {
  const filePath = path.join(LOGS_DIR, filename);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(v => v !== null);
  } catch {
    return [];
  }
}

export async function loadStats(artifacts: Artifact[]): Promise<Stats> {
  const iterations = readJsonl('iterations.jsonl') as { iteration?: number; mean_rating?: string; outcome?: string }[];

  const shipped = artifacts.filter(a => !a.killed);
  const killed = artifacts.filter(a => a.killed);
  const ratings = shipped.map(a => a.rating).filter((r): r is number => r !== null);
  const meanRating = ratings.length > 0
    ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 100) / 100
    : 0;

  const domainCounts: Record<string, number> = {};
  for (const a of shipped) {
    domainCounts[a.domain] = (domainCounts[a.domain] ?? 0) + 1;
  }

  const ratingTrend = iterations
    .filter(e => e.mean_rating != null && e.iteration != null && e.outcome === 'shipped')
    .map(e => ({ iteration: e.iteration!, rating: parseFloat(e.mean_rating!) }));

  return {
    totalIterations: iterations.length,
    totalArtifacts: shipped.length,
    totalKilled: killed.length,
    meanRating,
    domainCounts,
    ratingTrend,
  };
}
