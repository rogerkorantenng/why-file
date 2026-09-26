/** Harness for the MCP tests: a mock Bee server, a scratch repo, a stubbed
 * Bedrock, and a real MCP client joined to the server over an in-memory
 * transport. No tests of its own. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { BeeClient } from "../src/bee/client.ts";
import { createMockBeeServer, listenOnEphemeralPort } from "../src/bee/mock-server.ts";
import { buildOracleMcpServer } from "../src/mcp-server.ts";
import { Oracle } from "../src/oracle.ts";
import { stubInvoker } from "./helpers.ts";

/** One claim, so a capture over the protocol is deterministic. */
export const MODEL_CLAIMS = JSON.stringify([
  {
    topic: "cron job scheduling time",
    kind: "decision",
    context: "the reporting tables lock during business hours",
    decision: "run the cron at three am",
    rejectedOptions: ["four am"],
    consequences: "the backup job owns four am",
    sourceUtteranceIds: ["u2", "u9"],
    confidence: 0.95,
  },
]);

let beeServer: Server | null = null;
let baseUrl = "";
let repoDir = "";

export async function startHarness(): Promise<void> {
  beeServer = createMockBeeServer();
  ({ baseUrl } = await listenOnEphemeralPort(beeServer));
  repoDir = await mkdtemp(path.join(os.tmpdir(), "oracle-mcp-"));
}

export async function stopHarness(): Promise<void> {
  beeServer?.close();
  await rm(repoDir, { recursive: true, force: true });
}

export async function connect(): Promise<{ client: Client; oracle: Oracle }> {
  const oracle = new Oracle({
    beeClient: new BeeClient({ baseUrl }),
    repoDir,
    wearer: { name: "J. Wearer", email: "wearer@example.com" },
    invoker: stubInvoker(MODEL_CLAIMS),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-host", version: "1.0.0" });
  await Promise.all([buildOracleMcpServer(oracle).connect(serverTransport), client.connect(clientTransport)]);
  return { client, oracle };
}

/** Announces a session over the protocol, which every capture needs first. */
export async function announce(client: Client, sessionId: string): Promise<void> {
  await client.callTool({
    name: "start_session",
    arguments: {
      roomId: "room_war-room-3",
      sessionId,
      announcementText: "Oracle is recording this room.",
      policyRef: "https://example.com/policy",
      expectedParticipantDeviceIds: ["badge_42"],
    },
  });
}

export function textOf(result: unknown): string {
  return ((result as { content: Array<{ text: string }> }).content[0]?.text ?? "").toString();
}
