import { rm, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { resolve } from "../root.js";

export async function clearWorkspace(): Promise<void> {
  const dir = resolve("workspace", "current");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

export async function writeWorkspaceFile(filePath: string, content: string): Promise<void> {
  const full = resolve("workspace", "current", filePath);
  await mkdir(path.dirname(full), { recursive: true });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(full, content, "utf-8");
}

export async function readWorkspaceFiles(): Promise<Array<{ path: string; content: string }>> {
  const dir = resolve("workspace", "current");
  const results: Array<{ path: string; content: string }> = [];

  async function walk(base: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(base, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(base, entry.name), entryRel);
      } else {
        const content = await readFile(path.join(base, entry.name), "utf-8");
        results.push({ path: entryRel, content });
      }
    }
  }

  await walk(dir, "");
  return results;
}
