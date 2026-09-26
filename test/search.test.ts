import assert from "node:assert/strict";
import { test } from "node:test";
import { recencyWeight, relevanceScores, searchClaims } from "../src/search.ts";
import { makeClaim } from "./helpers.ts";

const NOW = new Date("2026-09-22T00:00:00Z");

function at(id: string, timestamp: string, overrides: Parameters<typeof makeClaim>[0] = {}) {
  return makeClaim({ id, provenance: { conversationId: `conv_${id}`, timestamp, sourceUtteranceIds: [] }, ...overrides });
}

test("ranks the claim whose text matches the query above an unrelated one", () => {
  const cron = at("cron", "2026-06-04T00:00:00Z", { context: "low traffic window", decision: "three am" });
  const db = at("db", "2026-06-09T00:00:00Z", { context: "billing reconciliation joins", decision: "postgres", rejectedOptions: ["DynamoDB"] });
  const hits = searchClaims([cron, db], "why does the cron run at three am", { now: NOW });
  assert.equal(hits[0]!.claim.id, "cron");
});

test("a query with no overlapping terms returns no hits, not a wrong guess", () => {
  const cron = at("cron", "2026-06-04T00:00:00Z", { context: "low traffic window", decision: "three am" });
  assert.deepEqual(searchClaims([cron], "kubernetes ingress annotation", { now: NOW }), []);
});

test("empty claim set never throws", () => {
  assert.deepEqual(searchClaims([], "why postgres", { now: NOW }), []);
});

test("between two equally relevant records, the newer one wins", () => {
  const older = at("older", "2025-09-22T00:00:00Z", { context: "retry budget on the payments call", decision: "five" });
  const newer = at("newer", "2026-09-01T00:00:00Z", { context: "retry budget on the payments call", decision: "five" });
  const relevance = relevanceScores([older, newer], "retry budget payments");
  assert.equal(relevance.get("older"), relevance.get("newer"));

  const hits = searchClaims([older, newer], "retry budget payments", { now: NOW });
  assert.equal(hits[0]!.claim.id, "newer");
  assert.ok(hits[0]!.recencyWeight > hits[1]!.recencyWeight);
});

test("a record a later conversation reversed ranks below the one that reversed it, even when it matches better", () => {
  const march = at("march", "2026-03-18T00:00:00Z", {
    topic: "payments call retry budget",
    decision: "five",
    context: "retry budget retry budget payments payments call upstream bursts",
  });
  const june = at("june", "2026-06-15T00:00:00Z", { topic: "payments call retry budget", decision: "three", context: "retry budget" });

  const relevance = relevanceScores([march, june], "retry budget payments call");
  assert.ok(relevance.get("march")! > relevance.get("june")!, "the reversed record is the better keyword match");

  const hits = searchClaims([march, june], "retry budget payments call", { now: NOW, supersededIds: new Set(["march"]) });
  assert.equal(hits[0]!.claim.id, "june");
  assert.equal(hits[1]!.claim.id, "march");
  assert.equal(hits[1]!.superseded, true);
  assert.equal(hits[1]!.supersededPenalty, 0.4);
});

test("a reversed record stays findable rather than being hidden", () => {
  const march = at("march", "2026-03-18T00:00:00Z", { decision: "five", context: "retry budget" });
  const hits = searchClaims([march], "retry budget", { now: NOW, supersededIds: new Set(["march"]) });
  assert.equal(hits.length, 1);
  assert.ok(hits[0]!.score > 0);
});

test("age alone can never bury a record: the recency factor has a floor", () => {
  assert.equal(recencyWeight(0), 1);
  assert.ok(recencyWeight(3650) >= 0.45);
  assert.ok(recencyWeight(120) > recencyWeight(240));
});

test("every hit shows the three factors behind its score", () => {
  const claim = at("c", "2026-06-15T00:00:00Z", { decision: "three", context: "retry budget" });
  const hit = searchClaims([claim], "retry budget", { now: NOW })[0]!;
  assert.ok(Math.abs(hit.score - hit.relevance * hit.recencyWeight * hit.supersededPenalty) < 1e-9);
  assert.ok(hit.ageDays > 90 && hit.ageDays < 110);
});

test("limit trims the answer without changing the order", () => {
  const a = at("a", "2026-06-15T00:00:00Z", { decision: "three", context: "retry budget payments" });
  const b = at("b", "2026-06-14T00:00:00Z", { decision: "postgres", context: "retry budget" });
  const hits = searchClaims([a, b], "retry budget payments", { now: NOW, limit: 1 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.claim.id, "a");
});
