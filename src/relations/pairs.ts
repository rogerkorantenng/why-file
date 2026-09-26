/**
 * Which pairs of records are worth asking about, and the answer when no model
 * is available.
 *
 * Pairing is deterministic and free: claims sorted by time, and only pairs
 * about the same subject, in different conversations, one strictly later than
 * the other. That keeps a sweep at one model call rather than one per pair,
 * and it means the expensive judgement is only ever spent on candidates a
 * person would also have thought worth checking.
 *
 * The heuristic below is what runs when Bedrock is unreachable. It
 * over-reports on purpose: a missed reversal is the failure this feature
 * exists to prevent, and a false one costs a glance. It says so in its own
 * rationale and reports a low confidence, so nobody mistakes it for judgement.
 */
import { topicOverlap } from "../claims/topic-label.ts";
import type { Claim, ClaimRelation } from "../types.ts";

export const HEURISTIC_DETECTOR = "heuristic";
export const MAX_PAIRS = 12;
export const MIN_OVERLAP = 0.3;

export interface ClaimPair {
  readonly later: Claim;
  readonly earlier: Claim;
  readonly overlap: number;
}

function subjectText(claim: Claim): string {
  return [claim.topic, claim.decision, claim.rejectedOptions.join(" "), claim.context].join(" ");
}

/** Pairs worth asking about: same subject, different conversations, one
 * strictly later than the other. */
export function candidatePairs(claims: readonly Claim[], minOverlap = MIN_OVERLAP): ClaimPair[] {
  const ordered = [...claims].sort((a, b) => a.provenance.timestamp.localeCompare(b.provenance.timestamp));
  const pairs: ClaimPair[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const earlier = ordered[i]!;
      const later = ordered[j]!;
      if (earlier.provenance.conversationId === later.provenance.conversationId) continue;
      if (later.provenance.timestamp <= earlier.provenance.timestamp) continue;
      const overlap = topicOverlap(subjectText(earlier), subjectText(later));
      if (overlap < minOverlap) continue;
      pairs.push({ later, earlier, overlap });
    }
  }
  return pairs.sort((a, b) => b.overlap - a.overlap).slice(0, MAX_PAIRS);
}

/** The no-model judgement. Same subject, different decision, later in time.
 * Deliberately over-reports and says so, because a missed reversal is the
 * failure this feature exists to prevent and a false one costs a glance. */
export function heuristicRelations(pairs: readonly ClaimPair[], now: () => Date): ClaimRelation[] {
  const out: ClaimRelation[] = [];
  for (const pair of pairs) {
    const earlierDecision = pair.earlier.decision.trim().toLowerCase();
    const laterDecision = pair.later.decision.trim().toLowerCase();
    if (!earlierDecision || !laterDecision) continue;
    if (earlierDecision === laterDecision) continue;
    if (pair.overlap < 0.4) continue;
    out.push({
      laterClaimId: pair.later.id,
      earlierClaimId: pair.earlier.id,
      kind: "supersedes",
      rationale: `Both records settle the same subject and the later one settles it differently ("${pair.earlier.decision}" then "${pair.later.decision}"). Flagged by word overlap, not by a model, so check it before acting on it.`,
      detectedBy: HEURISTIC_DETECTOR,
      detectedAt: now().toISOString(),
      confidence: Math.round(Math.min(0.5, pair.overlap) * 100) / 100,
    });
  }
  return out;
}
