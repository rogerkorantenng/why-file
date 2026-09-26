/**
 * The whole flow driven over the protocol, the way a host would drive it:
 * announce, capture, ask, review, and the answer when an id is unknown.
 * Bedrock is stubbed throughout.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { announce, connect, startHarness, stopHarness, textOf } from "./mcp-harness.ts";

before(startHarness);
after(stopHarness);

test("a host can run the whole flow over the protocol and get provenance back", async () => {
  const { client } = await connect();

  await announce(client, "s2");
  const captured = textOf(
    await client.callTool({ name: "capture_conversation", arguments: { sessionId: "s2", conversationId: "conv_6531525", presentDeviceIds: ["badge_42"] } }),
  );
  assert.match(captured, /"extractor": "bedrock:test-model"/);
  assert.match(captured, /run the cron at three am/);

  const answer = textOf(await client.callTool({ name: "ask", arguments: { question: "why does the cron run at three am" } }));
  assert.match(answer, /conv_6531525/);
  assert.match(answer, /"recencyWeight"/);
  assert.doesNotMatch(answer, /Unknown/);

  const status = textOf(await client.callTool({ name: "status", arguments: {} }));
  assert.match(status, /"modelConfigured": true/);
  await client.close();
});

test("the review tool returns the record beside the fragments, on request as text", async () => {
  const { client } = await connect();
  await announce(client, "s3");
  await client.callTool({ name: "capture_conversation", arguments: { sessionId: "s3", conversationId: "conv_6531525", presentDeviceIds: ["badge_42"] } });
  const claimId = JSON.parse(textOf(await client.callTool({ name: "list_claims", arguments: {} })))[0].id as string;

  const rendered = textOf(await client.callTool({ name: "review_claim", arguments: { claimId, render: true } }));
  assert.match(rendered, /\| \[u2\]/);
  assert.match(rendered, /## Decision/);
  await client.close();
});

test("asking for a claim that does not exist answers, rather than throwing at the host", async () => {
  const { client } = await connect();
  assert.match(textOf(await client.callTool({ name: "get_claim", arguments: { claimId: "nope" } })), /no such claim: nope/);
  await client.close();
});
