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
  ) as { version: string; files: string[]; exports: Record<string, string> };

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

  it("enables the stoker directive loop", () => {
    expect(foundry.stoker?.enabled).toBe(true);
    expect(foundry.stoker?.run_interval).toBeGreaterThanOrEqual(1);
    expect(foundry.stoker?.refinery_token_heat_window).toBeGreaterThanOrEqual(1);
    expect(foundry.stoker?.refinery_token_heat_threshold).toBeGreaterThan(0);
  });

  it("enables speculative idea carry-forward", () => {
    expect(foundry.speculative?.enabled).toBe(true);
    expect(foundry.speculative?.max_carried_ideas).toBe(2);
  });

  it("enables refinery target discovery", () => {
    expect(foundry.refinery?.enabled).toBe(true);
    expect(foundry.refinery?.min_iterations_between_runs).toBeGreaterThanOrEqual(5);
    expect(foundry.refinery?.max_refinery_queue).toBeGreaterThanOrEqual(1);
  });

  it("configures the active monitor warning window for health gates", () => {
    expect(foundry.monitor?.active_warning_window).toBe(10);
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

  it("exports Critic rating helpers as a package subpath", () => {
    expect(pkg.exports["./critic"]).toBe("./dist/critic/index.js");
  });
});
