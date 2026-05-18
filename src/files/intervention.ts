import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import type { FoundryConfig } from "../types/index.js";

function resolve(...segs: string[]): string {
  return path.join(process.cwd(), ...segs);
}

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
  await writeFile(resolve(config.intervention.requests_file), "", "utf-8");
}
