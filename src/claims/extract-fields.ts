/**
 * Pure text-level extraction: runs the idioms in patterns.ts one sentence at a
 * time (sentences.ts) and assembles the ADR-shaped fields. Kept separate from
 * claims produced with provenance (extract.ts) so the idioms can be unit
 * tested on arbitrary sentences without needing a full Conversation fixture.
 */
import {
  BECAUSE_RE,
  DECISION_IT_IS_RE,
  DECISION_SO_IT_IS_RE,
  DECISION_SO_RE,
  IF_RE,
  matchSpan,
  REJECTED_RE,
  type MatchedSpan,
} from "./patterns.ts";
import { asPhrase } from "./model-fields.ts";
import { splitSentences } from "./sentences.ts";

export interface ExtractedFields {
  readonly rejectedOptions: readonly string[];
  readonly decision: string;
  readonly context: string;
  readonly consequences: string;
  readonly matchedSpans: ReadonlyArray<{ start: number; end: number }>;
}

function firstSentenceMatch(re: RegExp, text: string): MatchedSpan | null {
  for (const sentence of splitSentences(text)) {
    const hit = matchSpan(re, sentence.text, sentence.start);
    if (hit) return hit;
  }
  return null;
}

export function extractFields(text: string): ExtractedFields {
  const spans: Array<{ start: number; end: number }> = [];

  const rejected: string[] = [];
  for (const m of text.matchAll(REJECTED_RE)) {
    if (m.index === undefined || !m[1]) continue;
    const value = m[1].trim();
    rejected.push(value);
    const start = m.index + m[0].indexOf(m[1]);
    spans.push({ start, end: start + value.length });
  }

  const decisionMatch =
    firstSentenceMatch(DECISION_SO_IT_IS_RE, text) ??
    firstSentenceMatch(DECISION_IT_IS_RE, text) ??
    firstSentenceMatch(DECISION_SO_RE, text);
  if (decisionMatch) spans.push({ start: decisionMatch.start, end: decisionMatch.end });

  const contextMatch = firstSentenceMatch(BECAUSE_RE, text);
  if (contextMatch) spans.push({ start: contextMatch.start, end: contextMatch.end });

  const consequenceMatch = firstSentenceMatch(IF_RE, text);
  const consequenceInsideDecision =
    !!decisionMatch &&
    !!consequenceMatch &&
    consequenceMatch.start >= decisionMatch.start &&
    consequenceMatch.end <= decisionMatch.end;
  if (consequenceMatch && !consequenceInsideDecision) {
    spans.push({ start: consequenceMatch.start, end: consequenceMatch.end });
  }

  // The same ingest floor the model path crosses.
  //
  // It is easy to assume this path is safe because there is no model on it: the values
  // are spans of the transcript, and a transcript is what actually happened. But a
  // transcript is ASR output from a third party's API, `BECAUSE_RE` captures `[^.]+?`,
  // and both of Oracle's committed-record defects were reproduced through here rather
  // than through Bedrock — a fragment carrying `\u001b[31m` and a newline produced a
  // record with a forged `## Consequences` above its real `## Decision`, and a commit
  // whose subject held a live escape and whose message had a second line. "It came from
  // the source" grounds a value; it does not make it safe for a destination.
  return {
    rejectedOptions: rejected.map(asPhrase).filter((s) => s.length > 0),
    decision: asPhrase(decisionMatch?.value ?? ""),
    context: asPhrase(contextMatch?.value ?? ""),
    consequences: consequenceInsideDecision ? "" : asPhrase(consequenceMatch?.value ?? ""),
    matchedSpans: spans,
  };
}
