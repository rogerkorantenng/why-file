/**
 * Export: the whole decision log as one document, and the same thing as JSON.
 *
 * Day two of using this tool is the day somebody asks for the decision log in
 * an onboarding doc, an architecture review pack, or a handover. A tool that
 * can only be queried one question at a time makes that person copy and paste,
 * and copy and paste is where provenance gets dropped.
 *
 * Both formats carry three things the ordinary answer carries: the provenance
 * line, the fact that nothing here names a speaker, and the consent
 * announcements that made the capture lawful in the first place. Exporting the
 * claims without the announcements would produce a document that looks like a
 * record of secret recording, which is precisely the thing Oracle's design
 * spends its whole budget avoiding.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { citedFragments, renderAdrMarkdown } from "./adr.ts";
import { forMarkdownBlock, forMarkdownToken } from "./guard/destination.ts";
import type { Claim, ClaimRelation, ConsentAnnouncement, Conversation } from "./types.ts";

export interface ExportInput {
  readonly claims: readonly Claim[];
  readonly relations: readonly ClaimRelation[];
  readonly announcements: readonly ConsentAnnouncement[];
  /** The conversations still held, so each record can quote the words it came from.
   * Absent for a store that has dropped its transcripts; the records survive that. */
  readonly conversations?: readonly Conversation[];
  readonly generatedAt: string;
}

export interface ExportResult {
  readonly markdown: string;
  readonly json: string;
  readonly claimCount: number;
  readonly supersededCount: number;
}

const HEADER_NOTE = [
  "Every record below was extracted from an in-person conversation captured by a Bee",
  "wearable under an announced, room-scoped session. No record names a speaker, and no",
  "field in this file could hold one. Provenance is a conversation id and a timestamp.",
  "Identity and assent come from the git author and the reviewers of each record.",
].join("\n");

function byTimeDescending(a: Claim, b: Claim): number {
  return b.provenance.timestamp.localeCompare(a.provenance.timestamp);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * A date a person reads, composed by Oracle rather than escaped from the timestamp.
 *
 * The raw provenance timestamp goes through the markdown guard, which is right — and it
 * comes out as `2026\\-03\\-18T09:31:17\\.400Z`, which nobody wants at the top of a
 * contents table. This parses it and writes the date out in Oracle's own words, so the
 * string in the table is one this file composed and carries nothing from outside. The
 * unparseable case falls back to the escaped original, which is ugly and correct.
 */
function dayOf(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return forMarkdownToken(iso);
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}

/**
 * The contents page.
 *
 * Every other section of this document is one record at a time. This is the only place a
 * reader can see the whole log at once and find the one they came for, and it is the
 * reason the export is a document rather than a dump. No identifier goes in it: the
 * columns are the three things somebody scanning a decision log is actually scanning for.
 */
function glanceTable(claims: readonly Claim[], superseded: ReadonlySet<string>): string[] {
  if (claims.length === 0) return [];
  const rows = claims.map((c) => {
    const decision = c.decision || c.rejectedOptions[0] || "(not captured)";
    const standing = superseded.has(c.id) ? "Reversed by a later conversation" : "Stands";
    return `| ${dayOf(c.provenance.timestamp)} | ${forMarkdownToken(c.topic)} | ${forMarkdownBlock(decision, 120)} | ${standing} |`;
  });
  return ["## At a glance", "", "| Settled | Subject | What was decided | Standing |", "| --- | --- | --- | --- |", ...rows, ""];
}

export function buildExport(input: ExportInput): ExportResult {
  const claims = [...input.claims].sort(byTimeDescending);
  const superseded = new Set(input.relations.filter((r) => r.kind === "supersedes").map((r) => r.earlierClaimId));

  const conversations = new Map((input.conversations ?? []).map((c) => [c.id, c]));

  const sections: string[] = [
    "# Decision log",
    "",
    `${claims.length} record${claims.length === 1 ? "" : "s"}, ${superseded.size} of them reversed by a later conversation. ` +
      `Generated ${dayOf(input.generatedAt)} by Why File.`,
    "",
    // A blockquote, because this note is about the document rather than part of it, and
    // because the one sentence a reader must not skip should not look like body text.
    ...HEADER_NOTE.split("\n").map((line) => `> ${line}`),
    "",
    ...glanceTable(claims, superseded),
    "## Consent announcements",
    "",
  ];

  if (input.announcements.length === 0) {
    sections.push("_No session was announced. Nothing should have been captured._", "");
  } else {
    for (const a of input.announcements) {
      // The export is markdown, which is a destination. Every value on these lines came
      // from outside Oracle, so each is escaped for the line it lands on.
      sections.push(
        `- ${forMarkdownToken(a.announcedAt)}, room ${forMarkdownToken(a.roomId)}, session ${forMarkdownToken(a.sessionId)}`,
        `  - announced: "${forMarkdownBlock(a.announcementText)}"`,
        `  - policy: ${forMarkdownToken(a.policyRef)}`,
      );
    }
    sections.push("");
  }

  sections.push("## Reversals", "");
  const reversals = input.relations.filter((r) => r.kind === "supersedes");
  if (reversals.length === 0) {
    sections.push("_None found._", "");
  } else {
    for (const r of reversals) {
      sections.push(
        `- ${forMarkdownToken(r.laterClaimId)} appears to reverse ${forMarkdownToken(r.earlierClaimId)} (${forMarkdownToken(r.detectedBy)}, confidence ${r.confidence.toFixed(2)})`,
        `  - ${forMarkdownBlock(r.rationale)}`,
      );
    }
    sections.push("");
  }

  sections.push("## Records, newest first", "");
  for (const claim of claims) {
    const body = renderAdrMarkdown(claim, input.relations, citedFragments(claim, conversations.get(claim.provenance.conversationId)))
      .split("\n")
      .map((line) => (line.startsWith("#") ? `##${line}` : line))
      .join("\n");
    sections.push(body, "---", "");
  }

  const json = JSON.stringify(
    {
      generatedAt: input.generatedAt,
      note: HEADER_NOTE,
      announcements: input.announcements,
      relations: input.relations,
      claims,
    },
    null,
    2,
  );

  return { markdown: sections.join("\n"), json: `${json}\n`, claimCount: claims.length, supersededCount: superseded.size };
}

export interface WrittenExport extends ExportResult {
  readonly markdownPath: string;
  readonly jsonPath: string;
}

export async function writeExport(input: ExportInput, outDir: string): Promise<WrittenExport> {
  const result = buildExport(input);
  await mkdir(outDir, { recursive: true });
  const markdownPath = path.join(outDir, "decision-log.md");
  const jsonPath = path.join(outDir, "decision-log.json");
  await writeFile(markdownPath, result.markdown, "utf8");
  await writeFile(jsonPath, result.json, "utf8");
  return { ...result, markdownPath, jsonPath };
}
