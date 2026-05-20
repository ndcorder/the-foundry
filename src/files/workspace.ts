import { rm, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolve } from "../root.js";

function workspaceDir(slot?: number): string {
  return slot != null ? resolve("workspace", `slot-${slot}`) : resolve("workspace", "current");
}

export async function clearWorkspace(slot?: number): Promise<void> {
  const dir = workspaceDir(slot);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

export async function writeWorkspaceFile(filePath: string, content: string, slot?: number): Promise<void> {
  const wsRoot = workspaceDir(slot);
  const full = path.join(wsRoot, filePath);
  const resolved = path.resolve(full);
  if (!resolved.startsWith(path.resolve(wsRoot) + path.sep) && resolved !== path.resolve(wsRoot)) {
    throw new Error(`Path traversal blocked: "${filePath}" escapes workspace`);
  }
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf-8");
}

export async function readWorkspaceFiles(slot?: number): Promise<Array<{ path: string; content: string }>> {
  const dir = workspaceDir(slot);
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
