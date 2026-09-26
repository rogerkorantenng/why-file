/**
 * Laying the review surface out as two columns.
 *
 * Left is the record, right is the transcript, and they run down the page
 * together so a reviewer's eye moves sideways rather than scrolling. Cited
 * fragments carry a bar in the margin. Colour is injected rather than baked in
 * so the same layout serves a terminal, an MCP client and a test.
 *
 * Two columns need room. Below 96 the record wraps to about thirty characters and the
 * transcript to about the same, and the two interleave into something a reviewer has to
 * decode rather than read — a `0.40 |` from the metadata table landing at the left margin
 * under a wrapped fragment. So below that width the same two things are stacked instead:
 * the record, then the transcript under it, each with the full width. The demo says which
 * one the reader is getting; the decision itself is made here rather than at the call
 * site, because the MCP client asking for a rendered surface has a width too.
 */
import { isRendererScaffolding, withoutEmphasis, withoutEntities } from "../adr.ts";
import { forTerminal } from "../guard/destination.ts";
import type { ReviewSurface } from "../review.ts";

/** Below this, the two columns stack. */
export const TWO_COLUMN_MINIMUM = 96;

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= width) line = `${line} ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

/** A wrapped value indents to clear its own first word, so a three-line bullet reads as
 * one bullet rather than three. The rest of Oracle's output does this with its gutter;
 * this surface has no gutter, so it does it with two spaces. */
function wrapHanging(text: string, width: number): string[] {
  const lines = wrap(text, Math.max(8, width - 2));
  return lines.map((line, i) => (i === 0 ? line : `  ${line}`));
}

/**
 * The record as a reviewer should read it: the markdown with the scaffolding a renderer
 * would have consumed taken out, which is the same treatment `print.ts` gives the
 * committed file at the end of the demo. Without it this pane showed a literal `&nbsp;`
 * in the middle of the quoted fragment and two rows of punctuation above the metadata.
 */
function recordLines(markdown: string, width: number): string[] {
  const out: string[] = [];
  for (const raw of markdown.split("\n")) {
    if (isRendererScaffolding(raw)) continue;
    const line = withoutEmphasis(withoutEntities(raw));
    if (line.trim() === "" && out[out.length - 1]?.trim() === "") continue;
    if (line.length <= width) out.push(line);
    else out.push(...wrapHanging(line, width));
  }
  return out;
}

export interface ReviewColours {
  readonly claim: string;
  readonly provenance: string;
  readonly plain: string;
  readonly reset: string;
}

const NO_COLOUR: ReviewColours = { claim: "", provenance: "", plain: "", reset: "" };

// The right-hand column is raw transcript, and a transcript is a third party's ASR
// output rather than something Oracle wrote. This layout is printed to a terminal and
// returned over MCP, so an escape sequence arriving in an utterance would repaint the
// record in the left column — the very thing the reviewer is checking it against.
const t = (s: string): string => forTerminal(s, 2000);

/** Things a reviewer should look at before merging, in either layout. */
function warningLines(review: ReviewSurface, width: number, colours: ReviewColours): string[] {
  if (review.warnings.length === 0) return [];
  const out = ["", `${colours.plain}Before merging:${colours.reset}`];
  for (const warning of review.warnings) {
    // A supersession warning carries the model's rationale inside a sentence Oracle
    // wrote. Same destination, same rule.
    for (const line of wrapHanging(`- ${t(warning)}`, width)) out.push(`${colours.plain}${line}${colours.reset}`);
  }
  return out;
}

function transcriptHeading(review: ReviewSurface): string {
  return `transcript, conversation ${t(review.claim.provenance.conversationId)}`;
}

/** One column, the record then the transcript. The bar that marks a cited fragment is
 * carried down its wrapped lines, so a three-line quotation is still visibly one. */
function renderStacked(review: ReviewSurface, width: number, colours: ReviewColours): string {
  const out: string[] = [];
  for (const line of recordLines(review.adrMarkdown, width)) {
    out.push(`${colours.plain}${line}${colours.reset}`.trimEnd());
  }
  out.push("");
  out.push(`${colours.provenance}${transcriptHeading(review)}${colours.reset}`);
  out.push("");
  for (const u of review.utterances) {
    const bar = u.cited ? "|" : " ";
    const colour = u.cited ? colours.claim : colours.provenance;
    const lines = wrap(`${bar} [${t(u.id)}] ${t(u.text)}`, width);
    out.push(`${colour}${lines[0] ?? ""}${colours.reset}`.trimEnd());
    for (const line of lines.slice(1)) out.push(`${colour}${bar} ${line}${colours.reset}`.trimEnd());
  }
  out.push(...warningLines(review, width, colours));
  return out.join("\n");
}

/** Renders the surface as two columns: the draft record on the left, the
 * fragments it came from on the right, cited ones marked with a bar. Below
 * `TWO_COLUMN_MINIMUM` the two stack instead of interleaving. */
export function renderReview(review: ReviewSurface, totalWidth = 104, colours: ReviewColours = NO_COLOUR): string {
  if (totalWidth < TWO_COLUMN_MINIMUM) return renderStacked(review, totalWidth, colours);

  const columnWidth = Math.max(28, Math.floor((totalWidth - 5) / 2));
  const left = recordLines(review.adrMarkdown, columnWidth);
  const right: Array<{ text: string; cited: boolean }> = [];
  right.push({ text: transcriptHeading(review), cited: false });
  right.push({ text: "", cited: false });
  for (const u of review.utterances) {
    const head = `${u.cited ? "|" : " "} [${t(u.id)}] ${t(u.text)}`;
    for (const line of wrap(head, columnWidth)) right.push({ text: line, cited: u.cited });
  }

  const rows = Math.max(left.length, right.length);
  const out: string[] = [];
  for (let i = 0; i < rows; i += 1) {
    const l = (left[i] ?? "").padEnd(columnWidth);
    const r = right[i];
    const rendered = r ? `${r.cited ? colours.claim : colours.provenance}${r.text}${colours.reset}` : "";
    out.push(`${colours.plain}${l}${colours.reset}  ${rendered}`.trimEnd());
  }
  out.push(...warningLines(review, totalWidth, colours));
  return out.join("\n");
}
