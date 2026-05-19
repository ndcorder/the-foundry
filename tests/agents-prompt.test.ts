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
});
