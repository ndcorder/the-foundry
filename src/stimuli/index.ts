import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import yaml from "yaml";
import type { StimuliConfig, StimuliSourceConfig, StimuliRefreshState } from "../types/index.js";
import { resolve } from "../root.js";

const execFile = promisify(execFileCb);

const EXEC_TIMEOUT = 30_000;

export async function loadStimuliConfig(): Promise<StimuliConfig> {
  const raw = await readFile(resolve("stimuli", "stimuli.yml"), "utf-8");
  return yaml.parse(raw) as StimuliConfig;
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
): Record<string, number> {
  const record: Record<string, number> = {};
  for (const [name, state] of states) {
    record[name] = state.last_refresh_iteration;
  }
  return record;
}

export function recordToRefreshStates(
  record: Record<string, number>,
  config: StimuliConfig,
): Map<string, StimuliRefreshState> {
  const states = new Map<string, StimuliRefreshState>();
  for (const name of Object.keys(config.mcp)) {
    states.set(name, {
      source: name,
      last_refresh_iteration: record[name] ?? 0,
      consecutive_failures: 0,
      disabled: false,
    });
  }
  return states;
}
