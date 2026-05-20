import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { resolve } from "../root.js";

function logsDir(): string {
  return resolve("logs");
}

const ROTATION_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50 MB

let dirEnsured = false;
const rotationChecks = new Map<string, number>(); // track last check iteration per file

async function ensureLogsDir(): Promise<void> {
  if (dirEnsured) return;
  await mkdir(logsDir(), { recursive: true });
  dirEnsured = true;
}

async function rotateIfNeeded(filename: string): Promise<void> {
  const filePath = path.join(logsDir(), filename);
  const lastCheck = rotationChecks.get(filename) ?? 0;
  const now = Date.now();
  // Only check every 60 seconds to avoid stat overhead on every append
  if (now - lastCheck < 60_000) return;
  rotationChecks.set(filename, now);

  try {
    const info = await stat(filePath);
    if (info.size < ROTATION_THRESHOLD_BYTES) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = filename.replace(".jsonl", "");
    const archiveName = `${base}.${timestamp}.jsonl`;
    await rename(filePath, path.join(logsDir(), archiveName));
  } catch {
    // file doesn't exist yet — nothing to rotate
  }
}

async function appendJsonl(filename: string, entry: Record<string, unknown>): Promise<void> {
  await ensureLogsDir();
  await rotateIfNeeded(filename);
  await appendFile(path.join(logsDir(), filename), JSON.stringify(entry) + "\n", "utf-8");
}

export function resetLoggerState(): void {
  dirEnsured = false;
  rotationChecks.clear();
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
