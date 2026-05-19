import { readFile } from "node:fs/promises";
import type { FoundryConfig } from "../types/index.js";
import { loadDomainsConfig } from "./config.js";
import { resolve } from "../root.js";

async function safeRead(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n\n[...truncated to fit context budget]";
}

interface PortfolioRow {
  line: string;
  id: string;
  rating: number;
  project: string;
}

function parsePortfolioTable(indexContent: string): { headers: string[]; rows: PortfolioRow[] } {
  const lines = indexContent.split("\n");
  const headers: string[] = [];
  const rows: PortfolioRow[] = [];
  let headersDone = false;

  for (const line of lines) {
    if (line.startsWith("|")) {
      if (!headersDone) {
        headers.push(line);
        if (headers.length >= 2) headersDone = true;
      } else {
        const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
        rows.push({
          line,
          id: cells[0] ?? "",
          rating: parseFloat(cells[3] ?? "0") || 0,
          project: cells[5] ?? "—",
        });
      }
    } else if (!headersDone) {
      headers.push(line);
    }
  }
  return { headers, rows };
}

function selectRelevantPortfolioEntries(
  indexContent: string,
  maxEntries: number,
  activeProjectIds: string[],
): string {
  const { headers, rows } = parsePortfolioTable(indexContent);
  if (rows.length <= maxEntries) return indexContent;

  const half = Math.floor(maxEntries / 2);
  const selected = new Map<string, PortfolioRow>();

  // 1. Last entries by recency (they're ordered chronologically in the file)
  for (const row of rows.slice(-half)) {
    selected.set(row.id, row);
  }

  // 2. Top entries by Critic score
  const byRating = [...rows].sort((a, b) => b.rating - a.rating);
  for (const row of byRating) {
    if (selected.size >= maxEntries) break;
    selected.set(row.id, row);
  }

  // 3. Active project artifacts (always include)
  if (activeProjectIds.length > 0) {
    for (const row of rows) {
      if (activeProjectIds.some((pid) => row.project.includes(pid))) {
        selected.set(row.id, row);
      }
    }
  }

  // Preserve original order
  const kept = rows.filter((r) => selected.has(r.id)).map((r) => r.line);
  return [...headers, ...kept].join("\n");
}

export async function buildSharedContext(
  config: FoundryConfig,
  activeProjectIds: string[] = [],
): Promise<string> {
  const [manifesto, journalCompressed, portfolioIndex, projectsIndex] =
    await Promise.all([
      safeRead(resolve("identity", "manifesto.md")),
      safeRead(resolve("identity", "journal-compressed.md")),
      safeRead(resolve("portfolio", "index.md")),
      safeRead(resolve("portfolio", "projects", "index.md")),
    ]);

  let domainsSection: string;
  try {
    const domainsConfig = await loadDomainsConfig();
    const rows = domainsConfig.domains.map(
      (d) => `| ${d.name} | ${d.description} | ${d.weight} |`
    );
    domainsSection = [
      "| Domain | Description | Weight |",
      "|---|---|---|",
      ...rows,
    ].join("\n");
  } catch {
    domainsSection = "*Domain configuration not available.*";
  }

  let truncatedJournal = truncateToTokenBudget(
    journalCompressed,
    config.context.journal_compressed_max_tokens,
  );

  // Hard fallback: if compressed journal is still too long after truncation,
  // keep only the most recent entries (from the bottom of the file)
  const maxChars = config.context.journal_compressed_max_tokens * 4;
  if (truncatedJournal.length > maxChars * 1.5) {
    const lines = journalCompressed.split("\n");
    const kept: string[] = [];
    let size = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      size += lines[i].length + 1;
      if (size > maxChars) break;
      kept.unshift(lines[i]);
    }
    truncatedJournal = "[...older entries compressed away]\n\n" + kept.join("\n");
  }

  const trimmedPortfolio = selectRelevantPortfolioEntries(
    portfolioIndex,
    config.context.portfolio_index_max_entries,
    activeProjectIds,
  );

  const sections = [
    "## Identity\n",
    manifesto || "*Manifesto not yet written.*",
    "\n## Recent History\n",
    truncatedJournal || "*No journal entries yet.*",
    "\n## Portfolio Summary\n",
    trimmedPortfolio || "*No artifacts in portfolio yet.*",
    "\n## Domain Balance\n",
    domainsSection,
    "\n## Active Projects\n",
    projectsIndex || "*No active projects.*",
  ];

  return sections.join("\n");
}
