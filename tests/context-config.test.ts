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

    it('throws with clear message when projects section is missing', async () => {
      const missingProjects = FOUNDRY_YML.replace(`
projects:
  max_active: 2
  max_iterations_per_project: 12
  allow_standalone_interrupts: true
`, '');
      writeFileSync(path.join(tempDir, 'config', 'foundry.yml'), missingProjects, 'utf-8');

      await expect(loadConfig()).rejects.toThrow("Missing 'projects' section");
    });

    it('throws with clear message when an iteration limit is invalid', async () => {
      writeFileSync(path.join(tempDir, 'config', 'foundry.yml'), FOUNDRY_YML.replace(
        'max_idea_retries: 3',
        'max_idea_retries: 0',
      ), 'utf-8');

      await expect(loadConfig()).rejects.toThrow(
        "Invalid 'iteration.max_idea_retries': expected number >= 1",
      );
    });

    it('throws with clear message when an iteration count is fractional', async () => {
      writeFileSync(path.join(tempDir, 'config', 'foundry.yml'), FOUNDRY_YML.replace(
        'max_idea_retries: 3',
        'max_idea_retries: 2.5',
      ), 'utf-8');

      await expect(loadConfig()).rejects.toThrow(
        "Invalid 'iteration.max_idea_retries': expected integer >= 1",
      );
    });

    it('throws with clear message when a context history window is invalid', async () => {
      writeFileSync(path.join(tempDir, 'config', 'foundry.yml'), FOUNDRY_YML.replace(
        'critic_gate1_history: 5',
        'critic_gate1_history: 0',
      ), 'utf-8');

      await expect(loadConfig()).rejects.toThrow(
        "Invalid 'context.critic_gate1_history': expected number >= 1",
      );
    });

    it('throws with clear message when a logging flag is invalid', async () => {
      writeFileSync(path.join(tempDir, 'config', 'foundry.yml'), FOUNDRY_YML.replace(
        'log_token_usage: true',
        'log_token_usage: sometimes',
      ), 'utf-8');

      await expect(loadConfig()).rejects.toThrow(
        "Invalid 'logging.log_token_usage': expected boolean",
      );
    });

    it('throws with clear message when a complexity profile token ceiling is invalid', async () => {
      writeFileSync(path.join(tempDir, 'config', 'foundry.yml'), FOUNDRY_YML.replace(
        '  novelty_window: 20',
        `  novelty_window: 20
  complexity_profiles:
    XL:
      max_tokens_per_phase: 0
      budget_warning_threshold: 800000`,
      ), 'utf-8');

      await expect(loadConfig()).rejects.toThrow(
        "Invalid 'iteration.complexity_profiles.XL.max_tokens_per_phase': expected number >= 1",
      );
    });

    it('throws with clear message when a refinery queue size is fractional', async () => {
      writeFileSync(path.join(tempDir, 'config', 'foundry.yml'), `${FOUNDRY_YML}
refinery:
  enabled: true
  min_iterations_between_runs: 5
  max_refinery_queue: 1.5
`, 'utf-8');

      await expect(loadConfig()).rejects.toThrow(
        "Invalid 'refinery.max_refinery_queue': expected integer >= 0",
      );
    });

    it('throws with clear message when stoker token heat window is invalid', async () => {
      writeFileSync(path.join(tempDir, 'config', 'foundry.yml'), `${FOUNDRY_YML}
stoker:
  enabled: true
  run_interval: 5
  refinery_token_heat_window: 0
  refinery_token_heat_threshold: 200000
`, 'utf-8');

      await expect(loadConfig()).rejects.toThrow(
        "Invalid 'stoker.refinery_token_heat_window': expected number >= 1",
      );
    });

    it('throws with clear message when monitor active warning window is invalid', async () => {
      writeFileSync(path.join(tempDir, 'config', 'foundry.yml'), `${FOUNDRY_YML}
monitor:
  active_warning_window: soon
`, 'utf-8');

      await expect(loadConfig()).rejects.toThrow(
        "Invalid 'monitor.active_warning_window': expected number >= 0",
      );
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

    it('throws with clear message when a required model agent is missing', async () => {
      writeFileSync(path.join(tempDir, 'config', 'models.yml'), `
agents:
  ideator:
    model: "glm-5.1"
    temperature: 0.9
    max_tokens: 4096
`, 'utf-8');

      await expect(loadModelsConfig()).rejects.toThrow("Missing 'models.agents.creator' section");
    });

    it('throws with clear message when model max_tokens is invalid', async () => {
      writeFileSync(path.join(tempDir, 'config', 'models.yml'), MODELS_YML.replace(
        'max_tokens: 16384',
        'max_tokens: 0',
      ), 'utf-8');

      await expect(loadModelsConfig()).rejects.toThrow(
        "Invalid 'models.agents.creator.max_tokens': expected number >= 1",
      );
    });

    it('throws with clear message when model max_tokens is fractional', async () => {
      writeFileSync(path.join(tempDir, 'config', 'models.yml'), MODELS_YML.replace(
        'max_tokens: 16384',
        'max_tokens: 16384.5',
      ), 'utf-8');

      await expect(loadModelsConfig()).rejects.toThrow(
        "Invalid 'models.agents.creator.max_tokens': expected integer >= 1",
      );
    });

    it('throws with clear message when a model override targets an unknown agent', async () => {
      writeFileSync(path.join(tempDir, 'config', 'models.yml'), `${MODELS_YML}
overrides:
  - agent: creatr
    model: "glm-4.5"
    start_iteration: 5
    end_iteration: 10
    label: "creator-typo"
`, 'utf-8');

      await expect(loadModelsConfig()).rejects.toThrow(
        "Invalid 'models.overrides[0].agent': expected one of ideator, creator, tester, critic, curator",
      );
    });

    it('throws with clear message when a model override window is inverted', async () => {
      writeFileSync(path.join(tempDir, 'config', 'models.yml'), `${MODELS_YML}
overrides:
  - agent: ideator
    model: "glm-4.5"
    start_iteration: 10
    end_iteration: 5
    label: "bad-window"
`, 'utf-8');

      await expect(loadModelsConfig()).rejects.toThrow(
        "Invalid 'models.overrides[0]': start_iteration must be <= end_iteration",
      );
    });

    it('throws with clear message when a model override window is fractional', async () => {
      writeFileSync(path.join(tempDir, 'config', 'models.yml'), `${MODELS_YML}
overrides:
  - agent: ideator
    model: "glm-4.5"
    start_iteration: 1.5
    end_iteration: 5
    label: "bad-window"
`, 'utf-8');

      await expect(loadModelsConfig()).rejects.toThrow(
        "Invalid 'models.overrides[0].start_iteration': expected integer >= 0",
      );
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

    it('throws with clear message when domains is not a list', async () => {
      writeFileSync(path.join(tempDir, 'config', 'domains.yml'), `
domains:
  fiction:
    description: "Short stories"
    weight: 1.0
`, 'utf-8');

      await expect(loadDomainsConfig()).rejects.toThrow("Invalid 'domains': expected array");
    });

    it('throws with clear message when a domain weight is invalid', async () => {
      writeFileSync(path.join(tempDir, 'config', 'domains.yml'), `
domains:
  - name: fiction
    description: "Short stories"
    weight: 0
`, 'utf-8');

      await expect(loadDomainsConfig()).rejects.toThrow(
        "Invalid 'domains[0].weight': expected number > 0",
      );
    });

    it('throws with clear message when a domain name is not a safe slug', async () => {
      writeFileSync(path.join(tempDir, 'config', 'domains.yml'), `
domains:
  - name: ../outside
    description: "Path escape"
    weight: 1
`, 'utf-8');

      await expect(loadDomainsConfig()).rejects.toThrow(
        "Invalid 'domains[0].name': expected safe slug",
      );
    });

    it('throws with clear message when domain names are duplicated', async () => {
      writeFileSync(path.join(tempDir, 'config', 'domains.yml'), `
domains:
  - name: fiction
    description: "Short stories"
    weight: 1
  - name: fiction
    description: "Duplicate fiction"
    weight: 1
`, 'utf-8');

      await expect(loadDomainsConfig()).rejects.toThrow(
        "Invalid 'domains[1].name': duplicate domain 'fiction'",
      );
    });
  });
});
