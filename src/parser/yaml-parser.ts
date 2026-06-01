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
import { meetsCriticShipThreshold, validateCriticRatings } from "../critic/ratings.js";

// ── JSON Schemas for retry prompts ───────────────────────────────

const CRITIC_RATING_VALUE_SCHEMA = {
  type: "number",
  minimum: 1,
  maximum: 5,
};

const CRITIC_RATINGS_SCHEMA = {
  type: "object",
  required: [
    "originality",
    "specificity",
    "craft",
    "surprise",
    "coherence",
    "portfolio_fit",
  ],
  properties: {
    originality: CRITIC_RATING_VALUE_SCHEMA,
    specificity: CRITIC_RATING_VALUE_SCHEMA,
    craft: CRITIC_RATING_VALUE_SCHEMA,
    surprise: CRITIC_RATING_VALUE_SCHEMA,
    coherence: CRITIC_RATING_VALUE_SCHEMA,
    portfolio_fit: CRITIC_RATING_VALUE_SCHEMA,
    technical_quality: CRITIC_RATING_VALUE_SCHEMA,
  },
};

const NON_BLANK_STRING_SCHEMA = {
  type: "string",
  minLength: 1,
  pattern: "\\S",
};

const OPTIONAL_NON_BLANK_STRING_SCHEMA = {
  type: ["string", "null"],
  minLength: 1,
  pattern: "\\S",
};

const SAFE_RELATIVE_FILE_PATH_PATTERN =
  "^(?!.*[\\u0000-\\u001F\\u007F])(?!/)(?![A-Za-z]:)(?!.*\\\\)(?!.*//)(?!.*/$)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*(?:^|/)\\.(?:/|$))(?!\\s)(?!.*\\s$).+$";

const SAFE_RELATIVE_FILE_PATH_SCHEMA = {
  type: "string",
  minLength: 1,
  pattern: SAFE_RELATIVE_FILE_PATH_PATTERN,
  description: "A relative POSIX file path inside the artifact; no absolute paths, drive prefixes, backslashes, NUL bytes, control characters, empty segments, leading/trailing whitespace, or '.'/'..' segments.",
};

const IDEATOR_PROJECT_SCHEMA = {
  type: "object",
  required: ["name", "description", "estimated_iterations", "structure"],
  properties: {
    name: NON_BLANK_STRING_SCHEMA,
    description: NON_BLANK_STRING_SCHEMA,
    estimated_iterations: { type: "integer", minimum: 1 },
    structure: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        minProperties: 1,
        additionalProperties: NON_BLANK_STRING_SCHEMA,
      },
    },
  },
};

const IDEATOR_PROPOSAL_SCHEMA = {
  type: "object",
  required: ["title", "domain", "pitch", "complexity", "why"],
  properties: {
    title: {
      ...NON_BLANK_STRING_SCHEMA,
      description: "A non-empty proposal title; titles must be unique within the ideas array.",
    },
    domain: {
      ...NON_BLANK_STRING_SCHEMA,
      description: "A non-empty configured domain slug.",
    },
    pitch: {
      ...NON_BLANK_STRING_SCHEMA,
      description: "A non-empty proposal pitch.",
    },
    complexity: { type: "string", enum: ["S", "M", "L", "XL"] },
    why: {
      ...NON_BLANK_STRING_SCHEMA,
      description: "A non-empty rationale for why this belongs in the portfolio.",
    },
    project_id: {
      ...OPTIONAL_NON_BLANK_STRING_SCHEMA,
      description: "Optional active project id when continuing a project; omit or null for standalone work and new project starters.",
    },
    stimulus_ref: {
      ...OPTIONAL_NON_BLANK_STRING_SCHEMA,
      description: "Optional non-empty reference to the stimulus source that inspired the proposal.",
    },
    xl_mode: {
      type: ["string", "null"],
      enum: ["single", "project", null],
      description: "Required for XL proposals: 'single' or 'project'. Use 'project' for L/XL project starters; otherwise null for non-XL proposals.",
    },
    project: {
      anyOf: [{ type: "null" }, IDEATOR_PROJECT_SCHEMA],
      description: "Required when xl_mode: project; otherwise null or omitted.",
    },
  },
};

const MANIFESTO_CHANGE_SCHEMA = {
  type: "object",
  required: ["section", "old", "new", "reason"],
  properties: {
    section: NON_BLANK_STRING_SCHEMA,
    old: NON_BLANK_STRING_SCHEMA,
    new: { type: "string" },
    reason: NON_BLANK_STRING_SCHEMA,
  },
};

const PROJECT_DECISION_SCHEMA = {
  type: "object",
  required: ["project_id", "action", "reason"],
  properties: {
    project_id: NON_BLANK_STRING_SCHEMA,
    action: { type: "string", enum: ["continue", "complete", "abandon", "extend"] },
    reason: NON_BLANK_STRING_SCHEMA,
  },
};

const STIMULI_ACTION_SCHEMA = {
  type: "object",
  required: ["action", "target"],
  allOf: [
    {
      if: { properties: { action: { const: "commission_skill" } }, required: ["action"] },
      then: {
        required: ["content"],
        properties: { content: NON_BLANK_STRING_SCHEMA },
      },
    },
  ],
  properties: {
    action: { type: "string", enum: ["refresh", "commission_skill"] },
    target: NON_BLANK_STRING_SCHEMA,
    content: NON_BLANK_STRING_SCHEMA,
  },
};

const CREATOR_FILE_MANIFEST_ENTRY_SCHEMA = {
  type: "object",
  required: ["path", "purpose"],
  properties: {
    path: SAFE_RELATIVE_FILE_PATH_SCHEMA,
    purpose: NON_BLANK_STRING_SCHEMA,
    estimated_lines: { type: "integer", minimum: 1 },
  },
};

const CREATOR_OUTPUT_FILE_SCHEMA = {
  type: "object",
  required: ["path", "content"],
  properties: {
    path: SAFE_RELATIVE_FILE_PATH_SCHEMA,
    content: NON_BLANK_STRING_SCHEMA,
    language: NON_BLANK_STRING_SCHEMA,
  },
};

const TESTER_TEST_RESULT_SCHEMA = {
  type: "object",
  required: ["name", "result", "details"],
  properties: {
    name: NON_BLANK_STRING_SCHEMA,
    result: { type: "string", enum: ["pass", "fail"] },
    details: NON_BLANK_STRING_SCHEMA,
  },
};

const TESTER_ISSUE_SCHEMA = {
  type: "object",
  required: ["severity", "description", "location"],
  properties: {
    severity: { type: "string", enum: ["critical", "major", "minor"] },
    description: NON_BLANK_STRING_SCHEMA,
    location: NON_BLANK_STRING_SCHEMA,
    suggested_fix: OPTIONAL_NON_BLANK_STRING_SCHEMA,
  },
};

const TESTER_FIXABLE_ISSUE_SCHEMA = {
  ...TESTER_ISSUE_SCHEMA,
  required: ["severity", "description", "location", "suggested_fix"],
  properties: {
    ...TESTER_ISSUE_SCHEMA.properties,
    suggested_fix: NON_BLANK_STRING_SCHEMA,
  },
};

const TESTER_TEST_PLAN_FILE_SCHEMA = {
  type: "object",
  required: ["path", "content"],
  properties: {
    path: SAFE_RELATIVE_FILE_PATH_SCHEMA,
    content: NON_BLANK_STRING_SCHEMA,
  },
};

const TESTER_TEST_PLAN_SCHEMA = {
  type: "object",
  required: ["language", "setup_commands", "files", "run_command"],
  properties: {
    language: NON_BLANK_STRING_SCHEMA,
    setup_commands: { type: "array", items: NON_BLANK_STRING_SCHEMA },
    files: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      description: "Generated test files to write into the sandbox; file paths must be unique.",
      items: TESTER_TEST_PLAN_FILE_SCHEMA,
    },
    run_command: NON_BLANK_STRING_SCHEMA,
  },
};

const SCHEMAS: Record<string, Record<string, unknown>> = {
  ideator: {
    type: "object",
    required: ["ideas"],
    properties: {
      ideas: {
        type: "array",
        minItems: 5,
        maxItems: 5,
        description: "Exactly five ideas. At least four must be M/L/XL. At least three must be L/XL.",
        items: IDEATOR_PROPOSAL_SCHEMA,
      },
    },
  },
  "critic-gate1": {
    type: "object",
    required: ["evaluations"],
    properties: {
      selected: {
        type: ["string", "null"],
        description: "This must exactly match the title of an approved evaluation. It is required when any evaluation is approved; use null only when no proposal is approved.",
      },
      evaluations: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["title", "decision"],
          allOf: [
            {
              if: { properties: { decision: { const: "reject" } }, required: ["decision"] },
              then: {
                required: ["reasons"],
                properties: {
                  reasons: NON_BLANK_STRING_SCHEMA,
                  recommended_complexity: {
                    type: "null",
                    description: "Only approved evaluations may recommend a build complexity override.",
                  },
                },
              },
            },
            {
              if: { properties: { decision: { const: "revise" } }, required: ["decision"] },
              then: {
                required: ["reasons"],
                properties: {
                  reasons: NON_BLANK_STRING_SCHEMA,
                  recommended_complexity: {
                    type: "null",
                    description: "Only approved evaluations may recommend a build complexity override.",
                  },
                },
              },
            },
          ],
          properties: {
            title: {
              ...NON_BLANK_STRING_SCHEMA,
              description: "A non-empty proposal title; each evaluation title must be unique.",
            },
            decision: { type: "string", enum: ["approve", "reject", "revise"] },
            sharpening_notes: { type: "string" },
            reasons: {
              type: "string",
              description: "Required and non-empty for reject or revise decisions.",
            },
            recommended_complexity: {
              type: ["string", "null"],
              enum: ["S", "M", "L", "XL", null],
              description: "Optional complexity override for approved evaluations only; use null for reject or revise evaluations.",
            },
          },
        },
      },
    },
  },
  creator: {
    type: "object",
    required: ["title", "files"],
    properties: {
      title: NON_BLANK_STRING_SCHEMA,
      files: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        description: "Artifact files to write; file paths must be unique.",
        items: CREATOR_OUTPUT_FILE_SCHEMA,
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
          approach: NON_BLANK_STRING_SCHEMA,
          file_manifest: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            description: "Planned artifact files; file paths must be unique.",
            items: CREATOR_FILE_MANIFEST_ENTRY_SCHEMA,
          },
          key_decisions: { type: "array", items: NON_BLANK_STRING_SCHEMA },
          challenges: { type: "array", items: NON_BLANK_STRING_SCHEMA },
          build_order: {
            type: "array",
            items: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: {
                ...SAFE_RELATIVE_FILE_PATH_SCHEMA,
                description: "A safe relative path that appears in file_manifest; no absolute paths, drive prefixes, backslashes, NUL bytes, control characters, empty segments, leading/trailing whitespace, or '.'/'..' segments.",
              },
            },
          },
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
        uniqueItems: true,
        description: "Artifact files to write; file paths must be unique.",
        items: CREATOR_OUTPUT_FILE_SCHEMA,
      },
    },
  },
  tester: {
    type: "object",
    required: ["verdict", "summary", "tests_run", "issues"],
    allOf: [
      {
        if: { properties: { verdict: { const: "pass" } }, required: ["verdict"] },
        then: {
          properties: {
            tests_run: {
              type: "array",
              items: {
                type: "object",
                properties: { result: { const: "pass" } },
              },
              description: "Passing reports cannot include failed test/check results.",
            },
            issues: {
              type: "array",
              maxItems: 0,
              description: "Passing reports cannot include open issues.",
            },
          },
        },
      },
      {
        if: { properties: { verdict: { const: "fail_catastrophic" } }, required: ["verdict"] },
        then: {
          required: ["post_mortem"],
          properties: { post_mortem: NON_BLANK_STRING_SCHEMA },
        },
        else: {
          properties: {
            post_mortem: {
              type: "null",
              description: "Only fail_catastrophic reports may include a non-empty post mortem; use null or omit otherwise.",
            },
          },
        },
      },
      {
        if: { properties: { verdict: { const: "fail_fixable" } }, required: ["verdict"] },
        then: {
          properties: {
            issues: {
              type: "array",
              minItems: 1,
              items: TESTER_FIXABLE_ISSUE_SCHEMA,
              description: "Fixable failures must include at least one issue with non-empty suggested_fix guidance.",
            },
          },
        },
        else: {
          properties: {
            issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  suggested_fix: {
                    type: "null",
                    description: "Only fail_fixable reports may include non-empty suggested_fix guidance; use null or omit otherwise.",
                  },
                },
              },
            },
          },
        },
      },
    ],
    properties: {
      verdict: { type: "string", enum: ["pass", "fail_fixable", "fail_catastrophic"] },
      summary: NON_BLANK_STRING_SCHEMA,
      tests_run: { type: "array", items: TESTER_TEST_RESULT_SCHEMA },
      issues: { type: "array", items: TESTER_ISSUE_SCHEMA },
      post_mortem: {
        ...OPTIONAL_NON_BLANK_STRING_SCHEMA,
        description: "Required and non-empty only when verdict is fail_catastrophic; otherwise use null or omit.",
      },
      test_plan: TESTER_TEST_PLAN_SCHEMA,
    },
  },
  "critic-gate2": {
    type: "object",
    required: ["decision", "ratings", "review"],
    allOf: [
      {
        if: { properties: { decision: { const: "revise" } }, required: ["decision"] },
        then: {
          required: ["revision_notes"],
          properties: { revision_notes: NON_BLANK_STRING_SCHEMA },
        },
      },
      {
        if: { properties: { decision: { const: "kill" } }, required: ["decision"] },
        then: {
          required: ["kill_reason"],
          properties: { kill_reason: NON_BLANK_STRING_SCHEMA },
        },
      },
    ],
    properties: {
      decision: { type: "string", enum: ["ship", "revise", "kill"] },
      ratings: CRITIC_RATINGS_SCHEMA,
      review: NON_BLANK_STRING_SCHEMA,
      revision_notes: NON_BLANK_STRING_SCHEMA,
      kill_reason: NON_BLANK_STRING_SCHEMA,
    },
  },
  "curator-redirect": {
    type: "object",
    required: ["proposal"],
    properties: {
      proposal: IDEATOR_PROPOSAL_SCHEMA,
    },
  },
  "curator-full": {
    type: "object",
    required: [
      "retrospective",
      "compressed_journal",
      "manifesto_changes",
      "domain_recommendations",
      "project_decisions",
      "stimuli_actions",
      "human_redirect",
    ],
    properties: {
      retrospective: { type: "string", minLength: 1 },
      compressed_journal: { type: "string", minLength: 1 },
      manifesto_changes: { type: "array", items: MANIFESTO_CHANGE_SCHEMA },
      domain_recommendations: { type: "string" },
      project_decisions: { type: "array", items: PROJECT_DECISION_SCHEMA },
      stimuli_actions: { type: "array", items: STIMULI_ACTION_SCHEMA },
      human_redirect: {
        anyOf: [
          { type: "null" },
          {
            type: "object",
            required: ["proposal"],
            properties: {
              proposal: IDEATOR_PROPOSAL_SCHEMA,
            },
          },
        ],
      },
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

const CRITIC_GATE1_DECISIONS = new Set(["approve", "reject", "revise"]);
const TESTER_VERDICTS = new Set(["pass", "fail_fixable", "fail_catastrophic"]);
const TESTER_TEST_RESULTS = new Set(["pass", "fail"]);
const TESTER_ISSUE_SEVERITIES = new Set(["critical", "major", "minor"]);
const CRITIC_GATE2_DECISIONS = new Set(["ship", "revise", "kill"]);
const COMPLEXITY_TIERS = new Set(["S", "M", "L", "XL"]);
const PROJECT_DECISION_ACTIONS = new Set(["continue", "complete", "abandon", "extend"]);
const STIMULI_ACTIONS = new Set(["refresh", "commission_skill"]);
function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateOptionalNonBlankString(value: unknown): boolean {
  return value === undefined || value === null || isNonBlankString(value);
}

function validateIdeatorProject(project: unknown): boolean {
  if (!isObj(project)) return false;
  return isNonBlankString(project.name) &&
    isNonBlankString(project.description) &&
    typeof project.estimated_iterations === "number" &&
    Number.isInteger(project.estimated_iterations) &&
    project.estimated_iterations > 0 &&
    Array.isArray(project.structure) &&
    project.structure.length > 0 &&
    project.structure.every((part) => (
      isObj(part) &&
      Object.keys(part).length > 0 &&
      Object.values(part).every(isNonBlankString)
    ));
}

function validateIdeatorProposal(proposal: unknown): boolean {
  if (!isObj(proposal)) return false;
  if (!isNonBlankString(proposal.title)) return false;
  if (!validateOptionalNonBlankString(proposal.project_id)) return false;
  if (!validateOptionalNonBlankString(proposal.stimulus_ref)) return false;
  if (
    proposal.xl_mode !== undefined &&
    proposal.xl_mode !== null &&
    proposal.xl_mode !== "single" &&
    proposal.xl_mode !== "project"
  ) {
    return false;
  }
  if (proposal.complexity === "XL" && (proposal.xl_mode !== "single" && proposal.xl_mode !== "project")) {
    return false;
  }
  const hasProjectBlock = proposal.project !== undefined && proposal.project !== null;
  if (proposal.xl_mode === "single" && proposal.complexity !== "XL") return false;
  if (proposal.xl_mode === "project") {
    if (proposal.complexity !== "L" && proposal.complexity !== "XL") return false;
    if (proposal.project_id !== undefined && proposal.project_id !== null) return false;
    if (!validateIdeatorProject(proposal.project)) return false;
  } else if (hasProjectBlock) {
    return false;
  }
  return isNonBlankString(proposal.domain) &&
    isNonBlankString(proposal.pitch) &&
    typeof proposal.complexity === "string" &&
    COMPLEXITY_TIERS.has(proposal.complexity) &&
    isNonBlankString(proposal.why);
}

function validateProposalWrapper(wrapper: unknown): boolean {
  if (!isObj(wrapper)) return false;
  return validateIdeatorProposal(wrapper.proposal);
}

function validateManifestoChange(change: unknown): boolean {
  if (!isObj(change)) return false;
  return isNonBlankString(change.section) &&
    isNonBlankString(change.old) &&
    typeof change.new === "string" &&
    isNonBlankString(change.reason);
}

function validateProjectDecision(decision: unknown): boolean {
  if (!isObj(decision)) return false;
  return isNonBlankString(decision.project_id) &&
    typeof decision.action === "string" &&
    PROJECT_DECISION_ACTIONS.has(decision.action) &&
    isNonBlankString(decision.reason);
}

function validateStimuliAction(action: unknown): boolean {
  if (!isObj(action)) return false;
  return typeof action.action === "string" &&
    STIMULI_ACTIONS.has(action.action) &&
    isNonBlankString(action.target) &&
    (
      action.action !== "commission_skill" ||
      isNonBlankString(action.content)
    ) &&
    (
      action.content === undefined ||
      isNonBlankString(action.content)
    );
}

function validateOptionalArray(
  value: unknown,
  itemValidator: (item: unknown) => boolean,
): boolean {
  return value === undefined || (Array.isArray(value) && value.every(itemValidator));
}

function validateStringArray(value: unknown): boolean {
  return validateOptionalArray(value, isNonBlankString);
}

function validateBuildOrder(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const seen = new Set<string>();
  for (const batch of value) {
    if (!Array.isArray(batch) || batch.length === 0) return false;
    for (const path of batch) {
      if (!isSafeRelativeFilePath(path)) return false;
      if (seen.has(path)) return false;
      seen.add(path);
    }
  }
  return true;
}

function validateCreatorFileManifestEntry(entry: unknown): boolean {
  if (!isObj(entry)) return false;
  const estimatedLines = entry.estimated_lines;
  return isSafeRelativeFilePath(entry.path) &&
    isNonBlankString(entry.purpose) &&
    (
      estimatedLines === undefined ||
      (typeof estimatedLines === "number" && Number.isInteger(estimatedLines) && estimatedLines > 0)
    );
}

function isSafeRelativeFilePath(filePath: unknown): filePath is string {
  if (typeof filePath !== "string") return false;
  if (filePath.trim() !== filePath || filePath.length === 0) return false;
  if (filePath.startsWith("/") || filePath.includes("\\") || /^[A-Za-z]:/.test(filePath)) return false;
  if (/[\x00-\x1F\x7F]/.test(filePath)) return false;
  const segments = filePath.split("/");
  return segments.every((segment) =>
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".."
  );
}

function validateCreatorOutputFile(file: unknown): boolean {
  if (!isObj(file)) return false;
  return isSafeRelativeFilePath(file.path) &&
    isNonBlankString(file.content) &&
    (file.language === undefined || isNonBlankString(file.language));
}

function validateCreatorOutputFiles(
  files: unknown,
  options: { allowEmpty?: boolean } = {},
): files is Array<{ path: string; content: string }> {
  if (!Array.isArray(files)) return false;
  if (!options.allowEmpty && files.length === 0) return false;
  const seen = new Set<string>();
  for (const file of files) {
    if (!validateCreatorOutputFile(file)) return false;
    if (seen.has(file.path)) return false;
    seen.add(file.path);
  }
  return true;
}

function validateTesterTestResult(result: unknown): boolean {
  if (!isObj(result)) return false;
  return isNonBlankString(result.name) &&
    typeof result.result === "string" &&
    TESTER_TEST_RESULTS.has(result.result) &&
    isNonBlankString(result.details);
}

function validateTesterIssue(issue: unknown): boolean {
  if (!isObj(issue)) return false;
  return typeof issue.severity === "string" &&
    TESTER_ISSUE_SEVERITIES.has(issue.severity) &&
    isNonBlankString(issue.description) &&
    isNonBlankString(issue.location) &&
    validateOptionalNonBlankString(issue.suggested_fix);
}

function validateTesterIssueSuggestedFixForVerdict(verdict: string, issue: unknown): boolean {
  if (!isObj(issue)) return false;
  if (verdict === "fail_fixable") return isNonBlankString(issue.suggested_fix);
  return issue.suggested_fix === undefined || issue.suggested_fix === null;
}

function validateTesterTestPlanFile(file: unknown): boolean {
  if (!isObj(file)) return false;
  return isSafeRelativeFilePath(file.path) && isNonBlankString(file.content);
}

function validateTesterTestPlanFiles(files: unknown): boolean {
  if (!Array.isArray(files) || files.length === 0) return false;
  const seen = new Set<string>();
  for (const file of files) {
    if (!validateTesterTestPlanFile(file)) return false;
    const path = (file as { path: string }).path;
    if (seen.has(path)) return false;
    seen.add(path);
  }
  return true;
}

function validateTesterTestPlan(plan: unknown): boolean {
  if (!isObj(plan)) return false;
  return isNonBlankString(plan.language) &&
    Array.isArray(plan.setup_commands) &&
    plan.setup_commands.every(isNonBlankString) &&
    validateTesterTestPlanFiles(plan.files) &&
    typeof plan.run_command === "string" &&
    plan.run_command.trim().length > 0;
}

function validateTesterPostMortem(verdict: string, postMortem: unknown): boolean {
  if (verdict === "fail_catastrophic") return isNonBlankString(postMortem);
  return postMortem === undefined || postMortem === null;
}

function creatorPlanManifestPaths(manifest: Array<{ path: string }>): Set<string> | null {
  const paths = new Set<string>();
  for (const entry of manifest) {
    if (paths.has(entry.path)) return null;
    paths.add(entry.path);
  }
  return paths;
}

function validateCreatorBuildOrderReferences(
  buildOrder: unknown,
  manifestPaths: ReadonlySet<string>,
): boolean {
  if (buildOrder === undefined) return true;
  if (!Array.isArray(buildOrder)) return false;
  return buildOrder.every((batch) =>
    Array.isArray(batch) && batch.every((path) => isSafeRelativeFilePath(path) && manifestPaths.has(path))
  );
}

function validateOptionalComplexityTier(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && COMPLEXITY_TIERS.has(value));
}

function validateCriticGate1Evaluation(e: unknown): boolean {
  if (!isObj(e)) return false;
  if (!isNonBlankString(e.title)) return false;
  if (typeof e.decision !== "string" || !CRITIC_GATE1_DECISIONS.has(e.decision)) return false;
  if (!validateOptionalComplexityTier(e.recommended_complexity)) return false;
  if (e.decision !== "approve" && e.recommended_complexity !== undefined && e.recommended_complexity !== null) return false;
  if (e.decision !== "approve" && !isNonBlankString(e.reasons)) return false;
  return true;
}

function validateUniqueEvaluationTitles(evaluations: unknown[]): boolean {
  const titles = new Set<string>();
  for (const evaluation of evaluations) {
    if (!isObj(evaluation) || typeof evaluation.title !== "string") return false;
    if (titles.has(evaluation.title)) return false;
    titles.add(evaluation.title);
  }
  return true;
}

function normalizeIdeator(data: unknown): unknown {
  if (!isObj(data) || !Array.isArray(data.ideas)) return data;
  for (const idea of data.ideas) {
    if (isObj(idea) && typeof idea.title === "string") {
      idea.title = idea.title.trim();
    }
  }
  return data;
}

function validateUniqueProposalTitles(proposals: unknown[]): boolean {
  const titles = new Set<string>();
  for (const proposal of proposals) {
    if (!isObj(proposal) || typeof proposal.title !== "string") return false;
    if (titles.has(proposal.title)) return false;
    titles.add(proposal.title);
  }
  return true;
}

function validateIdeatorComplexityDistribution(proposals: Array<{ complexity?: unknown }>): boolean {
  const atLeastM = proposals.filter((proposal) =>
    proposal.complexity === "M" || proposal.complexity === "L" || proposal.complexity === "XL"
  ).length;
  const atLeastL = proposals.filter((proposal) => proposal.complexity === "L" || proposal.complexity === "XL").length;
  return atLeastM >= 4 && atLeastL >= 3;
}

export function validateIdeator(data: unknown): data is IdeatorResponse {
  normalizeIdeator(data);
  if (!isObj(data) || !Array.isArray(data.ideas)) return false;
  return data.ideas.length === 5 &&
    data.ideas.every(validateIdeatorProposal) &&
    validateUniqueProposalTitles(data.ideas) &&
    validateIdeatorComplexityDistribution(data.ideas);
}

export function normalizeCriticGate1(data: unknown): unknown {
  if (!isObj(data)) return data;
  const d = data as any;
  const list = d.evaluations ?? d.decisions;
  if (!Array.isArray(list)) return data;

  if (typeof d.selected !== "string" && typeof d.selected_title === "string") {
    d.selected = d.selected_title;
  }
  if (typeof d.selected === "string") {
    d.selected = d.selected.trim();
  }
  if (d.selected === undefined || d.selected === "") {
    d.selected = null;
  }

  d.evaluations = list.map((e: unknown) => {
    if (!isObj(e)) return e;
    return {
      title: typeof e.title === "string" ? e.title.trim() : e.title,
      decision: e.decision ?? e.verdict ?? "reject",
      sharpening_notes: e.sharpening_notes ?? e.notes ?? e.sharpening ?? "",
      reasons: e.reasons ?? e.reason ?? "",
      recommended_complexity: e.recommended_complexity ?? null,
    };
  });
  delete d.decisions;
  delete d.selected_title;
  return data;
}

export function validateCriticGate1(data: unknown): data is CriticGate1Response {
  const selectedWasExplicitNull = isObj(data) &&
    Object.prototype.hasOwnProperty.call(data, "selected") &&
    data.selected === null;
  normalizeCriticGate1(data);
  if (!isObj(data) || !Array.isArray(data.evaluations) || data.evaluations.length === 0) return false;
  if (data.selected !== undefined && data.selected !== null && typeof data.selected !== "string") return false;
  const evaluationsValid = data.evaluations.every(validateCriticGate1Evaluation);
  if (!evaluationsValid) return false;
  if (!validateUniqueEvaluationTitles(data.evaluations)) return false;
  const approvedEvaluations = data.evaluations.filter((e: any) => e.decision === "approve");
  if (typeof data.selected === "string") {
    return data.evaluations.some((e: any) => e.title === data.selected && e.decision === "approve");
  }
  if (approvedEvaluations.length === 0) return true;
  if (selectedWasExplicitNull) return false;
  if (approvedEvaluations.length === 1) {
    (data as { selected?: string }).selected = approvedEvaluations[0].title;
    return true;
  }
  return false;
}

export function validateCreator(data: unknown): data is CreatorResponse {
  if (!isObj(data)) return false;
  if (!isNonBlankString(data.title)) return false;
  return validateCreatorOutputFiles(data.files);
}

export function validateTester(data: unknown): data is TesterResponse {
  if (!isObj(data)) return false;
  const verdict = data.verdict;
  if (typeof verdict !== "string" || !TESTER_VERDICTS.has(verdict)) return false;
  return isNonBlankString(data.summary)
    && validateTesterPostMortem(verdict, data.post_mortem)
    && Array.isArray(data.tests_run)
    && data.tests_run.every(validateTesterTestResult)
    && Array.isArray(data.issues)
    && (verdict !== "pass" || (data.issues.length === 0 && data.tests_run.every((test) => test.result === "pass")))
    && (verdict !== "fail_fixable" || data.issues.length > 0)
    && data.issues.every(validateTesterIssue)
    && data.issues.every((issue) => validateTesterIssueSuggestedFixForVerdict(verdict, issue))
    && (data.test_plan === undefined || validateTesterTestPlan(data.test_plan));
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
  if (typeof data.decision !== "string" || !CRITIC_GATE2_DECISIONS.has(data.decision)) return false;
  if (!isObj(data.ratings)) return false;
  if (!validateCriticRatings(data.ratings)) return false;
  if (data.decision === "ship" && !meetsCriticShipThreshold(data.ratings)) return false;
  if (!isNonBlankString(data.review)) return false;
  if (data.decision === "revise" && !isNonBlankString(data.revision_notes)) return false;
  if (data.decision === "kill" && !isNonBlankString(data.kill_reason)) return false;
  return true;
}

export function validateCuratorRedirect(data: unknown): data is CuratorRedirectResponse {
  return validateProposalWrapper(data);
}

export function validateCuratorFull(data: unknown): data is CuratorFullResponse {
  if (!isObj(data)) return false;
  if (!isNonBlankString(data.retrospective)) return false;
  if (!isNonBlankString(data.compressed_journal)) return false;
  if (typeof data.domain_recommendations !== "string") return false;
  if (!Array.isArray(data.manifesto_changes) || !data.manifesto_changes.every(validateManifestoChange)) return false;
  if (!Array.isArray(data.project_decisions) || !data.project_decisions.every(validateProjectDecision)) return false;
  if (!Array.isArray(data.stimuli_actions) || !data.stimuli_actions.every(validateStimuliAction)) return false;
  if (
    data.human_redirect !== null &&
    !validateProposalWrapper(data.human_redirect)
  ) {
    return false;
  }
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
  if (!isNonBlankString(p.approach)) return false;
  if (!Array.isArray(p.file_manifest) || p.file_manifest.length === 0) return false;
  if (!p.file_manifest.every(validateCreatorFileManifestEntry)) return false;
  const manifestPaths = creatorPlanManifestPaths(p.file_manifest);
  if (!manifestPaths) return false;
  return validateStringArray(p.key_decisions) &&
    validateStringArray(p.challenges) &&
    validateBuildOrder(p.build_order) &&
    validateCreatorBuildOrderReferences(p.build_order, manifestPaths);
}

export function validateCreatorBuild(data: unknown): data is CreatorBuildResponse {
  return isObj(data) && validateCreatorOutputFiles(data.files);
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
