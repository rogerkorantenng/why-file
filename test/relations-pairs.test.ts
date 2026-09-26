/**
 * Pairing and the no-model judgement. Deterministic throughout: no invoker is
 * constructed in this file at all.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { candidatePairs, heuristicRelations, supersededClaimIds } from "../src/relations.ts";
import { makeClaim } from "./helpers.ts";
import { NOW, june, march, unrelated } from "./relations-fixtures.ts";

test("only claims on the same subject, in different conversations, are worth comparing", () => {
  const pairs = candidatePairs([march, june, unrelated]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]!.earlier.id, "claim_march");
  assert.equal(pairs[0]!.later.id, "claim_june");
});

test("two claims from the same conversation are never a contradiction across time", () => {
  const sameConversation = makeClaim({
    ...june,
    id: "claim_march_2",
    provenance: { conversationId: "conv_march", timestamp: "2026-03-18T09:31:50Z", sourceUtteranceIds: ["u11"] },
  });
  assert.deepEqual(candidatePairs([march, sameConversation]), []);
});

test("the later claim is always the one that supersedes, whatever order they arrive in", () => {
  const pairs = candidatePairs([june, march]);
  assert.equal(pairs[0]!.earlier.id, "claim_march");
  assert.equal(pairs[0]!.later.id, "claim_june");
});

test("the heuristic catches a reversal without a model, and admits what it is", () => {
  const relations = heuristicRelations(candidatePairs([march, june]), NOW);
  assert.equal(relations.length, 1);
  assert.equal(relations[0]!.kind, "supersedes");
  assert.equal(relations[0]!.detectedBy, "heuristic");
  assert.match(relations[0]!.rationale, /word overlap, not by a model/);
  assert.ok(relations[0]!.confidence <= 0.5);
});

test("the heuristic stays quiet when the later claim settles the same thing the same way", () => {
  const same = makeClaim({ ...june, id: "claim_june_same", decision: "five" });
  assert.deepEqual(heuristicRelations(candidatePairs([march, same]), NOW), []);
});

test("a superseded claim is findable by id so search can rank it below its replacement", () => {
  const relations = heuristicRelations(candidatePairs([march, june]), NOW);
  assert.deepEqual([...supersededClaimIds(relations)], ["claim_march"]);
});
