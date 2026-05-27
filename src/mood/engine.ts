import type { MoodAxis, MoodState, MoodInfluence } from "./types.js";
import { loadMood } from "./store.js";

const ALL_AXES: MoodAxis[] = ["exploratory", "playful", "restless", "bold", "collaborative"];
const INERTIA = 0.3;
const DEFAULT_WINDOW = 20;

interface IterationEntry {
  iteration: number;
  outcome: "shipped" | "killed" | "skipped" | "halted";
  domain?: string;
  mean_rating?: string;
  title?: string;
  token_usage: { input: number; output: number };
  duration_ms: number;
}

const LIGHT_DOMAINS = new Set(["experiment", "music", "poetry", "code-art", "visual-art"]);

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function freshMood(iteration: number): MoodState {
  const axes = { exploratory: 0, playful: 0, restless: 0, bold: 0, collaborative: 0 } as Record<MoodAxis, number>;
  return {
    axes,
    dominant_mood: "curious and open",
    creative_nudge: "Everything is possible — follow whatever spark feels most alive.",
    influences: [],
    iteration,
    updated_at: new Date().toISOString(),
  };
}

// ── Signal extractors ──────────────────────────────────────────

function recentWindow(entries: IterationEntry[], window: number): IterationEntry[] {
  return entries.slice(-window);
}

function outcomeCounts(entries: IterationEntry[]): Record<string, number> {
  const counts: Record<string, number> = { shipped: 0, killed: 0, skipped: 0, halted: 0 };
  for (const e of entries) counts[e.outcome] = (counts[e.outcome] ?? 0) + 1;
  return counts;
}

function uniqueDomains(entries: IterationEntry[]): Set<string> {
  const domains = new Set<string>();
  for (const e of entries) if (e.domain) domains.add(e.domain);
  return domains;
}

function consecutiveSameDomain(entries: IterationEntry[]): number {
  if (entries.length === 0) return 0;
  let count = 1;
  const last = entries[entries.length - 1];
  for (let i = entries.length - 2; i >= 0; i--) {
    if (entries[i].domain === last.domain) count++;
    else break;
  }
  return count;
}

function qualityTrend(entries: IterationEntry[]): "rising" | "falling" | "plateau" {
  const rated = entries.filter((e) => e.mean_rating != null).map((e) => parseFloat(e.mean_rating!));
  if (rated.length < 4) return "plateau";
  const mid = Math.floor(rated.length / 2);
  const firstHalf = rated.slice(0, mid);
  const secondHalf = rated.slice(mid);
  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const diff = avg(secondHalf) - avg(firstHalf);
  if (diff > 0.3) return "rising";
  if (diff < -0.3) return "falling";
  return "plateau";
}

function domainCollapseRatio(entries: IterationEntry[]): number {
  const domains = entries.filter((e) => e.domain).map((e) => e.domain!);
  if (domains.length === 0) return 0;
  const counts: Record<string, number> = {};
  for (const d of domains) counts[d] = (counts[d] ?? 0) + 1;
  return Math.max(...Object.values(counts)) / domains.length;
}

function iterationsSinceProjectWork(entries: IterationEntry[]): number {
  // Heuristic: project work tends to have titles referencing continuations.
  // Without explicit project flags on entries, count iterations since any
  // "collaborative" signal. Default to entries.length if none found.
  return entries.length;
}

function recentMeanRatings(entries: IterationEntry[], count: number): number[] {
  return entries
    .filter((e) => e.outcome === "shipped" && e.mean_rating != null)
    .slice(-count)
    .map((e) => parseFloat(e.mean_rating!));
}

function shippedLightDomainCount(entries: IterationEntry[]): number {
  return entries.filter((e) => e.outcome === "shipped" && e.domain && LIGHT_DOMAINS.has(e.domain)).length;
}

function ambitiousKills(entries: IterationEntry[]): number {
  // An ambitious kill: killed with a mean_rating present (it got far enough to be rated)
  return entries.filter((e) => e.outcome === "killed" && e.mean_rating != null).length;
}

function consecutiveWithoutKill(entries: IterationEntry[]): number {
  let count = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].outcome === "killed") break;
    count++;
  }
  return count;
}

// ── Axis computation ───────────────────────────────────────────

function computeInfluences(recent: IterationEntry[]): MoodInfluence[] {
  const influences: MoodInfluence[] = [];
  const counts = outcomeCounts(recent);
  const domains = uniqueDomains(recent);
  const consec = consecutiveSameDomain(recent);
  const trend = qualityTrend(recent);
  const collapse = domainCollapseRatio(recent);
  const ratings = recentMeanRatings(recent, 5);
  const noKillStreak = consecutiveWithoutKill(recent);
  const ambKills = ambitiousKills(recent);
  const lightShips = shippedLightDomainCount(recent);
  const sinceProjWork = iterationsSinceProjectWork(recent);
  const total = recent.length || 1;

  // ── exploratory ──
  if (domains.size >= 5) {
    influences.push({ factor: `${domains.size} distinct domains in window`, axis: "exploratory", direction: 0.6, weight: 0.7 });
  } else if (domains.size <= 2 && total >= 5) {
    influences.push({ factor: `only ${domains.size} domain(s) in window`, axis: "exploratory", direction: -0.5, weight: 0.6 });
  }
  if (consec >= 4) {
    influences.push({ factor: `${consec} consecutive iterations in same domain`, axis: "exploratory", direction: -0.6, weight: 0.7 });
  }
  if (ambKills >= 2) {
    influences.push({ factor: `${ambKills} ambitious kills — pushing boundaries`, axis: "exploratory", direction: 0.4, weight: 0.5 });
  }

  // ── playful ──
  if (trend === "rising" || (ratings.length > 0 && ratings.every((r) => r >= 7))) {
    influences.push({ factor: "quality streak — room to play", axis: "playful", direction: 0.5, weight: 0.6 });
  }
  if (counts.killed >= 3) {
    influences.push({ factor: `${counts.killed} kills in window — need to prove itself`, axis: "playful", direction: -0.4, weight: 0.5 });
  }
  if (lightShips >= 3) {
    influences.push({ factor: `${lightShips} light-domain ships`, axis: "playful", direction: 0.4, weight: 0.5 });
  }

  // ── restless ──
  if (trend === "falling") {
    influences.push({ factor: "falling quality trend", axis: "restless", direction: 0.6, weight: 0.7 });
  }
  if (collapse > 0.5) {
    influences.push({ factor: `domain collapse at ${Math.round(collapse * 100)}%`, axis: "restless", direction: 0.5, weight: 0.6 });
  }
  if (trend === "rising") {
    influences.push({ factor: "rising quality — things are working", axis: "restless", direction: -0.5, weight: 0.6 });
  }

  // ── bold ──
  if (ratings.length >= 3 && ratings.every((r) => r >= 7)) {
    influences.push({ factor: "recent high-rated ships — confidence high", axis: "bold", direction: 0.6, weight: 0.7 });
  }
  if (counts.killed >= 3) {
    influences.push({ factor: `${counts.killed} kills — pulling back`, axis: "bold", direction: -0.5, weight: 0.6 });
  }
  if (noKillStreak >= 10) {
    influences.push({ factor: `${noKillStreak} iterations without a kill — not pushing hard enough`, axis: "bold", direction: 0.4, weight: 0.5 });
  }

  // ── collaborative ──
  if (sinceProjWork <= 5) {
    influences.push({ factor: "recent project work", axis: "collaborative", direction: 0.5, weight: 0.6 });
  }
  if (sinceProjWork >= 10) {
    influences.push({ factor: `${sinceProjWork} iterations of standalone work`, axis: "collaborative", direction: -0.5, weight: 0.6 });
  }

  return influences;
}

function axisFromInfluences(influences: MoodInfluence[], axis: MoodAxis): number {
  const relevant = influences.filter((i) => i.axis === axis);
  if (relevant.length === 0) return 0;
  let weighted = 0;
  let totalWeight = 0;
  for (const inf of relevant) {
    weighted += inf.direction * inf.weight;
    totalWeight += inf.weight;
  }
  return clamp(totalWeight > 0 ? weighted / totalWeight : 0, -1, 1);
}

// ── Dominant mood ──────────────────────────────────────────────

const AXIS_LABELS: Record<MoodAxis, [string, string]> = {
  exploratory: ["exploratory", "refined"],
  playful: ["playful", "serious"],
  restless: ["restless", "settled"],
  bold: ["bold", "careful"],
  collaborative: ["collaborative", "independent"],
};

export function deriveDominantMood(axes: Record<MoodAxis, number>): string {
  const strong = ALL_AXES
    .map((a) => ({ axis: a, value: axes[a], abs: Math.abs(axes[a]) }))
    .filter((x) => x.abs > 0.3)
    .sort((a, b) => b.abs - a.abs)
    .slice(0, 3);

  if (strong.length === 0) return "curious and open";

  const labels = strong.map((s) => {
    const [pos, neg] = AXIS_LABELS[s.axis];
    return s.value > 0 ? pos : neg;
  });

  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels[0]}, ${labels[1]}, and ${labels[2]}`;
}

// ── Creative nudge ─────────────────────────────────────────────

const NUDGE_TABLE: Array<{ match: (axes: Record<MoodAxis, number>) => boolean; nudge: string }> = [
  {
    match: (a) => a.restless > 0.3 && a.exploratory > 0.3,
    nudge: "Try something in a domain you haven't touched in 20 iterations.",
  },
  {
    match: (a) => a.playful > 0.3 && a.bold > 0.3,
    nudge: "Propose something absurd and ambitious — the portfolio can handle a spectacular failure.",
  },
  {
    match: (a) => a.bold < -0.3 && a.playful < -0.3,
    nudge: "Deepen an existing thread rather than starting fresh. Quality over novelty right now.",
  },
  {
    match: (a) => a.restless < -0.3 && a.collaborative > 0.3,
    nudge: "Continue a project — the momentum is good and the system is in a groove.",
  },
  {
    match: (a) => a.bold > 0.3 && a.exploratory > 0.3,
    nudge: "Pick the most intimidating domain on the list and attempt something you've never tried.",
  },
  {
    match: (a) => a.restless > 0.3 && a.bold < -0.3,
    nudge: "Something feels off — try a small, safe experiment in a new domain to reset.",
  },
  {
    match: (a) => a.playful > 0.3 && a.collaborative < -0.3,
    nudge: "Make something whimsical and self-contained — a playful standalone piece.",
  },
  {
    match: (a) => a.exploratory < -0.3 && a.restless < -0.3,
    nudge: "The groove is deep — push one of your strong threads to the next level.",
  },
  {
    match: (a) => a.collaborative > 0.3,
    nudge: "A project is calling — pick up where you left off or start one that spans multiple iterations.",
  },
  {
    match: (a) => a.restless > 0.3,
    nudge: "Shake things up. Break a pattern. The current trajectory wants disruption.",
  },
];

const DEFAULT_NUDGE = "Trust the creative instinct — make whatever feels right.";

export function generateCreativeNudge(axes: Record<MoodAxis, number>, _dominant: string): string {
  for (const entry of NUDGE_TABLE) {
    if (entry.match(axes)) return entry.nudge;
  }
  return DEFAULT_NUDGE;
}

// ── Main entry point ───────────────────────────────────────────

export async function computeMood(
  iterationEntries: IterationEntry[],
  currentIteration: number,
  window: number = DEFAULT_WINDOW,
): Promise<MoodState> {
  const recent = recentWindow(iterationEntries, window);

  if (recent.length === 0) return freshMood(currentIteration);

  const influences = computeInfluences(recent);
  const rawAxes = {} as Record<MoodAxis, number>;
  for (const axis of ALL_AXES) {
    rawAxes[axis] = axisFromInfluences(influences, axis);
  }

  const previous = await loadMood();
  const axes = {} as Record<MoodAxis, number>;
  for (const axis of ALL_AXES) {
    const prev = previous?.axes[axis] ?? 0;
    axes[axis] = clamp(rawAxes[axis] * (1 - INERTIA) + prev * INERTIA, -1, 1);
    axes[axis] = Math.round(axes[axis] * 1000) / 1000;
  }

  const dominant_mood = deriveDominantMood(axes);
  const creative_nudge = generateCreativeNudge(axes, dominant_mood);

  return {
    axes,
    dominant_mood,
    creative_nudge,
    influences,
    iteration: currentIteration,
    updated_at: new Date().toISOString(),
  };
}
