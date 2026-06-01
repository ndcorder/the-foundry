import { describe, expect, it } from "vitest";
import { summarizeFurnaceHealth, summarizeMonitorWarnings } from "../src/monitor/index.js";
import type { JsonlLogHealth } from "../src/logging/index.js";
import type { MonitorWarningStatus } from "../src/monitor/index.js";
import type { StimuliRefreshHealth } from "../src/stimuli/index.js";

function logHealth(overrides: Partial<JsonlLogHealth> = {}): JsonlLogHealth {
  return {
    activeFiles: 0,
    archiveCount: 0,
    totalActiveBytes: 0,
    totalArchiveBytes: 0,
    totalLogBytes: 0,
    rotationThresholdBytes: 50 * 1024 * 1024,
    largestActivePercent: 0,
    largestActiveBytesRemaining: 50 * 1024 * 1024,
    rotationPressure: "clear",
    healthState: "healthy",
    malformedActiveLines: 0,
    malformedActiveFiles: [],
    malformedActiveFileDetails: [],
    recommendedActions: [],
    largestActive: null,
    largestArchive: null,
    ...overrides,
  };
}

function monitorStatus(overrides: Partial<MonitorWarningStatus> = {}): MonitorWarningStatus {
  return {
    counts: { critical: 0, warning: 0, info: 0 },
    activeCounts: { critical: 0, warning: 0, info: 0 },
    activeWarnings: [],
    activeWindow: null,
    recentWarnings: [],
    latestWarning: null,
    ...overrides,
  };
}

function stimuliHealth(overrides: Partial<StimuliRefreshHealth> = {}): StimuliRefreshHealth {
  return {
    enabled: true,
    sources: 3,
    healthy: 1,
    due: 1,
    failing: 1,
    disabled: 1,
    entries: [],
    ...overrides,
  };
}

describe("furnace health summary", () => {
  it("keeps historical monitor counts separate from active warning counts", () => {
    const summary = summarizeMonitorWarnings([
      { detector: "slop", severity: "warning", message: "Old quality drift", iteration: 58, timestamp: "2026-05-19T00:00:00.000Z" },
      { detector: "manifesto_drift", severity: "warning", message: "Old drift", iteration: 61, timestamp: "2026-05-19T01:00:00.000Z" },
      { detector: "log_health", severity: "critical", message: "Recent malformed log", iteration: 74, timestamp: "2026-05-30T00:00:00.000Z" },
      { detector: "domain_collapse", severity: "info", message: "Recent domain note", iteration: 75, timestamp: "2026-05-30T00:01:00.000Z" },
    ], { currentIteration: 75, activeIterationWindow: 10 });

    expect(summary.counts).toEqual({ critical: 1, warning: 2, info: 1 });
    expect(summary.activeCounts).toEqual({ critical: 1, warning: 0, info: 1 });
    expect(summary.activeWarnings.map((entry) => entry.detector)).toEqual(["log_health", "domain_collapse"]);
    expect(summary.activeWindow).toEqual({ currentIteration: 75, iterations: 10 });
  });

  it("reports healthy when logs and monitor warnings are clear", () => {
    expect(summarizeFurnaceHealth(logHealth(), monitorStatus())).toEqual({
      level: "healthy",
      reasons: [],
      actions: [],
    });
  });

  it("reports warning for monitor warnings and log rotation pressure", () => {
    const summary = summarizeFurnaceHealth(
      logHealth({
        rotationPressure: "watch",
        healthState: "watch",
        recommendedActions: ["Plan log rotation before the next extended run."],
      }),
      monitorStatus({
        counts: { critical: 0, warning: 2, info: 1 },
        activeCounts: { critical: 0, warning: 2, info: 1 },
      }),
    );

    expect(summary).toEqual({
      level: "warning",
      reasons: [
        "2 monitor warnings",
        "JSONL log rotation pressure is watch",
      ],
      actions: [
        "Plan log rotation before the next extended run.",
        "Inspect logs/monitor.jsonl for recent monitor warnings.",
      ],
    });
  });

  it("reports critical for malformed logs and critical monitor warnings", () => {
    const summary = summarizeFurnaceHealth(
      logHealth({
        healthState: "malformed",
        malformedActiveLines: 1,
        malformedActiveFiles: ["events.jsonl"],
        malformedActiveFileDetails: [
          { name: "events.jsonl", malformedLines: 1, firstMalformedLine: 7 },
        ],
        recommendedActions: [
          "Repair or rotate malformed active JSONL logs before trusting monitor summaries.",
          "Inspect events.jsonl at line 7.",
        ],
      }),
      monitorStatus({
        counts: { critical: 1, warning: 1, info: 0 },
        activeCounts: { critical: 1, warning: 1, info: 0 },
      }),
    );

    expect(summary).toEqual({
      level: "critical",
      reasons: [
        "1 critical monitor warning",
        "1 monitor warning",
        "JSONL logs are malformed",
      ],
      actions: [
        "Repair or rotate malformed active JSONL logs before trusting monitor summaries.",
        "Inspect events.jsonl at line 7.",
        "Inspect logs/monitor.jsonl for recent monitor warnings.",
      ],
    });
  });

  it("does not warn on historical monitor warnings outside the active window", () => {
    const summary = summarizeFurnaceHealth(
      logHealth(),
      monitorStatus({
        counts: { critical: 0, warning: 56, info: 0 },
        activeCounts: { critical: 0, warning: 0, info: 0 },
      }),
    );

    expect(summary).toEqual({
      level: "healthy",
      reasons: [],
      actions: [],
    });
  });

  it("reports warning for failing or disabled stimuli feeds", () => {
    const summary = summarizeFurnaceHealth(
      logHealth(),
      monitorStatus(),
      stimuliHealth(),
    );

    expect(summary).toEqual({
      level: "warning",
      reasons: [
        "1 stimuli source failing",
        "1 stimuli source disabled",
      ],
      actions: [
        "Inspect stimuli source health and recover disabled or failing feeds.",
      ],
    });
  });

  it("keeps critical health when stimuli warnings accompany critical monitor warnings", () => {
    const summary = summarizeFurnaceHealth(
      logHealth(),
      monitorStatus({
        counts: { critical: 1, warning: 0, info: 0 },
        activeCounts: { critical: 1, warning: 0, info: 0 },
      }),
      stimuliHealth({ failing: 1, disabled: 0 }),
    );

    expect(summary.level).toBe("critical");
    expect(summary.reasons).toEqual([
      "1 critical monitor warning",
      "1 stimuli source failing",
    ]);
    expect(summary.actions).toEqual([
      "Inspect logs/monitor.jsonl for recent monitor warnings.",
      "Inspect stimuli source health and recover disabled or failing feeds.",
    ]);
  });
});
