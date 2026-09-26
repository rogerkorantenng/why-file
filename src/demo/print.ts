/**
 * What Oracle prints: records, answers, reversals, and the file a record becomes.
 *
 * The look these are drawn in lives in `layout.ts`. This file only decides which gutter
 * word each line gets and which of the three colours it is owed — plain ink for words
 * that were said, amber for a value Oracle is asserting, slate for pointers and
 * machinery.
 */
import type { Claim } from "../types.ts";
import type { RelationDetection } from "../relations.ts";
import type { SearchHit } from "../search.ts";
import { RULES_EXTRACTOR } from "../claims/extract.ts";
import { forTerminal } from "../guard/destination.ts";
import { isRendererScaffolding, withoutEmphasis, withoutEntities } from "../adr.ts";
import { AMBER, BOLD, PAD, RESET, SLATE, WHITE, blank, field, row, say, titled } from "./layout.ts";

/**
 * A terminal is a destination with its own rule: newlines are fine, escape sequences are
 * not. Every model-written or transcript-derived value printed below crosses `forTerminal`
 * first.
 *
 * This is the same mistake as the forged markdown heading in adr.ts, pointed at a
 * different output. The palette above is Oracle's own escape codes; an escape arriving
 * inside a claim field can repaint them, erase the provenance line with `\u001b[2K`, or
 * move the cursor back over the fallback warning — and the provenance line is the only
 * reason the record above it is worth anything.
 */
// 600 is `MAX_FIELD` in claims/model-fields.ts: the longest a claim field is allowed to
// be. The cap is there so a runaway string cannot flood a terminal, not to shorten the
// demo, so it is set where nothing a valid record contains is ever cut.
const t = (value: string): string => forTerminal(value, 600);

/** A fragment of transcript. The id goes in the gutter, so a wall of transcript lines up
 * with the record extracted from it and the eye can run down one edge. */
export function utterance(id: string, text: string): void {
  row(t(id), SLATE, t(text), WHITE);
}

/** A record: its subject and id on one line, then its fields under the same gutter.
 *
 * The decision and the rejected options are amber because they are the assertions — the
 * two lines somebody will quote back in three months. Context and consequences are prose
 * the model wrote about them and stay in the terminal's own ink.
 */
export function printClaim(claim: Claim): void {
  titled(t(claim.topic), t(claim.id));
  field("kind", t(claim.kind), "quiet");
  field("decision", t(claim.decision) || "not captured", claim.decision ? "claim" : "quiet");
  field("rejected", claim.rejectedOptions.map(t).join(", ") || "none", claim.rejectedOptions.length ? "claim" : "quiet");
  field("context", t(claim.context) || "not captured", claim.context ? "plain" : "quiet");
  field("so", t(claim.consequences) || "not captured", claim.consequences ? "plain" : "quiet");
  field("from", `conversation ${t(claim.provenance.conversationId)}, ${t(claim.provenance.timestamp)}`, "quiet");
  // The rule-based fallback produces records that read like the model's and are much
  // weaker — a one-word decision, a topic assembled out of whichever nouns were nearby.
  // Saying so in a footnote was not enough: the footnote is the quietest line on the
  // record and the record above it looks finished. It goes on the extractor line, which
  // is the line that is wrong.
  const weak = claim.extractor === RULES_EXTRACTOR ? " — matches a handful of phrasings and misses the rest, so read the fragments" : "";
  field("decided by", `${t(claim.extractor)}, confidence ${claim.confidence.toFixed(2)}${weak}`, "quiet");
  blank();
}

/** The score is printed factored out rather than as a single number, so the
 * ranking can be read instead of trusted. */
export function printHit(hit: SearchHit): void {
  field("answer", t(hit.claim.decision || hit.claim.context), "claim");
  if (hit.superseded) field("but", "a later record reverses this one", "quiet");
  field("from", `conversation ${t(hit.claim.provenance.conversationId)}, ${t(hit.claim.provenance.timestamp)}`, "quiet");
  field(
    "ranked",
    `${hit.score.toFixed(2)} = relevance ${hit.relevance.toFixed(2)} x recency ${hit.recencyWeight.toFixed(2)} (${Math.round(hit.ageDays)} days old) x supersession ${hit.supersededPenalty.toFixed(2)}`,
    "quiet",
  );
  blank();
}

/** What the sweep found, and which judge found it. The fallback says so on
 * screen rather than passing a heuristic off as a model's opinion. */
export function printReversals(detection: RelationDetection): void {
  if (detection.usedFallback) field("fell back", t(detection.fallbackReason ?? "no reason given"), "quiet");
  field("compared", `${detection.pairsConsidered} pair(s) on the same subject, judged by ${t(detection.detectedBy)}`, "quiet");
  blank();
  if (detection.relations.length === 0) {
    say("Nothing here has been quietly reversed.");
    return;
  }
  for (const r of detection.relations) {
    field("reversal", `${t(r.laterClaimId)} ${t(r.kind)} ${t(r.earlierClaimId)}`, "claim");
    field("why", t(r.rationale));
    field("confidence", r.confidence.toFixed(2), "quiet");
    blank();
  }
}

/**
 * The committed record, printed as it will be read.
 *
 * Everything above this is Oracle's own screen. This is the artefact: the markdown file
 * that lands in `decisions/` and outlives the tool. It gets the same gutter as everything
 * else so the two do not look like different programs, with headings bold, the quoted
 * fragments in the ink of the room that said them, and the standing footer in slate,
 * because that sentence is machinery about the record rather than part of it.
 */
export function printArtefact(markdown: string, path: string): void {
  titled("the file this becomes", path);
  blank();
  for (const raw of markdown.split("\n")) {
    const line = t(raw);
    // Markdown's own scaffolding — the table rules, the horizontal rule, the entity that
    // spaces a quoted fragment off its id — is structure for a renderer and noise on a
    // terminal, which is already showing the structure with the gutter. Dropped here and
    // nowhere else: the file on disk keeps all of it.
    if (isRendererScaffolding(line)) continue;
    const clean = withoutEntities(line);
    if (clean.startsWith("# ")) console.log(`${PAD}${BOLD}${AMBER}${clean.slice(2)}${RESET}`);
    else if (clean.startsWith("## ")) console.log(`${PAD}${BOLD}${clean.slice(3)}${RESET}`);
    else if (clean.startsWith("| ")) {
      // A metadata row lands in the gutter like every other labelled value, so the file's
      // own table and Oracle's own screen share one left edge.
      const cells = clean.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length === 2) field(cells[0]!.toLowerCase(), cells[1]!, "quiet");
    } else if (clean.startsWith("> ")) {
      const [, id = "", rest = ""] = /^>\s*(\S+)\s+(.*)$/.exec(clean) ?? [];
      if (rest) row(id, SLATE, `“${rest}”`, WHITE);
      else row("", "", clean.slice(2), WHITE);
    } else if (clean.startsWith("_") || clean.startsWith("*")) row("", "", withoutEmphasis(clean), SLATE);
    else if (clean.trim() === "") console.log("");
    else row("", "", clean, WHITE);
  }
}
