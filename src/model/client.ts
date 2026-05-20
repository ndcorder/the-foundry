import { getModel, complete } from "@earendil-works/pi-ai";
import type { AssistantMessage, Context, Model, TextContent } from "@earendil-works/pi-ai";
import type { AgentModelConfig, ModelTierOverride } from "../types/index.js";

let activeOverrides: ModelTierOverride[] = [];

export function setModelOverrides(overrides: ModelTierOverride[]): void {
  activeOverrides = overrides;
}

export function resolveAgentConfig(
  agentConfig: AgentModelConfig,
  agent: string,
  iteration: number,
): AgentModelConfig {
  const override = activeOverrides.find(
    (o) => o.agent === agent && iteration >= o.start_iteration && iteration <= o.end_iteration,
  );
  if (!override) return agentConfig;
  console.log(`  [override] ${agent} using ${override.model} (${override.label})`);
  return { ...agentConfig, model: override.model };
}
import { logTokenUsage } from "../logging/index.js";

export interface ModelCallResult {
  text: string;
  usage: { input: number; output: number };
}

let consecutiveErrors = 0;
let backoffMs = 0;
const MAX_BACKOFF_MS = 120_000;

const modelCache = new Map<string, Model<any>>();

function resolveModel(provider: string, modelId: string): Model<any> {
  const cacheKey = `${provider}:${modelId}`;
  const cached = modelCache.get(cacheKey);
  if (cached) return cached;
  const model = getModel(provider as any, modelId as any);
  modelCache.set(cacheKey, model);
  return model;
}

function extractText(message: AssistantMessage): string {
  return message.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
}

export function resetModelState(): void {
  consecutiveErrors = 0;
  backoffMs = 0;
  modelCache.clear();
  activeOverrides = [];
}

export async function validateProvider(provider: string, modelId: string): Promise<boolean> {
  try {
    resolveModel(provider, modelId);
    return true;
  } catch {
    return false;
  }
}

export async function callModel(
  agentConfig: AgentModelConfig,
  systemPrompt: string,
  userMessage: string,
  iteration: number,
  agent: string,
): Promise<ModelCallResult> {
  const effectiveConfig = resolveAgentConfig(agentConfig, agent, iteration);

  // Adaptive backoff on persistent API errors
  if (backoffMs > 0) {
    console.log(`  [backoff] Waiting ${(backoffMs / 1000).toFixed(0)}s before API call (${consecutiveErrors} consecutive errors)`);
    await new Promise((r) => setTimeout(r, backoffMs));
  }

  const provider = effectiveConfig.provider ?? "zai";
  const model = resolveModel(provider, effectiveConfig.model);

  const context: Context = {
    systemPrompt,
    messages: [
      { role: "user", content: userMessage, timestamp: Date.now() },
    ],
  };

  const startMs = Date.now();

  let response: AssistantMessage;
  try {
    response = await complete(model, context, {
      temperature: effectiveConfig.temperature,
      maxTokens: effectiveConfig.max_tokens,
      maxRetries: 5,
      timeoutMs: 180_000,
      ...(effectiveConfig.reasoning_effort && { reasoningEffort: effectiveConfig.reasoning_effort }),
    });
    // Reset on success
    consecutiveErrors = 0;
    backoffMs = 0;
  } catch (err) {
    consecutiveErrors++;
    backoffMs = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, consecutiveErrors));
    throw err;
  }

  const durationMs = Date.now() - startMs;
  const text = extractText(response);
  const usage = {
    input: response.usage.input,
    output: response.usage.output,
  };

  await logTokenUsage({
    timestamp: new Date().toISOString(),
    iteration,
    agent,
    model: effectiveConfig.model,
    input_tokens: usage.input,
    output_tokens: usage.output,
    duration_ms: durationMs,
  });

  if (response.stopReason === "error") {
    throw new Error(`Model error: ${response.errorMessage ?? "unknown"}`);
  }

  return { text, usage };
}
