/**
 * One stretch of capture, from Bee's boundary to stored records.
 *
 * The order here is the design: fetch, then the consent gate, then extraction.
 * Nothing reaches the model that the gate did not accept, and a refusal comes
 * back naming the rule that fired rather than as an empty list the caller has
 * to explain. The conversation is stored alongside its claims because the
 * review surface has to put a record beside the fragments that produced it,
 * and a reviewer cannot check a record against a transcript nobody kept.
 */
import type { BeeClient } from "./bee/client.ts";
import type { ModelInvoker } from "./bedrock/invoker.ts";
import { refusalReason } from "./capture-refusal.ts";
import { acceptUtterances } from "./consent.ts";
import { extractClaimsForConversation } from "./claims/model-extract.ts";
import type { ClaimStore } from "./store.ts";
import type { CaptureResult } from "./oracle-types.ts";
import type { Session } from "./types.ts";

export interface CaptureDeps {
  readonly beeClient: BeeClient;
  readonly store: ClaimStore;
  readonly invoker: ModelInvoker | null;
  readonly now: () => Date;
}

export async function runCapture(
  deps: CaptureDeps,
  session: Session,
  conversationId: string,
  presentDeviceIds: readonly string[],
): Promise<CaptureResult> {
  const conversation = await deps.beeClient.getConversation(conversationId);
  const accepted = acceptUtterances(session, conversation.roomId, conversation.utterances, presentDeviceIds);

  if (accepted.length === 0) {
    return {
      conversationId,
      claims: [],
      extractor: deps.invoker?.describe ?? "rules",
      usedFallback: false,
      fallbackReason: null,
      attributionRejections: [],
      refusedReason: refusalReason(conversationId, conversation.roomId, session.roomId),
    };
  }

  const scoped = { ...conversation, utterances: accepted };
  const result = await extractClaimsForConversation(scoped, deps.invoker, deps.now);

  deps.store.addConversation(scoped);
  for (const claim of result.claims) deps.store.addClaim(claim);

  return { ...result, conversationId, refusedReason: null };
}
