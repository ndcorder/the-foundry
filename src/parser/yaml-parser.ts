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

function extractYamlBlock(text: string): string {
  // Prefer explicit YAML code fence
  const fenced = text.match(/```(?:ya?ml)?\s*\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();

  // Look for raw YAML (line starting with a key: or list item)
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^\s*[a-z_][a-z0-9_-]*\s*:|^\s*- /.test(l));
  if (start >= 0) return lines.slice(start).join("\n").trim();

  return text.trim();
}

export function parseYaml<T>(text: string): T {
  const block = extractYamlBlock(text);
  return yaml.parse(block) as T;
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
