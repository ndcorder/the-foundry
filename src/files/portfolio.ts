import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { CriticRatings, CreatorFile } from "../types/index.js";
import { resolve } from "../root.js";

const CODE_DOMAINS = new Set(["code-tool", "code-game", "code-art"]);

export function isCodeDomain(domain: string): boolean {
  return CODE_DOMAINS.has(domain);
}

function domainDir(domain: string): string {
  if (domain.startsWith("code-")) return "code";
  return domain;
}

export function slugify(title: string): string {
  if (!title) throw new Error("slugify: title is empty or undefined");
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export async function getNextArtifactId(): Promise<string> {
  const indexPath = resolve("portfolio", "index.md");
  let content: string;
  try {
    content = await readFile(indexPath, "utf-8");
  } catch {
    return "0001";
  }
  const ids = [...content.matchAll(/\|\s*(\d{4})\s*\|/g)].map((m) => parseInt(m[1], 10));
  const max = ids.length > 0 ? Math.max(...ids) : 0;
  return String(max + 1).padStart(4, "0");
}

export interface WriteArtifactOpts {
  id: string;
  title: string;
  domain: string;
  files: CreatorFile[];
  review: string;
  ratings: CriticRatings;
  testerReport: string;
  proposal: string;
}

export async function writeArtifact(opts: WriteArtifactOpts): Promise<string> {
  const slug = slugify(opts.title);
  const dirName = `${opts.id}-${slug}`;
  const base = domainDir(opts.domain);
  const artifactDir = resolve("portfolio", base, dirName);
  await mkdir(artifactDir, { recursive: true });

  // Write artifact files
  for (const f of opts.files) {
    const filePath = path.join(artifactDir, f.path);
    const fileDir = path.dirname(filePath);
    await mkdir(fileDir, { recursive: true });
    await writeFile(filePath, f.content, "utf-8");
  }

  // Build ratings table
  const ratingEntries = Object.entries(opts.ratings)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `| ${k} | ${v} |`);

  const ratingsTable = [
    "| Dimension | Score |",
    "|---|---|",
    ...ratingEntries,
  ].join("\n");

  const mean = ratingEntries.length > 0
    ? (Object.values(opts.ratings).filter((v): v is number => v !== undefined).reduce((a, b) => a + b, 0) / ratingEntries.length).toFixed(1)
    : "N/A";

  // Write README.md
  const readme = [
    `# ${opts.title}`,
    "",
    `**Domain:** ${opts.domain}  `,
    `**ID:** ${opts.id}  `,
    `**Mean rating:** ${mean}`,
    "",
    "## Proposal",
    "",
    opts.proposal,
    "",
    "## Critic Review",
    "",
    opts.review,
    "",
    "## Ratings",
    "",
    ratingsTable,
    "",
    "## Tester Report",
    "",
    opts.testerReport || "*No test report (non-code artifact).*",
    "",
  ].join("\n");

  await writeFile(path.join(artifactDir, "README.md"), readme, "utf-8");

  return artifactDir;
}

export async function updatePortfolioIndex(
  id: string,
  title: string,
  domain: string,
  meanRating: string,
  projectId?: string,
): Promise<void> {
  const indexPath = resolve("portfolio", "index.md");
  let content: string;
  try {
    content = await readFile(indexPath, "utf-8");
  } catch {
    content = "# Portfolio Index\n\n| ID | Title | Domain | Rating | Date | Project |\n|---|---|---|---|---|---|\n";
  }

  // Remove the "No artifacts yet" placeholder
  content = content.replace(/\n\*No artifacts yet\.\*\n?/, "\n");

  const date = new Date().toISOString().slice(0, 10);
  const row = `| ${id} | ${title} | ${domain} | ${meanRating} | ${date} | ${projectId ?? "—"} |`;
  content = content.trimEnd() + "\n" + row + "\n";

  await writeFile(indexPath, content, "utf-8");
}

export async function writeKilledArtifact(
  id: string,
  title: string,
  domain: string,
  reason: string,
  proposal: string,
): Promise<void> {
  const slug = slugify(title);
  const dir = resolve("portfolio", "killed", `${id}-${slug}`);
  await mkdir(dir, { recursive: true });

  const postMortem = [
    `# ${title} (KILLED)`,
    "",
    `**Domain:** ${domain}  `,
    `**ID:** ${id}`,
    "",
    "## Proposal",
    "",
    proposal,
    "",
    "## Kill Reason",
    "",
    reason,
    "",
  ].join("\n");

  await writeFile(path.join(dir, "README.md"), postMortem, "utf-8");
}
