import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AttributionViolation,
  assertNoAttribution,
  findAttributionPhrase,
  findBannedKeys,
} from "../src/claims/attribution-guard.ts";

test("a field that could hold a person is refused wherever it sits", () => {
  assert.ok(findBannedKeys({ speaker: "Unknown" }));
  assert.ok(findBannedKeys({ claims: [{ decision: "postgres", saidBy: "someone" }] }));
  assert.ok(findBannedKeys({ a: { b: { participants: [] } } }));
  assert.equal(findBannedKeys({ decision: "postgres", topic: "database choice" }), null);
});

test("the banned key check reports where it found the offence", () => {
  const found = findBannedKeys({ claims: [{ decision: "x", speaker: "y" }] });
  assert.ok(found);
  assert.equal(found!.where, "$.claims[0].speaker");
});

test("prose that attributes a statement to somebody is refused", () => {
  assert.ok(findAttributionPhrase("Priya argued the access pattern was wrong"));
  assert.ok(findAttributionPhrase("he said three am was the low traffic window"));
  assert.ok(findAttributionPhrase("according to Marcus the backup job owns that slot"));
  assert.ok(findAttributionPhrase("the speaker labelled Unknown raised the migration cost"));
  assert.ok(findAttributionPhrase("[Unknown]: so postgres then"));
});

test("ordinary decision prose passes, including the first person plural", () => {
  assert.equal(findAttributionPhrase("The cron runs at three am because that is the low traffic window."), null);
  assert.equal(findAttributionPhrase("We revisit this if reconciliation moves off the join-heavy path."), null);
  assert.equal(findAttributionPhrase("Postgres was chosen over DynamoDB for transactional consistency."), null);
  assert.equal(findAttributionPhrase("The team decided to keep the flags in the existing database."), null);
});

test("the gate throws on the first offence, structural or textual", () => {
  assert.throws(() => assertNoAttribution({ speaker: "Unknown" }), AttributionViolation);
  assert.throws(() => assertNoAttribution({ decision: "Priya proposed postgres" }), AttributionViolation);
  assert.doesNotThrow(() => assertNoAttribution({ decision: "postgres", context: "ad hoc joins across six tables" }));
});

test("the error names the field or the text, so a rejection can be explained", () => {
  try {
    assertNoAttribution({ rationale: "she insisted on three retries" }, "bedrock:test-model");
    assert.fail("expected an AttributionViolation");
  } catch (err) {
    assert.ok(err instanceof AttributionViolation);
    assert.match(err.message, /bedrock:test-model/);
    assert.match(err.message, /\$\.rationale/);
  }
});
