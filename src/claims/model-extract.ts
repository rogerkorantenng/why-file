/**
 * Claim extraction with Amazon Bedrock, which is where the model belongs.
 *
 * The earlier build matched idioms: "because X", "so X it is", "not X, the".
 * That works on the three sentences it was written against and misses
 * everything else, and the README said so. Reading a decision out of speech
 * that arrives as "and so I think being able to like get shared / transactional
 * consistency across those matters more than / the write throughput" is a
 * judgement about what a fragment means, which is the thing a regex cannot do
 * and a model can. So the model reads the transcript and proposes claims, and
 * the deterministic path in extract.ts becomes the fallback.
 *
 * Three rules about what the model is and is not allowed to decide:
 *
 * 1. It never supplies provenance. It picks which utterances produced a claim;
 *    the conversation id and the timestamp are computed here from those
 *    utterances' own `startMs`. A model cannot hallucinate a citation into a
 *    record when the citation is derived, not quoted.
 * 2. It never supplies identity. It is handed text with no speaker field, and
 *    anything that comes back looking like attribution is dropped by
 *    attribution-guard.ts before it can become a Claim.
 * 3. It never gets the last word on availability. Timeout, no credentials, no
 *    model access, malformed JSON: all of it lands on the rule-based path with
 *    the reason recorded, and the reason is shown to the user.
 */
import type { ModelInvoker } from "../bedrock/invoker.ts";
import { extractClaims as extractClaimsWithRules, RULES_EXTRACTOR } from "./extract.ts";
import { EXTRACTION_SYSTEM_PROMPT, renderTranscript } from "./model-prompt.ts";
import { validateModelClaims } from "./model-validate.ts";
import type { Claim, Conversation } from "../types.ts";

export { validateModelClaims, type ValidationOutcome } from "./model-validate.ts";
export { EXTRACTION_SYSTEM_PROMPT } from "./model-prompt.ts";

export interface ExtractionResult {
  readonly claims: readonly Claim[];
  /** "bedrock:<model id>" or "rules". Recorded on every claim too. */
  readonly extractor: string;
  readonly usedFallback: boolean;
  /** Plain English, shown to the user. Null when the model path worked. */
  readonly fallbackReason: string | null;
  readonly attributionRejections: readonly string[];
}

/**
 * The extraction entry point. Asks Bedrock; falls back to the idioms on any
 * failure; never throws for an availability reason.
 */
export async function extractClaimsForConversation(
  conversation: Conversation,
  invoker: ModelInvoker | null,
  now: () => Date = () => new Date(),
): Promise<ExtractionResult> {
  const fallback = (reason: string | null, rejections: readonly string[] = []): ExtractionResult => ({
    claims: extractClaimsWithRules(conversation, now),
    extractor: RULES_EXTRACTOR,
    usedFallback: reason !== null,
    fallbackReason: reason,
    attributionRejections: rejections,
  });

  if (invoker === null) return fallback("Bedrock is switched off (ORACLE_BEDROCK=off)");
  if (conversation.utterances.length === 0) return fallback(null);

  try {
    const raw = await invoker.invoke({
      system: EXTRACTION_SYSTEM_PROMPT,
      user: renderTranscript(conversation),
      maxTokens: 1600,
      temperature: 0,
    });
    const outcome = validateModelClaims(raw, conversation, invoker.describe, now);
    if (outcome.claims.length === 0 && outcome.attributionRejections.length > 0) {
      return fallback(
        `every claim ${invoker.describe} returned was dropped by the attribution guard`,
        outcome.attributionRejections,
      );
    }
    return {
      claims: outcome.claims,
      extractor: invoker.describe,
      usedFallback: false,
      fallbackReason: null,
      attributionRejections: outcome.attributionRejections,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return fallback(`${message}; used the rule-based extractor instead`);
  }
}
