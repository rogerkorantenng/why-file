/**
 * What each step of the demo puts on screen, kept apart from the order they run in.
 *
 * `cli-demo.ts` reads as the sequence of events in a real day: announce, capture, sweep
 * for reversals, review, draft, ask, export, and the file that is left. Everything that
 * is only about putting words on a terminal lives here, so neither file has to be read to
 * follow the other. The look those words are drawn in is a third file again, `layout.ts`.
 */
import { AMBER, BOLD, RESET, SLATE, WHITE, WIDTH, blank, field, heading, legend, say, slate, titled } from "./layout.ts";
import { printClaim, printHit, utterance } from "./print.ts";
import { forTerminal } from "../guard/destination.ts";
import { MOCK_CONVERSATIONS } from "../fixtures/mock-conversations.ts";
import { TWO_COLUMN_MINIMUM, renderReview } from "../review.ts";
import type { Oracle } from "../oracle.ts";
import type { ReviewSurface } from "../review.ts";
import type { ConsentAnnouncement, DraftRecord } from "../types.ts";
import type { OracleStatus } from "../oracle-types.ts";
import type { WrittenExport } from "../export.ts";

/** The colour convention, stated once at the top in the colours it describes, because
 * every screen below leans on it: three colours, one meaning each, never decorative. */
export function masthead(extractor: string, baseUrl: string): void {
  blank();
  console.log(`${" ".repeat(13)}  ${BOLD}Why File${RESET}`);
  console.log(`${" ".repeat(13)}  ${SLATE}why the code looks like this, from what was said in the room${RESET}`);
  blank();
  legend();
  blank();
  field("extractor", extractor, "quiet");
  field("bee", `${baseUrl}, mocked at the /v1 boundary`, "quiet");
}

export function printAnnouncement(announcement: ConsentAnnouncement): void {
  field("room", announcement.roomId, "quiet");
  field("announced", announcement.announcedAt, "quiet");
  field("policy", announcement.policyRef, "quiet");
  blank();
  say(`“${announcement.announcementText}”`);
}

/** The day, conversation by conversation: the fragments as the room said them, then the
 * records taken out of them, under the same gutter so the eye can run between the two. */
export async function captureEverything(oracle: Oracle): Promise<string[]> {
  const claimIds: string[] = [];
  for (const conv of MOCK_CONVERSATIONS) {
    // A conversation id and a timestamp come from a third party's API, and this is a
    // terminal. `utterance()` below guards the transcript itself; this is the line above it.
    titled(`conversation ${forTerminal(conv.id, 80)}`, forTerminal(conv.startedAt, 40));
    blank();
    for (const u of conv.utterances) utterance(u.id, u.text);
    blank();

    const result = await oracle.captureConversation("session_1", conv.id, ["badge_42"]);
    if (result.usedFallback) field("fell back", result.fallbackReason ?? "no reason given", "quiet");
    for (const rejected of result.attributionRejections) field("dropped", `attribution guard: ${rejected}`, "quiet");
    if (result.claims.length > 1) field("segmented", `${result.claims.length} subjects in one recording`, "quiet");
    blank();
    for (const claim of result.claims) {
      claimIds.push(claim.id);
      printClaim(claim);
    }
  }
  return claimIds;
}

/** Two columns need room. Below 96 they would interleave into nonsense, so `renderReview`
 * stacks them instead — the record, then the transcript under it, each with the full
 * width. The sentence here says which of the two the reader is looking at; it used to say
 * the columns were not being drawn and then draw them anyway. */
export function printReview(review: ReviewSurface): void {
  if (WIDTH < TWO_COLUMN_MINIMUM) {
    slate(`This terminal is too narrow for two columns, so the record and the transcript are stacked. Widen it past ${TWO_COLUMN_MINIMUM} to see them side by side.`);
    blank();
  }
  console.log(renderReview(review, WIDTH, { claim: AMBER, provenance: SLATE, plain: WHITE, reset: RESET }));
}

/** A short sha in the gutter, the path beside it: a git log line, in Oracle's own layout. */
export function printDrafts(records: readonly DraftRecord[], repoDir: string): void {
  for (const record of records) {
    field(record.commitSha.slice(0, 8), `${record.filePath}  ${SLATE}on ${record.branch}${RESET}`);
  }
  blank();
  field("repo", repoDir, "quiet");
}

export function printQuestion(question: string): void {
  console.log(`${" ".repeat(13)}  ${BOLD}${question}${RESET}`);
  blank();
}

export function printNoAnswer(): void {
  say("Nothing in the log covers that.");
}

export { printHit };

/** The log and the announcements that made capturing it lawful, which is why they are
 * printed together and exported together. */
export function printExport(exported: WrittenExport, announcements: readonly ConsentAnnouncement[]): void {
  field("records", `${exported.claimCount}, ${exported.supersededCount} reversed`, "quiet");
  field("markdown", exported.markdownPath, "quiet");
  field("json", exported.jsonPath, "quiet");
  heading("The consent log, exported with them");
  for (const a of announcements) {
    field("session", `${a.sessionId} in ${a.roomId}, announced ${a.announcedAt}`, "quiet");
  }
}

export function printStatus(status: OracleStatus): void {
  blank();
  field("ran on", `${status.extractor}; last record extracted by ${status.lastExtractorUsed ?? "nothing yet"}`, "quiet");
  if (status.lastFallbackReason) field("fell back", status.lastFallbackReason, "quiet");
  blank();
}
