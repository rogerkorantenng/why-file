/**
 * The record half: what the model path produces and what happens when the
 * model is unreachable. Bedrock is stubbed throughout, so nothing here touches
 * a network.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ModelUnavailable } from "../src/bedrock/invoker.ts";
import { stubInvoker } from "./helpers.ts";
import { announce, makeOracle, startHarness, stopHarness } from "./oracle-harness.ts";

before(startHarness);
after(stopHarness);

test("a capture with the model stubbed reports the model as the extractor and stores its claims", async () => {
  const invoker = stubInvoker(
    JSON.stringify([
      {
        topic: "database for billing reconciliation",
        kind: "decision",
        context: "ad hoc joins across six tables",
        decision: "Use Postgres for billing reconciliation",
        rejectedOptions: ["DynamoDB"],
        consequences: "revisit if the workload stops being join-heavy",
        sourceUtteranceIds: ["u1", "u9"],
        confidence: 0.93,
      },
    ]),
  );
  const oracle = makeOracle(invoker);
  announce(oracle, "s4");
  const captured = await oracle.captureConversation("s4", "conv_6531611", ["badge_42"]);

  assert.equal(captured.usedFallback, false);
  assert.equal(captured.claims[0]!.extractor, "bedrock:test-model");
  assert.equal(oracle.status().lastExtractorUsed, "bedrock:test-model");
  assert.equal(oracle.status().lastFallbackReason, null);
});

test("an unreachable model does not stop a capture: the records still arrive, with the reason attached", async () => {
  const oracle = makeOracle(
    stubInvoker(() => {
      throw new ModelUnavailable("bedrock:test-model unreachable (TimeoutError)");
    }),
  );
  announce(oracle, "s5");
  const captured = await oracle.captureConversation("s5", "conv_6531611", ["badge_42"]);

  assert.equal(captured.usedFallback, true);
  assert.equal(captured.claims.length, 1);
  assert.equal(captured.claims[0]!.extractor, "rules");
  assert.match(oracle.status().lastFallbackReason!, /TimeoutError/);
});
