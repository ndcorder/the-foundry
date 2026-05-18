import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { DecisionLogEntry, TestReportEntry } from "../types/index.js";

function resolve(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}

export async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

export async function safeReadAbsolute(absPath: string): Promise<string> {
  try {
    return await readFile(absPath, "utf-8");
  } catch {
    return "";
  }
}

export async function readJsonlEntries<T>(filePath: string): Promise<T[]> {
  const raw = await safeRead(filePath);
  if (!raw.trim()) return [];
  const entries: T[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as T);
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

export async function readDecisions(): Promise<DecisionLogEntry[]> {
  return readJsonlEntries<DecisionLogEntry>(resolve("logs", "decisions.jsonl"));
}

export async function readTestReports(): Promise<TestReportEntry[]> {
  return readJsonlEntries<TestReportEntry>(resolve("logs", "test-reports.jsonl"));
}

export function formatDecisions(entries: DecisionLogEntry[]): string {
  if (entries.length === 0) return "*No decisions recorded yet.*";
  return entries
    .map((d) => {
      const label = d.proposal_title || d.artifact_id || "unknown";
      const detail = d.review || d.reasons || d.sharpening_notes || "";
      return `- **${d.gate} / ${d.decision}** — ${label}${detail ? ": " + detail : ""}`;
    })
    .join("\n");
}

export function formatTestReports(entries: TestReportEntry[]): string {
  if (entries.length === 0) return "*No test reports yet.*";
  return entries
    .map((r) => {
      return `- **${r.artifact_id}** [${r.outcome}] — ${r.summary} (${r.tests_passed}/${r.tests_run} passed)`;
    })
    .join("\n");
}

export async function readLiveStimuli(): Promise<string> {
  const liveDir = resolve("stimuli", "live");
  let files: string[];
  try {
    files = await readdir(liveDir);
  } catch {
    return "*No live stimuli available.*";
  }
  const contents: string[] = [];
  for (const file of files.sort()) {
    if (!file.endsWith(".md")) continue;
    const text = await safeReadAbsolute(path.join(liveDir, file));
    if (text.trim()) contents.push(text.trim());
  }
  return contents.length > 0 ? contents.join("\n\n---\n\n") : "*No live stimuli available.*";
}

export async function pickRandomSkills(count: number): Promise<string> {
  const skillsDir = resolve("stimuli", "skills");
  let files: string[];
  try {
    files = (await readdir(skillsDir)).filter((f) => f.endsWith(".md"));
  } catch {
    return "*No skill files available.*";
  }
  if (files.length === 0) return "*No skill files available.*";

  const picked: string[] = [];
  const pool = [...files];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }

  const contents: string[] = [];
  for (const file of picked) {
    const text = await safeReadAbsolute(path.join(skillsDir, file));
    if (text.trim()) contents.push(`### ${file}\n\n${text.trim()}`);
  }
  return contents.length > 0 ? contents.join("\n\n") : "*No skill files available.*";
}
