import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import yaml from "yaml";
import type {
  StimuliConfig,
  StimuliRefreshCheckpointEntry,
  StimuliRefreshCheckpointRecord,
  StimuliSourceConfig,
  StimuliRefreshState,
} from "../types/index.js";
import { resolve } from "../root.js";

const execFile = promisify(execFileCb);

const EXEC_TIMEOUT = 30_000;
const SAFE_SOURCE_NAME = /^[a-z0-9][a-z0-9_-]*$/i;

export interface StimuliSourceHealth {
  source: string;
  server: string;
  refreshInterval: number;
  lastRefreshIteration: number;
  iterationsSinceRefresh: number;
  consecutiveFailures: number;
  disabled: boolean;
  due: boolean;
  state: "healthy" | "due" | "failing" | "disabled";
}

export interface StimuliRefreshHealth {
  enabled: boolean;
  sources: number;
  healthy: number;
  due: number;
  failing: number;
  disabled: number;
  entries: StimuliSourceHealth[];
}

export async function loadStimuliConfig(): Promise<StimuliConfig> {
  const raw = await readFile(resolve("stimuli", "stimuli.yml"), "utf-8");
  const config = yaml.parse(raw) as unknown;
  validateStimuliConfig(config);
  return config;
}

function validateStimuliConfig(data: unknown): asserts data is StimuliConfig {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Stimuli config must be an object");
  }
  const config = data as Record<string, unknown>;
  if (!config.mcp || typeof config.mcp !== "object" || Array.isArray(config.mcp)) {
    throw new Error("Invalid 'stimuli.mcp': expected object");
  }
  validateInteger(config, "stimuli.stimuli_ttl", 1);
  validateInteger(config, "stimuli.skills_per_context", 0);

  for (const [name, value] of Object.entries(config.mcp as Record<string, unknown>)) {
    if (!SAFE_SOURCE_NAME.test(name)) {
      throw new Error(`Invalid 'stimuli.mcp' source name '${name}': expected safe slug`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Invalid 'stimuli.mcp.${name}': expected object`);
    }
    const source = value as Record<string, unknown>;
    if (source.server !== "tavily" && source.server !== "context7") {
      throw new Error(`Invalid 'stimuli.mcp.${name}.server': expected tavily or context7`);
    }
    validateInteger(source, `stimuli.mcp.${name}.max_items`, 1);
    validateInteger(source, `stimuli.mcp.${name}.refresh_interval`, 1);
    validateOptionalString(source, `stimuli.mcp.${name}.query_template`);
    validateOptionalString(source, `stimuli.mcp.${name}.strategy`);
    validateOptionalStringArray(source, `stimuli.mcp.${name}.queries`);
  }
}

function keyFromPath(pathValue: string): string | undefined {
  return pathValue.split(".").at(-1);
}

function validateInteger(section: Record<string, unknown>, pathValue: string, min: number): void {
  const key = keyFromPath(pathValue);
  const value = key ? section[key] : undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    throw new Error(`Invalid '${pathValue}': expected number >= ${min}`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`Invalid '${pathValue}': expected integer >= ${min}`);
  }
}

function validateOptionalString(section: Record<string, unknown>, pathValue: string): void {
  const key = keyFromPath(pathValue);
  const value = key ? section[key] : undefined;
  if (value === undefined) return;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid '${pathValue}': expected non-empty string`);
  }
}

function validateOptionalStringArray(section: Record<string, unknown>, pathValue: string): void {
  const key = keyFromPath(pathValue);
  const value = key ? section[key] : undefined;
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)) {
    throw new Error(`Invalid '${pathValue}': expected array of non-empty strings`);
  }
}

function formatContent(name: string, body: string): string {
  const header = `# ${name} — Refreshed ${new Date().toISOString()}`;
  return `${header}\n\n${body.trim()}\n`;
}

async function runFirecrawl(query: string, maxItems: number): Promise<string> {
  const { stdout } = await execFile(
    "firecrawl",
    ["search", query, "--limit", String(maxItems)],
    { timeout: EXEC_TIMEOUT },
  );
  return stdout;
}

async function runContext7(): Promise<string> {
  const { stdout } = await execFile(
    "npx",
    ["ctx7@latest", "docs", "/wikipedia/wikipedia", "random interesting topics"],
    { timeout: EXEC_TIMEOUT },
  );
  return stdout;
}

export async function refreshSource(
  name: string,
  config: StimuliSourceConfig,
): Promise<string> {
  let body: string;

  if (config.server === "tavily") {
    if (config.queries && config.queries.length > 0) {
      const parts: string[] = [];
      for (const query of config.queries) {
        parts.push(await runFirecrawl(query, config.max_items));
      }
      body = parts.join("\n\n---\n\n");
    } else {
      body = await runFirecrawl(config.query_template ?? "interesting news", config.max_items);
    }
  } else if (config.server === "context7") {
    try {
      body = await runContext7();
    } catch {
      body = "*Source unavailable — context7 did not return useful content this cycle.*";
    }
  } else {
    throw new Error(`Unknown stimuli server: ${config.server}`);
  }

  const content = formatContent(name, body);
  const outPath = resolve("stimuli", "live", `${name}.md`);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, content, "utf-8");
  return content;
}

export async function refreshAllStale(
  currentIteration: number,
  refreshStates: Map<string, StimuliRefreshState>,
): Promise<Map<string, StimuliRefreshState>> {
  let config: StimuliConfig;
  try {
    config = await loadStimuliConfig();
  } catch (err) {
    console.error(`[stimuli] failed to load config: ${err}`);
    return refreshStates;
  }

  for (const [name, sourceConfig] of Object.entries(config.mcp)) {
    const state = refreshStates.get(name) ?? {
      source: name,
      last_refresh_iteration: 0,
      consecutive_failures: 0,
      disabled: false,
    };

    if (state.disabled) continue;
    if (currentIteration - state.last_refresh_iteration < sourceConfig.refresh_interval) continue;

    try {
      await refreshSource(name, sourceConfig);
      state.last_refresh_iteration = currentIteration;
      state.consecutive_failures = 0;
    } catch (err) {
      state.consecutive_failures += 1;
      if (state.consecutive_failures >= 3) {
        state.disabled = true;
      }
      console.error(
        `[stimuli] ${name} refresh failed (${state.consecutive_failures}/3): ${err}`,
      );
    }

    refreshStates.set(name, state);
  }

  return refreshStates;
}

export async function writeSkillFile(name: string, content: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
    throw new Error(`Invalid skill name: ${name}`);
  }

  const outPath = resolve("stimuli", "skills", `${name}.md`);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, content, "utf-8");
}

export function initRefreshStates(
  config: StimuliConfig,
): Map<string, StimuliRefreshState> {
  const states = new Map<string, StimuliRefreshState>();
  for (const name of Object.keys(config.mcp)) {
    states.set(name, {
      source: name,
      last_refresh_iteration: 0,
      consecutive_failures: 0,
      disabled: false,
    });
  }
  return states;
}

export function refreshStatesToRecord(
  states: Map<string, StimuliRefreshState>,
): StimuliRefreshCheckpointRecord {
  const record: StimuliRefreshCheckpointRecord = {};
  for (const [name, state] of states) {
    record[name] = {
      last_refresh_iteration: state.last_refresh_iteration,
      consecutive_failures: state.consecutive_failures,
      disabled: state.disabled,
    };
  }
  return record;
}

export function recordToRefreshStates(
  record: StimuliRefreshCheckpointRecord,
  config: StimuliConfig,
): Map<string, StimuliRefreshState> {
  const states = new Map<string, StimuliRefreshState>();
  for (const name of Object.keys(config.mcp)) {
    const entry = normalizeCheckpointEntry(record[name]);
    states.set(name, {
      source: name,
      last_refresh_iteration: entry.last_refresh_iteration,
      consecutive_failures: entry.consecutive_failures,
      disabled: entry.disabled,
    });
  }
  return states;
}

function normalizeCheckpointEntry(value: StimuliRefreshCheckpointRecord[string] | undefined): StimuliRefreshCheckpointEntry {
  if (typeof value === "number" && Number.isFinite(value)) {
    return {
      last_refresh_iteration: Math.max(0, Math.floor(value)),
      consecutive_failures: 0,
      disabled: false,
    };
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      last_refresh_iteration: normalizeNonNegativeInteger(value.last_refresh_iteration),
      consecutive_failures: normalizeNonNegativeInteger(value.consecutive_failures),
      disabled: value.disabled === true,
    };
  }

  return {
    last_refresh_iteration: 0,
    consecutive_failures: 0,
    disabled: false,
  };
}

function normalizeNonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

export function summarizeStimuliRefreshHealth(
  config: StimuliConfig,
  states: Map<string, StimuliRefreshState>,
  currentIteration: number,
  enabled: boolean,
): StimuliRefreshHealth {
  const completedIteration = Math.max(0, Math.floor(currentIteration));
  const entries: StimuliSourceHealth[] = [];

  for (const [source, sourceConfig] of Object.entries(config.mcp)) {
    const state = states.get(source) ?? {
      source,
      last_refresh_iteration: 0,
      consecutive_failures: 0,
      disabled: false,
    };
    const refreshInterval = Math.max(1, Math.floor(sourceConfig.refresh_interval));
    const lastRefreshIteration = Math.max(0, Math.floor(state.last_refresh_iteration));
    const iterationsSinceRefresh = Math.max(0, completedIteration - lastRefreshIteration);
    const due = !state.disabled && iterationsSinceRefresh >= refreshInterval;
    const sourceState: StimuliSourceHealth["state"] = state.disabled
      ? "disabled"
      : state.consecutive_failures > 0
        ? "failing"
        : due
          ? "due"
          : "healthy";

    entries.push({
      source,
      server: sourceConfig.server,
      refreshInterval,
      lastRefreshIteration,
      iterationsSinceRefresh,
      consecutiveFailures: Math.max(0, Math.floor(state.consecutive_failures)),
      disabled: state.disabled,
      due,
      state: sourceState,
    });
  }

  return {
    enabled,
    sources: entries.length,
    healthy: entries.filter((entry) => entry.state === "healthy").length,
    due: entries.filter((entry) => entry.due).length,
    failing: entries.filter((entry) => entry.consecutiveFailures > 0 && !entry.disabled).length,
    disabled: entries.filter((entry) => entry.disabled).length,
    entries,
  };
}
