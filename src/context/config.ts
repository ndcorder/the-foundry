import { readFile } from "node:fs/promises";
import yaml from "yaml";
import type { FoundryConfig, ModelsConfig, DomainsConfig } from "../types/index.js";
import { resolve } from "../root.js";

async function readYaml<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  return yaml.parse(raw) as T;
}

function validateFoundryConfig(data: unknown): asserts data is FoundryConfig {
  const d = data as Record<string, unknown>;
  if (!d || typeof d !== "object") throw new Error("Config must be an object");
  if (!d.foundry || typeof d.foundry !== "object") throw new Error("Missing 'foundry' section");
  if (!d.iteration || typeof d.iteration !== "object") throw new Error("Missing 'iteration' section");
  if (!d.context || typeof d.context !== "object") throw new Error("Missing 'context' section");
  if (!d.intervention || typeof d.intervention !== "object") throw new Error("Missing 'intervention' section");
  if (!d.logging || typeof d.logging !== "object") throw new Error("Missing 'logging' section");
  if (!d.recovery || typeof d.recovery !== "object") throw new Error("Missing 'recovery' section");
}

export async function loadConfig(): Promise<FoundryConfig> {
  const config = await readYaml<unknown>(resolve("config", "foundry.yml"));
  validateFoundryConfig(config);
  return config;
}

export async function loadModelsConfig(): Promise<ModelsConfig> {
  return readYaml<ModelsConfig>(resolve("config", "models.yml"));
}

export async function loadDomainsConfig(): Promise<DomainsConfig> {
  return readYaml<DomainsConfig>(resolve("config", "domains.yml"));
}
