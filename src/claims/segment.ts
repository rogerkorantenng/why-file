/**
 * Topic segmentation, the deterministic version.
 *
 * One conversation is not one decision. A ten minute stretch in a war room
 * moves from the retry budget to where the feature flags live, and the earlier
 * build extracted a single claim per conversation and said so as a known
 * limitation. This splits a conversation into topic runs so several claims can
 * come out of one recording.
 *
 * The model path (model-extract.ts) segments by judgement: it returns one claim
 * per topic with the utterance ids that produced it. This module is what runs
 * when Bedrock is unreachable, so the fallback keeps the capability rather than
 * silently losing it. It is a lexical-cohesion split in the TextTiling family:
 * compare the vocabulary on either side of each possible boundary, and take a
 * boundary where the vocabulary changes AND the talking stopped for a moment.
 * Requiring both signals is what keeps it from cutting mid-argument, where
 * people restate the same point in new words.
 */
import type { Utterance } from "../types.ts";

export interface Segment {
  readonly index: number;
  readonly utterances: readonly Utterance[];
}

export interface SegmentOptions {
  /** Silence between two utterances that counts as a possible topic change. */
  readonly gapMs?: number;
  /** A gap this long is a boundary on its own, whatever the vocabulary does. */
  readonly hardGapMs?: number;
  /** Jaccard similarity below this counts as a vocabulary change. */
  readonly cohesionThreshold?: number;
  /** Utterances either side of the boundary used to compare vocabulary. */
  readonly window?: number;
  /** Segments shorter than this are merged back into their neighbour. */
  readonly minUtterances?: number;
}

const DEFAULTS: Required<SegmentOptions> = {
  gapMs: 3_000,
  hardGapMs: 20_000,
  cohesionThreshold: 0.12,
  window: 3,
  minUtterances: 3,
};

/** Content words only. The filler is the majority of a fragmentary transcript
 * and it is identical across topics, so leaving it in makes every boundary
 * look cohesive. */
const STOPWORDS = new Set([
  "a","about","actually","and","any","are","as","at","be","because","been","but","by","can","could","did","do","does",
  "for","from","get","gets","got","had","has","have","i","if","in","into","is","it","its","just","kind","like","ll",
  "m","me","mean","might","more","much","my","no","not","of","off","ok","okay","on","one","or","our","out","really",
  "right","s","same","so","some","t","than","that","thats","the","their","them","then","there","these","they","thing",
  "things","this","those","to","too","up","us","ve","very","want","was","we","well","were","what","when","which",
  "who","will","with","would","yeah","yes","you","your",
]);

function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (token.length > 1 && !STOPWORDS.has(token)) out.add(token);
  }
  return out;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function vocabularyAround(utterances: readonly Utterance[], from: number, to: number): Set<string> {
  const out = new Set<string>();
  for (let i = Math.max(from, 0); i < Math.min(to, utterances.length); i += 1) {
    for (const token of contentTokens(utterances[i]!.text)) out.add(token);
  }
  return out;
}

/** Returns the indices at which a new segment starts. */
export function boundaryIndices(utterances: readonly Utterance[], options: SegmentOptions = {}): number[] {
  const o = { ...DEFAULTS, ...options };
  const boundaries: number[] = [];
  for (let i = 1; i < utterances.length; i += 1) {
    const gap = utterances[i]!.startMs - utterances[i - 1]!.endMs;
    if (gap >= o.hardGapMs) {
      boundaries.push(i);
      continue;
    }
    if (gap < o.gapMs) continue;
    const before = vocabularyAround(utterances, i - o.window, i);
    const after = vocabularyAround(utterances, i, i + o.window);
    if (jaccard(before, after) < o.cohesionThreshold) boundaries.push(i);
  }
  return boundaries;
}

export function segmentByTopic(utterances: readonly Utterance[], options: SegmentOptions = {}): readonly Segment[] {
  const o = { ...DEFAULTS, ...options };
  if (utterances.length === 0) return [];

  const starts = [0, ...boundaryIndices(utterances, options), utterances.length];
  const runs: Utterance[][] = [];
  for (let i = 0; i < starts.length - 1; i += 1) {
    const run = utterances.slice(starts[i]!, starts[i + 1]!);
    if (run.length === 0) continue;
    // A run too short to hold an argument is a pause inside the previous
    // topic, not a topic of its own.
    const previous = runs[runs.length - 1];
    if (run.length < o.minUtterances && previous) previous.push(...run);
    else runs.push(run);
  }

  return runs.map((run, index) => ({ index, utterances: run }));
}
