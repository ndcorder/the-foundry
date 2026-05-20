import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import type { ProjectBrief, ProjectStatus } from "../types/index.js";
import { resolve } from "../root.js";
import { slugify } from "./portfolio.js";

const PROJECTS_DIR = "portfolio/projects";

export async function generateProjectId(): Promise<string> {
  const indexPath = resolve(PROJECTS_DIR, "index.md");
  let content: string;
  try {
    content = await readFile(indexPath, "utf-8");
  } catch {
    return "P001";
  }
  const ids = [...content.matchAll(/\|\s*(P\d{3})\s*\|/g)].map((m) =>
    parseInt(m[1].slice(1), 10),
  );
  const max = ids.length > 0 ? Math.max(...ids) : 0;
  return `P${String(max + 1).padStart(3, "0")}`;
}

export async function createProject(
  brief: ProjectBrief,
  iteration: number,
): Promise<string> {
  const projectId = await generateProjectId();
  const slug = slugify(brief.name);
  const dirName = `${projectId}-${slug}`;
  const projectDir = resolve(PROJECTS_DIR, dirName);
  await mkdir(projectDir, { recursive: true });
  await mkdir(path.join(projectDir, "artifacts"), { recursive: true });

  const structureList = brief.structure
    .map((entry) => {
      const [key, val] = Object.entries(entry)[0];
      return `- **${key}:** ${val}`;
    })
    .join("\n");

  const briefMd = [
    `# ${brief.name}`,
    "",
    brief.description,
    "",
    "## Structure",
    "",
    structureList,
    "",
  ].join("\n");

  await writeFile(path.join(projectDir, "brief.md"), briefMd, "utf-8");

  const now = new Date().toISOString();
  const status: ProjectStatus = {
    project_id: projectId,
    name: brief.name,
    status: "active",
    estimated_iterations: brief.estimated_iterations,
    completed_iterations: 0,
    last_iteration: iteration,
    created_at: now,
  };

  await writeFile(
    path.join(projectDir, "status.yml"),
    yaml.stringify(status),
    "utf-8",
  );

  const allProjects = await getAllProjects();
  allProjects.push(status);
  await updateProjectsIndex(allProjects);

  return projectId;
}

async function findProjectDir(projectId: string): Promise<string | null> {
  const base = resolve(PROJECTS_DIR);
  let entries: string[];
  try {
    entries = await readdir(base);
  } catch {
    return null;
  }
  const match = entries.find((e) => e.startsWith(projectId + "-"));
  return match ? path.join(base, match) : null;
}

async function readStatus(dir: string): Promise<ProjectStatus | null> {
  try {
    const raw = await readFile(path.join(dir, "status.yml"), "utf-8");
    return yaml.parse(raw) as ProjectStatus;
  } catch {
    return null;
  }
}

async function getAllProjects(): Promise<ProjectStatus[]> {
  const base = resolve(PROJECTS_DIR);
  let entries: string[];
  try {
    entries = await readdir(base);
  } catch {
    return [];
  }
  const results: ProjectStatus[] = [];
  for (const entry of entries) {
    if (!entry.match(/^P\d{3}-/)) continue;
    const status = await readStatus(path.join(base, entry));
    if (status) results.push(status);
  }
  return results;
}

export async function getActiveProjects(): Promise<ProjectStatus[]> {
  const all = await getAllProjects();
  return all.filter((p) => p.status === "active");
}

export async function countActiveProjects(): Promise<number> {
  return (await getActiveProjects()).length;
}

export async function getProjectContext(projectId: string): Promise<string> {
  const dir = await findProjectDir(projectId);
  if (!dir) return "";

  let brief: string;
  try {
    brief = await readFile(path.join(dir, "brief.md"), "utf-8");
  } catch {
    brief = "";
  }

  const artifactsDir = path.join(dir, "artifacts");
  let artifactFiles: string[];
  try {
    artifactFiles = await readdir(artifactsDir);
  } catch {
    artifactFiles = [];
  }

  const parts: string[] = [];
  if (brief) parts.push("## Project Brief\n\n" + brief);

  for (const file of artifactFiles) {
    try {
      const content = await readFile(path.join(artifactsDir, file), "utf-8");
      parts.push(`## Artifact: ${file}\n\n${content}`);
    } catch {
      // skip unreadable files
    }
  }

  return parts.join("\n\n---\n\n");
}

export async function updateProjectStatus(
  projectId: string,
  updates: Partial<ProjectStatus>,
): Promise<void> {
  const dir = await findProjectDir(projectId);
  if (!dir) throw new Error(`Project ${projectId} not found`);

  const existing = await readStatus(dir);
  if (!existing) throw new Error(`Cannot read status for ${projectId}`);

  const merged: ProjectStatus = { ...existing, ...updates };
  await writeFile(
    path.join(dir, "status.yml"),
    yaml.stringify(merged),
    "utf-8",
  );
}

export async function linkArtifactToProject(
  projectId: string,
  artifactId: string,
  title: string,
): Promise<void> {
  const dir = await findProjectDir(projectId);
  if (!dir) throw new Error(`Project ${projectId} not found`);

  const artifactsDir = path.join(dir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });

  const slug = slugify(title);
  const filename = `${artifactId}-${slug}.md`;
  const content = [
    `# ${title}`,
    "",
    `**Artifact ID:** ${artifactId}  `,
    `**Project:** ${projectId}`,
    "",
    `See [portfolio artifact](../../../${artifactId}*/) for full content.`,
    "",
  ].join("\n");

  await writeFile(path.join(artifactsDir, filename), content, "utf-8");
}

export async function updateProjectsIndex(
  projects: ProjectStatus[],
): Promise<void> {
  const indexPath = resolve(PROJECTS_DIR, "index.md");
  await mkdir(resolve(PROJECTS_DIR), { recursive: true });

  const rows = projects.map((p) => {
    const progress = `${p.completed_iterations}/${p.estimated_iterations}`;
    const started = p.created_at.slice(0, 10);
    const updated = p.completed_at?.slice(0, 10) ?? started;
    return `| ${p.project_id} | ${p.name} | ${p.status} | ${progress} | ${started} | ${updated} |`;
  });

  const content = [
    "# Projects Index",
    "",
    "| ID | Name | Status | Progress | Started | Updated |",
    "|---|---|---|---|---|---|",
    ...rows,
    "",
    rows.length === 0 ? "*No active projects.*\n" : "",
  ].join("\n");

  await writeFile(indexPath, content, "utf-8");
}
