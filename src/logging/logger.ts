import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const LOGS_DIR = path.join(process.cwd(), "logs");

let dirEnsured = false;

async function ensureLogsDir(): Promise<void> {
  if (dirEnsured) return;
  await mkdir(LOGS_DIR, { recursive: true });
  dirEnsured = true;
}

async function appendJsonl(filename: string, entry: Record<string, unknown>): Promise<void> {
  await ensureLogsDir();
  await appendFile(path.join(LOGS_DIR, filename), JSON.stringify(entry) + "\n", "utf-8");
}

export async function logTokenUsage(entry: Record<string, unknown>): Promise<void> {
  await appendJsonl("token-usage.jsonl", entry);
}

export async function logDecision(entry: Record<string, unknown>): Promise<void> {
  await appendJsonl("decisions.jsonl", entry);
}

export async function logIteration(entry: Record<string, unknown>): Promise<void> {
  await appendJsonl("iterations.jsonl", entry);
}

export async function logTestReport(entry: Record<string, unknown>): Promise<void> {
  await appendJsonl("test-reports.jsonl", entry);
}
