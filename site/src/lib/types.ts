export interface Artifact {
  id: string;
  title: string;
  domain: string;
  rating: number | null;
  killed: boolean;
  proposal: string;
  review: string;
  killReason: string;
  ratings: Record<string, number>;
  testerVerdict: string;
  testerSummary: string;
  testerTests: string;
  date: string;
  iteration: number | null;
  hasInteractive: boolean;
  interactivePath: string;
  contentFile: string;
  contentRaw: string;
  slug: string;
}

export interface JournalEntry {
  timestamp: string;
  iteration: number;
  status: 'shipped' | 'killed' | 'failed';
  title: string;
  domain: string;
  artifactId: string;
  rating: number | null;
  reviewSnippet: string;
  tokenUsage: string;
}

export interface Stats {
  totalIterations: number;
  totalArtifacts: number;
  totalKilled: number;
  meanRating: number;
  domainCounts: Record<string, number>;
  ratingTrend: { iteration: number; rating: number }[];
}

export const DOMAIN_COLORS: Record<string, string> = {
  poetry: 'var(--domain-poetry)',
  code: 'var(--domain-code)',
  'code-game': 'var(--domain-code-game)',
  'code-tool': 'var(--domain-code-tool)',
  'code-art': 'var(--domain-code-art)',
  experiment: 'var(--domain-experiment)',
  fiction: 'var(--domain-fiction)',
  worldbuilding: 'var(--domain-worldbuilding)',
  essay: 'var(--domain-essay)',
  music: 'var(--domain-music)',
};
