/**
 * Every test here runs with the Bedrock call stubbed. Nothing in this file
 * needs credentials, a region, or a network, which is the property the build
 * brief asks for: a demo that dies without network is a demo that dies in
 * front of a judge.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelUnavailable } from "../src/bedrock/invoker.ts";
import { extractClaimsForConversation } from "../src/claims/model-extract.ts";
import { makeConversation, stubInvoker } from "./helpers.ts";

const NOW = () => new Date("2026-09-22T00:00:00Z");
const CONVERSATION = makeConversation();

const GOOD_RESPONSE = JSON.stringify([
  {
    topic: "message queue choice",
    kind: "decision",
    context: "The team already runs SQS elsewhere and did not want another broker to operate.",
    decision: "Use SQS for the new queue",
    rejectedOptions: ["RabbitMQ"],
    consequences: "Another broker is avoided; revisit if ordering guarantees are needed.",
    sourceUtteranceIds: ["u2", "u3"],
    confidence: 0.9,
  },
]);

test("a well formed model response becomes a claim with a model-free provenance", async () => {
  const invoker = stubInvoker(GOOD_RESPONSE);
  const result = await extractClaimsForConversation(CONVERSATION, invoker, NOW);

  assert.equal(result.usedFallback, false);
  assert.equal(result.extractor, "bedrock:test-model");
  assert.equal(result.claims.length, 1);

  const claim = result.claims[0]!;
  assert.equal(claim.decision, "Use SQS for the new queue");
  assert.deepEqual(claim.rejectedOptions, ["RabbitMQ"]);
  assert.equal(claim.extractor, "bedrock:test-model");
  // Provenance is computed here from the cited utterances' own startMs, never
  // taken from the model. u2 starts at 2000ms into a conversation that began
  // at 09:00:00Z.
  assert.equal(claim.provenance.conversationId, "conv_test");
  assert.equal(claim.provenance.timestamp, "2026-05-01T09:00:02.000Z");
  assert.deepEqual(claim.provenance.sourceUtteranceIds, ["u2", "u3"]);
});

test("the transcript sent to the model carries utterance ids and no speaker field", async () => {
  const invoker = stubInvoker(GOOD_RESPONSE);
  await extractClaimsForConversation(CONVERSATION, invoker, NOW);
  const sent = invoker.requests[0]!;
  assert.match(sent.user, /\[u1\] so the queue/);
  assert.doesNotMatch(sent.user, /speaker/i);
  assert.doesNotMatch(sent.user, /Unknown/);
  assert.match(sent.system, /never states who said anything/i);
});

test("JSON wrapped in a fenced code block is still read", async () => {
  const invoker = stubInvoker("Here you go:\n```json\n" + GOOD_RESPONSE + "\n```\n");
  const result = await extractClaimsForConversation(CONVERSATION, invoker, NOW);
  assert.equal(result.claims.length, 1);
  assert.equal(result.usedFallback, false);
});

test("an unreachable model falls back to the rules and says why", async () => {
  const invoker = stubInvoker(() => {
    throw new ModelUnavailable("bedrock:test-model unreachable (TimeoutError: socket hang up)");
  });
  const result = await extractClaimsForConversation(CONVERSATION, invoker, NOW);

  assert.equal(result.usedFallback, true);
  assert.equal(result.extractor, "rules");
  assert.match(result.fallbackReason!, /TimeoutError/);
  assert.match(result.fallbackReason!, /rule-based extractor/);
  // The capability survives the fallback: the idioms still find the decision.
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0]!.decision, "SQS");
  assert.equal(result.claims[0]!.extractor, "rules");
});

test("no invoker at all is a supported mode, not an error", async () => {
  const result = await extractClaimsForConversation(CONVERSATION, null, NOW);
  assert.equal(result.extractor, "rules");
  assert.match(result.fallbackReason!, /switched off/);
  assert.equal(result.claims.length, 1);
});

test("nothing that reaches a claim ever mentions a speaker, whichever path ran", async () => {
  for (const invoker of [stubInvoker(GOOD_RESPONSE), null]) {
    const result = await extractClaimsForConversation(CONVERSATION, invoker, NOW);
    const serialized = JSON.stringify(result.claims);
    assert.doesNotMatch(serialized, /speaker/i);
    assert.doesNotMatch(serialized, /Unknown/);
  }
});
