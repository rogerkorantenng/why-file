import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptUtterances, assertTextOnly, closeSession, ConsentViolation, startSession } from "../src/consent.ts";
import type { Utterance } from "../src/types.ts";

const baseInput = {
  roomId: "room_a",
  sessionId: "s1",
  announcementText: "Oracle is recording this room.",
  policyRef: "https://org.example.com/policy",
  roster: { roomId: "room_a", expectedParticipantDeviceIds: ["badge_1"] },
};

test("rule 2: refuses to start a session without an announcement", () => {
  assert.throws(() => startSession({ ...baseInput, announcementText: "" }), ConsentViolation);
  assert.throws(() => startSession({ ...baseInput, announcementText: "   " }), ConsentViolation);
});

test("rule 4: refuses to start a session without a policy reference", () => {
  assert.throws(() => startSession({ ...baseInput, policyRef: "" }), ConsentViolation);
});

test("rule 2: the announcement is logged as the session's first record", () => {
  const session = startSession(baseInput);
  assert.equal(session.announcement.announcementText, baseInput.announcementText);
  assert.equal(session.announcement.sessionId, "s1");
  assert.ok(session.announcement.announcedAt);
});

test("rule 1: room-scoped — utterances from a different room are dropped, not stored", () => {
  const session = startSession(baseInput);
  const utterances: Utterance[] = [{ id: "u1", text: "hello", startMs: 0, endMs: 100 }];
  const accepted = acceptUtterances(session, "room_other", utterances, ["badge_1"]);
  assert.deepEqual(accepted, []);
});

test("rule 3: discards a segment when no expected roster device is present", () => {
  const session = startSession(baseInput);
  const utterances: Utterance[] = [{ id: "u1", text: "hello", startMs: 0, endMs: 100 }];
  const accepted = acceptUtterances(session, "room_a", utterances, ["badge_unrelated"]);
  assert.deepEqual(accepted, []);
});

test("rule 3: accepts a segment when an expected roster device is present", () => {
  const session = startSession(baseInput);
  const utterances: Utterance[] = [{ id: "u1", text: "hello", startMs: 0, endMs: 100 }];
  const accepted = acceptUtterances(session, "room_a", utterances, ["badge_1", "badge_unrelated"]);
  assert.deepEqual(accepted, utterances);
});

test("a closed session refuses further capture", () => {
  const session = closeSession(startSession(baseInput));
  assert.throws(() => acceptUtterances(session, "room_a", [], ["badge_1"]), ConsentViolation);
});

test("rule 5: rejects any payload carrying an audio-shaped field", () => {
  assert.throws(() => assertTextOnly({ text: "hi", audio: "base64..." }), ConsentViolation);
  assert.throws(() => assertTextOnly({ recordingUrl: "https://example.com/a.wav" }), ConsentViolation);
  assert.doesNotThrow(() => assertTextOnly({ text: "hi", startMs: 0 }));
});
