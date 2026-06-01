import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import type { FoundryConfig } from "../types/index.js";
import { resolve } from "../root.js";

export async function checkStopFile(config: FoundryConfig): Promise<boolean> {
  try {
    await access(resolve(config.intervention.stop_file));
    return true;
  } catch {
    return false;
  }
}

export async function readRequests(config: FoundryConfig): Promise<string> {
  try {
    const content = await readFile(resolve(config.intervention.requests_file), "utf-8");
    return content.trim();
  } catch {
    return "";
  }
}

export async function clearRequests(config: FoundryConfig): Promise<void> {
  const requestPath = resolve(config.intervention.requests_file);
  await mkdir(path.dirname(requestPath), { recursive: true });
  await writeFile(requestPath, "", "utf-8");
}

export async function writeRequests(config: FoundryConfig, content: string): Promise<void> {
  const requestPath = resolve(config.intervention.requests_file);
  const trimmed = content.trim();
  await mkdir(path.dirname(requestPath), { recursive: true });
  await writeFile(requestPath, trimmed ? `${trimmed}\n` : "", "utf-8");
}
