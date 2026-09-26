import assert from "node:assert/strict";
import { test } from "node:test";
import { findAttributionPhrase } from "../src/claims/attribution-guard.ts";
import { buildReview, renderReview } from "../src/review.ts";
import type { ClaimRelation } from "../src/types.ts";
import { makeClaim, makeConversation } from "./helpers.ts";

const conversation = makeConversation({
  utterances: [
    { id: "u1", text: "ok so the queue, we keep going back and forth", startMs: 0, endMs: 2000 },
    { id: "u2", text: "no, not RabbitMQ, the ops burden is wrong here", startMs: 2000, endMs: 4500 },
    { id: "u3", text: "so SQS it is, because we already run it elsewhere.", startMs: 4500, endMs: 7000 },
    { id: "u4", text: "although actually hold on, ordering matters here", startMs: 7000, endMs: 9500 },
    { id: "u5", text: "let's park it until Thursday", startMs: 9500, endMs: 11000 },
  ],
});

const claim = makeClaim({
  id: "claim_queue",
  topic: "message queue choice",
  decision: "SQS",
  rejectedOptions: ["RabbitMQ"],
  context: "the ops burden of another broker",
  extractor: "bedrock:test-model",
  confidence: 0.9,
  provenance: { conversationId: "conv_test", timestamp: "2026-05-01T09:00:02.000Z", sourceUtteranceIds: ["u2", "u3"] },
});

test("the cited fragments are marked and their neighbours are shown", () => {
  const review = buildReview(claim, conversation, [], 2);
  assert.deepEqual(review.utterances.map((u) => u.id), ["u1", "u2", "u3", "u4", "u5"]);
  assert.deepEqual(review.utterances.filter((u) => u.cited).map((u) => u.id), ["u2", "u3"]);
});

test("each fragment carries its own wall-clock time, resolved against the conversation start", () => {
  const review = buildReview(claim, conversation, [], 0);
  assert.equal(review.utterances.find((u) => u.id === "u3")!.timestamp, "2026-05-01T09:00:04.500Z");
});

test("the sentence that walks a decision back is inside the context window a reviewer sees", () => {
  const review = buildReview(claim, conversation, [], 2);
  const texts = review.utterances.map((u) => u.text).join(" ");
  assert.match(texts, /ordering matters here/);
  assert.match(texts, /park it until Thursday/);
});

test("a reviewer is told when a later record reversed this one", () => {
  const relation: ClaimRelation = {
    laterClaimId: "claim_later",
    earlierClaimId: "claim_queue",
    kind: "supersedes",
    rationale: "The queue moved to Kafka for ordering.",
    detectedBy: "bedrock:test-model",
    detectedAt: "2026-09-22T00:00:00Z",
    confidence: 0.9,
  };
  const review = buildReview(claim, conversation, [relation]);
  assert.ok(review.warnings.some((w) => w.includes("claim_later")));
  assert.match(review.adrMarkdown, /## Superseded/);
});

test("a rule-extracted record is flagged as the weaker path, a model-extracted one is not", () => {
  const rulesClaim = makeClaim({ ...claim, extractor: "rules", confidence: 0.4 });
  assert.ok(buildReview(rulesClaim, conversation).warnings.some((w) => w.includes("rule-based fallback")));
  assert.ok(!buildReview(claim, conversation).warnings.some((w) => w.includes("rule-based fallback")));
});

test("a claim whose transcript was not retained says so rather than showing an empty column", () => {
  const review = buildReview(claim, undefined);
  assert.deepEqual(review.utterances, []);
  assert.ok(review.warnings.some((w) => w.includes("No transcript was retained")));
});

test("the rendered surface puts the record and the transcript side by side", () => {
  const rendered = renderReview(buildReview(claim, conversation), 100);
  const lines = rendered.split("\n");
  assert.match(lines[0]!, /^# SQS\s{2,}/, "the record starts the left column");
  assert.match(lines[0]!, /transcript, conversation conv_test$/, "the transcript heads the right column on the same line");
  const citedRow = lines.find((l) => l.includes("[u2]"))!;
  assert.match(citedRow, /^\S.*\| \[u2\]/, "a cited fragment shares its row with the record");
  assert.match(rendered, /\| \[u3\]/, "cited fragments are marked");
});

test("no part of the review surface names anybody", () => {
  const review = buildReview(claim, conversation);
  const rendered = renderReview(review);
  assert.doesNotMatch(rendered, /Unknown/);
  assert.equal(findAttributionPhrase(rendered), null);
  // The only place the word "speaker" appears is the standing line in every
  // record saying the record names none.
  const speakerMentions = rendered.match(/speaker/gi) ?? [];
  assert.equal(speakerMentions.length, 1);
  assert.match(rendered, /It names no speaker/);
  assert.doesNotMatch(JSON.stringify(review.utterances), /speaker/i);
});

test("below 96 columns the record and the transcript stack rather than interleaving", () => {
  // The demo used to print "this terminal is too narrow for two columns" and then draw
  // the two columns, so the record wrapped to about thirty characters and a metadata
  // cell landed at the left margin under a wrapped fragment.
  const rendered = renderReview(buildReview(claim, conversation), 80);
  const lines = rendered.split("\n");
  assert.equal(lines[0], "# SQS", "the record starts on a line of its own");
  const heading = lines.findIndex((l) => l.startsWith("transcript, conversation conv_test"));
  assert.ok(heading > 1, "the transcript follows the record rather than sharing its rows");
  assert.equal(lines[heading], "transcript, conversation conv_test");
  assert.ok(
    !lines.some((l) => /\S\s{2,}\S*\s*\[u\d+\]/.test(l)),
    "no row carries a record line and a transcript line at once",
  );
  assert.ok(lines.every((l) => l.length <= 80), "nothing overruns the terminal");
});

test("at 96 columns and above the two columns are still drawn", () => {
  const lines = renderReview(buildReview(claim, conversation), 96).split("\n");
  assert.match(lines[0]!, /^# SQS\s{2,}transcript, conversation conv_test$/);
});

test("the review pane shows the record's words, not the scaffolding a markdown renderer would eat", () => {
  const review = buildReview(claim, conversation);
  // The committed file keeps all of it; this is only about the two screens that show it.
  assert.match(review.adrMarkdown, /&nbsp;/);
  assert.match(review.adrMarkdown, /^\| --- \| --- \|$/m);
  for (const width of [80, 100]) {
    const rendered = renderReview(review, width);
    assert.doesNotMatch(rendered, /&nbsp;/, `a literal HTML entity at ${width} columns`);
    assert.doesNotMatch(rendered, /\|\s*-{3}/, `a table rule at ${width} columns`);
    assert.doesNotMatch(rendered, /^\s*\|(\s*\|)+\s*$/m, `an empty header row at ${width} columns`);
    assert.match(rendered, /It names no speaker/, "the standing footer survives");
    assert.doesNotMatch(rendered, /_This record was extracted/, `an emphasis marker at ${width} columns`);
  }
});

test("a wrapped line in the review pane indents under its own first word", () => {
  const wordy = makeClaim({
    ...claim,
    extractor: "rules",
    confidence: 0.4,
    context:
      "the ops burden of another broker, which nobody on the team has run in anger before and which would need its own on-call rotation",
  });
  const lines = renderReview(buildReview(wordy, conversation), 80).split("\n");
  const bullet = lines.findIndex((l) => l.startsWith("- Extracted by the rule-based fallback"));
  assert.ok(bullet > 0, "the fallback warning is shown");
  assert.match(lines[bullet + 1]!, /^ {2}\S/, "its second line is indented, so it reads as one bullet");
});
