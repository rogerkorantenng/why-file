/**
 * The features a second day of use needs, end to end: segmentation into
 * several records, the March decision a June conversation reversed, the review
 * surface, the export, and the status line. Bedrock is off throughout, so the
 * capability is proved on the deterministic path alone.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ConsentViolation } from "../src/consent.ts";
import { announce, makeOracle, startHarness, stopHarness } from "./oracle-harness.ts";

before(startHarness);
after(stopHarness);

test("one recording with two subjects becomes two records", async () => {
  const oracle = makeOracle();
  announce(oracle, "s6");
  const captured = await oracle.captureConversation("s6", "conv_6529877", ["badge_42"]);
  assert.equal(captured.claims.length, 2);
  assert.notEqual(captured.claims[0]!.id, captured.claims[1]!.id);
});

test("a decision taken in March and reversed in June is found, and search ranks the June one first", async () => {
  const oracle = makeOracle();
  announce(oracle, "s7");
  await oracle.captureConversation("s7", "conv_6529877", ["badge_42"]); // March: retry budget five
  await oracle.captureConversation("s7", "conv_6531702", ["badge_42"]); // June: retry budget three

  const detection = await oracle.findContradictions();
  assert.equal(detection.relations.length, 1);
  assert.equal(detection.relations[0]!.kind, "supersedes");
  assert.match(detection.relations[0]!.earlierClaimId, /conv_6529877/);
  assert.match(detection.relations[0]!.laterClaimId, /conv_6531702/);

  const hits = oracle.ask("what is the retry budget on the payments call", { now: new Date("2026-09-22T00:00:00Z") });
  assert.match(hits[0]!.claim.provenance.conversationId, /conv_6531702/);
  assert.equal(hits[0]!.claim.decision, "three");
  assert.ok(hits.some((h) => h.superseded), "the reversed record is still findable, marked as reversed");
});

test("the review surface pairs a stored record with the fragments it came from", async () => {
  const oracle = makeOracle();
  announce(oracle, "s8");
  const captured = await oracle.captureConversation("s8", "conv_6531525", ["badge_42"]);
  const review = oracle.review(captured.claims[0]!.id);

  assert.ok(review.utterances.length > 0);
  assert.ok(review.utterances.some((u) => u.cited));
  assert.match(review.adrMarkdown, /## Provenance/);
});

test("the exported log carries the consent announcements alongside the records", async () => {
  const oracle = makeOracle();
  announce(oracle, "s9");
  await oracle.captureConversation("s9", "conv_6531611", ["badge_42"]);
  const exported = oracle.exportLog();

  assert.ok(exported.claimCount > 0);
  assert.match(exported.markdown, /Oracle is recording this room\./);
  assert.match(exported.markdown, /No record names a speaker/);
});

test("status reports what is running and what is stored, without a model configured", async () => {
  const oracle = makeOracle();
  announce(oracle, "s10");
  await oracle.captureConversation("s10", "conv_6531611", ["badge_42"]);
  const status = oracle.status();

  assert.equal(status.modelConfigured, false);
  assert.equal(status.extractor, "rules");
  assert.equal(status.claimCount, 1);
  assert.equal(status.conversationCount, 1);
  assert.deepEqual(status.openSessions, ["s10"]);
});

test("a closed session refuses further capture", async () => {
  const oracle = makeOracle();
  announce(oracle, "s11");
  oracle.closeSession("s11");
  await assert.rejects(() => oracle.captureConversation("s11", "conv_6531611", ["badge_42"]), ConsentViolation);
});

test("nothing Oracle stores or renders, on any path, contains a speaker label", async () => {
  const oracle = makeOracle();
  announce(oracle, "s12");
  for (const id of ["conv_6529877", "conv_6531525", "conv_6531611", "conv_6531702"]) {
    await oracle.captureConversation("s12", id, ["badge_42"]);
  }
  await oracle.findContradictions();

  const serialized = JSON.stringify({ claims: oracle.store.allClaims(), relations: oracle.store.allRelations() });
  assert.doesNotMatch(serialized, /speaker/i);
  assert.doesNotMatch(serialized, /Unknown/);
  assert.doesNotMatch(oracle.exportLog().json, /"speaker"/i);
});
