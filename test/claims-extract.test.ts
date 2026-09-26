import assert from "node:assert/strict";
import { test } from "node:test";
import { extractClaims } from "../src/claims/extract.ts";
import { stripSpeakers } from "../src/bee/client.ts";
import { MOCK_CONVERSATIONS } from "../src/fixtures/mock-conversations.ts";

const NOW = () => new Date("2026-09-22T00:00:00Z");

test("extracts a decision claim with provenance, no name anywhere in the output", () => {
  const raw = MOCK_CONVERSATIONS.find((c) => c.id === "conv_6531611")!; // Postgres vs DynamoDB
  const [claim] = extractClaims(stripSpeakers(raw), NOW);
  assert.ok(claim);
  assert.equal(claim!.kind, "decision");
  assert.equal(claim!.decision, "postgres");
  assert.deepEqual(claim!.rejectedOptions, ["DynamoDB"]);
  assert.equal(claim!.provenance.conversationId, "conv_6531611");
  assert.ok(claim!.provenance.timestamp.startsWith("2026-06-09"));
  assert.ok(claim!.provenance.sourceUtteranceIds.length > 0);

  // The core design constraint from SPEC.md: never assert who said anything.
  const serialized = JSON.stringify(claim);
  assert.doesNotMatch(serialized, /speaker/i);
  assert.doesNotMatch(serialized, /Unknown/);
  assert.doesNotMatch(serialized, /"who"/i);
});

test("provenance never contains a quoted name, only a conversation id and timestamp", () => {
  for (const raw of MOCK_CONVERSATIONS) {
    const [claim] = extractClaims(stripSpeakers(raw), NOW);
    if (!claim) continue;
    const keys = Object.keys(claim.provenance).sort();
    assert.deepEqual(keys, ["conversationId", "sourceUtteranceIds", "timestamp"]);
  }
});

test("a conversation with no matching idiom yields no claim, rather than a fabricated one", () => {
  const empty = {
    id: "conv_empty",
    roomId: "room_a",
    startedAt: "2026-01-01T00:00:00Z",
    endedAt: "2026-01-01T00:01:00Z",
    utterances: [{ id: "u1", text: "yeah anyway let's grab lunch", startMs: 0, endMs: 1000 }],
  };
  assert.deepEqual(extractClaims(empty, NOW), []);
});

test("the Claim type itself has no field that could hold a name (compile-time contract check)", () => {
  const raw = MOCK_CONVERSATIONS[0]!;
  const [claim] = extractClaims(stripSpeakers(raw), NOW);
  assert.ok(claim);
  // Extended when the model path was added. Every new field here names a
  // subject, a method or a number. None of them could hold a person.
  const allowedFields = [
    "id",
    "kind",
    "topic",
    "context",
    "decision",
    "rejectedOptions",
    "consequences",
    "provenance",
    "extractedAt",
    "extractor",
    "confidence",
  ];
  assert.deepEqual(Object.keys(claim!).sort(), allowedFields.sort());
});
