/**
 * Joins utterances into a single string while keeping a char-offset map back to
 * the utterance that produced each span. Used for provenance: once claims.ts
 * finds a matched phrase, this module says which utterance id and timestamp it
 * came from.
 */
import type { Utterance } from "./types.ts";

export interface OffsetEntry {
  readonly utteranceId: string;
  readonly timestampMs: number;
  readonly start: number;
  readonly end: number;
}

export interface JoinedTranscript {
  readonly text: string;
  readonly offsets: readonly OffsetEntry[];
}

export function joinTranscript(utterances: readonly Utterance[]): JoinedTranscript {
  let cursor = 0;
  const offsets: OffsetEntry[] = [];
  const parts: string[] = [];
  for (const u of utterances) {
    const start = cursor;
    parts.push(u.text);
    cursor += u.text.length;
    offsets.push({ utteranceId: u.id, timestampMs: u.startMs, start, end: cursor });
    parts.push(" ");
    cursor += 1;
  }
  return { text: parts.join(""), offsets };
}

export function utteranceIdsForSpan(offsets: readonly OffsetEntry[], start: number, end: number): string[] {
  return offsets.filter((o) => o.start < end && o.end > start).map((o) => o.utteranceId);
}

export function earliestTimestampMsForSpan(offsets: readonly OffsetEntry[], start: number, end: number): number {
  const overlapping = offsets.filter((o) => o.start < end && o.end > start);
  const first = overlapping[0];
  return first ? first.timestampMs : 0;
}
