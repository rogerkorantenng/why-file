/** Splits joined transcript text into sentence spans, keeping character
 * offsets into the original string. Extraction runs one sentence at a time so
 * a decision or reason phrase can never bleed across an unrelated clause. */
export interface Sentence {
  readonly text: string;
  readonly start: number;
}

export function splitSentences(text: string): readonly Sentence[] {
  const out: Sentence[] = [];
  const re = /[^.!?]+[.!?]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].trim().length === 0) continue;
    out.push({ text: m[0], start: m.index });
  }
  return out;
}
