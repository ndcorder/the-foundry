import { rename, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { CheckpointState } from "../types/state.js";

export const CHECKPOINT_PATH = path.join(process.cwd(), "checkpoint.json");

const TMP_PATH = path.join(process.cwd(), "checkpoint.tmp.json");

export async function saveCheckpoint(state: CheckpointState): Promise<void> {
  const json = JSON.stringify(state, null, 2);
  await writeFile(TMP_PATH, json, "utf-8");
  await rename(TMP_PATH, CHECKPOINT_PATH);
}

export async function loadCheckpoint(): Promise<CheckpointState | null> {
  let raw: string;
  try {
    raw = await readFile(CHECKPOINT_PATH, "utf-8");
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
    await unlink(CHECKPOINT_PATH);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}
