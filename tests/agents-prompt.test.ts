import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setRootDir } from '../src/root.js';

let tempDir: string;
beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-test-'));
  setRootDir(tempDir);
});
afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function writeValidPromptContracts(): Promise<void> {
  const { PROMPT_CONTRACTS } = await import('../src/agents/prompt.js');
  const baseDir = path.join(tempDir, 'prompts');
  for (const contract of PROMPT_CONTRACTS) {
    const filePath = path.join(baseDir, contract.relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    const content = contract.sections?.length
      ? `# ${contract.name}\n\n${contract.sections[0].requiredPlaceholders.map((placeholder) => `{${placeholder}}`).join('\n')}\n\n${contract.sections[0].marker}\n\n${contract.sections[1].requiredPlaceholders.map((placeholder) => `{${placeholder}}`).join('\n')}\n`
      : `# ${contract.name}\n\n${contract.requiredPlaceholders.map((placeholder) => `{${placeholder}}`).join('\n')}\n`;
    writeFileSync(
      filePath,
      content,
      'utf-8',
    );
  }
}

describe('agents/prompt', () => {
  describe('loadPrompt', () => {
    it('loads a prompt markdown file by role', async () => {
      const promptsDir = path.join(tempDir, 'prompts');
      mkdirSync(promptsDir, { recursive: true });
      writeFileSync(path.join(promptsDir, 'ideator.md'), '# Ideator Prompt\n\nYou are the Ideator.', 'utf-8');

      const { loadPrompt } = await import('../src/agents/prompt.js');
      const result = await loadPrompt('ideator');
      expect(result).toBe('# Ideator Prompt\n\nYou are the Ideator.');
    });

    it('throws when prompt file does not exist', async () => {
      const promptsDir = path.join(tempDir, 'prompts');
      mkdirSync(promptsDir, { recursive: true });

      const { loadPrompt } = await import('../src/agents/prompt.js');
      await expect(loadPrompt('nonexistent')).rejects.toThrow();
    });
  });

  describe('loadCriticGate1Prompt', () => {
    it('returns content before ## GATE 2 marker', async () => {
      const promptsDir = path.join(tempDir, 'prompts');
      mkdirSync(promptsDir, { recursive: true });
      writeFileSync(
        path.join(promptsDir, 'critic.md'),
        '# Critic\n\nGate 1 content here.\n\n## GATE 2\n\nGate 2 content here.',
        'utf-8',
      );

      const { loadCriticGate1Prompt } = await import('../src/agents/prompt.js');
      const result = await loadCriticGate1Prompt();
      expect(result).toBe('# Critic\n\nGate 1 content here.');
      expect(result).not.toContain('GATE 2');
    });

    it('returns full content when no ## GATE 2 marker exists', async () => {
      const promptsDir = path.join(tempDir, 'prompts');
      mkdirSync(promptsDir, { recursive: true });
      writeFileSync(
        path.join(promptsDir, 'critic.md'),
        '# Critic\n\nAll content, no gate 2 marker.',
        'utf-8',
      );

      const { loadCriticGate1Prompt } = await import('../src/agents/prompt.js');
      const result = await loadCriticGate1Prompt();
      expect(result).toBe('# Critic\n\nAll content, no gate 2 marker.');
    });
  });

  describe('loadCriticGate2Prompt', () => {
    it('returns content from ## GATE 2 onward', async () => {
      const promptsDir = path.join(tempDir, 'prompts');
      mkdirSync(promptsDir, { recursive: true });
      writeFileSync(
        path.join(promptsDir, 'critic.md'),
        '# Critic\n\nGate 1 content.\n\n## GATE 2\n\nGate 2 content here.',
        'utf-8',
      );

      const { loadCriticGate2Prompt } = await import('../src/agents/prompt.js');
      const result = await loadCriticGate2Prompt();
      expect(result).toBe('## GATE 2\n\nGate 2 content here.');
    });

    it('returns full content when no ## GATE 2 marker exists', async () => {
      const promptsDir = path.join(tempDir, 'prompts');
      mkdirSync(promptsDir, { recursive: true });
      writeFileSync(
        path.join(promptsDir, 'critic.md'),
        '# Critic\n\nAll content.',
        'utf-8',
      );

      const { loadCriticGate2Prompt } = await import('../src/agents/prompt.js');
      const result = await loadCriticGate2Prompt();
      expect(result).toBe('# Critic\n\nAll content.');
    });
  });

  describe('injectVars', () => {
    it('replaces single-brace placeholders', async () => {
      const { injectVars } = await import('../src/agents/prompt.js');
      const template = 'Hello {name}, your domain is {domain}.';
      const result = injectVars(template, { name: 'Foundry', domain: 'code' });
      expect(result).toBe('Hello Foundry, your domain is code.');
    });

    it('replaces all occurrences of a placeholder', async () => {
      const { injectVars } = await import('../src/agents/prompt.js');
      const template = '{x} and {x} again';
      const result = injectVars(template, { x: 'val' });
      expect(result).toBe('val and val again');
    });

    it('leaves unmatched placeholders untouched', async () => {
      const { injectVars } = await import('../src/agents/prompt.js');
      const template = '{known} and {unknown}';
      const result = injectVars(template, { known: 'yes' });
      expect(result).toBe('yes and {unknown}');
    });

    it('handles empty vars', async () => {
      const { injectVars } = await import('../src/agents/prompt.js');
      const template = 'no vars here';
      const result = injectVars(template, {});
      expect(result).toBe('no vars here');
    });
  });

  describe('validatePromptContracts', () => {
    it('accepts prompt files that satisfy the required placeholder contracts', async () => {
      await writeValidPromptContracts();

      const { validatePromptContracts } = await import('../src/agents/prompt.js');
      const report = await validatePromptContracts();

      expect(report.status).toBe('healthy');
      expect(report.summary).toEqual({
        total: report.files.length,
        ok: report.files.length,
        invalid: 0,
      });
      expect(report.files.every((file) => file.ok)).toBe(true);
      expect(report.files.map((file) => file.name)).toContain('prompts/creator/plan.md');
    });

    it('reports missing required placeholders and unknown placeholders', async () => {
      await writeValidPromptContracts();
      writeFileSync(
        path.join(tempDir, 'prompts', 'tester.md'),
        '# Tester\n\n{approved_proposal}\n{mystery_context}\n',
        'utf-8',
      );

      const { validatePromptContracts } = await import('../src/agents/prompt.js');
      const report = await validatePromptContracts();
      const tester = report.files.find((file) => file.name === 'prompts/tester.md');

      expect(report.status).toBe('invalid');
      expect(tester?.ok).toBe(false);
      expect(tester?.errors).toContain('missing required placeholders: artifact_content, critic_sharpening_notes');
      expect(tester?.errors).toContain('unknown placeholders: mystery_context');
      expect(tester?.diagnostics).toEqual(expect.arrayContaining([
        {
          code: 'missing_placeholder',
          message: 'missing required placeholders: artifact_content, critic_sharpening_notes',
          placeholders: ['artifact_content', 'critic_sharpening_notes'],
        },
        {
          code: 'unknown_placeholder',
          message: 'unknown placeholders: mystery_context',
          placeholders: ['mystery_context'],
        },
      ]));
    });

    it('reports missing or blank prompt files', async () => {
      await writeValidPromptContracts();
      rmSync(path.join(tempDir, 'prompts', 'refinery.md'));
      writeFileSync(path.join(tempDir, 'prompts', 'creator', 'polish.md'), '   \n', 'utf-8');

      const { validatePromptContracts } = await import('../src/agents/prompt.js');
      const report = await validatePromptContracts();

      expect(report.status).toBe('invalid');
      expect(report.summary).toEqual({
        total: report.files.length,
        ok: report.files.length - 2,
        invalid: 2,
      });
      expect(report.files.find((file) => file.name === 'prompts/refinery.md')?.errors).toEqual([
        'missing prompt file',
      ]);
      expect(report.files.find((file) => file.name === 'prompts/refinery.md')?.diagnostics).toEqual([
        { code: 'missing_file', message: 'missing prompt file' },
      ]);
      expect(report.files.find((file) => file.name === 'prompts/creator/polish.md')?.errors).toEqual([
        'prompt file is blank',
      ]);
      expect(report.files.find((file) => file.name === 'prompts/creator/polish.md')?.diagnostics).toEqual([
        { code: 'blank_file', message: 'prompt file is blank' },
      ]);
    });

    it('reports critic prompt files without the Gate 2 section marker', async () => {
      await writeValidPromptContracts();
      writeFileSync(
        path.join(tempDir, 'prompts', 'critic.md'),
        [
          '# Critic',
          '{shared_context}',
          '{ideator_proposals}',
          '{critic_gate1_history}',
          '{complexity_distribution}',
          '{critic_review_history}',
          '{artifact_content}',
          '{approved_proposal}',
          '{tester_report}',
        ].join('\n'),
        'utf-8',
      );

      const { validatePromptContracts } = await import('../src/agents/prompt.js');
      const report = await validatePromptContracts();
      const critic = report.files.find((file) => file.name === 'prompts/critic.md');

      expect(report.status).toBe('invalid');
      expect(critic?.ok).toBe(false);
      expect(critic?.errors).toContain('missing required section marker for Critic Gate 1: ## GATE 2');
      expect(critic?.errors).toContain('missing required section marker for Critic Gate 2: ## GATE 2');
      expect(critic?.diagnostics).toEqual(expect.arrayContaining([
        {
          code: 'missing_section_marker',
          message: 'missing required section marker for Critic Gate 1: ## GATE 2',
          section: 'Critic Gate 1',
          marker: '## GATE 2',
        },
        {
          code: 'missing_section_marker',
          message: 'missing required section marker for Critic Gate 2: ## GATE 2',
          section: 'Critic Gate 2',
          marker: '## GATE 2',
        },
      ]));
    });

    it('reports duplicate critic split markers before ambiguous gate parsing reaches runtime', async () => {
      await writeValidPromptContracts();
      writeFileSync(
        path.join(tempDir, 'prompts', 'critic.md'),
        [
          '# Critic',
          '{shared_context}',
          '{ideator_proposals}',
          '{critic_gate1_history}',
          '{complexity_distribution}',
          '',
          '## GATE 2',
          '{shared_context}',
          '{critic_review_history}',
          '{artifact_content}',
          '{approved_proposal}',
          '{tester_report}',
          '',
          '## GATE 2',
          'accidental duplicate split marker',
        ].join('\n'),
        'utf-8',
      );

      const { validatePromptContracts } = await import('../src/agents/prompt.js');
      const report = await validatePromptContracts();
      const critic = report.files.find((file) => file.name === 'prompts/critic.md');

      expect(report.status).toBe('invalid');
      expect(critic?.ok).toBe(false);
      expect(critic?.errors).toContain('duplicate section marker appears 2 times: ## GATE 2');
      expect(critic?.diagnostics).toEqual(expect.arrayContaining([
        {
          code: 'duplicate_section_marker',
          message: 'duplicate section marker appears 2 times: ## GATE 2',
          marker: '## GATE 2',
        },
      ]));
    });

    it('reports placeholders placed in the wrong critic gate section', async () => {
      await writeValidPromptContracts();
      writeFileSync(
        path.join(tempDir, 'prompts', 'critic.md'),
        [
          '# Critic',
          '{shared_context}',
          '{ideator_proposals}',
          '{critic_gate1_history}',
          '{complexity_distribution}',
          '{artifact_content}',
          '',
          '## GATE 2',
          '{shared_context}',
          '{critic_review_history}',
          '{approved_proposal}',
          '{tester_report}',
        ].join('\n'),
        'utf-8',
      );

      const { validatePromptContracts } = await import('../src/agents/prompt.js');
      const report = await validatePromptContracts();
      const critic = report.files.find((file) => file.name === 'prompts/critic.md');

      expect(report.status).toBe('invalid');
      expect(critic?.ok).toBe(false);
      expect(critic?.errors).toContain('Critic Gate 1 unknown placeholders: artifact_content');
      expect(critic?.errors).toContain('Critic Gate 2 missing required placeholders: artifact_content');
      expect(critic?.diagnostics).toEqual(expect.arrayContaining([
        {
          code: 'unknown_placeholder',
          message: 'Critic Gate 1 unknown placeholders: artifact_content',
          section: 'Critic Gate 1',
          placeholders: ['artifact_content'],
        },
        {
          code: 'missing_placeholder',
          message: 'Critic Gate 2 missing required placeholders: artifact_content',
          section: 'Critic Gate 2',
          placeholders: ['artifact_content'],
        },
      ]));
    });
  });
});
