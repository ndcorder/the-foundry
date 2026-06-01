import type { StatsSnapshot } from "../types/index.js";

const OUTCOME_CAP = 50;
const REJECTION_CAP = 20;
type OutcomeSource = "ideator" | "human_redirect";

export class StatsTracker {
  private iteration = 0;
  private shipped = 0;
  private killed = 0;
  private skipped = 0;
  private domainCounts: Record<string, number> = {};
  private recentOutcomes: Array<{ iteration: number; outcome: string; domain?: string; source?: OutcomeSource }> = [];
  private criticWindow: Array<{ iteration: number; rejected: boolean }> = [];
  private tokens = { input: 0, output: 0 };

  private constructor() {}

  static fresh(): StatsTracker {
    return new StatsTracker();
  }

  static fromSnapshot(snap: StatsSnapshot): StatsTracker {
    const t = new StatsTracker();
    t.iteration = snap.iteration;
    t.shipped = snap.shipped;
    t.killed = snap.killed;
    t.skipped = snap.skipped;
    t.domainCounts = { ...snap.domain_counts };
    t.recentOutcomes = snap.recent_outcomes.slice(-OUTCOME_CAP);
    t.criticWindow = snap.critic_rejection_window.slice(-REJECTION_CAP);
    t.tokens = { ...snap.total_tokens };
    return t;
  }

  recordOutcome(
    iteration: number,
    outcome: "shipped" | "killed" | "skipped",
    domain?: string,
    source?: OutcomeSource,
  ): void {
    this[outcome]++;
    if (outcome === "shipped" && domain) {
      this.domainCounts[domain] = (this.domainCounts[domain] ?? 0) + 1;
    }
    this.recentOutcomes.push({ iteration, outcome, domain, ...(source ? { source } : {}) });
    if (this.recentOutcomes.length > OUTCOME_CAP) {
      this.recentOutcomes.shift();
    }
  }

  recordCriticDecision(iteration: number, rejected: boolean): void {
    this.criticWindow.push({ iteration, rejected });
    if (this.criticWindow.length > REJECTION_CAP) {
      this.criticWindow.shift();
    }
  }

  recordTokens(input: number, output: number): void {
    this.tokens.input += input;
    this.tokens.output += output;
  }

  getSnapshot(): StatsSnapshot {
    return {
      iteration: this.iteration,
      shipped: this.shipped,
      killed: this.killed,
      skipped: this.skipped,
      domain_counts: { ...this.domainCounts },
      recent_outcomes: [...this.recentOutcomes],
      critic_rejection_window: [...this.criticWindow],
      total_tokens: { ...this.tokens },
    };
  }

  getRejectionRate(): number {
    if (this.criticWindow.length === 0) return 0;
    const rejected = this.criticWindow.filter((e) => e.rejected).length;
    return rejected / this.criticWindow.length;
  }

  getDomainStats(): string {
    const total = Object.values(this.domainCounts).reduce((a, b) => a + b, 0);
    if (total === 0) return "(no artifacts shipped)";
    return Object.entries(this.domainCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([d, n]) => `${d}: ${n} (${Math.round((n / total) * 100)}%)`)
      .join(", ");
  }

  getIteration(): number {
    return this.iteration;
  }

  setIteration(n: number): void {
    this.iteration = n;
  }
}
