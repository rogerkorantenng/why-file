#!/usr/bin/env node
/**
 * Oracle's REPL — `npm run repl`, or one command straight from the shell:
 * `node src/repl.ts ask "why does the cron run at 3am"`.
 *
 * `npm run demo` is a script: eight fixed steps against four fixed conversations, and
 * it exits. This is the other shape — you announce a session, pull today's
 * conversations, read the log, ask it a question months later, and commit a record, in
 * whatever order the day actually goes, without restarting the process between any of
 * them. It is built on the same `Oracle` class and the same mock Bee server the demo
 * uses; nothing here changes what `cli-demo.ts` does or how it looks.
 *
 * The commands are drawn from what Oracle is *for* — a decision log that ends in a git
 * commit — not from a generic CLI vocabulary: `announce`, `capture`, `log`, `ask`,
 * `review`, `commit`, `sweep`, `export`. A sibling Bee app in this project's family has
 * a REPL that is a review queue with a different command set on purpose, chosen because
 * that app's job is not this one's.
 *
 * The look is Oracle's own: `demo/layout.ts`'s gutter and two-accent palette, no boxes,
 * no colour Oracle doesn't already use elsewhere. Nothing new is added to the palette.
 */
import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BeeClient } from "./bee/client.ts";
import { createMockBeeServer, listenOnEphemeralPort } from "./bee/mock-server.ts";
import { invokerFromEnv } from "./bedrock/invoker.ts";
import { AMBER, BOLD, GUTTER, RESET, SLATE, WHITE, WIDTH, blank, field, say, slate, titled } from "./demo/layout.ts";
import { printClaim, printHit, printReversals, utterance } from "./demo/print.ts";
import { MOCK_CONVERSATIONS } from "./fixtures/mock-conversations.ts";
import { Oracle } from "./oracle.ts";
import { supersededClaimIds } from "./relations.ts";
import { TWO_COLUMN_MINIMUM, renderReview } from "./review.ts";
import { ClaimStore } from "./store.ts";
import type { Server } from "node:http";

// Matches the room in fixtures/mock-conversations.ts — capture is room-scoped (rule 1),
// and a session announced for a different room silently drops every utterance rather
// than throwing, which is correct behaviour and a confusing REPL bug if this drifts.
const ROOM_ID = "room_war-room-3";
const POLICY_REF = "https://internal.example.com/policies/room-capture";
const DEVICE_ID = "badge_42";
const SESSION_ID = "session_repl";
const ANNOUNCEMENT_TEXT =
  "Why File is recording this room for engineering decisions. Text only, no audio kept.";

const COMMANDS = [
  "announce",
  "capture",
  "log",
  "ask",
  "review",
  "commit",
  "sweep",
  "export",
  "status",
  "help",
  "clear",
  "exit",
  "quit",
] as const;

let oracle: Oracle;
let repoDir: string;
let announced = false;

function usage(name: string, args: string): void {
  console.log(`  usage: ${AMBER}${name}${RESET} ${SLATE}${args}${RESET}`);
  blank();
}

function printError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.log(`  ${BOLD}error${RESET}  ${SLATE}${message}${RESET}`);
  blank();
}

function banner(): void {
  blank();
  console.log(`${" ".repeat(GUTTER)}  ${BOLD}Why File${RESET}`);
  blank();
  field("help", "list every command", "quiet");
  field("tab", "completes a command, a conversation id, or a claim id", "quiet");
  field("ctrl+d", "leave — nothing here is lost, only what was never committed", "quiet");
  blank();
}

function printHelp(): void {
  const cmd = (name: string, args: string, desc: string): void => {
    console.log(`  ${AMBER}${name}${RESET}${args ? ` ${SLATE}${args}${RESET}` : ""}`);
    console.log(`    ${SLATE}${desc}${RESET}`);
  };
  blank();
  cmd("announce", "", "announce the room and log the announcement — rule 2");
  cmd("capture", "[conversationId]", "pull a conversation from Bee and extract what it settled; all of today's if no id is given");
  cmd("log", "", "the decision log, newest first — every claim on record and where it came from");
  cmd("ask", "<question>", "ask what was decided, ranked by relevance, recency, and whether it was reversed");
  cmd("review", "<claimId>", "the draft beside the words it came from, two columns wide enough");
  cmd("commit", "<claimId>", "draft the ADR and commit it to a local git branch, under your own identity, never pushed");
  cmd("sweep", "", "sweep every claim for a later conversation that quietly reversed it");
  cmd("export", "[dir]", "write the whole decision log to disk as markdown and JSON, with the consent log");
  cmd("status", "", "what is configured, what last ran, and what it fell back to");
  cmd("clear", "", "clear the screen");
  cmd("help", "", "this");
  cmd("exit", "", "leave (or Ctrl+D)");
  blank();
  slate('also runs one-shot from the shell: node src/repl.ts ask "why does the cron run at 3am"');
  blank();
}

async function ensureSession(): Promise<void> {
  if (announced) return;
  await doAnnounce(false);
}

async function doAnnounce(explicit: boolean): Promise<void> {
  const session = oracle.startSession({
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    announcementText: ANNOUNCEMENT_TEXT,
    policyRef: POLICY_REF,
    roster: { roomId: ROOM_ID, expectedParticipantDeviceIds: [DEVICE_ID] },
  });
  announced = true;
  field("room", session.announcement.roomId, "quiet");
  field("announced", session.announcement.announcedAt, "quiet");
  field("policy", session.announcement.policyRef, "quiet");
  blank();
  say(`“${session.announcement.announcementText}”`);
  blank();
  if (!explicit) slate("(announced automatically — capture needs an open session first)");
  blank();
}

async function doCapture(args: readonly string[]): Promise<void> {
  await ensureSession();
  const known = MOCK_CONVERSATIONS.map((c) => c.id);
  const ids = args[0] ? [args[0]] : known;
  for (const id of ids) {
    const conv = MOCK_CONVERSATIONS.find((c) => c.id === id);
    if (!conv) {
      console.log(`  ${SLATE}no such conversation: ${id} — known: ${known.join(", ")}${RESET}`);
      blank();
      continue;
    }
    titled(`conversation ${conv.id}`, conv.startedAt);
    blank();
    for (const u of conv.utterances) utterance(u.id, u.text);
    blank();
    const result = await oracle.captureConversation(SESSION_ID, conv.id, [DEVICE_ID]);
    if (result.refusedReason) field("refused", result.refusedReason, "quiet");
    if (result.usedFallback) field("fell back", result.fallbackReason ?? "no reason given", "quiet");
    for (const rejected of result.attributionRejections) field("dropped", `attribution guard: ${rejected}`, "quiet");
    if (result.claims.length > 1) field("segmented", `${result.claims.length} subjects in one recording`, "quiet");
    blank();
    for (const claim of result.claims) printClaim(claim);
  }
}

function doLog(): void {
  const claims = oracle.claims();
  if (claims.length === 0) {
    say("The log is empty. Run `capture` to pull today's conversations.");
    blank();
    return;
  }
  const superseded = supersededClaimIds(oracle.store.allRelations());
  for (const claim of claims) {
    titled(`${claim.kind}  ${claim.topic}`, claim.id);
    const decided = claim.decision || claim.rejectedOptions.join(", ") || claim.context || "not captured";
    field("decided", decided, claim.decision || claim.rejectedOptions.length ? "claim" : "quiet");
    if (superseded.has(claim.id)) field("but", "a later record reverses this one", "quiet");
    field("from", `${claim.provenance.conversationId}, ${claim.provenance.timestamp}`, "quiet");
    blank();
  }
  field("total", `${claims.length} record(s), ${superseded.size} reversed`, "quiet");
  blank();
}

async function doAsk(args: readonly string[]): Promise<void> {
  const question = args.join(" ").trim();
  if (!question) {
    usage("ask", "<question>");
    return;
  }
  console.log(`${" ".repeat(GUTTER)}  ${BOLD}${question}${RESET}`);
  blank();
  const hits = oracle.ask(question, { limit: 5 });
  if (hits.length === 0) {
    say("Nothing in the log covers that.");
    blank();
    return;
  }
  hits.forEach(printHit);
}

function doReview(args: readonly string[]): void {
  const id = args[0];
  if (!id) {
    usage("review", "<claimId>");
    return;
  }
  let review;
  try {
    review = oracle.review(id);
  } catch (err) {
    printError(err);
    return;
  }
  if (WIDTH < TWO_COLUMN_MINIMUM) {
    slate(`This terminal is too narrow for two columns, so the record and the transcript are stacked. Widen past ${TWO_COLUMN_MINIMUM} to see them side by side.`);
    blank();
  }
  console.log(renderReview(review, WIDTH, { claim: AMBER, provenance: SLATE, plain: WHITE, reset: RESET }));
  blank();
}

async function doCommit(args: readonly string[]): Promise<void> {
  const id = args[0];
  if (!id) {
    usage("commit", "<claimId>");
    return;
  }
  let record;
  try {
    record = await oracle.draftRecordForClaim(id);
  } catch (err) {
    printError(err);
    return;
  }
  field(record.commitSha.slice(0, 8), `${record.filePath}  ${SLATE}on ${record.branch}${RESET}`);
  field("repo", repoDir, "quiet");
  blank();
  say("Committed under your own git identity, on a local branch, never pushed. `git log` in the repo above shows it.");
  blank();
}

async function doSweep(): Promise<void> {
  const detection = await oracle.findContradictions();
  printReversals(detection);
}

async function doExport(args: readonly string[]): Promise<void> {
  const outDir = args[0] ?? path.join(repoDir, "export");
  const written = await oracle.exportLogTo(outDir);
  field("records", `${written.claimCount}, ${written.supersededCount} reversed`, "quiet");
  field("markdown", written.markdownPath, "quiet");
  field("json", written.jsonPath, "quiet");
  blank();
}

function doStatus(): void {
  const status = oracle.status();
  field("extractor", status.extractor, "quiet");
  field("last used", status.lastExtractorUsed ?? "nothing yet", "quiet");
  if (status.lastFallbackReason) field("fell back", status.lastFallbackReason, "quiet");
  field("claims", String(status.claimCount), "quiet");
  field("conversations", String(status.conversationCount), "quiet");
  field("announcements", String(status.announcementCount), "quiet");
  field("relations", String(status.relationCount), "quiet");
  field("open sessions", status.openSessions.join(", ") || "none", "quiet");
  field("store", status.persistTo ?? "in-memory only, nothing kept between runs", "quiet");
  field("repo", repoDir, "quiet");
  blank();
}

function clearScreen(): void {
  process.stdout.write("\x1Bc");
}

export type DispatchResult = "ok" | "exit" | "unknown";

/** Shared by the REPL loop and one-shot argv dispatch, so `node src/repl.ts ask ...`
 * and typing `ask ...` at the prompt run the identical handler. */
export async function dispatch(cmd: string, args: readonly string[]): Promise<DispatchResult> {
  try {
    switch (cmd) {
      case "help":
        printHelp();
        return "ok";
      case "clear":
        clearScreen();
        banner();
        return "ok";
      case "status":
        doStatus();
        return "ok";
      case "announce":
        await doAnnounce(true);
        return "ok";
      case "capture":
        await doCapture(args);
        return "ok";
      case "log":
        doLog();
        return "ok";
      case "ask":
        await doAsk(args);
        return "ok";
      case "review":
        doReview(args);
        return "ok";
      case "commit":
        await doCommit(args);
        return "ok";
      case "sweep":
        await doSweep();
        return "ok";
      case "export":
        await doExport(args);
        return "ok";
      case "exit":
      case "quit":
        return "exit";
      default:
        console.log(`  ${SLATE}unknown command: ${cmd} — try ${AMBER}help${RESET}`);
        blank();
        return "unknown";
    }
  } catch (err) {
    printError(err);
    return "ok";
  }
}

export function completer(line: string): [string[], string] {
  const parts = line.split(/\s+/);
  if (parts.length <= 1) {
    const hits = COMMANDS.filter((c) => c.startsWith(line));
    // A trailing space on the one unambiguous match, so completing a command name
    // leaves the cursor ready for its argument rather than needing a second Tab.
    return [hits.length === 1 ? [`${hits[0]} `] : hits, line];
  }
  const [cmd] = parts;
  const last = parts[parts.length - 1] ?? "";
  let candidates: readonly string[] = [];
  if (cmd === "capture") candidates = MOCK_CONVERSATIONS.map((c) => c.id);
  else if (cmd === "review" || cmd === "commit") candidates = oracle.claims().map((c) => c.id);
  return [candidates.filter((c) => c.startsWith(last)), last];
}

async function loadHistory(historyPath: string): Promise<string[]> {
  try {
    return (await readFile(historyPath, "utf8")).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

async function startRepl(mockServer: Server): Promise<void> {
  banner();
  const historyPath = path.join(os.homedir(), ".oracle_history");
  const history = await loadHistory(historyPath);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    completer,
    history,
    historySize: 500,
  });

  let latestHistory: readonly string[] = history;
  rl.on("history", (h) => {
    latestHistory = h;
  });
  rl.on("SIGINT", () => rl.close());

  // Prompted and read by hand rather than `rl.prompt()` on the `line` event, for the
  // same reason said-out-loud's `review-cli.ts` does this — see its header comment.
  // `rl.prompt()` calls `resume()` on the input stream, and on a piped, non-interactive
  // input readline can mark itself closed as soon as the pipe hits EOF, even while
  // lines it already buffered are still being worked through; the next `rl.prompt()`
  // then throws `ERR_USE_AFTER_CLOSE` mid-script. Reading from the interface's own
  // async iterator has no such moment: it just ends.
  const promptText = `${SLATE}why file${RESET} ${AMBER}»${RESET} `;
  const interactive = Boolean(process.stdin.isTTY);
  const lines = rl[Symbol.asyncIterator]();

  async function nextLine(): Promise<string | null> {
    process.stdout.write(promptText);
    const next = await lines.next();
    if (!interactive) process.stdout.write("\n"); // a pipe supplies no Enter of its own
    return next.done ? null : next.value;
  }

  for (;;) {
    const line = await nextLine();
    if (line === null) break; // input ended — the same as Ctrl+D
    const trimmed = line.trim();
    if (trimmed) {
      const [cmd, ...args] = trimmed.split(/\s+/);
      const result = await dispatch(cmd!.toLowerCase(), args);
      if (result === "exit") break;
    }
  }
  rl.close();

  try {
    await writeFile(historyPath, `${latestHistory.slice(0, 500).join("\n")}\n`, "utf8");
  } catch {
    // history is a convenience; losing it is not worth failing the exit over
  }
  blank();
  slate("goodbye — anything committed is in the repo above; nothing else survives this process");
  blank();
  mockServer.close();
}

/**
 * Builds the module-level `oracle` and `repoDir` a command handler reads, and starts
 * the mock Bee server behind it. Split out from `main()` so a test can boot the same
 * REPL state `dispatch()` runs against without going through argv or the readline loop.
 */
export async function boot(): Promise<Server> {
  const mockServer = createMockBeeServer();
  const { baseUrl } = await listenOnEphemeralPort(mockServer);

  // Not `${cwd}/demo-repo` (the MCP server's default): this repo lives inside the
  // monorepo that hosts every app here, and `git init` on a directory nested inside an
  // existing repo is a no-op — `ensureDemoRepo`'s `rev-parse --git-dir` check walks up
  // and finds the *outer* repo, then `commit` runs to a branch that outer repo does not
  // have. Outside any existing repo, in the REPL's own home, is unambiguous.
  repoDir = process.env.ORACLE_REPO_DIR ?? path.join(os.homedir(), ".oracle", "repl-repo");
  const persistTo = process.env.ORACLE_STORE_PATH ?? path.join(process.cwd(), ".oracle", "repl-store.json");
  const store = await ClaimStore.loadFrom(persistTo);

  oracle = new Oracle({
    beeClient: new BeeClient({ baseUrl }),
    repoDir,
    wearer: {
      name: process.env.ORACLE_WEARER_NAME ?? "Why File Wearer",
      email: process.env.ORACLE_WEARER_EMAIL ?? "wearer@localhost",
    },
    store,
    invoker: invokerFromEnv(),
    persistTo,
  });
  announced = false;
  return mockServer;
}

async function main(): Promise<void> {
  const mockServer = await boot();

  const argv = process.argv.slice(2);
  if (argv.length > 0) {
    const [cmd, ...args] = argv;
    const result = await dispatch(cmd!.toLowerCase(), args);
    mockServer.close();
    process.exitCode = result === "unknown" ? 1 : 0;
    return;
  }

  await startRepl(mockServer);
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
