import { getModel, complete } from "@earendil-works/pi-ai";
import type { AssistantMessage, Context, Model, TextContent } from "@earendil-works/pi-ai";
import type { AgentModelConfig } from "../types/index.js";
import { logTokenUsage } from "../logging/index.js";

export interface ModelCallResult {
  text: string;
  usage: { input: number; output: number };
}

const modelCache = new Map<string, Model<any>>();

function resolveModel(modelId: string): Model<any> {
  const cached = modelCache.get(modelId);
  if (cached) return cached;
  const model = getModel("zai", modelId as any);
  modelCache.set(modelId, model);
  return model;
}

function extractText(message: AssistantMessage): string {
  return message.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
}

export async function callModel(
  agentConfig: AgentModelConfig,
  systemPrompt: string,
  userMessage: string,
  iteration: number,
  agent: string,
): Promise<ModelCallResult> {
  const model = resolveModel(agentConfig.model);

  const context: Context = {
    systemPrompt,
    messages: [
      { role: "user", content: userMessage, timestamp: Date.now() },
    ],
  };

  const startMs = Date.now();

  const response: AssistantMessage = await complete(model, context, {
    temperature: agentConfig.temperature,
    maxTokens: agentConfig.max_tokens,
    maxRetries: 5,
    timeoutMs: 180_000,
  });

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
    model: agentConfig.model,
    input_tokens: usage.input,
    output_tokens: usage.output,
    duration_ms: durationMs,
  });

  if (response.stopReason === "error") {
    throw new Error(`Model error: ${response.errorMessage ?? "unknown"}`);
  }

  return { text, usage };
}
