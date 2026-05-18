import { readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import type { FoundryConfig, ModelsConfig, DomainsConfig } from "../types/index.js";

function resolve(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}

async function readYaml<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  return yaml.parse(raw) as T;
}

export async function loadConfig(): Promise<FoundryConfig> {
  return readYaml<FoundryConfig>(resolve("config", "foundry.yml"));
}

export async function loadModelsConfig(): Promise<ModelsConfig> {
  return readYaml<ModelsConfig>(resolve("config", "models.yml"));
}

export async function loadDomainsConfig(): Promise<DomainsConfig> {
  return readYaml<DomainsConfig>(resolve("config", "domains.yml"));
}
