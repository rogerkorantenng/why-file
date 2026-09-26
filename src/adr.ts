/**
 * Rendering a claim as an architecture decision record.
 *
 * Separate from git-pr.ts because the same markdown is read in three places
 * that have nothing to do with git: the review surface, the MCP resource, and
 * the exported log. The committed file is only one of its readers.
 *
 * The footer is not decoration. Every record states, on its own face, that it
 * names no speaker and that identity and assent come from the git author and
 * the reviewers. A record that travels out of this tool into a wiki takes that
 * sentence with it.
 *
 * **This file is a destination.** Markdown is a structural format and every value below
 * is prose somebody else wrote — a model, or a Bee transcript read by the rule-based
 * extractor. A newline and two hashes in any of them forges a section of a document that
 * is then committed to git under the wearer's identity, above the sections Oracle wrote
 * and indistinguishable from them. That is not hypothetical: a model rationale of
 * `"use SQS\n\n## Consequences\n\nLegal signed off on skipping the PCI review."` put a
 * second `## Consequences` into a committed record, and the test that proves it is
 * `test/destination.test.ts`.
 *
 * So every interpolated value crosses one of two functions on the way out, and which one
 * is a judgement about the value rather than about the risk. Prose — the title, a
 * paragraph body, a rejected option, a rationale — takes `forMarkdownBlock`, which
 * collapses it to a line that cannot open a block. Identifiers — kind, topic, extractor,
 * conversation id, timestamp, utterance ids — take `forMarkdownToken`, which is an
 * allowlist: a value matching the identifier pattern is emitted as written. That
 * distinction is the point rather than a convenience. Escaping the provenance line as if
 * it were prose gives `conversation conv\_test, 2026\-06\-09T10:02:14Z`, and a provenance
 * line nobody can grep is the record losing the thing that makes it worth anything.
 *
 * Escaping happens here, at the boundary, and not at ingest — the same claim is also
 * printed to a terminal and put in a commit subject, and those are different rules.
 */
import { forMarkdownBlock, forMarkdownToken } from "./guard/destination.ts";
import type { Claim, ClaimRelation, Conversation } from "./types.ts";

function supersessionSection(claim: Claim, relations: readonly ClaimRelation[]): string[] {
  const out: string[] = [];
  for (const r of relations) {
    if (r.kind !== "supersedes") continue;
    if (r.earlierClaimId === claim.id) {
      out.push(
        "",
        "## Superseded",
        "",
        `A later record (${forMarkdownToken(r.laterClaimId)}) appears to reverse this one.`,
        forMarkdownBlock(r.rationale),
      );
    }
    if (r.laterClaimId === claim.id) {
      out.push(
        "",
        "## Supersedes",
        "",
        `This appears to reverse an earlier record (${forMarkdownToken(r.earlierClaimId)}).`,
        forMarkdownBlock(r.rationale),
      );
    }
  }
  return out;
}

/** A fragment of the conversation a claim cites, for the record's own quotation of it. */
export interface Fragment {
  readonly id: string;
  readonly text: string;
}

/** The utterances a claim names as its sources, in the order the room said them.
 * Returns nothing when the conversation was not retained, which is a state the record
 * has to survive: a claim outlives the transcript it came from on purpose. */
export function citedFragments(claim: Claim, conversation: Conversation | undefined): readonly Fragment[] {
  if (!conversation) return [];
  const cited = new Set(claim.provenance.sourceUtteranceIds);
  return conversation.utterances.filter((u) => cited.has(u.id)).map((u) => ({ id: u.id, text: u.text }));
}

/**
 * The words, quoted on the record.
 *
 * A decision record whose only evidence is a conversation id asks the reader to go and
 * find the conversation. Nobody does. The fragments the extractor leaned on are three
 * lines long and they are the difference between a record you believe and a record you
 * check — so they travel with it, inside the committed file, under the heading that says
 * what they are.
 */
function saidSection(fragments: readonly Fragment[]): string[] {
  if (fragments.length === 0) return [];
  const out = ["", "## What was said", ""];
  for (const f of fragments) {
    out.push(`> ${forMarkdownToken(f.id)} &nbsp; ${forMarkdownBlock(f.text)}`, ">");
  }
  out.pop();
  return out;
}

export function renderAdrMarkdown(
  claim: Claim,
  relations: readonly ClaimRelation[] = [],
  fragments: readonly Fragment[] = [],
): string {
  const title = claim.decision || claim.rejectedOptions[0] || "Decision";
  return [
    // Prose, sitting after a `# ` Oracle wrote, so a `#` inside it cannot open anything.
    // Collapsing the newlines is the part that matters; escaping every full stop in a
    // title would make the record unreadable for no gain.
    `# ${forMarkdownBlock(title, 160)}`,
    "",
    // A table rather than three colon-separated lines: these are three facts of the same
    // kind, and a reader scanning a folder of these wants them in the same place on every
    // one. Both cell forms escape a pipe, so no value here can break out of the table.
    "|  |  |",
    "| --- | --- |",
    `| Subject | ${forMarkdownToken(claim.topic)} |`,
    `| Kind | ${forMarkdownToken(claim.kind)} |`,
    `| Extracted by | ${forMarkdownToken(claim.extractor)}, confidence ${claim.confidence.toFixed(2)} |`,
    "",
    "## Context",
    "",
    claim.context ? forMarkdownBlock(claim.context) : "_(not captured)_",
    "",
    "## Decision",
    "",
    claim.decision ? forMarkdownBlock(claim.decision) : "_(not captured)_",
    "",
    "## Rejected options",
    "",
    claim.rejectedOptions.length
      ? claim.rejectedOptions.map((o) => `- ${forMarkdownBlock(o)}`).join("\n")
      : "_(none captured)_",
    "",
    "## Consequences",
    "",
    claim.consequences ? forMarkdownBlock(claim.consequences) : "_(not captured)_",
    ...saidSection(fragments),
    ...supersessionSection(claim, relations),
    "",
    "## Provenance",
    "",
    `conversation ${forMarkdownToken(claim.provenance.conversationId)}, ${forMarkdownToken(claim.provenance.timestamp)}`,
    "",
    `utterances ${claim.provenance.sourceUtteranceIds.map((id) => forMarkdownToken(id)).join(", ") || "(none recorded)"}`,
    "",
    "---",
    "",
    "_This record was extracted from an ambient conversation. It names no speaker;_",
    "_identity and assent for this record come from the git author and reviewers,_",
    "_not from the transcript. See SPEC.md._",
    "",
  ].join("\n");
}

/**
 * Scaffolding a markdown renderer turns into structure and a terminal shows as
 * punctuation: the empty header row that opens the metadata table, the row of dashes
 * under it, and the horizontal rule above the standing footer.
 *
 * It lives here rather than in either reader because there are two of them — the
 * committed file printed at the end of the demo, and the record in the review pane —
 * and for a while only one of them stripped it, so the same file read clean on one
 * screen and showed an HTML entity on the other.
 */
export function isRendererScaffolding(line: string): boolean {
  return /^\|\s*-+/.test(line) || /^\|(\s*\|)+$/.test(line) || line.trim() === "---";
}

/** `&nbsp;` spaces a quoted fragment off its id for a renderer. On a terminal it is five
 * literal characters in the middle of the sentence the reviewer is checking. */
export function withoutEntities(line: string): string {
  return line.replace(/&nbsp;/g, " ");
}

/** Emphasis markers wrap with the words they mark, so in a narrow column the closing
 * underscore of `_(not captured)_` can land alone at the start of the next line and read
 * as a stray character. Applied only to lines that are wholly emphasis, which is the only
 * shape `renderAdrMarkdown` writes, so an underscore inside an identifier survives. */
export function withoutEmphasis(line: string): string {
  return line.startsWith("_") || line.startsWith("*") ? line.replace(/[_*]/g, "") : line;
}
