/**
 * One failure type, and the one distinction that matters inside it.
 *
 * Everything that can go wrong calling Bedrock leaves this package as
 * `ModelUnavailable`, so no caller has more than one error to handle and the
 * fallback path is the same whatever happened.
 *
 * Inside the client, though, two kinds of failure behave differently. An
 * entitlement failure means "this account cannot invoke this model, and it
 * never will until somebody enables it": trying the next model in the
 * preference chain is the right move, and it costs a couple of hundred
 * milliseconds. A timeout or a throttle means the deadline is spent, and
 * walking down the chain would spend it again on every candidate. So only
 * entitlement failures advance the chain; everything else falls back to the
 * rule-based extractor immediately.
 */

export class ModelUnavailable extends Error {
  readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ModelUnavailable";
    this.cause = cause;
  }
}

const ENTITLEMENT_NAMES = new Set(["AccessDeniedException", "ResourceNotFoundException"]);

/**
 * True when this account cannot invoke this model at all.
 *
 * `ValidationException` is included only for the on-demand case, where the
 * message says the bare model id needs an inference profile. That is the
 * error a stale or wrongly-prefixed id produces, and it is permanent for that
 * id, so the chain should step past it rather than give up.
 */
export function isEntitlementError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = String((err as { name?: unknown }).name ?? "");
  const message = String((err as { message?: unknown }).message ?? "");
  if (ENTITLEMENT_NAMES.has(name)) return true;
  if (name === "ValidationException" && /inference profile|on-demand throughput/i.test(message)) return true;
  return /is not available for this account|don't have access to the model/i.test(message);
}
