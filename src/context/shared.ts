import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FoundryConfig } from "../types/index.js";
import { loadDomainsConfig } from "./config.js";

function resolve(...segments: string[]): string {
  return path.join(process.cwd(), ...segments);
}

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

function takeLastEntries(indexContent: string, maxEntries: number): string {
  const lines = indexContent.split("\n");
  const tableRows: string[] = [];
  const headerLines: string[] = [];
  let inTable = false;

  for (const line of lines) {
    if (line.startsWith("|")) {
      if (!inTable) {
        // First two pipe-lines are header + separator
        headerLines.push(line);
        inTable = true;
      } else if (headerLines.length < 2) {
        headerLines.push(line);
      } else {
        tableRows.push(line);
      }
    } else if (!inTable) {
      headerLines.push(line);
    }
  }

  const kept = tableRows.slice(-maxEntries);
  if (kept.length === 0) return indexContent;
  return [...headerLines, ...kept].join("\n");
}

export async function buildSharedContext(config: FoundryConfig): Promise<string> {
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

  const truncatedJournal = truncateToTokenBudget(
    journalCompressed,
    config.context.journal_compressed_max_tokens
  );

  const trimmedPortfolio = takeLastEntries(
    portfolioIndex,
    config.context.portfolio_index_max_entries
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
