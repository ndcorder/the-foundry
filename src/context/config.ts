import { readFile } from "node:fs/promises";
import yaml from "yaml";
import type { FoundryConfig, ModelsConfig, DomainsConfig } from "../types/index.js";
import { resolve } from "../root.js";

const REQUIRED_MODEL_AGENTS = ["ideator", "creator", "tester", "critic", "curator"] as const;
const SAFE_DOMAIN_NAME = /^[a-z0-9][a-z0-9_-]*$/;

async function readYaml<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  return yaml.parse(raw) as T;
}

function validateFoundryConfig(data: unknown): asserts data is FoundryConfig {
  const d = data as Record<string, unknown>;
  if (!d || typeof d !== "object") throw new Error("Config must be an object");
  const foundry = requiredSection(d, "foundry");
  const iteration = requiredSection(d, "iteration");
  const context = requiredSection(d, "context");
  const intervention = requiredSection(d, "intervention");
  const logging = requiredSection(d, "logging");
  const recovery = requiredSection(d, "recovery");
  const projects = requiredSection(d, "projects");
  const stimuli = requiredSection(d, "stimuli");
  const loop = requiredSection(d, "loop");

  validateRequiredString(foundry, "foundry.name");
  validateRequiredString(foundry, "foundry.version");

  validateRequiredInteger(iteration, "iteration.max_idea_retries", 1);
  validateRequiredInteger(iteration, "iteration.max_revision_rounds", 0);
  validateRequiredInteger(iteration, "iteration.max_test_fix_cycles", 0);
  validateOptionalInteger(iteration, "iteration.ideation_burst_count", 1);
  validateRequiredInteger(iteration, "iteration.curator_interval", 1);
  validateRequiredInteger(iteration, "iteration.domain_cooldown", 0);
  validateRequiredInteger(iteration, "iteration.novelty_window", 1);
  validateComplexityProfiles(iteration);

  validateRequiredInteger(projects, "projects.max_active", 1);
  validateRequiredInteger(projects, "projects.max_iterations_per_project", 1);
  validateRequiredBoolean(projects, "projects.allow_standalone_interrupts");
  validateOptionalInteger(projects, "projects.kickstart_after", 0);

  validateRequiredBoolean(stimuli, "stimuli.enabled");
  validateRequiredInteger(stimuli, "stimuli.stimuli_ttl", 1);
  validateRequiredInteger(stimuli, "stimuli.skills_per_context", 0);
  validateRequiredInteger(stimuli, "stimuli.mcp_timeout_seconds", 1);

  validateRequiredInteger(context, "context.journal_compressed_max_tokens", 1);
  validateRequiredInteger(context, "context.portfolio_index_max_entries", 1);
  validateRequiredInteger(context, "context.critic_review_history", 1);
  validateRequiredInteger(context, "context.critic_gate1_history", 1);

  validateRequiredString(intervention, "intervention.requests_file");
  validateRequiredString(intervention, "intervention.stop_file");

  validateRequiredBoolean(logging, "logging.log_all_prompts");
  validateRequiredBoolean(logging, "logging.log_token_usage");
  validateRequiredBoolean(logging, "logging.log_decisions");
  validateRequiredBoolean(logging, "logging.log_test_reports");

  validateRequiredInteger(recovery, "recovery.checkpoint_every", 1);
  validateRequiredBoolean(recovery, "recovery.resume_on_crash");

  validateRequiredNumber(loop, "loop.cooldown_seconds", 0);
  validateRequiredNumber(loop, "loop.disk_space_min_gb", 0);
  validateOptionalInteger(loop, "loop.concurrency", 1);

  const git = optionalSection(d, "git");
  if (git) {
    validateOptionalBoolean(git, "git.auto_commit");
    validateOptionalBoolean(git, "git.auto_push");
  }

  const streaks = optionalSection(d, "streaks");
  if (streaks) {
    validateOptionalInteger(streaks, "streaks.min_length_for_amplify", 1);
    validateOptionalInteger(streaks, "streaks.cooldown_after_break", 0);
    validateOptionalNumber(streaks, "streaks.high_rating_threshold", 0);
    validateOptionalNumber(streaks, "streaks.rating_break_threshold", 0);
  }

  const complexity = optionalSection(d, "complexity");
  if (complexity) {
    validateOptionalInteger(complexity, "complexity.yield_window", 1);
    validateOptionalInteger(complexity, "complexity.min_samples_for_confidence", 1);
    validateOptionalInteger(complexity, "complexity.high_confidence_samples", 1);
  }

  const speculative = optionalSection(d, "speculative");
  if (speculative) {
    validateOptionalBoolean(speculative, "speculative.enabled");
    validateOptionalInteger(speculative, "speculative.max_carried_ideas", 0);
  }

  const refinery = optionalSection(d, "refinery");
  if (refinery) {
    validateOptionalBoolean(refinery, "refinery.enabled");
    validateOptionalInteger(refinery, "refinery.min_iterations_between_runs", 0);
    validateOptionalInteger(refinery, "refinery.max_refinery_queue", 0);
  }

  const stoker = optionalSection(d, "stoker");
  if (stoker) {
    validateOptionalBoolean(stoker, "stoker.enabled");
    validateOptionalInteger(stoker, "stoker.run_interval", 1);
    validateOptionalInteger(stoker, "stoker.refinery_token_heat_window", 1);
    validateOptionalInteger(stoker, "stoker.refinery_token_heat_threshold", 1);
  }

  const monitor = optionalSection(d, "monitor");
  if (monitor) {
    validateOptionalInteger(monitor, "monitor.active_warning_window", 0);
  }
}

function validateComplexityProfiles(iteration: Record<string, unknown>): void {
  const profiles = iteration.complexity_profiles;
  if (profiles === undefined) return;
  if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
    throw new Error("Invalid 'iteration.complexity_profiles' section: expected object");
  }

  for (const [tier, value] of Object.entries(profiles as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Invalid 'iteration.complexity_profiles.${tier}' section: expected object`);
    }
    const profile = value as Record<string, unknown>;
    validateRequiredInteger(profile, `iteration.complexity_profiles.${tier}.max_tokens_per_phase`, 1);
    validateRequiredInteger(profile, `iteration.complexity_profiles.${tier}.budget_warning_threshold`, 1);
  }
}

function validateModelsConfig(data: unknown): asserts data is ModelsConfig {
  const d = data as Record<string, unknown>;
  if (!d || typeof d !== "object") throw new Error("Models config must be an object");
  const agents = requiredSection(d, "models.agents");

  for (const agent of REQUIRED_MODEL_AGENTS) {
    const section = requiredSection(agents, `models.agents.${agent}`);
    validateRequiredString(section, `models.agents.${agent}.model`);
    validateRequiredNumber(section, `models.agents.${agent}.temperature`, 0);
    validateRequiredInteger(section, `models.agents.${agent}.max_tokens`, 1);
    validateOptionalString(section, `models.agents.${agent}.provider`);
    validateOptionalString(section, `models.agents.${agent}.reasoning_effort`);
  }

  if (d.overrides !== undefined) {
    if (!Array.isArray(d.overrides)) {
      throw new Error("Invalid 'models.overrides': expected array");
    }

    d.overrides.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`Invalid 'models.overrides[${index}]': expected object`);
      }

      const override = entry as Record<string, unknown>;
      validateRequiredString(override, `models.overrides[${index}].agent`);
      if (!isRequiredModelAgent(override.agent)) {
        throw new Error(
          `Invalid 'models.overrides[${index}].agent': expected one of ${REQUIRED_MODEL_AGENTS.join(", ")}`,
        );
      }
      validateRequiredString(override, `models.overrides[${index}].model`);
      validateRequiredInteger(override, `models.overrides[${index}].start_iteration`, 0);
      validateRequiredInteger(override, `models.overrides[${index}].end_iteration`, 0);
      validateRequiredString(override, `models.overrides[${index}].label`);

      if ((override.start_iteration as number) > (override.end_iteration as number)) {
        throw new Error(`Invalid 'models.overrides[${index}]': start_iteration must be <= end_iteration`);
      }
    });
  }
}

function validateDomainsConfig(data: unknown): asserts data is DomainsConfig {
  const d = data as Record<string, unknown>;
  if (!d || typeof d !== "object") throw new Error("Domains config must be an object");
  if (!Array.isArray(d.domains)) throw new Error("Invalid 'domains': expected array");
  const seen = new Set<string>();

  d.domains.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid 'domains[${index}]': expected object`);
    }
    const domain = entry as Record<string, unknown>;
    validateRequiredString(domain, `domains[${index}].name`);
    const name = domain.name as string;
    if (!SAFE_DOMAIN_NAME.test(name)) {
      throw new Error(`Invalid 'domains[${index}].name': expected safe slug`);
    }
    if (seen.has(name)) {
      throw new Error(`Invalid 'domains[${index}].name': duplicate domain '${name}'`);
    }
    seen.add(name);
    validateRequiredString(domain, `domains[${index}].description`);
    validatePositiveNumber(domain, `domains[${index}].weight`);
  });
}

function optionalSection(root: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = root[key];
  if (value === undefined) return null;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`Invalid '${key}' section: expected object`);
}

function requiredSection(root: Record<string, unknown>, path: string): Record<string, unknown> {
  const key = path.split(".").at(-1);
  const value = key ? root[key] : undefined;
  if (value === undefined) throw new Error(`Missing '${path}' section`);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`Invalid '${path}' section: expected object`);
}

function validateOptionalBoolean(section: Record<string, unknown>, path: string): void {
  const key = path.split(".").at(-1);
  if (!key || section[key] === undefined) return;
  if (typeof section[key] !== "boolean") {
    throw new Error(`Invalid '${path}': expected boolean`);
  }
}

function validateRequiredBoolean(section: Record<string, unknown>, path: string): void {
  const key = path.split(".").at(-1);
  if (!key || typeof section[key] !== "boolean") {
    throw new Error(`Invalid '${path}': expected boolean`);
  }
}

function validateOptionalString(section: Record<string, unknown>, path: string): void {
  const key = path.split(".").at(-1);
  if (!key || section[key] === undefined) return;
  if (typeof section[key] !== "string" || section[key].trim().length === 0) {
    throw new Error(`Invalid '${path}': expected non-empty string`);
  }
}

function validateRequiredString(section: Record<string, unknown>, path: string): void {
  const key = path.split(".").at(-1);
  if (!key || typeof section[key] !== "string" || section[key].trim().length === 0) {
    throw new Error(`Invalid '${path}': expected non-empty string`);
  }
}

function validateOptionalNumber(section: Record<string, unknown>, path: string, min: number): void {
  const key = path.split(".").at(-1);
  if (!key || section[key] === undefined) return;
  const value = section[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    throw new Error(`Invalid '${path}': expected number >= ${min}`);
  }
}

function validateOptionalInteger(section: Record<string, unknown>, path: string, min: number): void {
  const key = path.split(".").at(-1);
  if (!key || section[key] === undefined) return;
  validateIntegerValue(section[key], path, min);
}

function validateRequiredNumber(section: Record<string, unknown>, path: string, min: number): void {
  const key = path.split(".").at(-1);
  const value = key ? section[key] : undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    throw new Error(`Invalid '${path}': expected number >= ${min}`);
  }
}

function validateRequiredInteger(section: Record<string, unknown>, path: string, min: number): void {
  const key = path.split(".").at(-1);
  const value = key ? section[key] : undefined;
  validateIntegerValue(value, path, min);
}

function validateIntegerValue(value: unknown, path: string, min: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    throw new Error(`Invalid '${path}': expected number >= ${min}`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid '${path}': expected integer >= ${min}`);
  }
}

function validatePositiveNumber(section: Record<string, unknown>, path: string): void {
  const key = path.split(".").at(-1);
  const value = key ? section[key] : undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid '${path}': expected number > 0`);
  }
}

function isRequiredModelAgent(value: unknown): value is (typeof REQUIRED_MODEL_AGENTS)[number] {
  return typeof value === "string" && (REQUIRED_MODEL_AGENTS as readonly string[]).includes(value);
}

export async function loadConfig(): Promise<FoundryConfig> {
  const config = await readYaml<unknown>(resolve("config", "foundry.yml"));
  validateFoundryConfig(config);
  return config;
}

export async function loadModelsConfig(): Promise<ModelsConfig> {
  const config = await readYaml<unknown>(resolve("config", "models.yml"));
  validateModelsConfig(config);
  return config;
}

export async function loadDomainsConfig(): Promise<DomainsConfig> {
  const config = await readYaml<unknown>(resolve("config", "domains.yml"));
  validateDomainsConfig(config);
  return config;
}
