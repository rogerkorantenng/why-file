/**
 * What a host sees before it calls anything: the tool list, whether each tool
 * describes itself well enough to be chosen, the resources, and the prompts.
 * Driven through a real client over an in-memory transport rather than by
 * reading the registration code back to itself. Bedrock is stubbed.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { connect, startHarness, stopHarness } from "./mcp-harness.ts";

before(startHarness);
after(stopHarness);

test("the server exposes a toolset a host can work with, not just the demo script", async () => {
  const { client } = await connect();
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  for (const expected of [
    "ask",
    "capture_conversation",
    "close_session",
    "consent_log",
    "draft_record",
    "export_decision_log",
    "find_contradictions",
    "get_claim",
    "list_claims",
    "list_conversations",
    "review_claim",
    "start_session",
    "status",
  ]) {
    assert.ok(names.includes(expected), `missing tool: ${expected}`);
  }
  await client.close();
});

test("every tool describes itself well enough to be chosen without reading the source", async () => {
  const { client } = await connect();
  for (const tool of (await client.listTools()).tools) {
    assert.ok((tool.description ?? "").length > 40, `${tool.name} has a thin description`);
    assert.ok(tool.title, `${tool.name} has no title`);
  }
  await client.close();
});

test("resources let a host read a claim and its record by URI", async () => {
  const { client, oracle } = await connect();
  oracle.startSession({
    roomId: "room_war-room-3",
    sessionId: "s1",
    announcementText: "Oracle is recording this room.",
    policyRef: "https://example.com/policy",
    roster: { roomId: "room_war-room-3", expectedParticipantDeviceIds: ["badge_42"] },
  });
  const captured = await oracle.captureConversation("s1", "conv_6531525", ["badge_42"]);
  const claimId = captured.claims[0]!.id;

  const uris = (await client.listResources()).resources.map((r) => r.uri);
  assert.ok(uris.includes("oracle://claims"));
  assert.ok(uris.includes("oracle://consent-log"));

  const record = await client.readResource({ uri: `oracle://record/${claimId}` });
  const body = String((record.contents[0] as { text: string }).text);
  assert.match(body, /## Provenance/);
  assert.match(body, /conversation conv_6531525/);
  assert.doesNotMatch(body, /Unknown/);
  await client.close();
});

test("the prompts carry the house rule about naming nobody into the host's context", async () => {
  const { client } = await connect();
  const names = (await client.listPrompts()).prompts.map((p) => p.name);
  assert.deepEqual(names.sort(), ["review-a-draft-record", "why-is-this-like-this"]);

  const prompt = await client.getPrompt({ name: "why-is-this-like-this", arguments: { question: "why postgres" } });
  const body = String((prompt.messages[0]!.content as { text: string }).text);
  assert.match(body, /why postgres/);
  assert.match(body, /Never say or guess who said anything/);
  await client.close();
});
