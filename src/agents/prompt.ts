import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolve } from "../root.js";

function promptsDir(): string {
  return resolve("prompts");
}

export async function loadPrompt(role: string): Promise<string> {
  return readFile(path.join(promptsDir(), `${role}.md`), "utf-8");
}

export async function loadCriticGate1Prompt(): Promise<string> {
  const full = await loadPrompt("critic");
  const gate2Start = full.indexOf("## GATE 2");
  if (gate2Start < 0) return full;
  return full.slice(0, gate2Start).trim();
}

export async function loadCriticGate2Prompt(): Promise<string> {
  const full = await loadPrompt("critic");
  const gate2Start = full.indexOf("## GATE 2");
  if (gate2Start < 0) return full;
  return full.slice(gate2Start).trim();
}

export function injectVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}
