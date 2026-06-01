import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolve } from "../root.js";

export interface PromptContract {
  name: string;
  relativePath: string;
  requiredPlaceholders: readonly string[];
  optionalPlaceholders?: readonly string[];
  sections?: readonly PromptSectionContract[];
}

export interface PromptSectionContract {
  name: string;
  marker: string;
  position: "before" | "from";
  requiredPlaceholders: readonly string[];
  optionalPlaceholders?: readonly string[];
}

export type PromptContractDiagnosticCode =
  | "missing_file"
  | "blank_file"
  | "missing_placeholder"
  | "unknown_placeholder"
  | "missing_section_marker"
  | "duplicate_section_marker";

export interface PromptContractDiagnostic {
  code: PromptContractDiagnosticCode;
  message: string;
  section?: string;
  marker?: string;
  placeholders?: string[];
}

export interface PromptContractFileStatus {
  name: string;
  path: string;
  ok: boolean;
  placeholders?: string[];
  errors?: string[];
  diagnostics?: PromptContractDiagnostic[];
}

export interface PromptContractSummary {
  total: number;
  ok: number;
  invalid: number;
}

export interface PromptContractReport {
  status: "healthy" | "invalid";
  summary: PromptContractSummary;
  files: PromptContractFileStatus[];
}

export const PROMPT_CONTRACTS: readonly PromptContract[] = [
  {
    name: "prompts/ideator.md",
    relativePath: "ideator.md",
    requiredPlaceholders: [
      "shared_context",
      "stimuli_live",
      "stimuli_skills",
      "lineage_context",
      "mood_context",
      "dreams_context",
      "stoker_directive",
      "speculative_ideas",
      "critic_gate1_history",
      "domain_list",
      "domain_cooldown",
      "novelty_window",
      "max_iterations_per_project",
    ],
    optionalPlaceholders: ["streak_context", "complexity_bias"],
  },
  {
    name: "prompts/critic.md",
    relativePath: "critic.md",
    requiredPlaceholders: [
      "shared_context",
      "ideator_proposals",
      "critic_gate1_history",
      "complexity_distribution",
      "critic_review_history",
      "artifact_content",
      "approved_proposal",
      "tester_report",
    ],
    sections: [
      {
        name: "Critic Gate 1",
        marker: "## GATE 2",
        position: "before",
        requiredPlaceholders: [
          "shared_context",
          "ideator_proposals",
          "critic_gate1_history",
          "complexity_distribution",
        ],
      },
      {
        name: "Critic Gate 2",
        marker: "## GATE 2",
        position: "from",
        requiredPlaceholders: [
          "shared_context",
          "critic_review_history",
          "artifact_content",
          "approved_proposal",
          "tester_report",
        ],
      },
    ],
  },
  {
    name: "prompts/creator.md",
    relativePath: "creator.md",
    requiredPlaceholders: [
      "shared_context",
      "critic_review_history",
      "approved_proposal",
      "critic_sharpening_notes",
      "project_context",
      "manifesto_quality_standards",
    ],
    optionalPlaceholders: ["streak_context"],
  },
  {
    name: "prompts/tester.md",
    relativePath: "tester.md",
    requiredPlaceholders: [
      "approved_proposal",
      "artifact_content",
      "critic_sharpening_notes",
    ],
  },
  {
    name: "prompts/curator.md",
    relativePath: "curator.md",
    requiredPlaceholders: [
      "shared_context_full",
      "curator_interval",
      "compression_cutoff",
      "domain_stats",
      "critic_rejection_rate",
      "project_statuses",
      "stimuli_staleness",
      "requests_content",
      "kickstart_after",
      "max_iterations_per_project",
    ],
  },
  {
    name: "prompts/refinery.md",
    relativePath: "refinery.md",
    requiredPlaceholders: ["source_context", "refinement_instructions"],
  },
  {
    name: "prompts/creator/plan.md",
    relativePath: path.join("creator", "plan.md"),
    requiredPlaceholders: [
      "shared_context",
      "approved_proposal",
      "critic_sharpening_notes",
      "project_context",
      "manifesto_quality_standards",
    ],
    optionalPlaceholders: ["streak_context"],
  },
  {
    name: "prompts/creator/build.md",
    relativePath: path.join("creator", "build.md"),
    requiredPlaceholders: [
      "plan",
      "approved_proposal_brief",
      "critic_sharpening_notes_brief",
      "prior_files",
      "build_batch",
    ],
  },
  {
    name: "prompts/creator/revise.md",
    relativePath: path.join("creator", "revise.md"),
    requiredPlaceholders: [
      "approved_proposal_brief",
      "critic_sharpening_notes",
      "key_decisions",
      "manifesto_quality_standards",
      "all_files",
    ],
  },
  {
    name: "prompts/creator/polish.md",
    relativePath: path.join("creator", "polish.md"),
    requiredPlaceholders: ["key_decisions", "revised_files"],
  },
  {
    name: "prompts/creator/assemble.md",
    relativePath: path.join("creator", "assemble.md"),
    requiredPlaceholders: ["file_manifest", "approved_proposal_brief", "all_files"],
  },
];

function promptsDir(): string {
  return resolve("prompts");
}

export async function loadPrompt(role: string): Promise<string> {
  return readFile(path.join(promptsDir(), `${role}.md`), "utf-8");
}

export async function loadCreatorPhasePrompt(phase: string): Promise<string> {
  return readFile(path.join(promptsDir(), "creator", `${phase}.md`), "utf-8");
}

export async function loadCriticGate1Prompt(): Promise<string> {
  const full = await loadPrompt("critic");
  const gate2Start = full.indexOf("## GATE 2");
  if (gate2Start < 0) return full;
  return full.slice(0, gate2Start).trim();
}

export async function loadCriticGate2Prompt(): Promise<string> {
  const full = await loadPrompt("critic");
  const gate2Start = full.indexOf("## GATE 2");
  if (gate2Start < 0) return full;
  return full.slice(gate2Start).trim();
}

export function injectVars(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

function extractPlaceholders(template: string): string[] {
  const placeholders = new Set<string>();
  for (const match of template.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    placeholders.add(match[1]);
  }
  return Array.from(placeholders).sort();
}

function validatePlaceholderSet(
  placeholders: string[],
  requiredPlaceholders: readonly string[],
  optionalPlaceholders: readonly string[] | undefined,
  label: string,
  section?: string,
): PromptContractDiagnostic[] {
  const placeholderSet = new Set(placeholders);
  const required = [...requiredPlaceholders].sort();
  const allowed = new Set([
    ...requiredPlaceholders,
    ...(optionalPlaceholders ?? []),
  ]);
  const missing = required.filter((placeholder) => !placeholderSet.has(placeholder));
  const unknown = placeholders.filter((placeholder) => !allowed.has(placeholder));
  const diagnostics: PromptContractDiagnostic[] = [];
  if (missing.length > 0) {
    diagnostics.push({
      code: "missing_placeholder",
      message: `${label}missing required placeholders: ${missing.join(", ")}`,
      ...(section ? { section } : {}),
      placeholders: missing,
    });
  }
  if (unknown.length > 0) {
    diagnostics.push({
      code: "unknown_placeholder",
      message: `${label}unknown placeholders: ${unknown.join(", ")}`,
      ...(section ? { section } : {}),
      placeholders: unknown,
    });
  }
  return diagnostics;
}

function validatePromptSections(content: string, contract: PromptContract): PromptContractDiagnostic[] {
  const diagnostics: PromptContractDiagnostic[] = [];
  const uniqueMarkers = new Set((contract.sections ?? []).map((section) => section.marker));
  for (const marker of uniqueMarkers) {
    const count = countOccurrences(content, marker);
    if (count > 1) {
      diagnostics.push({
        code: "duplicate_section_marker",
        message: `duplicate section marker appears ${count} times: ${marker}`,
        marker,
      });
    }
  }
  for (const section of contract.sections ?? []) {
    const markerIndex = content.indexOf(section.marker);
    if (markerIndex < 0) {
      diagnostics.push({
        code: "missing_section_marker",
        message: `missing required section marker for ${section.name}: ${section.marker}`,
        section: section.name,
        marker: section.marker,
      });
      continue;
    }
    const sectionContent = section.position === "before"
      ? content.slice(0, markerIndex)
      : content.slice(markerIndex);
    diagnostics.push(...validatePlaceholderSet(
      extractPlaceholders(sectionContent),
      section.requiredPlaceholders,
      section.optionalPlaceholders,
      `${section.name} `,
      section.name,
    ));
  }
  return diagnostics;
}

function countOccurrences(content: string, marker: string): number {
  let count = 0;
  let start = 0;
  while (start < content.length) {
    const index = content.indexOf(marker, start);
    if (index < 0) break;
    count += 1;
    start = index + marker.length;
  }
  return count;
}

async function validatePromptContract(contract: PromptContract): Promise<PromptContractFileStatus> {
  const filePath = path.join(promptsDir(), contract.relativePath);
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return {
      name: contract.name,
      path: filePath,
      ok: false,
      errors: ["missing prompt file"],
      diagnostics: [{ code: "missing_file", message: "missing prompt file" }],
    };
  }

  if (content.trim().length === 0) {
    return {
      name: contract.name,
      path: filePath,
      ok: false,
      placeholders: [],
      errors: ["prompt file is blank"],
      diagnostics: [{ code: "blank_file", message: "prompt file is blank" }],
    };
  }

  const placeholders = extractPlaceholders(content);
  const diagnostics = [
    ...validatePlaceholderSet(
      placeholders,
      contract.requiredPlaceholders,
      contract.optionalPlaceholders,
      "",
    ),
    ...validatePromptSections(content, contract),
  ];
  const errors = diagnostics.map((diagnostic) => diagnostic.message);

  return {
    name: contract.name,
    path: filePath,
    ok: errors.length === 0,
    placeholders,
    ...(errors.length > 0 ? { errors } : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

export async function validatePromptContracts(
  contracts: readonly PromptContract[] = PROMPT_CONTRACTS,
): Promise<PromptContractReport> {
  const files = await Promise.all(contracts.map(validatePromptContract));
  const invalid = files.filter((file) => !file.ok).length;
  return {
    status: invalid > 0 ? "invalid" : "healthy",
    summary: {
      total: files.length,
      ok: files.length - invalid,
      invalid,
    },
    files,
  };
}
