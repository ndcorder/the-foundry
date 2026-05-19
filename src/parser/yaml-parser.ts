import yaml from "yaml";
import { repair, retryPrompt, type ValidationError } from "outputguard";
import type {
  IdeatorResponse,
  CriticGate1Response,
  CreatorResponse,
  TesterResponse,
  CriticGate2Response,
  CuratorRedirectResponse,
  CuratorFullResponse,
} from "../types/index.js";

// ── JSON Schemas for retry prompts ───────────────────────────────

const SCHEMAS: Record<string, Record<string, unknown>> = {
  ideator: {
    type: "object",
    required: ["ideas"],
    properties: {
      ideas: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["title", "domain", "pitch", "complexity", "why"],
          properties: {
            title: { type: "string" },
            domain: { type: "string" },
            pitch: { type: "string" },
            complexity: { type: "string", enum: ["S", "M", "L"] },
            why: { type: "string" },
            project_id: {},
            stimulus_ref: {},
          },
        },
      },
    },
  },
  "critic-gate1": {
    type: "object",
    required: ["evaluations"],
    properties: {
      evaluations: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["title", "decision"],
          properties: {
            title: { type: "string" },
            decision: { type: "string" },
            sharpening_notes: { type: "string" },
            reasons: { type: "string" },
          },
        },
      },
    },
  },
  creator: {
    type: "object",
    required: ["title", "files"],
    properties: {
      title: { type: "string" },
      files: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["path", "content"],
          properties: {
            path: { type: "string" },
            content: { type: "string" },
            language: { type: "string" },
          },
        },
      },
      notes: { type: "string" },
    },
  },
  tester: {
    type: "object",
    required: ["verdict", "summary"],
    properties: {
      verdict: { type: "string", enum: ["pass", "fail_fixable", "fail_catastrophic"] },
      summary: { type: "string" },
      tests_run: { type: "array" },
      issues: { type: "array" },
      post_mortem: {},
      test_plan: { type: "object" },
    },
  },
  "critic-gate2": {
    type: "object",
    required: ["decision", "ratings", "review"],
    properties: {
      decision: { type: "string", enum: ["ship", "revise", "kill"] },
      ratings: { type: "object" },
      review: { type: "string" },
      revision_notes: { type: "string" },
      kill_reason: { type: "string" },
    },
  },
  "curator-redirect": {
    type: "object",
    required: ["proposal"],
    properties: {
      proposal: {
        type: "object",
        required: ["title", "domain"],
        properties: {
          title: { type: "string" },
          domain: { type: "string" },
          pitch: { type: "string" },
          complexity: { type: "string" },
          why: { type: "string" },
        },
      },
    },
  },
  "curator-full": {
    type: "object",
    required: ["retrospective", "compressed_journal"],
    properties: {
      retrospective: { type: "string" },
      compressed_journal: { type: "string" },
      manifesto_changes: { type: "array" },
      domain_recommendations: { type: "string" },
      project_decisions: { type: "array" },
      stimuli_actions: { type: "array" },
    },
  },
};

export function getSchema(role: string): Record<string, unknown> | undefined {
  return SCHEMAS[role];
}

// ── Parsing ──────────────────────────────────────────────────────

function stripLlmWrappers(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .replace(/<output>([\s\S]*?)<\/output>/gi, "$1")
    .replace(/<response>([\s\S]*?)<\/response>/gi, "$1")
    .replace(/<answer>([\s\S]*?)<\/answer>/gi, "$1")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<tool_use>[\s\S]*?<\/tool_use>/gi, "")
    .replace(/<function_call>[\s\S]*?<\/function_call>/gi, "")
    .trim();
}

export function parseYaml<T>(text: string): T {
  const cleaned = stripLlmWrappers(text);
  const result = repair(cleaned, { format: "yaml" });
  if (!result.repaired && result.parseError) {
    throw new Error(result.parseError);
  }
  return yaml.parse(result.text) as T;
}

export function buildCorrectionPrompt(rawResponse: string, error: string, role?: string): string {
  const schema = role ? SCHEMAS[role] : undefined;
  if (schema) {
    const errors: ValidationError[] = [{ message: error, path: "$", schemaPath: "", value: undefined }];
    return retryPrompt(rawResponse, schema, errors, { format: "yaml", includeMessageHistory: true });
  }
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

  const list = (data as any).evaluations ?? (data as any).decisions;
  if (!Array.isArray(list) || list.length === 0) return false;

  const valid = list.every(
    (e: any) => typeof e.title === "string" && (typeof e.decision === "string" || typeof e.verdict === "string"),
  );
  if (!valid) return false;

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

  if (typeof data.decision !== "string" && typeof data.verdict !== "string") return false;
  if (!isObj(data.ratings)) return false;
  if (typeof data.review !== "string") return false;

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
