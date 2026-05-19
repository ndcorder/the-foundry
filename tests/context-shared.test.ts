import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { setRootDir } from '../src/root.js';
import { buildSharedContext } from '../src/context/shared.js';
import type { FoundryConfig, DomainsConfig } from '../src/types/index.js';

let tempDir: string;

function makeConfig(overrides: Partial<FoundryConfig['context']> = {}): FoundryConfig {
  return {
    foundry: { name: 'Test Foundry', version: '0.1.0' },
    iteration: { max_idea_retries: 3, max_revision_rounds: 2, max_test_fix_cycles: 2, curator_interval: 15, domain_cooldown: 10, novelty_window: 20 },
    projects: { max_active: 2, max_iterations_per_project: 12, allow_standalone_interrupts: true },
    stimuli: { enabled: true, stimuli_ttl: 30, skills_per_context: 2, mcp_timeout_seconds: 30 },
    context: { journal_compressed_max_tokens: 4000, portfolio_index_max_entries: 30, critic_review_history: 8, critic_gate1_history: 5, ...overrides },
    intervention: { requests_file: 'requests.md', stop_file: 'STOP' },
    logging: { log_all_prompts: true, log_token_usage: true, log_decisions: true, log_test_reports: true },
    recovery: { checkpoint_every: 1, resume_on_crash: true },
    loop: { cooldown_seconds: 2, disk_space_min_gb: 1 },
  };
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-test-'));
  setRootDir(tempDir);
  mkdirSync(path.join(tempDir, 'portfolio', 'projects'), { recursive: true });
  mkdirSync(path.join(tempDir, 'identity'), { recursive: true });
  mkdirSync(path.join(tempDir, 'logs'), { recursive: true });
  mkdirSync(path.join(tempDir, 'stimuli', 'skills'), { recursive: true });
  mkdirSync(path.join(tempDir, 'stimuli', 'live'), { recursive: true });
  mkdirSync(path.join(tempDir, 'config'), { recursive: true });
});
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

describe('buildSharedContext', () => {
  it('includes manifesto content', async () => {
    writeFileSync(path.join(tempDir, 'identity', 'manifesto.md'), '# Test Manifesto\nWe build.');
    const domainsYml: DomainsConfig = { domains: [{ name: 'fiction', description: 'Stories', weight: 1.0 }] };
    writeFileSync(path.join(tempDir, 'config', 'domains.yml'), yaml.stringify(domainsYml));
    const result = await buildSharedContext(makeConfig());
    expect(result).toContain('Test Manifesto');
    expect(result).toContain('We build.');
  });

  it('shows placeholder when manifesto missing', async () => {
    const domainsYml: DomainsConfig = { domains: [] };
    writeFileSync(path.join(tempDir, 'config', 'domains.yml'), yaml.stringify(domainsYml));
    const result = await buildSharedContext(makeConfig());
    expect(result).toContain('*Manifesto not yet written.*');
  });

  it('includes journal-compressed content', async () => {
    writeFileSync(path.join(tempDir, 'identity', 'journal-compressed.md'), 'Journal entry 1');
    const domainsYml: DomainsConfig = { domains: [] };
    writeFileSync(path.join(tempDir, 'config', 'domains.yml'), yaml.stringify(domainsYml));
    const result = await buildSharedContext(makeConfig());
    expect(result).toContain('Journal entry 1');
  });

  it('shows journal placeholder when empty', async () => {
    const domainsYml: DomainsConfig = { domains: [] };
    writeFileSync(path.join(tempDir, 'config', 'domains.yml'), yaml.stringify(domainsYml));
    const result = await buildSharedContext(makeConfig());
    expect(result).toContain('*No journal entries yet.*');
  });

  it('includes portfolio index', async () => {
    const portfolioIndex = [
      '| ID | Title | Domain | Rating | Date | Project |',
      '|---|---|---|---|---|---|',
      '| 0001 | Test Story | fiction | 7.5 | 2026-01-01 | — |',
    ].join('\n');
    writeFileSync(path.join(tempDir, 'portfolio', 'index.md'), portfolioIndex);
    const domainsYml: DomainsConfig = { domains: [] };
    writeFileSync(path.join(tempDir, 'config', 'domains.yml'), yaml.stringify(domainsYml));
    const result = await buildSharedContext(makeConfig());
    expect(result).toContain('Test Story');
  });

  it('includes domain balance table', async () => {
    const domainsYml: DomainsConfig = {
      domains: [
        { name: 'fiction', description: 'Short stories', weight: 1.0 },
        { name: 'poetry', description: 'Poems', weight: 0.8 },
      ],
    };
    writeFileSync(path.join(tempDir, 'config', 'domains.yml'), yaml.stringify(domainsYml));
    const result = await buildSharedContext(makeConfig());
    expect(result).toContain('fiction');
    expect(result).toContain('poetry');
    expect(result).toContain('Domain');
  });

  it('handles missing domains config gracefully', async () => {
    // No domains.yml written
    const result = await buildSharedContext(makeConfig());
    expect(result).toContain('*Domain configuration not available.*');
  });

  it('includes projects index', async () => {
    writeFileSync(path.join(tempDir, 'portfolio', 'projects', 'index.md'), '# Projects\nSome projects here');
    const domainsYml: DomainsConfig = { domains: [] };
    writeFileSync(path.join(tempDir, 'config', 'domains.yml'), yaml.stringify(domainsYml));
    const result = await buildSharedContext(makeConfig());
    expect(result).toContain('Some projects here');
  });

  it('truncates long journal to token budget', async () => {
    // Create a very long journal that exceeds the token budget
    const longJournal = 'X'.repeat(200_000);
    writeFileSync(path.join(tempDir, 'identity', 'journal-compressed.md'), longJournal);
    const domainsYml: DomainsConfig = { domains: [] };
    writeFileSync(path.join(tempDir, 'config', 'domains.yml'), yaml.stringify(domainsYml));
    const result = await buildSharedContext(makeConfig({ journal_compressed_max_tokens: 100 }));
    // 100 tokens * 4 chars = 400 chars max; result should be much shorter than the input
    expect(result.length).toBeLessThan(longJournal.length);
  });

  it('triggers hard fallback for extremely small token budget with multiline journal', async () => {
    // Use token budget of 10 (40 chars). truncateToTokenBudget will produce ~79 chars (40 + suffix).
    // Hard fallback triggers when truncatedJournal.length > maxChars * 1.5 = 60 chars.
    // 79 > 60, so the hard fallback should kick in.
    // Each short line is ~5 chars so several lines fit within the 40-char budget, ensuring kept.unshift runs.
    const lines = Array.from({ length: 50 }, (_, i) => `L${i}`);
    writeFileSync(path.join(tempDir, 'identity', 'journal-compressed.md'), lines.join('\n'));
    const domainsYml: DomainsConfig = { domains: [] };
    writeFileSync(path.join(tempDir, 'config', 'domains.yml'), yaml.stringify(domainsYml));
    const result = await buildSharedContext(makeConfig({ journal_compressed_max_tokens: 10 }));
    expect(result).toContain('[...older entries compressed away]');
    // Some lines should be kept (the most recent ones)
    expect(result).toContain('L49');
  });

  it('selects relevant portfolio entries when too many', async () => {
    const header = '| ID | Title | Domain | Rating | Date | Project |\n|---|---|---|---|---|---|\n';
    const rows: string[] = [];
    for (let i = 1; i <= 50; i++) {
      const id = String(i).padStart(4, '0');
      rows.push(`| ${id} | Story ${id} | fiction | ${(i / 10).toFixed(1)} | 2026-01-${String(i).padStart(2, '0')} | — |`);
    }
    writeFileSync(path.join(tempDir, 'portfolio', 'index.md'), header + rows.join('\n'));
    const domainsYml: DomainsConfig = { domains: [] };
    writeFileSync(path.join(tempDir, 'config', 'domains.yml'), yaml.stringify(domainsYml));
    // Set max entries to 10 — should reduce the 50 rows
    const result = await buildSharedContext(makeConfig({ portfolio_index_max_entries: 10 }));
    const rowMatches = result.match(/\| \d{4} \|/g) ?? [];
    expect(rowMatches.length).toBeLessThanOrEqual(15); // generous upper bound accounting for active project entries
    expect(rowMatches.length).toBeGreaterThan(0);
  });

  it('keeps active project artifacts in portfolio selection', async () => {
    const header = '| ID | Title | Domain | Rating | Date | Project |\n|---|---|---|---|---|---|\n';
    const rows: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const id = String(i).padStart(4, '0');
      const project = i === 5 ? 'P001' : '—';
      rows.push(`| ${id} | Story ${id} | fiction | 3.0 | 2026-01-01 | ${project} |`);
    }
    writeFileSync(path.join(tempDir, 'portfolio', 'index.md'), header + rows.join('\n'));
    const domainsYml: DomainsConfig = { domains: [] };
    writeFileSync(path.join(tempDir, 'config', 'domains.yml'), yaml.stringify(domainsYml));
    const result = await buildSharedContext(makeConfig({ portfolio_index_max_entries: 5 }), ['P001']);
    expect(result).toContain('Story 0005');
  });
});
