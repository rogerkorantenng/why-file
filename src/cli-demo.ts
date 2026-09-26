#!/usr/bin/env node
/**
 * End-to-end demo for a judge without an MCP client handy. This file is the order of
 * events and nothing else: what each step prints lives in `demo/steps.ts`, and the look
 * it is drawn in lives in `demo/layout.ts`.
 *
 * It ends on the artefact rather than a status line. Everything above step 8 is Oracle's
 * own screen and will be gone when the terminal scrolls; the committed file is the thing
 * still there in March, so the run finishes by printing one.
 *
 * No network needed. `ORACLE_BEDROCK=off npm run demo` takes the deterministic path
 * deliberately, and an unreachable Bedrock takes it automatically, saying why.
 */
import os from "node:os";
import path from "node:path";
import { BeeClient } from "./bee/client.ts";
import { createMockBeeServer, listenOnEphemeralPort } from "./bee/mock-server.ts";
import { invokerFromEnv } from "./bedrock/invoker.ts";
import { blank, say, step } from "./demo/layout.ts";
import { printArtefact, printReversals } from "./demo/print.ts";
import { captureEverything, masthead, printAnnouncement, printDrafts, printExport } from "./demo/steps.ts";
import { printHit, printNoAnswer, printQuestion, printReview, printStatus } from "./demo/steps.ts";
import { Oracle } from "./oracle.ts";

const QUESTIONS = ["why does the cron run at 3am", "what is the retry budget on the payments call"];

async function main(): Promise<void> {
  const mockServer = createMockBeeServer();
  const { baseUrl } = await listenOnEphemeralPort(mockServer);

  const invoker = invokerFromEnv();
  const repoDir = path.join(os.tmpdir(), `oracle-demo-${Date.now()}`);
  const oracle = new Oracle({
    beeClient: new BeeClient({ baseUrl }),
    repoDir,
    wearer: { name: "J. Wearer", email: "wearer@example.com" },
    invoker,
  });

  masthead(
    invoker ? `${invoker.describe} — the chain steps past any this account cannot invoke` : "rules, Bedrock switched off",
    baseUrl,
  );

  step(1, "Announce the room, and log the announcement before anything else");
  const session = oracle.startSession({
    roomId: "room_war-room-3",
    sessionId: "session_1",
    announcementText: "Why File is recording this room for engineering decisions. Text only, no audio kept.",
    policyRef: "https://internal.example.com/policies/room-capture",
    roster: { roomId: "room_war-room-3", expectedParticipantDeviceIds: ["badge_42"] },
  });
  printAnnouncement(session.announcement);

  step(2, "Capture the day, and extract what was settled");
  const claimIds = await captureEverything(oracle);

  step(3, "Find what a later conversation quietly reversed");
  const detection = await oracle.findContradictions();
  printReversals(detection);

  step(4, "Review the draft beside the words it came from");
  const reviewTarget = detection.relations[0]?.earlierClaimId ?? claimIds[0];
  if (reviewTarget) printReview(oracle.review(reviewTarget));

  step(5, "Draft: a local git branch and commit each, never pushed");
  const records = [];
  for (const claimId of claimIds) records.push(await oracle.draftRecordForClaim(claimId));
  printDrafts(records, repoDir);

  step(6, "Ask, months later");
  for (const question of QUESTIONS) {
    printQuestion(question);
    const hits = oracle.ask(question, { limit: 2 });
    if (hits.length === 0) printNoAnswer();
    hits.forEach(printHit);
  }

  step(7, "Export the whole log");
  printExport(await oracle.exportLogTo(path.join(repoDir, "export")), oracle.store.allAnnouncements());

  step(8, "The artefact");
  say("Everything above scrolls away. This is what is left: one file, on a branch, under the wearer's git identity, naming nobody.");
  blank();
  printArtefact(oracle.review(claimIds[0]!).adrMarkdown, `decisions/${claimIds[0]}.md`);

  printStatus(oracle.status());
  mockServer.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
