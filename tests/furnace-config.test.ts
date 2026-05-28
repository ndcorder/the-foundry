import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "yaml";
import type { FoundryConfig, ModelsConfig } from "../src/types/index.js";

describe("furnace defaults", () => {
  const foundry = yaml.parse(
    readFileSync(new URL("../config/foundry.yml", import.meta.url), "utf-8"),
  ) as FoundryConfig;
  const models = yaml.parse(
    readFileSync(new URL("../config/models.yml", import.meta.url), "utf-8"),
  ) as ModelsConfig;
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
  ) as { version: string; files: string[] };

  it("keeps the default config version aligned with the package", () => {
    expect(foundry.foundry.version).toBe(pkg.version);
  });

  it("runs many iterations in parallel without a cooldown", () => {
    expect(foundry.loop.concurrency ?? 1).toBeGreaterThanOrEqual(6);
    expect(foundry.loop.cooldown_seconds).toBe(0);
  });

  it("runs multiple ideation bursts per attempt", () => {
    expect(foundry.iteration.ideation_burst_count ?? 1).toBeGreaterThanOrEqual(3);
  });

  it("feeds large contexts to every ideation and review call", () => {
    expect(foundry.stimuli.skills_per_context).toBeGreaterThanOrEqual(8);
    expect(foundry.context.journal_compressed_max_tokens).toBeGreaterThanOrEqual(24_000);
    expect(foundry.context.portfolio_index_max_entries).toBeGreaterThanOrEqual(100);
    expect(foundry.context.critic_review_history).toBeGreaterThanOrEqual(16);
    expect(foundry.context.critic_gate1_history).toBeGreaterThanOrEqual(12);
  });

  it("keeps every agent on a furnace-sized output ceiling", () => {
    for (const agent of Object.values(models.agents)) {
      expect(agent.max_tokens).toBeGreaterThanOrEqual(180_000);
    }
  });

  it("ships dashboard sources in the npm package", () => {
    expect(pkg.files).toContain("dashboard/");
  });
});
