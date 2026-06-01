import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import type { CriticRatings, CreatorFile } from "../types/index.js";
import { resolve } from "../root.js";
import { assertShippableCriticRatings, formatMeanCriticRating } from "../critic/ratings.js";

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

function resolveWithin(baseDir: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`Path traversal blocked: ${relativePath}`);
  }

  const base = path.resolve(baseDir);
  const target = path.resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`Path traversal blocked: ${relativePath}`);
  }

  return target;
}

export async function getNextArtifactId(): Promise<string> {
  const indexPath = resolve("portfolio", "index.md");
  const ids: number[] = [];

  try {
    const content = await readFile(indexPath, "utf-8");
    ids.push(...[...content.matchAll(/\|\s*(\d{4})\s*\|/g)].map((m) => parseInt(m[1], 10)));
  } catch {
    // Missing index is fine on a new install.
  }

  try {
    const killedEntries = await readdir(resolve("portfolio", "killed"), { withFileTypes: true });
    for (const entry of killedEntries) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/^(\d{4})-/);
      if (match) ids.push(parseInt(match[1], 10));
    }
  } catch {
    // Killed directory may not exist yet.
  }

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
  refinery?: {
    source_type: string;
    source_id: string;
    source_title: string;
    refinement_type: string;
    original_rating?: number;
  };
}

export async function writeArtifact(opts: WriteArtifactOpts): Promise<string> {
  assertShippableCriticRatings(opts.ratings);

  const slug = slugify(opts.title);
  const dirName = `${opts.id}-${slug}`;
  const base = domainDir(opts.domain);
  const artifactDir = resolve("portfolio", base, dirName);
  await mkdir(artifactDir, { recursive: true });

  // Write artifact files
  for (const f of opts.files) {
    const filePath = resolveWithin(artifactDir, f.path);
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

  const mean = formatMeanCriticRating(opts.ratings);

  const refinerySection = opts.refinery
    ? [
        "## Refinery Lineage",
        "",
        `Refined from ${opts.refinery.source_type} #${opts.refinery.source_id}: ${opts.refinery.source_title}.`,
        `Refinement type: ${opts.refinery.refinement_type}.`,
        opts.refinery.original_rating !== undefined
          ? `Original rating: ${opts.refinery.original_rating}.`
          : "",
        "",
      ].filter(Boolean)
    : [];

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
    ...refinerySection,
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

export interface PortfolioIndexMetadata {
  refined_from?: string;
}

function ensureRefinedFromColumn(content: string): string {
  if (content.includes("| Refined From |")) return content;

  const lines = content.split("\n");
  const headerIndex = lines.findIndex((line) => line.includes("| ID |") && line.includes("| Project |"));
  if (headerIndex < 0) return content;

  lines[headerIndex] = lines[headerIndex].replace(/\|\s*$/, "| Refined From |");
  if (lines[headerIndex + 1]?.includes("---")) {
    lines[headerIndex + 1] = lines[headerIndex + 1].replace(/\|\s*$/, "|---|");
  }

  for (let i = headerIndex + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|") || line.includes("---")) continue;
    const cells = line.split("|").slice(1, -1);
    if (cells.length === 6) {
      lines[i] = line.replace(/\|\s*$/, "| — |");
    }
  }

  return lines.join("\n");
}

export async function updatePortfolioIndex(
  id: string,
  title: string,
  domain: string,
  meanRating: string,
  projectId?: string,
  metadata?: PortfolioIndexMetadata,
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
  if (metadata?.refined_from) {
    content = ensureRefinedFromColumn(content);
  }

  const date = new Date().toISOString().slice(0, 10);
  const refinedFrom = metadata?.refined_from ? `#${metadata.refined_from}` : "—";
  const hasRefinedColumn = content.includes("| Refined From |");
  const row = hasRefinedColumn
    ? `| ${id} | ${title} | ${domain} | ${meanRating} | ${date} | ${projectId ?? "—"} | ${refinedFrom} |`
    : `| ${id} | ${title} | ${domain} | ${meanRating} | ${date} | ${projectId ?? "—"} |`;
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
