import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { findAttributionPhrase } from "../src/claims/attribution-guard.ts";
import { buildExport, writeExport, type ExportInput } from "../src/export.ts";
import { makeClaim } from "./helpers.ts";

let outDir: string;

before(async () => {
  outDir = await mkdtemp(path.join(os.tmpdir(), "oracle-export-"));
});

after(async () => {
  await rm(outDir, { recursive: true, force: true });
});

const input: ExportInput = {
  generatedAt: "2026-09-22T00:00:00Z",
  claims: [
    makeClaim({
      id: "claim_march",
      topic: "payments call retry budget",
      decision: "five",
      provenance: { conversationId: "conv_march", timestamp: "2026-03-18T09:31:17Z", sourceUtteranceIds: ["u5"] },
    }),
    makeClaim({
      id: "claim_june",
      topic: "payments call retry budget",
      decision: "three",
      provenance: { conversationId: "conv_june", timestamp: "2026-06-15T16:40:02Z", sourceUtteranceIds: ["u7"] },
    }),
  ],
  relations: [
    {
      laterClaimId: "claim_june",
      earlierClaimId: "claim_march",
      kind: "supersedes",
      rationale: "The retry budget moved from five to three.",
      detectedBy: "bedrock:test-model",
      detectedAt: "2026-09-22T00:00:00Z",
      confidence: 0.95,
    },
  ],
  announcements: [
    {
      roomId: "room_war-room-3",
      sessionId: "session_1",
      announcedAt: "2026-03-18T09:30:00Z",
      announcementText: "Oracle is recording this room for engineering decisions.",
      policyRef: "https://internal.example.com/policies/room-capture",
    },
  ],
};

test("the export leads with the records, newest first", () => {
  const { markdown } = buildExport(input);
  assert.ok(markdown.indexOf("claim_june") < markdown.indexOf("claim_march"));
});

test("the export carries the consent announcements that made the capture lawful", () => {
  const { markdown } = buildExport(input);
  assert.match(markdown, /## Consent announcements/);
  assert.match(markdown, /Oracle is recording this room for engineering decisions/);
  assert.match(markdown, /policies\/room-capture/);
});

test("reversals are stated up front rather than left for the reader to spot", () => {
  const result = buildExport(input);
  assert.equal(result.supersededCount, 1);
  assert.match(result.markdown, /claim_june appears to reverse claim_march/);
  assert.match(result.markdown, /1 of them reversed by a later conversation/);
});

test("an export with nothing captured says so instead of looking like a clean log", () => {
  const empty = buildExport({ ...input, claims: [], relations: [], announcements: [] });
  assert.match(empty.markdown, /No session was announced/);
  assert.match(empty.markdown, /_None found\._/);
  assert.equal(empty.claimCount, 0);
});

test("the export names nobody and says on its own face that it names nobody", () => {
  const { markdown, json } = buildExport(input);
  assert.match(markdown, /No record names a speaker/);
  assert.doesNotMatch(markdown, /Unknown/);
  assert.equal(findAttributionPhrase(markdown), null);
  assert.doesNotMatch(json, /"speaker"/i);
});

test("both files are written and parse back", async () => {
  const written = await writeExport(input, outDir);
  assert.equal(path.basename(written.markdownPath), "decision-log.md");
  const onDisk = JSON.parse(await readFile(written.jsonPath, "utf8")) as { claims: unknown[]; relations: unknown[] };
  assert.equal(onDisk.claims.length, 2);
  assert.equal(onDisk.relations.length, 1);
  assert.match(await readFile(written.markdownPath, "utf8"), /# Decision log/);
});
