import { rename, readFile, writeFile, unlink } from "node:fs/promises";
import type { CheckpointState } from "../types/state.js";
import { resolve } from "../root.js";

export function checkpointPath(): string {
  return resolve("checkpoint.json");
}

function tmpPath(): string {
  return resolve("checkpoint.tmp.json");
}

export async function saveCheckpoint(state: CheckpointState): Promise<void> {
  const json = JSON.stringify(state, null, 2);
  await writeFile(tmpPath(), json, "utf-8");
  await rename(tmpPath(), checkpointPath());
}

export async function loadCheckpoint(): Promise<CheckpointState | null> {
  let raw: string;
  try {
    raw = await readFile(checkpointPath(), "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(raw) as CheckpointState;
  } catch {
    console.error(`[checkpoint] corrupt checkpoint.json — treating as fresh start`);
    return null;
  }
}

export async function deleteCheckpoint(): Promise<void> {
  try {
    await unlink(checkpointPath());
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}
