import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { DecisionLogEntry, TestReportEntry } from "../types/index.js";
import { resolve } from "../root.js";

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

function parseJsonlLines<T>(raw: string): T[] {
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

export async function readJsonlEntries<T>(filePath: string): Promise<T[]> {
  // Read current file + any rotated archives (e.g., iterations.2026-05-18T....jsonl)
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, ".jsonl");
  let allEntries: T[] = [];

  try {
    const files = await readdir(dir);
    // Rotated files sort chronologically before the current file
    const rotated = files
      .filter((f) => f.startsWith(base + ".") && f.endsWith(".jsonl") && f !== path.basename(filePath))
      .sort();

    const recentRotated = rotated.slice(-2);

    for (const f of recentRotated) {
      const raw = await safeReadAbsolute(path.join(dir, f));
      allEntries.push(...parseJsonlLines<T>(raw));
    }
  } catch {
    // dir doesn't exist yet
  }

  // Current file
  const raw = await safeRead(filePath);
  allEntries.push(...parseJsonlLines<T>(raw));

  return allEntries;
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

export function selectDiverseReviews(
  reviews: DecisionLogEntry[],
  maxCount: number,
): DecisionLogEntry[] {
  if (reviews.length <= maxCount) return reviews;

  const selected = new Map<number, DecisionLogEntry>();
  const byDomain = new Map<string, DecisionLogEntry[]>();

  for (const r of reviews) {
    const domain = r.proposal_title?.split(" ")[0] ?? "unknown";
    const existing = byDomain.get(domain) ?? [];
    existing.push(r);
    byDomain.set(domain, existing);
  }

  // Round-robin across domains to get diversity
  const domains = [...byDomain.keys()];
  let idx = 0;
  while (selected.size < maxCount && selected.size < reviews.length) {
    const domainIdx = idx % domains.length;
    const domain = domains[domainIdx];
    const pool = byDomain.get(domain)!;
    if (pool.length > 0) {
      const entry = pool.shift()!;
      const key = reviews.indexOf(entry);
      selected.set(key, entry);
    }
    idx++;
    if (pool.length === 0) {
      domains.splice(domainIdx, 1);
      if (domains.length === 0) break;
      if (domainIdx < domains.length) idx = domainIdx;
      else idx = 0;
    }
  }

  // Return in original order
  return [...selected.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, v]) => v);
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
