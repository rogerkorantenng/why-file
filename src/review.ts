/**
 * The review surface: the draft record beside the words that produced it.
 *
 * A model now proposes the claims, so the reviewer's job changed. It is no
 * longer "is this ADR well written", it is "did the room actually settle
 * this". That question cannot be answered from the record alone, and it is
 * answered in about four seconds when the cited fragments are sitting next to
 * it, with the ones the extractor leaned on marked and their neighbours shown
 * for context.
 *
 * Two columns, left is the draft, right is the transcript. The fragments the
 * claim cites are marked; the two either side are shown unmarked, because the
 * commonest extraction error is a decision lifted out of the sentence that
 * walked it back.
 */
import { citedFragments, renderAdrMarkdown } from "./adr.ts";
import { warningsFor } from "./review/warnings.ts";
import type { Claim, ClaimRelation, Conversation } from "./types.ts";

export interface ReviewedUtterance {
  readonly id: string;
  readonly text: string;
  readonly timestamp: string;
  /** True when the claim cites this fragment as a source. */
  readonly cited: boolean;
}

export interface ReviewSurface {
  readonly claim: Claim;
  readonly adrMarkdown: string;
  readonly utterances: readonly ReviewedUtterance[];
  readonly relations: readonly ClaimRelation[];
  /** Things a reviewer should look at before merging. Plain English. */
  readonly warnings: readonly string[];
}

function addMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

export function buildReview(
  claim: Claim,
  conversation: Conversation | undefined,
  relations: readonly ClaimRelation[] = [],
  contextWindow = 2,
): ReviewSurface {
  const cited = new Set(claim.provenance.sourceUtteranceIds);
  const utterances: ReviewedUtterance[] = [];

  if (conversation) {
    const all = conversation.utterances;
    const citedIndices = all.map((u, i) => (cited.has(u.id) ? i : -1)).filter((i) => i >= 0);
    const first = citedIndices.length ? Math.max(0, Math.min(...citedIndices) - contextWindow) : 0;
    const last = citedIndices.length ? Math.min(all.length - 1, Math.max(...citedIndices) + contextWindow) : all.length - 1;
    for (let i = first; i <= last; i += 1) {
      const u = all[i]!;
      utterances.push({
        id: u.id,
        text: u.text,
        timestamp: addMs(conversation.startedAt, u.startMs),
        cited: cited.has(u.id),
      });
    }
  }

  return {
    claim,
    adrMarkdown: renderAdrMarkdown(claim, relations, citedFragments(claim, conversation)),
    utterances,
    relations,
    warnings: warningsFor(claim, conversation, relations),
  };
}

export { TWO_COLUMN_MINIMUM, renderReview, type ReviewColours } from "./review/render.ts";
