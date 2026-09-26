/**
 * The model's half of contradiction detection, with the Bedrock call stubbed
 * throughout: how a judgement is mapped back to its pair, what happens to a
 * rationale that names somebody, and what runs when the model is unreachable.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelUnavailable } from "../src/bedrock/invoker.ts";
import { detectRelations } from "../src/relations.ts";
import { stubInvoker } from "./helpers.ts";
import { NOW, june, march, unrelated } from "./relations-fixtures.ts";

test("a model judgement is mapped back to the right pair and recorded as the model's", async () => {
  const invoker = stubInvoker(
    JSON.stringify([
      { pair: "P1", relation: "supersedes", rationale: "The retry budget moved from five to three.", confidence: 0.95 },
    ]),
  );
  const detection = await detectRelations([march, june, unrelated], invoker, NOW);

  assert.equal(detection.usedFallback, false);
  assert.equal(detection.pairsConsidered, 1);
  assert.equal(detection.relations.length, 1);
  assert.equal(detection.relations[0]!.laterClaimId, "claim_june");
  assert.equal(detection.relations[0]!.earlierClaimId, "claim_march");
  assert.equal(detection.relations[0]!.detectedBy, "bedrock:test-model");
});

test('a model answer of "unrelated" records no relation at all', async () => {
  const invoker = stubInvoker(JSON.stringify([{ pair: "P1", relation: "unrelated", rationale: "different questions", confidence: 0.8 }]));
  const detection = await detectRelations([march, june], invoker, NOW);
  assert.deepEqual(detection.relations, []);
  assert.equal(detection.usedFallback, false);
});

test("a rationale that names somebody takes its relation down with it", async () => {
  const invoker = stubInvoker(
    JSON.stringify([{ pair: "P1", relation: "supersedes", rationale: "Priya said five was too many.", confidence: 0.9 }]),
  );
  const detection = await detectRelations([march, june], invoker, NOW);
  assert.deepEqual(detection.relations, []);
  assert.equal(detection.attributionRejections.length, 1);
});

test("an unreachable model falls back to the heuristic rather than reporting nothing", async () => {
  const invoker = stubInvoker(() => {
    throw new ModelUnavailable("bedrock:test-model unreachable (TimeoutError)");
  });
  const detection = await detectRelations([march, june], invoker, NOW);
  assert.equal(detection.usedFallback, true);
  assert.equal(detection.detectedBy, "heuristic");
  assert.match(detection.fallbackReason!, /word-overlap heuristic/);
  assert.equal(detection.relations.length, 1);
});

test("nothing to compare means no model call and no findings", async () => {
  const invoker = stubInvoker("[]");
  const detection = await detectRelations([march], invoker, NOW);
  assert.equal(detection.pairsConsidered, 0);
  assert.deepEqual(detection.relations, []);
  assert.equal(invoker.requests.length, 0);
});
