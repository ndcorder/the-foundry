import yaml from "yaml";
import type {
  IdeatorResponse,
  CriticGate1Response,
  CreatorResponse,
  TesterResponse,
  CriticGate2Response,
  CuratorRedirectResponse,
  CuratorFullResponse,
} from "../types/index.js";

function stripWrappers(text: string): string {
  // Strip thinking/reasoning/output tags that GLM models sometimes emit
  let cleaned = text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .replace(/<output>([\s\S]*?)<\/output>/gi, "$1")
    .replace(/<response>([\s\S]*?)<\/response>/gi, "$1")
    .replace(/<answer>([\s\S]*?)<\/answer>/gi, "$1")
    .trim();
  return cleaned;
}

function extractYamlBlock(text: string): string {
  const cleaned = stripWrappers(text);

  // Strategy 1: explicit YAML code fence (most reliable)
  const fenced = cleaned.match(/```(?:ya?ml)?\s*\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  // Strategy 2: any code fence at all
  const anyFence = cleaned.match(/```\w*\s*\n([\s\S]*?)```/);
  if (anyFence) {
    const inner = anyFence[1].trim();
    // Only use if it looks like YAML (has key: value patterns)
    if (/^[a-z_][a-z0-9_-]*\s*:/m.test(inner)) return inner;
  }

  // Strategy 3: find the first YAML-like line and take everything from there
  const lines = cleaned.split("\n");
  const start = lines.findIndex((l) => /^[a-z_][a-z0-9_-]*\s*:/.test(l));
  if (start >= 0) {
    // Find end: stop at lines that are clearly not YAML (markdown headers, etc.)
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^```/.test(l) || /^#{1,3}\s/.test(l)) { end = i; break; }
    }
    return lines.slice(start, end).join("\n").trim();
  }

  return cleaned;
}

export function parseYaml<T>(text: string): T {
  const block = extractYamlBlock(text);

  try {
    return yaml.parse(block) as T;
  } catch (firstError) {
    // Retry with light cleanup: tabs → spaces, trailing whitespace
    const fixedBlock = block.replace(/\t/g, "  ").replace(/[ \t]+$/gm, "");
    if (fixedBlock !== block) {
      try { return yaml.parse(fixedBlock) as T; } catch { /* fall through */ }
    }

    // Retry: if the block starts with `---`, strip the document marker
    if (block.startsWith("---")) {
      const stripped = block.replace(/^---\s*\n/, "").replace(/\n---\s*$/, "");
      try { return yaml.parse(stripped) as T; } catch { /* fall through */ }
    }

    throw firstError;
  }
}

export function buildCorrectionPrompt(rawResponse: string, error: string): string {
  const truncated = rawResponse.length > 2000 ? rawResponse.slice(0, 2000) + "\n[...truncated]" : rawResponse;
  return [
    "Your previous response wasn't valid YAML. Here's what I received:",
    "",
    "```",
    truncated,
    "```",
    "",
    `Parse error: ${error}`,
    "",
    "Please respond with ONLY valid YAML matching the output format specified in your original instructions.",
    "Do not include any text before or after the YAML block.",
  ].join("\n");
}

// ── Validators ───────────────────────────────────────────────────
// Structural checks — not exhaustive, just enough to catch garbled output.

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateIdeator(data: unknown): data is IdeatorResponse {
  if (!isObj(data) || !Array.isArray(data.ideas)) return false;
  return data.ideas.length > 0 && data.ideas.every(
    (i: any) => typeof i.title === "string" && typeof i.domain === "string" && typeof i.pitch === "string",
  );
}

export function validateCriticGate1(data: unknown): data is CriticGate1Response {
  if (!isObj(data)) return false;

  // Accept both "evaluations" and "decisions" as the list key
  const list = (data as any).evaluations ?? (data as any).decisions;
  if (!Array.isArray(list) || list.length === 0) return false;

  const valid = list.every(
    (e: any) => typeof e.title === "string" && (typeof e.decision === "string" || typeof e.verdict === "string"),
  );
  if (!valid) return false;

  // Normalize into the canonical shape
  (data as any).evaluations = list.map((e: any) => ({
    title: e.title,
    decision: e.decision ?? e.verdict ?? "reject",
    sharpening_notes: e.sharpening_notes ?? e.notes ?? e.sharpening ?? "",
    reasons: e.reasons ?? e.reason ?? "",
  }));
  delete (data as any).decisions;

  return true;
}

export function validateCreator(data: unknown): data is CreatorResponse {
  if (!isObj(data)) return false;
  if (typeof data.title !== "string") return false;
  if (!Array.isArray(data.files) || data.files.length === 0) return false;
  return data.files.every(
    (f: any) => typeof f.path === "string" && typeof f.content === "string",
  );
}

export function validateTester(data: unknown): data is TesterResponse {
  if (!isObj(data)) return false;
  return typeof data.verdict === "string" && typeof data.summary === "string";
}

export function validateCriticGate2(data: unknown): data is CriticGate2Response {
  if (!isObj(data)) return false;

  // Accept both "decision" and "verdict" for the gate 2 outcome
  if (typeof data.decision !== "string" && typeof data.verdict !== "string") return false;
  if (!isObj(data.ratings)) return false;
  if (typeof data.review !== "string") return false;

  // Normalize "verdict" → "decision"
  if (!data.decision && data.verdict) {
    (data as any).decision = data.verdict;
    delete (data as any).verdict;
  }

  return true;
}

export function validateCuratorRedirect(data: unknown): data is CuratorRedirectResponse {
  if (!isObj(data) || !isObj(data.proposal)) return false;
  const p = data.proposal as any;
  return typeof p.title === "string" && typeof p.domain === "string";
}

export function validateCuratorFull(data: unknown): data is CuratorFullResponse {
  if (!isObj(data)) return false;
  if (typeof data.retrospective !== "string") return false;
  if (typeof data.compressed_journal !== "string") return false;
  return true;
}

export type Validator<T> = (data: unknown) => data is T;

const validators: Record<string, Validator<any>> = {
  ideator: validateIdeator,
  "critic-gate1": validateCriticGate1,
  creator: validateCreator,
  tester: validateTester,
  "critic-gate2": validateCriticGate2,
  "curator-redirect": validateCuratorRedirect,
  "curator-full": validateCuratorFull,
};

export function getValidator<T>(key: string): Validator<T> | undefined {
  return validators[key] as Validator<T> | undefined;
}
