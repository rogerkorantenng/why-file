/**
 * Named idioms a fragmentary transcript uses to state a claim. Matching is
 * scoped to one sentence at a time (see sentences.ts) so a lazy regex cannot
 * bleed backward across an unrelated clause just because "it is" or "because"
 * eventually shows up later in the transcript. Each pattern is unit-tested in
 * test/patterns.test.ts against sentences the demo fixtures do not contain.
 */

/** "no, not DynamoDB, the access pattern is wrong" -> "DynamoDB" */
export const REJECTED_RE = /\bnot\s+([a-zA-Z0-9][\w\s-]{1,40}?),\s*(?:the|because|it)/gi;

/** "so three am it is" -> "three am". Tried first: the combined idiom is more
 * specific than either half alone, so it wins over the two looser patterns
 * below when a sentence has no earlier punctuation to bound them by. */
export const DECISION_SO_IT_IS_RE = /\bso\s+([a-zA-Z0-9][\w\s-]{1,20}?)\s+it is\b/i;

/** "three am it is" -> "three am" */
export const DECISION_IT_IS_RE = /\b([a-zA-Z0-9][\w\s-]{1,20}?)\s+it is\b/i;

/** "so postgres, and we revisit" -> "postgres" */
export const DECISION_SO_RE = /\bso\s+([a-zA-Z0-9][\w\s-]{1,30}?)(?:,| and\b|\.|$)/i;

/** "because the upstream rate limiter resets on a ten second window" -> that clause */
export const BECAUSE_RE = /\bbecause\s+([^.]+?)(?:\.\s|\.$|$)/i;

/** "if reconciliation moves off the join-heavy path" -> that clause */
export const IF_RE = /\bif\s+([^.]+?)(?:\.\s|\.$|$)/i;

export interface MatchedSpan {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

/** Runs `re` against `text` and returns group 1 as a span, offset by `base`
 * (the text's start position within some larger joined string). */
export function matchSpan(re: RegExp, text: string, base = 0): MatchedSpan | null {
  const m = re.exec(text);
  if (!m || m.index === undefined || !m[1]) return null;
  const groupIndex = m[0].indexOf(m[1]);
  const start = base + m.index + Math.max(groupIndex, 0);
  const value = m[1].trim();
  return { value, start, end: start + value.length };
}
