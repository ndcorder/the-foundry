import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setRootDir } from '../src/root.js';
import { loadConfig, loadModelsConfig, loadDomainsConfig } from '../src/context/config.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'foundry-test-'));
  setRootDir(tempDir);
  mkdirSync(path.join(tempDir, 'config'), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const FOUNDRY_YML = `
foundry:
  name: "Test Foundry"
  version: "0.1.0"

iteration:
  max_idea_retries: 3
  max_revision_rounds: 2
  max_test_fix_cycles: 2
  curator_interval: 15
  domain_cooldown: 10
  novelty_window: 20

projects:
  max_active: 2
  max_iterations_per_project: 12
  allow_standalone_interrupts: true

stimuli:
  enabled: false
  stimuli_ttl: 30
  skills_per_context: 2
  mcp_timeout_seconds: 30

context:
  journal_compressed_max_tokens: 4000
  portfolio_index_max_entries: 30
  critic_review_history: 8
  critic_gate1_history: 5

intervention:
  requests_file: "requests.md"
  stop_file: "STOP"

logging:
  log_all_prompts: true
  log_token_usage: true
  log_decisions: true
  log_test_reports: true

recovery:
  checkpoint_every: 1
  resume_on_crash: true

loop:
  cooldown_seconds: 2
  disk_space_min_gb: 1
`;

const MODELS_YML = `
agents:
  ideator:
    model: "glm-5.1"
    temperature: 0.9
    max_tokens: 4096
  creator:
    model: "glm-5.1"
    temperature: 0.7
    max_tokens: 16384
  tester:
    model: "glm-5.1"
    temperature: 0.2
    max_tokens: 8192
  critic:
    model: "glm-5.1"
    temperature: 0.3
    max_tokens: 4096
  curator:
    model: "glm-5.1"
    temperature: 0.5
    max_tokens: 8192
`;

const DOMAINS_YML = `
domains:
  - name: fiction
    description: "Short stories"
    weight: 1.0
  - name: poetry
    description: "Poems"
    weight: 0.8
`;

describe('config', () => {
  describe('loadConfig', () => {
    it('parses foundry.yml correctly', async () => {
      writeFileSync(path.join(tempDir, 'config', 'foundry.yml'), FOUNDRY_YML, 'utf-8');
      const config = await loadConfig();
      expect(config.foundry.name).toBe('Test Foundry');
      expect(config.foundry.version).toBe('0.1.0');
      expect(config.iteration.max_idea_retries).toBe(3);
      expect(config.intervention.stop_file).toBe('STOP');
      expect(config.loop.cooldown_seconds).toBe(2);
    });

    it('throws when foundry.yml does not exist', async () => {
      await expect(loadConfig()).rejects.toThrow();
    });

    it('throws on invalid YAML', async () => {
      writeFileSync(path.join(tempDir, 'config', 'foundry.yml'), ':\n  : :\n  - [invalid', 'utf-8');
      await expect(loadConfig()).rejects.toThrow();
    });

    it('throws with clear message when required section is missing', async () => {
      const incomplete = `
foundry:
  name: "Test"
  version: "0.1.0"
iteration:
  max_idea_retries: 3
`;
      writeFileSync(path.join(tempDir, 'config', 'foundry.yml'), incomplete, 'utf-8');
      await expect(loadConfig()).rejects.toThrow("Missing 'context' section");
    });
  });

  describe('loadModelsConfig', () => {
    it('parses models.yml correctly', async () => {
      writeFileSync(path.join(tempDir, 'config', 'models.yml'), MODELS_YML, 'utf-8');
      const models = await loadModelsConfig();
      expect(models.agents.ideator.model).toBe('glm-5.1');
      expect(models.agents.ideator.temperature).toBe(0.9);
      expect(models.agents.creator.max_tokens).toBe(16384);
      expect(models.agents.tester.temperature).toBe(0.2);
    });

    it('throws when models.yml does not exist', async () => {
      await expect(loadModelsConfig()).rejects.toThrow();
    });
  });

  describe('loadDomainsConfig', () => {
    it('parses domains.yml correctly', async () => {
      writeFileSync(path.join(tempDir, 'config', 'domains.yml'), DOMAINS_YML, 'utf-8');
      const domains = await loadDomainsConfig();
      expect(domains.domains).toHaveLength(2);
      expect(domains.domains[0].name).toBe('fiction');
      expect(domains.domains[0].weight).toBe(1.0);
      expect(domains.domains[1].name).toBe('poetry');
    });

    it('throws when domains.yml does not exist', async () => {
      await expect(loadDomainsConfig()).rejects.toThrow();
    });
  });
});
