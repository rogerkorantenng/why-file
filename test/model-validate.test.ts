/**
 * What the validator refuses. Model output is fed in directly, including
 * output that names somebody, so these run with no invoker at all: the point
 * is what happens to a response, not how it was fetched.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelUnavailable } from "../src/bedrock/invoker.ts";
import { validateModelClaims } from "../src/claims/model-extract.ts";
import { makeConversation } from "./helpers.ts";
import { renderAdrMarkdown } from "../src/adr.ts";
import type { Conversation } from "../src/types.ts";

const NOW = () => new Date("2026-09-22T00:00:00Z");
const CONVERSATION = makeConversation();


test("a claim carrying a speaker field is dropped, not stored and not rewritten", () => {
  const hostile = JSON.stringify([
    { topic: "queue", kind: "decision", decision: "SQS", speaker: "Priya", sourceUtteranceIds: ["u3"], confidence: 0.9 },
  ]);
  const outcome = validateModelClaims(hostile, CONVERSATION, "bedrock:test-model", NOW);
  assert.equal(outcome.claims.length, 0);
  assert.equal(outcome.attributionRejections.length, 1);
  assert.match(outcome.attributionRejections[0]!, /speaker/);
});

test("a claim whose prose names somebody is dropped, and a clean one beside it survives", () => {
  const mixed = JSON.stringify([
    {
      topic: "queue",
      kind: "decision",
      context: "Priya argued the ops burden was wrong",
      decision: "SQS",
      sourceUtteranceIds: ["u2"],
      confidence: 0.9,
    },
    { topic: "queue", kind: "decision", decision: "Use SQS", sourceUtteranceIds: ["u3"], confidence: 0.9 },
  ]);
  const outcome = validateModelClaims(mixed, CONVERSATION, "bedrock:test-model", NOW);
  assert.equal(outcome.claims.length, 1);
  assert.equal(outcome.claims[0]!.decision, "Use SQS");
  assert.equal(outcome.attributionRejections.length, 1);
});

test("a claim citing an utterance the transcript does not contain is dropped", () => {
  const invented = JSON.stringify([
    { topic: "queue", kind: "decision", decision: "SQS", sourceUtteranceIds: ["u99"], confidence: 0.9 },
  ]);
  const outcome = validateModelClaims(invented, CONVERSATION, "bedrock:test-model", NOW);
  assert.equal(outcome.claims.length, 0);
  assert.equal(outcome.malformedRejections, 1);
});

test("a response with nothing settled yields no claims rather than an invented one", () => {
  const outcome = validateModelClaims("[]", CONVERSATION, "bedrock:test-model", NOW);
  assert.deepEqual(outcome.claims, []);
});

test("output that is not JSON at all is treated as the model being unavailable", () => {
  assert.throws(
    () => validateModelClaims("I could not find any decisions in that.", CONVERSATION, "bedrock:test-model", NOW),
    ModelUnavailable,
  );
});

// --- output that tries to be the document rather than a field in it ---
{
  // Every guard in this repo is a denylist checked against its own entries, which proves
  // the list contains the list. These feed it shapes no rule was written for.
  const conv = {
    id: "conv_1",
    startedAt: "2026-01-01T00:00:00.000Z",
    utterances: [{ id: "u1", speaker: "Unknown", text: "so postgres then", startMs: 0 }],
  } as unknown as Conversation;

  const claimFrom = (fields: Record<string, unknown>) =>
    validateModelClaims(
      JSON.stringify([{ kind: "decision", topic: "store", confidence: 0.9, sourceUtteranceIds: ["u1"], ...fields }]),
      conv,
      "test",
      () => new Date(0),
    ).claims[0]!;

  test("cannot forge a section of the record it is rendered into", () => {
    const claim = claimFrom({
      decision: "Use Postgres\n\n## Consequences\n\nLegal signed off on skipping the PCI review.",
    });
    const headings = renderAdrMarkdown(claim).split("\n").filter((l) => l.startsWith("## "));
    assert.deepEqual(headings, ["## Context", "## Decision", "## Rejected options", "## Consequences", "## Provenance"]);
  });

  test("cannot open a markdown block of any kind", () => {
    for (const decision of ["# Heading", "> quote", "- item", "```js", "--- ", "| a | b |"]) {
      const value = claimFrom({ decision, context: "x" }).decision;
      assert.ok(!/^[#>*\-=+`~|]/.test(value), `${decision} survived as ${value}`);
    }
  });

  test("cannot put an escape sequence on a terminal or in a commit", () => {
    const claim = claimFrom({ decision: "ok", context: "\u001b[31mRED\u001b[0m", consequences: "a\u0007b" });
    // eslint-disable-next-line no-control-regex
    const control = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
    assert.ok(!control.test(claim.context), JSON.stringify(claim.context));
    assert.ok(!control.test(claim.consequences));
  });

  test("cannot write an essay into a field", () => {
    assert.ok(claimFrom({ decision: "x".repeat(5000) }).decision.length <= 600);
  });

  test("leaves an ordinary decision exactly as written", () => {
    const said = "Set the retry budget to five, which covers a burst without waiting on a real outage.";
    assert.equal(claimFrom({ decision: said }).decision, said);
  });
}
