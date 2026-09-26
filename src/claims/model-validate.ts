/**
 * Turning raw model output into Claims, or refusing to. Three refusals live
 * here, each a design position rather than defensive coding: a candidate that
 * reads like attribution is dropped and never rewritten; a candidate citing an
 * utterance the transcript does not contain is dropped, because a record whose
 * provenance points at nothing is worse than no record; and provenance is
 * computed from the cited utterances' own offsets rather than taken from the
 * model, so a citation cannot be invented. Kept apart from the call path so
 * the test suite can feed it hostile output, names included, with no model.
 */
import { ModelUnavailable } from "../bedrock/invoker.ts";
import { parseJsonArray } from "../bedrock/json.ts";
import { AttributionViolation, assertNoAttribution } from "./attribution-guard.ts";
import { asString, asStringArray, clampConfidence, provenanceFor, resolveKind } from "./model-fields.ts";
import { safeTopic } from "./topic-label.ts";
import type { Claim, Conversation } from "../types.ts";

const MAX_CLAIMS_PER_CONVERSATION = 6;

export interface ValidationOutcome {
  readonly claims: Claim[];
  /** Dropped because they read like attribution, with the reason for each. */
  readonly attributionRejections: readonly string[];
  /** Dropped for any other reason: no citable utterance, empty, duplicate. */
  readonly malformedRejections: number;
}

/** Throws only when the whole response is unusable; the rest are per-candidate drops. */
export function validateModelClaims(
  raw: string,
  conversation: Conversation,
  extractor: string,
  now: () => Date,
): ValidationOutcome {
  const parsed = parseJsonArray(raw);
  if (parsed === null) throw new ModelUnavailable(`${extractor} did not return JSON`);

  const knownIds = new Set(conversation.utterances.map((u) => u.id));
  const claims: Claim[] = [];
  const attributionRejections: string[] = [];
  const seenDecisions = new Set<string>();
  let malformedRejections = 0;

  for (const candidate of parsed) {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      malformedRejections += 1;
      continue;
    }
    try {
      assertNoAttribution(candidate, extractor);
    } catch (err: unknown) {
      if (err instanceof AttributionViolation) {
        // `publicReason`, not `message`. This array is returned by `status` and printed
        // by the demo, so it is a second output path around the guard: pushing
        // `err.message` put the refused sentence, and the key the model chose to send it
        // under, on the very screen the guard exists to keep it off. The full message
        // stays on the error for a caller that logs.
        attributionRejections.push(err.publicReason);
        continue;
      }
      throw err;
    }

    const c = candidate as Record<string, unknown>;
    const decision = asString(c["decision"]);
    const context = asString(c["context"]);
    const rejectedOptions = asStringArray(c["rejectedOptions"]);
    const sourceUtteranceIds = asStringArray(c["sourceUtteranceIds"]).filter((id) => knownIds.has(id));

    if (sourceUtteranceIds.length === 0) {
      malformedRejections += 1;
      continue;
    }
    if (!decision && !context && rejectedOptions.length === 0) {
      malformedRejections += 1;
      continue;
    }
    const dedupeKey = `${decision.toLowerCase()}|${rejectedOptions.join(",").toLowerCase()}`;
    if (seenDecisions.has(dedupeKey)) {
      malformedRejections += 1;
      continue;
    }
    seenDecisions.add(dedupeKey);

    claims.push({
      id: `claim_${conversation.id}_s${claims.length + 1}`,
      kind: resolveKind(c["kind"], Boolean(decision)),
      // S5: the label is re-rendered from the model's content words, not passed through.
      topic: safeTopic(asString(c["topic"])),
      context,
      decision,
      rejectedOptions,
      consequences: asString(c["consequences"]),
      provenance: provenanceFor(conversation, sourceUtteranceIds),
      extractedAt: now().toISOString(),
      extractor,
      confidence: clampConfidence(c["confidence"]),
    });
    if (claims.length >= MAX_CLAIMS_PER_CONVERSATION) break;
  }

  return { claims, attributionRejections, malformedRejections };
}
