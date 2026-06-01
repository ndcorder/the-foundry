import { appendFile, mkdir, readFile, readdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { resolve } from "../root.js";

export type JsonlRotationPressure = "clear" | "watch" | "rotate-soon";
export type JsonlLogHealthState = "healthy" | "watch" | "rotate-soon" | "malformed";

export interface JsonlMalformedLogDetail {
  name: string;
  malformedLines: number;
  firstMalformedLine: number;
}

export interface JsonlLogHealth {
  activeFiles: number;
  archiveCount: number;
  totalActiveBytes: number;
  totalArchiveBytes: number;
  totalLogBytes: number;
  rotationThresholdBytes: number;
  largestActivePercent: number;
  largestActiveBytesRemaining: number;
  rotationPressure: JsonlRotationPressure;
  healthState: JsonlLogHealthState;
  malformedActiveLines: number;
  malformedActiveFiles: string[];
  malformedActiveFileDetails: JsonlMalformedLogDetail[];
  recommendedActions: string[];
  largestActive: {
    name: string;
    bytes: number;
  } | null;
  largestArchive: {
    name: string;
    bytes: number;
  } | null;
}

function logsDir(): string {
  return resolve("logs");
}

const ROTATION_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50 MB

let ensuredLogsDir: string | null = null;

async function ensureLogsDir(): Promise<void> {
  const dir = logsDir();
  if (ensuredLogsDir === dir) return;
  await mkdir(dir, { recursive: true });
  ensuredLogsDir = dir;
}

async function unusedArchivePath(filename: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = filename.replace(".jsonl", "");
  const dir = logsDir();

  for (let suffix = 0; ; suffix++) {
    const archiveName = suffix === 0
      ? `${base}.${timestamp}.jsonl`
      : `${base}.${timestamp}.${suffix}.jsonl`;
    const archivePath = path.join(dir, archiveName);
    try {
      await stat(archivePath);
    } catch {
      return archivePath;
    }
  }
}

async function rotateIfNeeded(filename: string): Promise<void> {
  const filePath = path.join(logsDir(), filename);
  try {
    const info = await stat(filePath);
    if (info.size < ROTATION_THRESHOLD_BYTES) return;

    await rename(filePath, await unusedArchivePath(filename));
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
  ensuredLogsDir = null;
}

function isRotatedJsonl(filename: string): boolean {
  const stem = filename.slice(0, -".jsonl".length);
  return stem.includes(".");
}

function getRotationPressure(percent: number): JsonlRotationPressure {
  if (percent >= 95) return "rotate-soon";
  if (percent >= 80) return "watch";
  return "clear";
}

function getLogHealthState(rotationPressure: JsonlRotationPressure, malformedActiveLines: number): JsonlLogHealthState {
  if (malformedActiveLines > 0) return "malformed";
  if (rotationPressure === "rotate-soon") return "rotate-soon";
  if (rotationPressure === "watch") return "watch";
  return "healthy";
}

function getRecommendedActions(
  rotationPressure: JsonlRotationPressure,
  malformedActiveLines: number,
  malformedActiveFileDetails: JsonlMalformedLogDetail[],
): string[] {
  const actions: string[] = [];
  if (malformedActiveLines > 0) {
    actions.push("Repair or rotate malformed active JSONL logs before trusting monitor summaries.");
    for (const detail of malformedActiveFileDetails) {
      actions.push(`Inspect ${detail.name} at line ${detail.firstMalformedLine}.`);
    }
  }

  if (rotationPressure === "rotate-soon") {
    actions.push("Rotate or archive active logs before the next long unattended run.");
  } else if (rotationPressure === "watch") {
    actions.push("Plan log rotation before the next extended run.");
  }

  return actions;
}

async function inspectMalformedJsonlLines(
  filePath: string,
): Promise<{ malformedLines: number; firstMalformedLine: number | null }> {
  const raw = await readFile(filePath, "utf-8");
  let malformedLines = 0;
  let firstMalformedLine: number | null = null;
  const lines = raw.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      JSON.parse(trimmed);
    } catch {
      malformedLines++;
      firstMalformedLine ??= index + 1;
    }
  }
  return { malformedLines, firstMalformedLine };
}

export async function readJsonlLogHealth(): Promise<JsonlLogHealth> {
  const dir = logsDir();
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return {
      activeFiles: 0,
      archiveCount: 0,
      totalActiveBytes: 0,
      totalArchiveBytes: 0,
      totalLogBytes: 0,
      rotationThresholdBytes: ROTATION_THRESHOLD_BYTES,
      largestActivePercent: 0,
      largestActiveBytesRemaining: ROTATION_THRESHOLD_BYTES,
      rotationPressure: "clear",
      healthState: "healthy",
      malformedActiveLines: 0,
      malformedActiveFiles: [],
      malformedActiveFileDetails: [],
      recommendedActions: [],
      largestActive: null,
      largestArchive: null,
    };
  }

  let activeFiles = 0;
  let archiveCount = 0;
  let totalActiveBytes = 0;
  let totalArchiveBytes = 0;
  let largestActive: JsonlLogHealth["largestActive"] = null;
  let largestArchive: JsonlLogHealth["largestArchive"] = null;
  let malformedActiveLines = 0;
  const malformedActiveFiles: string[] = [];
  const malformedActiveFileDetails: JsonlMalformedLogDetail[] = [];

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const filePath = path.join(dir, file);
    try {
      const info = await stat(filePath);
      if (!info.isFile()) continue;
      if (isRotatedJsonl(file)) {
        archiveCount++;
        totalArchiveBytes += info.size;
        if (!largestArchive || info.size > largestArchive.bytes) {
          largestArchive = { name: file, bytes: info.size };
        }
        continue;
      }

      activeFiles++;
      totalActiveBytes += info.size;
      if (!largestActive || info.size > largestActive.bytes) {
        largestActive = { name: file, bytes: info.size };
      }
      const malformed = await inspectMalformedJsonlLines(filePath);
      malformedActiveLines += malformed.malformedLines;
      if (malformed.malformedLines > 0 && malformed.firstMalformedLine !== null) {
        malformedActiveFiles.push(file);
        malformedActiveFileDetails.push({
          name: file,
          malformedLines: malformed.malformedLines,
          firstMalformedLine: malformed.firstMalformedLine,
        });
      }
    } catch {
      // log health is advisory; skip files that disappear during the scan
    }
  }

  const largestActiveBytes = largestActive?.bytes ?? 0;
  const largestActivePercent = Math.min(100, Math.round((largestActiveBytes / ROTATION_THRESHOLD_BYTES) * 100));
  const rotationPressure = getRotationPressure(largestActivePercent);
  const sortedMalformedDetails = malformedActiveFileDetails.sort((a, b) => a.name.localeCompare(b.name));
  return {
    activeFiles,
    archiveCount,
    totalActiveBytes,
    totalArchiveBytes,
    totalLogBytes: totalActiveBytes + totalArchiveBytes,
    rotationThresholdBytes: ROTATION_THRESHOLD_BYTES,
    largestActivePercent,
    largestActiveBytesRemaining: Math.max(0, ROTATION_THRESHOLD_BYTES - largestActiveBytes),
    rotationPressure,
    healthState: getLogHealthState(rotationPressure, malformedActiveLines),
    malformedActiveLines,
    malformedActiveFiles: malformedActiveFiles.sort(),
    malformedActiveFileDetails: sortedMalformedDetails,
    recommendedActions: getRecommendedActions(rotationPressure, malformedActiveLines, sortedMalformedDetails),
    largestActive,
    largestArchive,
  };
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

export async function logEvent(entry: Record<string, unknown>): Promise<void> {
  await appendJsonl("events.jsonl", entry);
}

export async function logMonitor(entry: Record<string, unknown>): Promise<void> {
  await appendJsonl("monitor.jsonl", entry);
}

export async function logRefinery(entry: Record<string, unknown>): Promise<void> {
  await appendJsonl("refinery.jsonl", entry);
}

export async function logStoker(entry: Record<string, unknown>): Promise<void> {
  await appendJsonl("stoker.jsonl", entry);
}

export async function logStimuli(entry: Record<string, unknown>): Promise<void> {
  await appendJsonl("stimuli.jsonl", entry);
}

export async function logSpark(entry: Record<string, unknown>): Promise<void> {
  await appendJsonl("spark.jsonl", entry);
}

export async function logRequest(entry: Record<string, unknown>): Promise<void> {
  await appendJsonl("requests.jsonl", entry);
}

export async function logTestReport(entry: Record<string, unknown>): Promise<void> {
  await appendJsonl("test-reports.jsonl", entry);
}
