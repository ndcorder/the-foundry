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
            complexity: { type: "string", enum: ["S", "M", "L", "XL"] },
            why: { type: "string" },
            project_id: {},
            stimulus_ref: {},
            xl_mode: { type: "string", enum: ["single", "project"] },
            project: { type: "object" },
          },
        },
      },
    },
  },
  "critic-gate1": {
    type: "object",
    required: ["evaluations"],
    properties: {
      selected: { type: ["string", "null"] },
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
            recommended_complexity: { type: "string", enum: ["S", "M", "L", "XL"] },
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
  "creator-plan": {
    type: "object",
    required: ["plan"],
    properties: {
      plan: {
        type: "object",
        required: ["approach", "file_manifest"],
        properties: {
          approach: { type: "string" },
          file_manifest: { type: "array" },
          key_decisions: { type: "array" },
          challenges: { type: "array" },
          build_order: { type: "array" },
        },
      },
    },
  },
  "creator-build": {
    type: "object",
    required: ["files"],
    properties: {
      files: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["path", "content"],
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
        },
      },
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

export function normalizeCriticGate1(data: unknown): unknown {
  if (!isObj(data)) return data;
  const d = data as any;
  const list = d.evaluations ?? d.decisions;
  if (!Array.isArray(list)) return data;

  if (typeof d.selected !== "string" && typeof d.selected_title === "string") {
    d.selected = d.selected_title;
  }
  if (d.selected === undefined || d.selected === "") {
    d.selected = null;
  }

  d.evaluations = list.map((e: any) => ({
    title: e.title,
    decision: e.decision ?? e.verdict ?? "reject",
    sharpening_notes: e.sharpening_notes ?? e.notes ?? e.sharpening ?? "",
    reasons: e.reasons ?? e.reason ?? "",
    recommended_complexity: e.recommended_complexity ?? null,
  }));
  delete d.decisions;
  delete d.selected_title;
  return data;
}

export function validateCriticGate1(data: unknown): data is CriticGate1Response {
  normalizeCriticGate1(data);
  if (!isObj(data) || !Array.isArray(data.evaluations) || data.evaluations.length === 0) return false;
  if (data.selected !== undefined && data.selected !== null && typeof data.selected !== "string") return false;
  return data.evaluations.every(
    (e: any) => typeof e.title === "string" && typeof e.decision === "string",
  );
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

export function normalizeCriticGate2(data: unknown): unknown {
  if (!isObj(data)) return data;
  const d = data as any;
  if (!d.decision && d.verdict) {
    d.decision = d.verdict;
    delete d.verdict;
  }
  return data;
}

export function validateCriticGate2(data: unknown): data is CriticGate2Response {
  normalizeCriticGate2(data);
  if (!isObj(data)) return false;
  if (typeof data.decision !== "string") return false;
  if (!isObj(data.ratings)) return false;
  if (typeof data.review !== "string") return false;
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

// ── Creator pipeline validators ──────────────────────────────────

export interface CreatorPlan {
  approach: string;
  file_manifest: Array<{ path: string; purpose: string; estimated_lines?: number }>;
  key_decisions: string[];
  challenges: string[];
  build_order?: string[][];
}

export interface CreatorPlanResponse {
  plan: CreatorPlan;
}

export interface CreatorBuildResponse {
  files: Array<{ path: string; content: string }>;
}

export function validateCreatorPlan(data: unknown): data is CreatorPlanResponse {
  if (!isObj(data) || !isObj(data.plan)) return false;
  const p = data.plan as any;
  return typeof p.approach === "string" && Array.isArray(p.file_manifest);
}

export function validateCreatorBuild(data: unknown): data is CreatorBuildResponse {
  if (!isObj(data) || !Array.isArray(data.files)) return false;
  return data.files.length > 0 && data.files.every(
    (f: any) => typeof f.path === "string" && typeof f.content === "string",
  );
}

// ── Registry ────────────────────────────────────────────────────

export type Validator<T> = (data: unknown) => data is T;

const validators: Record<string, Validator<any>> = {
  ideator: validateIdeator,
  "critic-gate1": validateCriticGate1,
  creator: validateCreator,
  tester: validateTester,
  "critic-gate2": validateCriticGate2,
  "curator-redirect": validateCuratorRedirect,
  "curator-full": validateCuratorFull,
  "creator-plan": validateCreatorPlan,
  "creator-build": validateCreatorBuild,
};

export function getValidator<T>(key: string): Validator<T> | undefined {
  return validators[key] as Validator<T> | undefined;
}
