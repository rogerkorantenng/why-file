import assert from "node:assert/strict";
import { test } from "node:test";
import { extractFields } from "../src/claims/extract-fields.ts";

// None of these sentences appear in src/fixtures/mock-conversations.ts. They
// exist to prove the extractor generalizes past the three demo fixtures.

test("rejected-option idiom generalizes to an unrelated technology pair", () => {
  const fields = extractFields("no, not Redis, the durability guarantees are wrong for this workload.");
  assert.deepEqual(fields.rejectedOptions, ["Redis"]);
});

test("'so X it is' idiom generalizes to a different decision", () => {
  const fields = extractFields("we argued about it for a while, so Kubernetes it is.");
  assert.equal(fields.decision, "Kubernetes");
});

test("'so X, and' idiom generalizes when 'it is' is absent", () => {
  const fields = extractFields("so we ship the flag off by default, and revisit after the beta.");
  assert.equal(fields.decision, "we ship the flag off by default");
});

test("'because' idiom generalizes to an unrelated reason clause", () => {
  const fields = extractFields("we capped the page size at fifty because the mobile client times out past that.");
  assert.match(fields.context, /mobile client times out/);
});

test("'if' idiom generalizes to an unrelated conditional consequence", () => {
  const fields = extractFields("we will revisit the cache TTL if the hit rate drops below ninety percent.");
  assert.match(fields.consequences, /hit rate drops below ninety percent/);
});

test("a sentence with none of the idioms yields nothing captured, not a fabrication", () => {
  const fields = extractFields("yeah I grabbed a coffee and then came back to my desk.");
  assert.equal(fields.decision, "");
  assert.equal(fields.context, "");
  assert.equal(fields.rejectedOptions.length, 0);
});

test("a decision phrase does not bleed across an unrelated, distant 'it is' in a later sentence", () => {
  const fields = extractFields(
    "we spent twenty minutes on naming for the queue. eventually redis-backed-queue it is.",
  );
  // Sentence-scoping (see sentences.ts) must stop the match at the period,
  // not merge the naming discussion into the decision phrase.
  assert.equal(fields.decision, "redis-backed-queue");
});

test("the demo fixture's cron sentence resolves to the short decision, not the whole clause", () => {
  const fields = extractFields(
    "we looked at four am too but the backup job already owns that slot so three am it is. not changing it without a real reason.",
  );
  assert.equal(fields.decision, "three am");
});
