/**
 * The deterministic extractor: named idioms, one sentence at a time, one claim
 * per topic run.
 *
 * This is no longer the primary path. Bedrock is (model-extract.ts), because
 * reading a claim out of fragmentary speaker-less speech is a judgement, not a
 * pattern match, and the idiom list here only fires on the handful of shapes
 * in patterns.ts. It stays because it is the fallback, and the fallback has to
 * keep the capability rather than quietly losing it: it segments topics like
 * the model path does, labels a topic like the model path does, and reports a
 * confidence so a reviewer can see it is the weaker of the two.
 *
 * It runs on `Utterance[]`, which has no `speaker` field, so its output cannot
 * name anyone: the input cannot carry a name past the boundary in
 * bee/client.ts.
 */
import type { Claim, ClaimKind, Conversation, Provenance, Utterance } from "../types.ts";
import { earliestTimestampMsForSpan, joinTranscript, utteranceIdsForSpan } from "../transcript.ts";
import { extractFields, type ExtractedFields } from "./extract-fields.ts";
import { segmentByTopic, type SegmentOptions } from "./segment.ts";
import { topicLabel } from "./topic-label.ts";

export const RULES_EXTRACTOR = "rules";

function classify(fields: ExtractedFields): ClaimKind {
  if (fields.decision) return "decision";
  if (fields.rejectedOptions.length > 0) return "rejected-option";
  return "constraint";
}

function addMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

/** How much of the ADR shape the idioms actually found. A claim with a
 * decision, a reason and a rejected option is worth more of a reviewer's trust
 * than one with a bare "so X it is". */
function confidenceOf(fields: ExtractedFields): number {
  const found = [fields.decision, fields.context, fields.consequences, fields.rejectedOptions[0]].filter(Boolean).length;
  return Math.round((0.25 + 0.15 * found) * 100) / 100;
}

function claimFromSegment(
  conversation: Conversation,
  utterances: readonly Utterance[],
  segmentIndex: number,
  now: () => Date,
): Claim | null {
  const { text, offsets } = joinTranscript(utterances);
  const fields = extractFields(text);
  if (!fields.decision && fields.rejectedOptions.length === 0 && !fields.context) return null;

  const starts = fields.matchedSpans.map((s) => s.start);
  const ends = fields.matchedSpans.map((s) => s.end);
  const spanStart = Math.min(...starts);
  const spanEnd = Math.max(...ends);

  const provenance: Provenance = {
    conversationId: conversation.id,
    timestamp: addMs(conversation.startedAt, earliestTimestampMsForSpan(offsets, spanStart, spanEnd)),
    sourceUtteranceIds: utteranceIdsForSpan(offsets, spanStart, spanEnd),
  };

  return {
    id: `claim_${conversation.id}_s${segmentIndex + 1}`,
    kind: classify(fields),
    topic: topicLabel(utterances.map((u) => u.text).join(" ")),
    context: fields.context,
    decision: fields.decision,
    rejectedOptions: fields.rejectedOptions,
    consequences: fields.consequences,
    provenance,
    extractedAt: now().toISOString(),
    extractor: RULES_EXTRACTOR,
    confidence: confidenceOf(fields),
  };
}

/** Splits the conversation into topic runs and extracts at most one claim from
 * each. A single-topic conversation still yields a single claim, which is the
 * common case in the fixtures; a war-room stretch that moves from the retry
 * budget to the config store yields two. */
export function extractClaims(
  conversation: Conversation,
  now: () => Date = () => new Date(),
  segmentOptions: SegmentOptions = {},
): Claim[] {
  const segments = segmentByTopic(conversation.utterances, segmentOptions);
  const claims: Claim[] = [];
  for (const segment of segments) {
    const claim = claimFromSegment(conversation, segment.utterances, segment.index, now);
    if (claim) claims.push(claim);
  }
  return claims;
}
