/**
 * The preference chain, with the Converse call replaced by a fake sender. No
 * credentials, no region, no network: these test what Oracle does when a model
 * is refused, which is the situation this account is actually in.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { BedrockInvoker, DEFAULT_MODEL_CHAIN, ModelUnavailable } from "../src/bedrock/invoker.ts";
import { isEntitlementError } from "../src/bedrock/errors.ts";

/** The shape AWS returns for a model the account cannot invoke. */
function accessDenied(modelId: string): Error {
  const err = new Error(`${modelId} is not available for this account.`);
  err.name = "AccessDeniedException";
  return err;
}

function onDemandValidation(modelId: string): Error {
  const err = new Error(`Invocation of model ID ${modelId} with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile that contains this model.`);
  err.name = "ValidationException";
  return err;
}

function invokerOver(models: string[], answered: Set<string>, calls: string[] = []): BedrockInvoker {
  return new BedrockInvoker({
    models,
    timeoutMs: 500,
    converse: async (modelId) => {
      calls.push(modelId);
      if (!answered.has(modelId)) throw accessDenied(modelId);
      return `answer from ${modelId}`;
    },
  });
}

test("a refused model is stepped past, and the one that answers is the one recorded", async () => {
  const calls: string[] = [];
  const invoker = invokerOver(["model-a", "model-b", "model-c"], new Set(["model-b"]), calls);

  assert.equal(await invoker.invoke({ system: "s", user: "u" }), "answer from model-b");
  assert.deepEqual(calls, ["model-a", "model-b"]);
  assert.equal(invoker.describe, "bedrock:model-b");
});

test("a refusal is remembered, so the probe costs one call rather than one per request", async () => {
  const calls: string[] = [];
  const invoker = invokerOver(["model-a", "model-b"], new Set(["model-b"]), calls);

  await invoker.invoke({ system: "s", user: "u" });
  await invoker.invoke({ system: "s", user: "u" });
  await invoker.invoke({ system: "s", user: "u" });

  assert.deepEqual(calls, ["model-a", "model-b", "model-b", "model-b"]);
});

test("the on-demand validation error advances the chain too, because a bare model id never works", async () => {
  const calls: string[] = [];
  const invoker = new BedrockInvoker({
    models: ["anthropic.claude-sonnet-4-6", "us.anthropic.claude-sonnet-4-6"],
    timeoutMs: 500,
    converse: async (modelId) => {
      calls.push(modelId);
      if (!modelId.startsWith("us.")) throw onDemandValidation(modelId);
      return "ok";
    },
  });

  assert.equal(await invoker.invoke({ system: "s", user: "u" }), "ok");
  assert.equal(invoker.describe, "bedrock:us.anthropic.claude-sonnet-4-6");
});

test("a timeout does not walk the chain: the deadline is spent, so the caller falls back", async () => {
  const calls: string[] = [];
  const invoker = new BedrockInvoker({
    models: ["model-a", "model-b"],
    timeoutMs: 500,
    converse: async (modelId) => {
      calls.push(modelId);
      const err = new Error("socket hang up");
      err.name = "TimeoutError";
      throw err;
    },
  });

  await assert.rejects(() => invoker.invoke({ system: "s", user: "u" }), ModelUnavailable);
  assert.deepEqual(calls, ["model-a"], "only the first candidate is tried");
});

test("when every model is refused the error names the chain, rather than looking like an outage", async () => {
  const invoker = invokerOver(["model-a", "model-b"], new Set());
  await assert.rejects(
    () => invoker.invoke({ system: "s", user: "u" }),
    (err: unknown) => {
      assert.ok(err instanceof ModelUnavailable);
      assert.match((err as Error).message, /no Bedrock model in the preference chain is available/);
      return true;
    },
  );
});

test("an empty response is a failure, not an empty claim set", async () => {
  const invoker = new BedrockInvoker({ models: ["model-a"], timeoutMs: 500, converse: async () => "   " });
  await assert.rejects(() => invoker.invoke({ system: "s", user: "u" }), ModelUnavailable);
});

test("the shipped chain is newest first and every id is an inference profile", () => {
  assert.ok(DEFAULT_MODEL_CHAIN.length >= 2, "a chain, not a hard-coded id");
  for (const id of DEFAULT_MODEL_CHAIN) assert.match(id, /^us\.anthropic\./);
  assert.equal(DEFAULT_MODEL_CHAIN.at(-1), "us.anthropic.claude-sonnet-4-5-20250929-v1:0");
});

test("entitlement failures are told apart from transient ones", () => {
  assert.ok(isEntitlementError(accessDenied("x")));
  assert.ok(isEntitlementError(onDemandValidation("x")));
  const throttle = new Error("Too many requests");
  throttle.name = "ThrottlingException";
  assert.equal(isEntitlementError(throttle), false);
  assert.equal(isEntitlementError(null), false);
});
