import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { BeeClient, stripSpeakers } from "../src/bee/client.ts";
import { createMockBeeServer, listenOnEphemeralPort } from "../src/bee/mock-server.ts";
import { MOCK_CONVERSATIONS } from "../src/fixtures/mock-conversations.ts";

let server: Server;
let baseUrl: string;

before(async () => {
  server = createMockBeeServer();
  ({ baseUrl } = await listenOnEphemeralPort(server));
});

after(() => {
  server.close();
});

test("mock server serves /v1/conversations shaped like a list", async () => {
  const client = new BeeClient({ baseUrl });
  const ids = await client.listConversationIds();
  assert.deepEqual(ids, MOCK_CONVERSATIONS.map((c) => c.id));
});

test("mock server serves /v1/conversations/:id with fragmentary Unknown-speaker utterances, per Bee's own published bee now example", async () => {
  for (const fixture of MOCK_CONVERSATIONS) {
    const res = await fetch(`${baseUrl}/v1/conversations/${fixture.id}`);
    const body = (await res.json()) as { utterances: Array<{ speaker: string; text: string }> };
    assert.ok(body.utterances.every((u) => u.speaker === "Unknown"), `${fixture.id} must label every speaker Unknown`);
    assert.ok(body.utterances.some((u) => u.text.length < 30), `${fixture.id} must carry short fragments`);
    assert.ok(
      body.utterances.some((u) => !/[.!?]$/.test(u.text.trim())),
      `${fixture.id} must carry an utterance that stops mid-sentence`,
    );
  }
});

test("client strips the speaker field before returning a Conversation — the attribution boundary", async () => {
  const client = new BeeClient({ baseUrl });
  const conversation = await client.getConversation(MOCK_CONVERSATIONS[0]!.id);
  for (const u of conversation.utterances) {
    assert.ok(!("speaker" in u));
  }
  assert.doesNotMatch(JSON.stringify(conversation), /speaker/i);
});

test("stripSpeakers is a pure function usable without a live server", () => {
  const raw = MOCK_CONVERSATIONS[1]!;
  const stripped = stripSpeakers(raw);
  assert.equal(stripped.utterances.length, raw.utterances.length);
  assert.ok(!("speaker" in stripped.utterances[0]!));
});

test("404s on an unknown conversation id", async () => {
  const client = new BeeClient({ baseUrl });
  await assert.rejects(() => client.getConversation("conv_does_not_exist"));
});
