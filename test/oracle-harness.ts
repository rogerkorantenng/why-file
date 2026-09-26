/** Harness for the end-to-end Oracle tests: a mock Bee server on an ephemeral
 * port, a scratch git repo, and an Oracle built over both. No tests of its
 * own. Bedrock is whatever the caller passes, and null by default, so a test
 * only reaches a model when it hands one in. */
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { BeeClient } from "../src/bee/client.ts";
import { createMockBeeServer, listenOnEphemeralPort } from "../src/bee/mock-server.ts";
import { Oracle } from "../src/oracle.ts";
import type { ModelInvoker } from "../src/bedrock/invoker.ts";

let server: Server | null = null;
let baseUrl = "";
let repoDir = "";

export async function startHarness(): Promise<void> {
  server = createMockBeeServer();
  ({ baseUrl } = await listenOnEphemeralPort(server));
  repoDir = await mkdtemp(path.join(os.tmpdir(), "oracle-e2e-"));
}

export async function stopHarness(): Promise<void> {
  server?.close();
  await rm(repoDir, { recursive: true, force: true });
}

export function makeOracle(invoker: ModelInvoker | null = null): Oracle {
  return new Oracle({
    beeClient: new BeeClient({ baseUrl }),
    repoDir,
    wearer: { name: "J. Wearer", email: "wearer@example.com" },
    invoker,
  });
}

/** Opens a session the fixtures' own room, which is the only way capture is
 * ever accepted. */
export function announce(oracle: Oracle, sessionId: string, badge = "badge_42"): void {
  oracle.startSession({
    roomId: "room_war-room-3",
    sessionId,
    announcementText: "Oracle is recording this room.",
    policyRef: "https://org.example.com/policy",
    roster: { roomId: "room_war-room-3", expectedParticipantDeviceIds: [badge] },
  });
}
