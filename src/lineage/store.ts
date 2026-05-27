import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import { resolve } from "../root.js";
import type { LineageGraph } from "./types.js";

const LINEAGE_PATH = "identity/lineage.yml";

export async function saveLineageGraph(graph: LineageGraph): Promise<void> {
  const filePath = resolve(LINEAGE_PATH);
  await mkdir(path.dirname(filePath), { recursive: true });
  const content = yaml.stringify(graph, { lineWidth: 120 });
  await writeFile(filePath, content, "utf-8");
}

export async function loadLineageGraph(): Promise<LineageGraph | null> {
  try {
    const content = await readFile(resolve(LINEAGE_PATH), "utf-8");
    return yaml.parse(content) as LineageGraph;
  } catch {
    return null;
  }
}
