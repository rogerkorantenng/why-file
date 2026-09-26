/**
 * Contradiction detection across time.
 *
 * This is the finding the research said the product exists for: a decision
 * taken in March that a conversation in June quietly reverses, with nobody
 * editing the record in between and nobody in either room noticing. A
 * decision log that only appends is a log that lies by the second quarter.
 *
 * Two stages, and the split matters:
 *
 * - Pairing is deterministic and cheap. Claims are sorted by time, and only
 *   pairs that are about the same subject and sit in different conversations
 *   are considered at all. That is a lexical test, no model, and it keeps the
 *   number of model calls at one per sweep instead of one per pair.
 * - Judging is the model's job, in a single batched call, because "does this
 *   reverse that or refine it" is exactly the question a regex answers badly.
 *   When Bedrock is unreachable the heuristic below runs instead: same
 *   subject, different decision, later in time. It over-reports, it says so in
 *   the rationale, and it reports a low confidence.
 *
 * Nothing here names anyone. Rationales are prose from a model, so they go
 * through the same attribution guard as extracted claims, and a rationale that
 * reads like attribution takes its relation down with it.
 */
import { parseJsonArray } from "./bedrock/json.ts";
import { ModelUnavailable, type ModelInvoker } from "./bedrock/invoker.ts";
import { readJudgements } from "./relations/judgements.ts";
import { HEURISTIC_DETECTOR, candidatePairs, heuristicRelations } from "./relations/pairs.ts";
import { RELATION_SYSTEM_PROMPT, renderPairs } from "./relations/prompt.ts";
import type { Claim, ClaimRelation } from "./types.ts";

export { HEURISTIC_DETECTOR, candidatePairs, heuristicRelations, type ClaimPair } from "./relations/pairs.ts";
export { RELATION_SYSTEM_PROMPT } from "./relations/prompt.ts";

export interface RelationDetection {
  readonly relations: readonly ClaimRelation[];
  readonly detectedBy: string;
  readonly pairsConsidered: number;
  readonly usedFallback: boolean;
  readonly fallbackReason: string | null;
  readonly attributionRejections: readonly string[];
}

export async function detectRelations(
  claims: readonly Claim[],
  invoker: ModelInvoker | null,
  now: () => Date = () => new Date(),
): Promise<RelationDetection> {
  const pairs = candidatePairs(claims);
  const fallback = (reason: string | null, rejections: readonly string[] = []): RelationDetection => ({
    relations: heuristicRelations(pairs, now),
    detectedBy: HEURISTIC_DETECTOR,
    pairsConsidered: pairs.length,
    usedFallback: reason !== null,
    fallbackReason: reason,
    attributionRejections: rejections,
  });

  if (pairs.length === 0) {
    return { relations: [], detectedBy: invoker?.describe ?? HEURISTIC_DETECTOR, pairsConsidered: 0, usedFallback: false, fallbackReason: null, attributionRejections: [] };
  }
  if (invoker === null) return fallback("Bedrock is switched off (ORACLE_BEDROCK=off)");

  try {
    const raw = await invoker.invoke({
      system: RELATION_SYSTEM_PROMPT,
      user: renderPairs(pairs),
      maxTokens: 1200,
      temperature: 0,
    });
    const parsed = parseJsonArray(raw);
    if (parsed === null) throw new ModelUnavailable(`${invoker.describe} did not return JSON`);
    const { relations, attributionRejections } = readJudgements(parsed, pairs, invoker.describe, now);
    return {
      relations,
      detectedBy: invoker.describe,
      pairsConsidered: pairs.length,
      usedFallback: false,
      fallbackReason: null,
      attributionRejections,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return fallback(`${message}; used the word-overlap heuristic instead`);
  }
}

/** Claims a later record has reversed. Search ranks these below their
 * replacement rather than hiding them, because the old reasoning is still the
 * reason the code looked that way for three months. */
export function supersededClaimIds(relations: readonly ClaimRelation[]): Set<string> {
  const out = new Set<string>();
  for (const relation of relations) {
    if (relation.kind === "supersedes") out.add(relation.earlierClaimId);
  }
  return out;
}
