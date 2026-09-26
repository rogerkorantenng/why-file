/**
 * The consent half, end to end over the mocked Bee /v1/* boundary, with
 * Bedrock switched off so the gate is tested on its own terms. The model half
 * is in oracle-records.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ConsentViolation } from "../src/consent.ts";
import { announce, makeOracle, startHarness, stopHarness } from "./oracle-harness.ts";

before(startHarness);
after(stopHarness);

test("capture refuses without a prior announced session", async () => {
  const oracle = makeOracle();
  await assert.rejects(() => oracle.captureConversation("no_such_session", "conv_6531611", ["badge_42"]));
});

test("the full announce, capture, draft, ask flow, on the mocked /v1/* boundary", async () => {
  const oracle = makeOracle();
  announce(oracle, "s1");
  assert.equal(oracle.store.allAnnouncements().length, 1);

  const captured = await oracle.captureConversation("s1", "conv_6531611", ["badge_42"]);
  assert.equal(captured.claims.length, 1);
  assert.equal(captured.claims[0]!.decision, "postgres");

  const record = await oracle.draftRecordForClaim(captured.claims[0]!.id);
  assert.equal(record.branch, `why-file/${captured.claims[0]!.id}`);

  const hits = oracle.ask("why postgres and not dynamodb");
  assert.ok(hits.length > 0);
  assert.equal(hits[0]!.claim.id, captured.claims[0]!.id);
  assert.equal(hits[0]!.claim.provenance.conversationId, "conv_6531611");
});

test("capture with no rostered device present yields no claim (rule 3), and says why", async () => {
  const oracle = makeOracle();
  announce(oracle, "s2", "badge_only_expected");
  const captured = await oracle.captureConversation("s2", "conv_6531611", ["badge_unrelated"]);
  assert.deepEqual(captured.claims, []);
  assert.match(captured.refusedReason!, /no rostered device was present/);
  assert.equal(oracle.store.allClaims().length, 0);
});

test("starting a session without an announcement is refused end to end", () => {
  const oracle = makeOracle();
  assert.throws(
    () =>
      oracle.startSession({
        roomId: "room_x",
        sessionId: "s3",
        announcementText: "",
        policyRef: "https://org.example.com/policy",
        roster: { roomId: "room_x", expectedParticipantDeviceIds: ["badge_1"] },
      }),
    ConsentViolation,
  );
});
