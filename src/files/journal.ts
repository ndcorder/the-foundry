import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function resolve(...segs: string[]): string {
  return path.join(process.cwd(), ...segs);
}

export async function appendJournal(entry: string): Promise<void> {
  const journalPath = resolve("identity", "journal.md");
  let content: string;
  try {
    content = await readFile(journalPath, "utf-8");
  } catch {
    content = "# The Foundry — Journal\n\n*Chronological record of iterations, decisions, and reflections.*\n\n---\n";
  }

  const timestamp = new Date().toISOString();
  const formatted = `\n### ${timestamp}\n\n${entry}\n`;
  content = content.trimEnd() + formatted;

  await writeFile(journalPath, content, "utf-8");
}
