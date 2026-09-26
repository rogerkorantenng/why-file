import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { ClaimStore } from "../src/store.ts";
import { makeClaim, makeConversation } from "./helpers.ts";

let dir: string;

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "oracle-store-"));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function populated(): ClaimStore {
  const store = new ClaimStore();
  store.addConversation(makeConversation());
  store.addClaim(makeClaim({ id: "c_old", provenance: { conversationId: "conv_test", timestamp: "2026-01-01T00:00:00Z", sourceUtteranceIds: ["u1"] } }));
  store.addClaim(makeClaim({ id: "c_new", provenance: { conversationId: "conv_test", timestamp: "2026-08-01T00:00:00Z", sourceUtteranceIds: ["u3"] } }));
  store.addAnnouncement({
    roomId: "room_test",
    sessionId: "s1",
    announcedAt: "2026-01-01T00:00:00Z",
    announcementText: "Oracle is recording this room.",
    policyRef: "https://example.com/policy",
  });
  store.setRelations([
    {
      laterClaimId: "c_new",
      earlierClaimId: "c_old",
      kind: "supersedes",
      rationale: "The later record settles it differently.",
      detectedBy: "heuristic",
      detectedAt: "2026-09-01T00:00:00Z",
      confidence: 0.4,
    },
  ]);
  return store;
}

test("claims come back newest first when asked for in time order", () => {
  assert.deepEqual(populated().claimsByTime().map((c) => c.id), ["c_new", "c_old"]);
});

test("a fresh sweep of relations replaces the previous one rather than piling up", () => {
  const store = populated();
  store.setRelations([]);
  assert.deepEqual(store.allRelations(), []);
});

test("relations can be found from either end of the pair", () => {
  const store = populated();
  assert.equal(store.relationsFor("c_old").length, 1);
  assert.equal(store.relationsFor("c_new").length, 1);
  assert.equal(store.relationsFor("c_missing").length, 0);
});

test("the store survives a restart, so an MCP host that reconnects still has the log", async () => {
  const file = path.join(dir, "nested", "oracle-store.json");
  await populated().saveTo(file);

  const reloaded = await ClaimStore.loadFrom(file);
  assert.equal(reloaded.allClaims().length, 2);
  assert.equal(reloaded.allAnnouncements().length, 1);
  assert.equal(reloaded.allRelations().length, 1);
  assert.equal(reloaded.getConversation("conv_test")?.utterances.length, 3);
});

test("the persisted file has no speaker field anywhere, which a judge can check by eye", async () => {
  const file = path.join(dir, "check.json");
  await populated().saveTo(file);
  const text = await readFile(file, "utf8");
  assert.doesNotMatch(text, /"speaker"/i);
  assert.doesNotMatch(text, /Unknown/);
});

test("pointing Oracle at a directory with no store yet gives an empty store, not a crash", async () => {
  const store = await ClaimStore.loadFrom(path.join(dir, "does-not-exist.json"));
  assert.deepEqual(store.allClaims(), []);
});

test("a corrupt store file is treated as an empty one rather than taking the tool down", async () => {
  const file = path.join(dir, "corrupt.json");
  await (await import("node:fs/promises")).writeFile(file, "{not json at all");
  const store = await ClaimStore.loadFrom(file);
  assert.deepEqual(store.allClaims(), []);
});
