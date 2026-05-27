import type { DreamEntry } from "./types.js";

export function extractDreamFromKill(
  artifactId: string,
  title: string,
  domain: string,
  pitch: string,
  killReason: string,
  review: string,
  iteration: number,
): DreamEntry {
  return {
    artifact_id: artifactId,
    title,
    domain,
    pitch: pitch.slice(0, 200),
    kill_reason: killReason.slice(0, 150),
    what_was_good: extractPositives(review),
    resurrection_hint: generateHint(title, domain, killReason),
    iteration,
    added_at: new Date().toISOString(),
  };
}

function extractPositives(review: string): string {
  const positivePatterns = [
    /the (?:concept|kernel|idea|premise|core|foundation)\s+(?:is|was)\s+([^.]+)/i,
    /(?:strong|good|solid|interesting|promising|compelling)\s+([^.]+)/i,
    /(?:works|succeeds|shines|excels)\s+(?:in|at|when)\s+([^.]+)/i,
  ];

  for (const pattern of positivePatterns) {
    const match = review.match(pattern);
    if (match) return match[0].slice(0, 120);
  }

  if (review.length > 50) {
    const firstSentence = review.split(/[.!]/)[0];
    if (firstSentence && firstSentence.length < 120) return firstSentence;
  }

  return "The core idea had potential.";
}

function generateHint(title: string, domain: string, killReason: string): string {
  const reason = killReason.toLowerCase();

  if (reason.includes("execution") || reason.includes("craft") || reason.includes("quality"))
    return `The idea is sound — try again with a different structural approach.`;

  if (reason.includes("generic") || reason.includes("predictable") || reason.includes("cliché"))
    return `Find a sharper angle. What\'s the one specific detail that makes this unlike anything else?`;

  if (reason.includes("ambitious") || reason.includes("scope") || reason.includes("too large"))
    return `Scale it down to the single most compelling moment and nail that.`;

  if (reason.includes("similar") || reason.includes("repetit") || reason.includes("already"))
    return `Invert it — what if you took the opposite approach to the same theme?`;

  if (reason.includes("coherence") || reason.includes("structure") || reason.includes("fell apart"))
    return `The idea needs a stronger formal container. What structure would hold it together?`;

  return `This could work in a different domain — what happens if you move it to ${domain === "fiction" ? "code-art" : "fiction"}?`;
}
