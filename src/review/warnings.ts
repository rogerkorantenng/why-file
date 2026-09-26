/**
 * What a reviewer should look at before merging a record.
 *
 * Plain English, and each one earns its place: a record with no retained
 * transcript cannot be checked at all; a record from the rule-based fallback
 * is the weaker path and should be read against the fragments; a low
 * confidence is the extractor saying it is unsure this was really settled; and
 * a reversal in either direction means one of two merged records is now wrong.
 */
import { RULES_EXTRACTOR } from "../claims/extract.ts";
import type { Claim, ClaimRelation, Conversation } from "../types.ts";

export function warningsFor(claim: Claim, conversation: Conversation | undefined, relations: readonly ClaimRelation[]): string[] {
  const warnings: string[] = [];
  if (!conversation) {
    warnings.push("No transcript was retained for this conversation, so the record cannot be checked against its source here.");
  }
  if (claim.extractor === RULES_EXTRACTOR) {
    warnings.push("Extracted by the rule-based fallback, not a model. It matches a handful of phrasings and misses the rest, so read the fragments closely.");
  }
  if (claim.confidence < 0.45) {
    warnings.push(`The extractor reported low confidence (${claim.confidence.toFixed(2)}) that this was really settled.`);
  }
  if (!claim.decision) {
    warnings.push("No decision was extracted, only context. This may be an argument in progress rather than a record.");
  }
  for (const relation of relations) {
    if (relation.earlierClaimId === claim.id && relation.kind === "supersedes") {
      warnings.push(`A later record (${relation.laterClaimId}) appears to reverse this one. ${relation.rationale}`);
    }
    if (relation.laterClaimId === claim.id && relation.kind === "supersedes") {
      warnings.push(`This record appears to reverse an earlier one (${relation.earlierClaimId}), which may still be merged and wrong.`);
    }
  }
  return warnings;
}
