/**
 * The Bedrock boundary itself. The JSON reader and the environment switch are
 * tested directly; the client is tested for the one property everything else
 * depends on, which is that whatever goes wrong comes back as ModelUnavailable
 * inside the timeout.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJsonArray, parseJsonBlock } from "../src/bedrock/json.ts";
import { BedrockInvoker, DEFAULT_MODEL_CHAIN, ModelUnavailable, invokerFromEnv } from "../src/bedrock/invoker.ts";

test("bare JSON, fenced JSON and JSON with a sentence in front all read the same", () => {
  assert.deepEqual(parseJsonBlock('{"decision":"postgres"}'), { decision: "postgres" });
  assert.deepEqual(parseJsonBlock('```json\n{"decision":"postgres"}\n```'), { decision: "postgres" });
  assert.deepEqual(parseJsonBlock('Here is what I found:\n[{"decision":"postgres"}]'), [{ decision: "postgres" }]);
});

test("a brace inside a string does not end the value early", () => {
  assert.deepEqual(parseJsonBlock('{"decision":"use } carefully","kind":"decision"}'), {
    decision: "use } carefully",
    kind: "decision",
  });
});

test("an array wrapped in an object under a plausible key is still found", () => {
  assert.deepEqual(parseJsonArray('{"claims":[{"decision":"postgres"}]}'), [{ decision: "postgres" }]);
});

test("unparseable output returns null rather than throwing, because that routes to the fallback", () => {
  assert.equal(parseJsonBlock("I could not find any decisions."), null);
  assert.equal(parseJsonBlock('{"decision": '), null);
  assert.equal(parseJsonArray('{"note":"nothing here"}'), null);
});

test("ORACLE_BEDROCK=off means run without a model, not fail to start", () => {
  assert.equal(invokerFromEnv({ ORACLE_BEDROCK: "off" } as NodeJS.ProcessEnv), null);
  assert.equal(invokerFromEnv({ ORACLE_BEDROCK: "OFF" } as NodeJS.ProcessEnv), null);
});

test("with no configuration, the first model in the preference chain is the one named", () => {
  const invoker = invokerFromEnv({} as NodeJS.ProcessEnv);
  assert.ok(invoker);
  assert.equal(invoker!.describe, `bedrock:${DEFAULT_MODEL_CHAIN[0]}`);
});

test("the chain is overridable without touching code, as one id or as several", () => {
  const one = invokerFromEnv({ ORACLE_BEDROCK_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0" } as NodeJS.ProcessEnv);
  assert.equal(one!.describe, "bedrock:us.anthropic.claude-haiku-4-5-20251001-v1:0");

  const several = invokerFromEnv({ ORACLE_BEDROCK_MODEL_ID: "first-choice, second-choice" } as NodeJS.ProcessEnv);
  assert.equal(several!.describe, "bedrock:first-choice");
});

test("a call that cannot complete inside its timeout comes back as ModelUnavailable, not a hang", async () => {
  // A 150ms deadline and a model id that cannot exist. Missing credentials,
  // a refused model, a blocked network and the deadline itself all land on the
  // same error, which is the property under test: no Bedrock call can stall
  // the CLI or an MCP host, and no caller has more than one failure to handle.
  const invoker = new BedrockInvoker({ region: "us-east-1", timeoutMs: 150, models: ["us.anthropic.no-such-model-v0"] });
  const started = Date.now();
  await assert.rejects(
    () => invoker.invoke({ system: "s", user: "u" }),
    (err: unknown) => {
      assert.ok(err instanceof ModelUnavailable, `expected ModelUnavailable, got ${String(err)}`);
      assert.match((err as Error).message, /no-such-model-v0/);
      return true;
    },
  );
  assert.ok(Date.now() - started < 8000, "the deadline is enforced");
});
