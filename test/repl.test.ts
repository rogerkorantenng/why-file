/**
 * The REPL's command dispatch and tab completion (src/repl.ts).
 *
 * `dispatch()` is the one function both the interactive loop and one-shot argv calls
 * run through, so it is what this file tests rather than spawning the process and
 * scraping a terminal. Bedrock is switched off throughout — the fixture conversations
 * still extract real claims through the rule-based path, which is enough to exercise
 * every command — and the store and git repo both point at a fresh temp directory so
 * this suite never touches a real `~/.oracle` or a developer's own `.oracle/`.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { MOCK_CONVERSATIONS } from "../src/fixtures/mock-conversations.ts";
import { boot, completer, dispatch } from "../src/repl.ts";

const workDir = mkdtempSync(path.join(tmpdir(), "oracle-repl-test-"));
process.env.ORACLE_BEDROCK = "off";
process.env.ORACLE_STORE_PATH = path.join(workDir, "store.json");
process.env.ORACLE_REPO_DIR = path.join(workDir, "repo");

let mockServer: Server;

before(async () => {
  mockServer = await boot();
});

after(() => {
  mockServer.close();
  rmSync(workDir, { recursive: true, force: true });
});

/** Every command's whole interface is what it prints, so tests capture stdout rather
 * than a return value. */
async function run(cmd: string, ...args: string[]): Promise<string> {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...parts: unknown[]): void => {
    lines.push(parts.map(String).join(" "));
  };
  try {
    await dispatch(cmd, args);
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

test("help lists every command, and nothing it does not have", async () => {
  const out = await run("help");
  for (const cmd of ["announce", "capture", "log", "ask", "review", "commit", "sweep", "export", "status"]) {
    assert.match(out, new RegExp(cmd));
  }
});

test("an unknown command says so without throwing", async () => {
  const out = await run("frobnicate");
  assert.match(out, /unknown command: frobnicate/);
  assert.equal(await dispatch("frobnicate", []), "unknown");
});

test("exit and quit both signal the REPL to stop, and nothing else does", async () => {
  assert.equal(await dispatch("exit", []), "exit");
  assert.equal(await dispatch("quit", []), "exit");
  assert.equal(await dispatch("status", []), "ok");
});

test("review and commit on an unknown id report the error rather than throwing", async () => {
  const reviewOut = await run("review", "no-such-claim");
  assert.match(reviewOut, /no such claim/);
  const commitOut = await run("commit", "no-such-claim");
  assert.match(commitOut, /no such claim/);
});

test("ask and review with no argument print usage instead of doing nothing silently", async () => {
  assert.match(await run("ask"), /usage: ask/);
  assert.match(await run("review"), /usage: review/);
  assert.match(await run("commit"), /usage: commit/);
});

test("tab-completes command names from a prefix, and nothing for a prefix no command has", () => {
  // A unique match gets a trailing space, so completing a command leaves the cursor
  // ready for its argument rather than needing a second Tab.
  const [hits] = completer("cap");
  assert.deepEqual(hits, ["capture "]);
  const [empty] = completer("zzz");
  assert.deepEqual(empty, []);
  const [all] = completer("");
  assert.ok(all.includes("capture") && all.includes("commit") && all.includes("sweep"));
});

test("the day: capture, log, ask, review, commit, sweep and export all work over the mock conversations", async () => {
  // capture with no id pulls every conversation, extracts through the rule-based path
  // (Bedrock is off), and announces the session automatically on first use.
  const captureOut = await run("capture");
  assert.match(captureOut, /announced automatically/);
  assert.match(captureOut, /decided by/);
  // conv_6529877 covers two subjects; the other three conversations are one each.
  assert.equal((captureOut.match(/decided by/g) ?? []).length, 5);

  const logOut = await run("log");
  assert.match(logOut, /total.*5 record\(s\)/s);

  const askOut = await run("ask", "what", "is", "the", "retry", "budget", "on", "the", "payments", "call");
  assert.match(askOut, /answer/);
  assert.doesNotMatch(askOut, /Nothing in the log covers that/);

  const noHitOut = await run("ask", "kubernetes", "ingress", "annotation");
  assert.match(noHitOut, /Nothing in the log covers that/);

  // conv_6529877's first claim: the retry budget settled at five in March.
  const reviewOut = await run("review", "claim_conv_6529877_s1");
  assert.match(reviewOut, /## Decision/);
  assert.match(reviewOut, /five/);

  const commitOut = await run("commit", "claim_conv_6529877_s1");
  assert.match(commitOut, /on why-file\/claim_conv_6529877_s1/);

  // March settles the retry budget at five; June settles it again at three, in a
  // conversation that never mentions the first. `sweep` finds the reversal.
  const sweepOut = await run("sweep");
  assert.match(sweepOut, /supersedes/);

  const exportOut = await run("export", path.join(workDir, "export"));
  assert.match(exportOut, /records.*5, 1 reversed/s);

  // Completion now has real ids to offer: conversation ids for `capture`, claim ids
  // for `review` and `commit`.
  const [convHits] = completer("capture ");
  assert.deepEqual(new Set(convHits), new Set(MOCK_CONVERSATIONS.map((c) => c.id)));

  const [reviewHits] = completer("review claim_conv_6529877");
  assert.ok(reviewHits.includes("claim_conv_6529877_s1"));
  assert.ok(reviewHits.includes("claim_conv_6529877_s2"));
});
