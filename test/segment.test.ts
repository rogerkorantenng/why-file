import assert from "node:assert/strict";
import { test } from "node:test";
import { stripSpeakers } from "../src/bee/client.ts";
import { extractClaims } from "../src/claims/extract.ts";
import { boundaryIndices, segmentByTopic } from "../src/claims/segment.ts";
import { MOCK_CONVERSATIONS } from "../src/fixtures/mock-conversations.ts";
import type { Utterance } from "../src/types.ts";

const NOW = () => new Date("2026-09-22T00:00:00Z");

function utterance(id: string, text: string, startMs: number, lengthMs = 2000): Utterance {
  return { id, text, startMs, endMs: startMs + lengthMs };
}

test("a conversation that stays on one subject is one segment", () => {
  const conversation = stripSpeakers(MOCK_CONVERSATIONS.find((c) => c.id === "conv_6531611")!);
  assert.equal(segmentByTopic(conversation.utterances).length, 1);
});

test("the multi-topic fixture splits where the room changed subject", () => {
  const conversation = stripSpeakers(MOCK_CONVERSATIONS.find((c) => c.id === "conv_6529877")!);
  const segments = segmentByTopic(conversation.utterances);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0]!.utterances.map((u) => u.id), ["u1", "u2", "u3", "u4", "u5", "u6"]);
  assert.deepEqual(segments[1]!.utterances.map((u) => u.id), ["u7", "u8", "u9", "u10", "u11", "u12"]);
});

test("one recording yields one claim per subject, which the earlier build could not do", () => {
  const conversation = stripSpeakers(MOCK_CONVERSATIONS.find((c) => c.id === "conv_6529877")!);
  const claims = extractClaims(conversation, NOW);
  assert.equal(claims.length, 2);
  assert.equal(claims[0]!.decision, "five");
  assert.deepEqual(claims[1]!.rejectedOptions, ["Consul"]);
  // Each claim cites only its own segment's fragments.
  assert.ok(claims[0]!.provenance.sourceUtteranceIds.every((id) => ["u1", "u2", "u3", "u4", "u5", "u6"].includes(id)));
  assert.ok(claims[1]!.provenance.sourceUtteranceIds.every((id) => ["u7", "u8", "u9", "u10", "u11", "u12"].includes(id)));
});

test("a pause alone does not split a segment when the vocabulary carries on", () => {
  const utterances = [
    utterance("u1", "the retry budget on the payments call", 0),
    utterance("u2", "the retry budget is the thing that matters here", 2000),
    utterance("u3", "so the retry budget on payments goes to five", 9000),
    utterance("u4", "the payments retry budget, five, agreed", 11000),
  ];
  assert.deepEqual(boundaryIndices(utterances), []);
});

test("a long enough silence is a boundary whatever the vocabulary does", () => {
  const utterances = [
    utterance("u1", "the retry budget on the payments call", 0),
    utterance("u2", "the retry budget goes to five", 2000),
    utterance("u3", "the retry budget again, still five", 4000),
    utterance("u4", "the retry budget on payments, five", 40000),
    utterance("u5", "still the retry budget, five", 42000),
    utterance("u6", "retry budget five, done", 44000),
  ];
  assert.deepEqual(boundaryIndices(utterances), [3]);
});

test("a run too short to hold an argument is folded into the segment before it", () => {
  const utterances = [
    utterance("u1", "the queue broker choice is the question", 0),
    utterance("u2", "the queue broker ops burden matters", 2000),
    utterance("u3", "the queue broker, SQS then", 4000),
    utterance("u4", "unrelated lunch plans entirely", 40000),
  ];
  const segments = segmentByTopic(utterances);
  assert.equal(segments.length, 1);
  assert.equal(segments[0]!.utterances.length, 4);
});

test("an empty conversation segments into nothing rather than throwing", () => {
  assert.deepEqual(segmentByTopic([]), []);
});
