import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { setRootDir } from '../src/root.js';
import {
  buildIdeatorContext,
  buildCreatorContext,
  buildTesterContext,
  buildCriticGate1Context,
  buildCriticGate2Context,
  buildCuratorContext,
} from '../src/context/agent-context.js';
import type { FoundryConfig, DecisionLogEntry, TestReportEntry, DomainsConfig } from '../src/types/index.js';

let tempDir: string;

function makeConfig(overrides: Partial<FoundryConfig['context']> = {}): FoundryConfig {
  return {
    foundry: { name: 'Test', version: '0.1.0' },
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

function makeDecision(gate: 'gate1' | 'gate2', title: string): DecisionLogEntry {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    iteration: 1,
    gate,
    agent: 'critic',
    decision: 'approve',
    proposal_title: title,
  };
}

function makeTestReport(id: string): TestReportEntry {
  return {
    timestamp: '2026-01-01T00:00:00Z',
    iteration: 1,
    artifact_id: id,
    outcome: 'pass',
    summary: 'Tests passed',
    tests_run: 3,
    tests_passed: 3,
    tests_failed: 0,
  };
}

function seedDirs() {
  mkdirSync(path.join(tempDir, 'portfolio', 'projects'), { recursive: true });
  mkdirSync(path.join(tempDir, 'identity'), { recursive: true });
  mkdirSync(path.join(tempDir, 'logs'), { recursive: true });
  mkdirSync(path.join(tempDir, 'stimuli', 'skills'), { recursive: true });
  mkdirSync(path.join(tempDir, 'stimuli', 'live'), { recursive: true });
  mkdirSync(path.join(tempDir, 'config'), { recursive: true });
  const domainsYml: DomainsConfig = { domains: [{ name: 'fiction', description: 'Stories', weight: 1.0 }] };
  writeFileSync(path.join(tempDir, 'config', 'domains.yml'), yaml.stringify(domainsYml));
}

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-test-'));
  setRootDir(tempDir);
  seedDirs();
});
afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

describe('buildIdeatorContext', () => {
  it('returns a ContextBlock with shared + agent-specific', async () => {
    const config = makeConfig();
    const shared = '## Shared context';
    const block = await buildIdeatorContext(shared, config);
    expect(block.shared).toBe(shared);
    expect(block.full).toContain(shared);
    expect(block.agentSpecific).toContain('Gate 1 Decisions');
  });

  it('includes decisions filtered to gate1', async () => {
    const decisions = [
      makeDecision('gate1', 'Approved Idea'),
      makeDecision('gate2', 'Shipped Artifact'),
    ];
    writeFileSync(
      path.join(tempDir, 'logs', 'decisions.jsonl'),
      decisions.map(d => JSON.stringify(d)).join('\n') + '\n',
    );
    const block = await buildIdeatorContext('shared', makeConfig());
    expect(block.agentSpecific).toContain('Approved Idea');
    // gate2 decisions should NOT appear in ideator gate1 section
  });

  it('includes active projects summary', async () => {
    const projDir = path.join(tempDir, 'portfolio', 'projects', 'P001-test-proj');
    mkdirSync(projDir, { recursive: true });
    writeFileSync(path.join(projDir, 'status.yml'), yaml.stringify({
      project_id: 'P001',
      name: 'Test Project',
      status: 'active',
      estimated_iterations: 5,
      completed_iterations: 2,
      last_iteration: 10,
      created_at: '2026-01-01T00:00:00Z',
    }));
    const block = await buildIdeatorContext('shared', makeConfig());
    expect(block.agentSpecific).toContain('Test Project');
    expect(block.agentSpecific).toContain('2/5');
    expect(block.agentSpecific).toContain('Project slots: 1/2 active');
    expect(block.agentSpecific).toContain('Starter slots available');
  });

  it('warns ideator when active projects are at capacity', async () => {
    for (const id of ['P001', 'P002']) {
      const projDir = path.join(tempDir, 'portfolio', 'projects', `${id}-test-proj`);
      mkdirSync(projDir, { recursive: true });
      writeFileSync(path.join(projDir, 'status.yml'), yaml.stringify({
        project_id: id,
        name: `Test Project ${id}`,
        status: 'active',
        estimated_iterations: 5,
        completed_iterations: 2,
        last_iteration: 10,
        created_at: '2026-01-01T00:00:00Z',
      }));
    }

    const block = await buildIdeatorContext('shared', makeConfig());
    expect(block.agentSpecific).toContain('Project slots: 2/2 active');
    expect(block.agentSpecific).toContain('At capacity; do not propose new project starters');
  });

  it('includes curator recommendations when present', async () => {
    writeFileSync(path.join(tempDir, 'curator-recommendations.md'), 'Try more poetry.');
    const block = await buildIdeatorContext('shared', makeConfig());
    expect(block.agentSpecific).toContain('Try more poetry.');
    expect(block.agentSpecific).toContain('Curator');
  });

  it('includes live stimuli', async () => {
    writeFileSync(path.join(tempDir, 'stimuli', 'live', 'news.md'), 'Breaking news content');
    const block = await buildIdeatorContext('shared', makeConfig());
    expect(block.agentSpecific).toContain('Breaking news content');
  });

  it('includes skill files', async () => {
    writeFileSync(path.join(tempDir, 'stimuli', 'skills', 'writing.md'), 'Writing skill guide');
    const block = await buildIdeatorContext('shared', makeConfig());
    expect(block.agentSpecific).toContain('Writing skill guide');
  });

  it('includes hot streak guidance when streak state is active', async () => {
    writeFileSync(path.join(tempDir, 'identity', 'streaks.yml'), yaml.stringify({
      current: {
        active: true,
        length: 2,
        domain: 'fiction',
        avg_rating: 3.9,
        start_iteration: 10,
        last_iteration: 11,
        artifact_ids: ['0010', '0011'],
        project_id: null,
      },
      recent_breaks: [],
      cooldown_domains: [],
      cooldown_remaining: 0,
    }));

    const block = await buildIdeatorContext('shared', makeConfig());
    expect(block.agentSpecific).toContain('Hot Streak');
    expect(block.agentSpecific).toContain('2-iteration hot streak in fiction');
  });

  it('includes complexity guidance when yield bias is actionable', async () => {
    writeFileSync(path.join(tempDir, 'identity', 'complexity-bias.yml'), yaml.stringify({
      updated_at: '2026-01-01T00:00:00Z',
      updated_iteration: 12,
      yields: [
        { tier: 'S', shipped_count: 3, mean_rating: 3.4, mean_token_cost: 4000, roi: 0.85 },
        { tier: 'M', shipped_count: 3, mean_rating: 4.0, mean_token_cost: 12000, roi: 0.33 },
      ],
      recommendation: {
        favor: 'S',
        avoid: ['M'],
        confidence: 'medium',
        reason: 'S is currently more efficient.',
      },
    }));

    const block = await buildIdeatorContext('shared', makeConfig());
    expect(block.agentSpecific).toContain('Complexity Guidance');
    expect(block.agentSpecific).toContain('Lean toward S-tier');
    expect(block.agentSpecific).toContain('Avoid M-tier');
  });

  it('includes stoker directives when present', async () => {
    writeFileSync(path.join(tempDir, 'identity', 'stoker-directive.yml'), yaml.stringify({
      generated_at: '2026-01-01T00:00:00Z',
      generated_iteration: 12,
      for_iteration: 13,
      urgency: 'high',
      ideator_hint: 'Take a deliberate risk in fiction.',
      complexity_override: 'L',
      streak_instruction: 'neutral',
      domain_pressure: { toward: ['fiction'], away_from: ['code-tool'] },
      rules_fired: ['running_cold'],
    }));

    const block = await buildIdeatorContext('shared', makeConfig());
    expect(block.agentSpecific).toContain('Stoker Directive');
    expect(block.agentSpecific).toContain('Take a deliberate risk in fiction.');
    expect(block.agentSpecific).toContain('Prefer L-tier');
    expect(block.agentSpecific).toContain('Avoid code-tool');
  });

  it('suppresses consumed stoker directives based on the iteration log', async () => {
    writeFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), JSON.stringify({
      iteration: 13,
      outcome: 'shipped',
      title: 'Previous Work',
    }) + '\n');
    writeFileSync(path.join(tempDir, 'identity', 'stoker-directive.yml'), yaml.stringify({
      generated_at: '2026-01-01T00:00:00Z',
      generated_iteration: 12,
      for_iteration: 13,
      urgency: 'high',
      ideator_hint: 'This directive has already been consumed.',
      streak_instruction: 'neutral',
      rules_fired: ['running_cold'],
    }));

    const block = await buildIdeatorContext('shared', makeConfig());
    expect(block.agentSpecific).not.toContain('Stoker Directive');
    expect(block.agentSpecific).not.toContain('already been consumed');
  });

  it('includes salvaged speculative ideas when present', async () => {
    mkdirSync(path.join(tempDir, 'workspace'), { recursive: true });
    writeFileSync(path.join(tempDir, 'workspace', 'speculative.yml'), yaml.stringify({
      updated_at: '2026-01-01T00:00:00Z',
      ideas: [
        {
          proposal: {
            title: 'Salvaged Clock',
            domain: 'prose',
            pitch: 'A clock that files complaints about time.',
            complexity: 'M',
            why: 'It gives the portfolio a sharper surreal object.',
            project_id: null,
            stimulus_ref: null,
          },
          critic_evaluation: {
            decision: 'revise',
            reasons: 'Good kernel but too vague.',
            sharpening_notes: 'Make the bureaucracy concrete.',
          },
          iteration: 12,
          salvageable: true,
        },
      ],
    }));

    const block = await buildIdeatorContext('shared', makeConfig());
    expect(block.agentSpecific).toContain('Salvaged Ideas from Last Iteration');
    expect(block.agentSpecific).toContain('Salvaged Clock');
    expect(block.agentSpecific).toContain('Make the bureaucracy concrete.');
  });

  it('labels speculative ideas as fast-track options after a killed iteration', async () => {
    mkdirSync(path.join(tempDir, 'workspace'), { recursive: true });
    writeFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), JSON.stringify({
      iteration: 12,
      outcome: 'killed',
      title: 'Killed Work',
    }) + '\n');
    writeFileSync(path.join(tempDir, 'workspace', 'speculative.yml'), yaml.stringify({
      updated_at: '2026-01-01T00:00:00Z',
      ideas: [
        {
          proposal: {
            title: 'Fast Clock',
            domain: 'prose',
            pitch: 'A clock that files complaints about time.',
            complexity: 'M',
            why: 'It gives the next run a pre-warmed option.',
            project_id: null,
            stimulus_ref: null,
          },
          critic_evaluation: {
            decision: 'approve',
            reasons: 'Approved but not selected.',
            sharpening_notes: 'Build it next.',
          },
          iteration: 12,
          salvageable: true,
        },
      ],
    }));

    const block = await buildIdeatorContext('shared', makeConfig());
    expect(block.agentSpecific).toContain('Fast-Track Options');
    expect(block.agentSpecific).toContain('Strongly consider refining');
  });

  it('suppresses speculative ideas older than the previous iteration', async () => {
    mkdirSync(path.join(tempDir, 'workspace'), { recursive: true });
    writeFileSync(path.join(tempDir, 'logs', 'iterations.jsonl'), JSON.stringify({
      iteration: 14,
      outcome: 'shipped',
      title: 'Newer Work',
    }) + '\n');
    writeFileSync(path.join(tempDir, 'workspace', 'speculative.yml'), yaml.stringify({
      updated_at: '2026-01-01T00:00:00Z',
      ideas: [
        {
          proposal: {
            title: 'Old Clock',
            domain: 'prose',
            pitch: 'A stale warmed option from two rounds back.',
            complexity: 'M',
            why: 'It should no longer be injected.',
            project_id: null,
            stimulus_ref: null,
          },
          critic_evaluation: {
            decision: 'revise',
            reasons: 'Good kernel but old.',
            sharpening_notes: 'This note should be hidden.',
          },
          iteration: 12,
          salvageable: true,
        },
      ],
    }));

    const block = await buildIdeatorContext('shared', makeConfig());
    expect(block.agentSpecific).not.toContain('Old Clock');
    expect(block.agentSpecific).not.toContain('This note should be hidden');
  });
});

describe('buildCreatorContext', () => {
  it('includes proposal and reviews', async () => {
    const decisions = [makeDecision('gate2', 'Previous Review')];
    writeFileSync(
      path.join(tempDir, 'logs', 'decisions.jsonl'),
      decisions.map(d => JSON.stringify(d)).join('\n') + '\n',
    );
    const block = await buildCreatorContext('shared', makeConfig(), 'Build a CLI tool');
    expect(block.agentSpecific).toContain('Build a CLI tool');
    expect(block.agentSpecific).toContain('Previous Review');
  });

  it('includes test reports', async () => {
    const reports = [makeTestReport('0042')];
    writeFileSync(
      path.join(tempDir, 'logs', 'test-reports.jsonl'),
      reports.map(r => JSON.stringify(r)).join('\n') + '\n',
    );
    const block = await buildCreatorContext('shared', makeConfig(), 'proposal');
    expect(block.agentSpecific).toContain('0042');
  });

  it('includes project context when provided', async () => {
    const block = await buildCreatorContext('shared', makeConfig(), 'proposal', 'Project context here');
    expect(block.agentSpecific).toContain('Project context here');
    expect(block.agentSpecific).toContain('Project Context');
  });

  it('omits project context section when not provided', async () => {
    const block = await buildCreatorContext('shared', makeConfig(), 'proposal');
    expect(block.agentSpecific).not.toContain('Project Context');
  });

  it('includes creator streak context when streak state is active', async () => {
    writeFileSync(path.join(tempDir, 'identity', 'streaks.yml'), yaml.stringify({
      current: {
        active: true,
        length: 3,
        domain: 'code',
        avg_rating: 4.1,
        start_iteration: 7,
        last_iteration: 9,
        artifact_ids: ['0007', '0008', '0009'],
        project_id: null,
      },
      recent_breaks: [],
      cooldown_domains: [],
      cooldown_remaining: 0,
    }));

    const block = await buildCreatorContext('shared', makeConfig(), 'proposal');
    expect(block.agentSpecific).toContain('Streak Context');
    expect(block.agentSpecific).toContain('4.1');
  });
});

describe('buildTesterContext', () => {
  it('builds context without shared section', () => {
    const block = buildTesterContext('proposal text', 'critic notes', 'artifact code');
    expect(block.shared).toBe('');
    expect(block.agentSpecific).toContain('proposal text');
    expect(block.agentSpecific).toContain('critic notes');
    expect(block.agentSpecific).toContain('artifact code');
    expect(block.full).toBe(block.agentSpecific);
  });

  it('shows placeholder when no critic notes', () => {
    const block = buildTesterContext('proposal', '', 'artifact');
    expect(block.agentSpecific).toContain('*No sharpening notes provided.*');
  });
});

describe('buildCriticGate1Context', () => {
  it('includes gate1 history and proposals', async () => {
    const decisions = [makeDecision('gate1', 'Old Gate1')];
    writeFileSync(
      path.join(tempDir, 'logs', 'decisions.jsonl'),
      decisions.map(d => JSON.stringify(d)).join('\n') + '\n',
    );
    const block = await buildCriticGate1Context('shared', makeConfig(), 'Proposals to evaluate');
    expect(block.agentSpecific).toContain('Old Gate1');
    expect(block.agentSpecific).toContain('Proposals to evaluate');
    expect(block.shared).toBe('shared');
  });
});

describe('buildCriticGate2Context', () => {
  it('includes gate2 history, artifact, proposal, and tester report', async () => {
    const decisions = [makeDecision('gate2', 'Prev Review')];
    writeFileSync(
      path.join(tempDir, 'logs', 'decisions.jsonl'),
      decisions.map(d => JSON.stringify(d)).join('\n') + '\n',
    );
    const block = await buildCriticGate2Context('shared', makeConfig(), 'artifact content', 'proposal', 'tester report');
    expect(block.agentSpecific).toContain('Prev Review');
    expect(block.agentSpecific).toContain('artifact content');
    expect(block.agentSpecific).toContain('proposal');
    expect(block.agentSpecific).toContain('tester report');
  });

  it('shows placeholder when no tester report', async () => {
    const block = await buildCriticGate2Context('shared', makeConfig(), 'artifact', 'proposal', '');
    expect(block.agentSpecific).toContain('*No tester report (non-code artifact).*');
  });
});

describe('buildCuratorContext', () => {
  it('assembles full curator context with all sections', async () => {
    writeFileSync(path.join(tempDir, 'identity', 'manifesto.md'), 'Manifesto content');
    writeFileSync(path.join(tempDir, 'identity', 'journal.md'), 'Full journal');
    writeFileSync(path.join(tempDir, 'identity', 'journal-compressed.md'), 'Compressed journal');
    const decisions = [makeDecision('gate2', 'Recent Decision')];
    writeFileSync(
      path.join(tempDir, 'logs', 'decisions.jsonl'),
      decisions.map(d => JSON.stringify(d)).join('\n') + '\n',
    );
    writeFileSync(path.join(tempDir, 'stimuli', 'live', 'news.md'), 'News content');
    writeFileSync(path.join(tempDir, 'requests.md'), 'User request: more poetry');
    writeFileSync(path.join(tempDir, 'portfolio', 'projects', 'index.md'), 'Projects index content');

    const config = makeConfig();
    const block = await buildCuratorContext(config);
    expect(block.agentSpecific).toContain('Full journal');
    expect(block.agentSpecific).toContain('Recent Decision');
    expect(block.agentSpecific).toContain('News content');
    expect(block.agentSpecific).toContain('User request: more poetry');
    expect(block.agentSpecific).toContain('Projects index content');
    expect(block.shared).toContain('Manifesto content');
  });

  it('shows placeholders when files are missing', async () => {
    const config = makeConfig();
    const block = await buildCuratorContext(config);
    expect(block.agentSpecific).toContain('*No journal entries yet.*');
    expect(block.agentSpecific).toContain('*No pending requests.*');
    expect(block.agentSpecific).toContain('*No active projects.*');
  });
});
