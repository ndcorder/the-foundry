import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import { resolve } from "../root.js";
import type { MoodState } from "./types.js";

const MOOD_PATH = "identity/mood.yml";

export async function saveMood(mood: MoodState): Promise<void> {
  const filePath = resolve(MOOD_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  const content = yaml.stringify(mood, { lineWidth: 120 });
  await writeFile(filePath, content, "utf-8");
}

export async function loadMood(): Promise<MoodState | null> {
  try {
    const content = await readFile(resolve(MOOD_PATH), "utf-8");
    return yaml.parse(content) as MoodState;
  } catch {
    return null;
  }
}
