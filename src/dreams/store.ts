import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import { resolve } from "../root.js";
import type { DreamJournal, DreamEntry } from "./types.js";

const DREAMS_PATH = "identity/dreams.yml";
const MAX_DREAMS = 30;

export async function loadDreamJournal(): Promise<DreamJournal> {
  try {
    const raw = await readFile(resolve(DREAMS_PATH), "utf-8");
    return yaml.parse(raw) as DreamJournal;
  } catch {
    return { dreams: [], updated_at: new Date().toISOString() };
  }
}

export async function saveDreamJournal(journal: DreamJournal): Promise<void> {
  const dir = path.dirname(resolve(DREAMS_PATH));
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(DREAMS_PATH), yaml.stringify(journal), "utf-8");
}

export async function addDream(entry: DreamEntry): Promise<void> {
  const journal = await loadDreamJournal();
  journal.dreams.unshift(entry);
  if (journal.dreams.length > MAX_DREAMS) {
    journal.dreams = journal.dreams.slice(0, MAX_DREAMS);
  }
  journal.updated_at = new Date().toISOString();
  await saveDreamJournal(journal);
}

export async function getDreamsForIdeator(count: number = 3): Promise<string> {
  const journal = await loadDreamJournal();
  if (journal.dreams.length === 0) return "*No fallen artifacts to draw from yet.*";

  const selected = journal.dreams.slice(0, count);
  return selected
    .map((d) =>
      `- **"${d.title}"** [${d.domain}] — killed because: ${d.kill_reason}. ` +
      `What was worth saving: ${d.what_was_good}. ` +
      `Resurrection hint: ${d.resurrection_hint}`
    )
    .join("\n");
}
