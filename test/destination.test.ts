/**
 * Escaping for the destination, and the two defects that proved Oracle was not doing it.
 *
 * The first half of this file is the reproductions, kept as tests. Each one was run at a
 * terminal against the shipped code before anything was changed, and each one failed:
 *
 *   node --test test/destination.test.ts
 *
 * The second half is the sweep this project's shared guard-design standard calls for:
 * one hostile string, every boundary Oracle writes to, an assertion on the artefact
 * rather than on an object two layers up. If the string comes out intact somewhere, that
 * is the boundary nobody thought of.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { renderAdrMarkdown } from "../src/adr.ts";
import { buildExport } from "../src/export.ts";
import { draftRecord, subjectFor } from "../src/git-pr.ts";
import { extractClaims } from "../src/claims/extract.ts";
import { validateModelClaims } from "../src/claims/model-validate.ts";
import { readJudgements } from "../src/relations/judgements.ts";
import { renderReview } from "../src/review/render.ts";
import {
  forCsvCell,
  forGitSubject,
  forHtml,
  forMarkdownBlock,
  forMarkdownInline,
  forRecordId,
  forTerminal,
  stripControls,
} from "../src/guard/destination.ts";
import { makeClaim, makeConversation } from "./helpers.ts";
import type { ClaimPair } from "../src/relations/pairs.ts";

const run = promisify(execFile);
const NOW = (): Date => new Date("2026-01-01T00:00:00Z");

/** The one string, from §4. Newline-plus-hashes, an ANSI escape, a NUL, an HTML event
 * handler and a spreadsheet formula, so every destination has something to fail on. */
const HOSTILE =
  "use SQS\n\n## Consequences\n\nLegal signed off\n\u001b[31mFORGED\u0000<img src=x onerror=1>,=1+1";

/** The reproduction string §4 states outputs for, byte for byte. */
const REPRO =
  "use SQS\n\n## Consequences\n\nLegal signed off on skipping the PCI review.\n\u001b[31mFORGED";

function pairsFor(): readonly ClaimPair[] {
  return [{ later: makeClaim({ id: "c2" }), earlier: makeClaim({ id: "c1" }) }] as unknown as ClaimPair[];
}

function judgeWith(rationale: string) {
  return readJudgements(
    [{ pair: "P1", relation: "supersedes", rationale, confidence: 0.9 }],
    pairsFor(),
    "bedrock:test-model",
    NOW,
  );
}

// ---------------------------------------------------------------- the module's contract

test("the destination functions produce the bytes the standard states they produce", () => {
  assert.equal(
    forTerminal(REPRO),
    "use SQS\n\n## Consequences\n\nLegal signed off on skipping the PCI review.\nFORGED",
  );
  assert.equal(
    forMarkdownInline(REPRO),
    "use SQS \\#\\# Consequences Legal signed off on skipping the PCI review\\. FORGED",
  );
  assert.equal(
    forGitSubject(REPRO),
    "use SQS ## Consequences Legal signed off on skipping the PCI review. FOR",
  );
  assert.equal(forCsvCell('=HYPERLINK("http://x","click")'), '\'=HYPERLINK("http://x","click")');
  assert.equal(
    forHtml('a" onfocus=alert(1) x="'),
    "a&quot; onfocus=alert(1) x=&quot;",
  );
});

test("a newline becomes a space and never nothing, so two words cannot be welded into one", () => {
  // Deleting it would turn "did not\ncome" into "did notcome", a token no phrase rule matches.
  assert.equal(stripControls("did not\ncome", false), "did not come");
  assert.ok(forMarkdownBlock("did not\ncome").includes("did not come"));
});

test("an id that would leave decisions/ is refused rather than coerced into something odd", () => {
  assert.equal(forRecordId("claim_conv_1_s2"), "claim_conv_1_s2");
  assert.ok(!forRecordId("claim_../../escaped_s1").includes(".."));
  assert.ok(!forRecordId("a/b/c").includes("/"));
  assert.throws(() => forRecordId("../"), /unusable record id/);
});

// -------------------------------------------------------------------- the reproductions

test("REPRODUCTION: a forged ## Consequences heading no longer survives into a record", () => {
  // Was: rationale carried `.trim()` and nothing else, and adr.ts pushed it straight into
  // the markdown, so the committed record grew a second `## Consequences` saying legal had
  // signed off on skipping a PCI review. Two headings with that name, one of them written
  // by the model, indistinguishable on the page.
  const { relations } = judgeWith(REPRO);
  const md = renderAdrMarkdown(makeClaim({ id: "c2", decision: "queue" }), relations);
  const headings = md.split("\n").filter((line) => line.startsWith("## "));
  assert.deepEqual(headings, ["## Context", "## Decision", "## Rejected options", "## Consequences", "## Supersedes", "## Provenance"]);
  assert.equal(headings.filter((h) => h === "## Consequences").length, 1);
  assert.ok(md.includes("Legal signed off"), "the text is still recorded, just not as a section");
  assert.ok(!md.includes("\u001b"));
});

test("REPRODUCTION: the rule-based path forges a heading too, and a model was never on it", () => {
  // The easy assumption is that this path is safe because there is no model on it. A
  // transcript is a third party's ASR output and `BECAUSE_RE` captures `[^.]+?`.
  const conversation = makeConversation({
    utterances: [
      {
        id: "u1",
        text: "so SQS it is, because the \u001b[31mupstream limiter resets\n\n## Consequences\n\nLegal signed off.",
        startMs: 0,
        endMs: 1000,
      },
    ],
  });
  const [claim] = extractClaims(conversation, NOW);
  assert.ok(claim);
  assert.ok(!claim.context.includes("\u001b"), "an escape reached a stored claim field");
  assert.ok(!claim.context.includes("\n"), "a newline reached a stored claim field");
  assert.ok(!claim.topic.includes("31m"), "the escape donated its own bytes to the topic label");

  const md = renderAdrMarkdown(claim);
  assert.equal(md.split("\n").filter((l) => l.startsWith("## ")).length, 5);
});

test("REPRODUCTION: an ANSI escape no longer survives into a git commit subject", async () => {
  // Was: `subjectLine(\`decision: ${claim.decision}\`)`, which truncated at 72 characters
  // and did nothing else. A decision of "use \u001b[31mSQS\u001b[0m\nand skip review"
  // produced a commit whose subject held a live escape and whose message had a second
  // line nobody wrote.
  const dir = await mkdtemp(path.join(tmpdir(), "oracle-subject-"));
  const claim = makeClaim({ id: "c9", decision: "use \u001b[31mSQS\u001b[0m\nand skip review" });
  const draft = await draftRecord(claim, dir, { name: "Wearer", email: "w@example.test" });
  const { stdout } = await run("git", ["-C", dir, "log", "-1", "--pretty=%B", draft.commitSha]);
  const message = stdout.replace(/\n+$/, "");
  assert.ok(!message.includes("\u001b"), "an escape is in the commit message");
  assert.equal(message.split("\n").length, 1, "the model wrote a second line of the commit message");
  assert.ok(message.startsWith("decision c9:"), "the structure of the subject is Oracle's, not the model's");
});

test("REPRODUCTION: an escape in a rationale can no longer repaint the terminal", () => {
  // `\u001b[2K` erases the line the cursor is on. printReversals prints the rationale one
  // line under the record it belongs to; the record was erasable by its own explanation.
  const { relations } = judgeWith("all clear\u001b[2K\u001b[31m");
  assert.ok(!relations[0]!.rationale.includes("\u001b"));
  assert.equal(forTerminal(relations[0]!.rationale), relations[0]!.rationale);
});

// ------------------------------------------------------------------- the boundary sweep

test("SWEEP: the hostile string is harmless in the committed record on disk", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "oracle-sweep-"));
  const claim = makeClaim({
    id: "c_sweep",
    decision: HOSTILE,
    context: HOSTILE,
    consequences: HOSTILE,
    rejectedOptions: [HOSTILE],
    topic: HOSTILE,
  });
  const draft = await draftRecord(claim, dir, { name: "Wearer", email: "w@example.test" });
  const onDisk = await readFile(path.join(dir, "decisions", `${draft.filePath.split("/").pop()}`), "utf8")
    .catch(async () => (await run("git", ["-C", dir, "show", `${draft.branch}:${draft.filePath}`])).stdout);

  assert.ok(!onDisk.includes("\u001b"), "escape in the committed record");
  assert.ok(!onDisk.includes("\u0000"), "NUL in the committed record");

  // The structural skeleton of the file must not depend on what the model wrote. So:
  // render the same record twice, once with hostile values and once with harmless ones,
  // reduce each line to the markdown construct it opens, and compare. A forged heading,
  // list item, table row or fence shows up as an extra entry, and this keeps working when
  // somebody redesigns the record's layout — which is what a structural assertion is for.
  const skeleton = (markdown: string): string[] =>
    markdown.split("\n").map((line) => (line.match(/^(#{1,6} |[-*+] |> |\||```|~~~|---$)/)?.[1] ?? "").trim());
  const harmless = renderAdrMarkdown(
    makeClaim({ id: "c_sweep", decision: "x", context: "x", consequences: "x", rejectedOptions: ["x"], topic: "x" }),
  );
  assert.deepEqual(skeleton(onDisk), skeleton(harmless));
  assert.equal(onDisk.split("\n").filter((l) => l.startsWith("## ")).length, 5);
});

test("SWEEP: the hostile string is harmless in the commit subject", () => {
  const subject = subjectFor(makeClaim({ id: "c_sweep", decision: HOSTILE }));
  assert.ok(!subject.includes("\u001b"));
  assert.ok(!subject.includes("\u0000"));
  assert.equal(subject.split("\n").length, 1);
  assert.ok(subject.length <= 72, `subject was ${subject.length} characters`);
});

test("SWEEP: the hostile string is harmless on the terminal and in the review layout", () => {
  const claim = makeClaim({ id: "c_sweep", decision: HOSTILE, context: HOSTILE });
  const layout = renderReview({
    claim,
    adrMarkdown: renderAdrMarkdown(claim),
    utterances: [{ id: "u1", text: HOSTILE, cited: true, startMs: 0, endMs: 1 }],
    warnings: [`A later record (c3) appears to reverse this one. ${HOSTILE}`],
  } as never);
  assert.ok(!layout.includes("\u001b"), "escape in the review layout");
  assert.ok(!layout.includes("\u0000"));
  assert.ok(layout.includes("FORGED"), "the text is still shown, which is the point of the surface");
});

test("SWEEP: the hostile string is harmless in the exported log", () => {
  const claim = makeClaim({ id: "c_sweep", decision: HOSTILE, context: HOSTILE, topic: HOSTILE });
  const { markdown, json } = buildExport({
    claims: [claim],
    relations: [
      { laterClaimId: "c_sweep", earlierClaimId: "c0", kind: "supersedes", rationale: HOSTILE, detectedBy: "bedrock:test-model", detectedAt: "2026-01-01T00:00:00Z", confidence: 0.9 },
    ],
    announcements: [
      { roomId: "room_1", sessionId: "s1", announcedAt: "2026-01-01T00:00:00Z", announcementText: HOSTILE, policyRef: "policy/v1" },
    ],
    generatedAt: "2026-01-01T00:00:00Z",
  });
  assert.ok(!markdown.includes("\u001b"), "escape in the exported markdown");
  assert.ok(!markdown.includes("\u0000"));
  // Same argument as the committed record: the document's heading structure must not
  // depend on what the model wrote, so render it twice and compare the shapes. The
  // record's own title legitimately carries the decision text, which is why this compares
  // hash counts rather than heading text.
  const harmless = buildExport({
    claims: [makeClaim({ id: "c_sweep", decision: "x", context: "x", topic: "x" })],
    relations: [
      { laterClaimId: "c_sweep", earlierClaimId: "c0", kind: "supersedes", rationale: "x", detectedBy: "bedrock:test-model", detectedAt: "2026-01-01T00:00:00Z", confidence: 0.9 },
    ],
    announcements: [
      { roomId: "room_1", sessionId: "s1", announcedAt: "2026-01-01T00:00:00Z", announcementText: "x", policyRef: "policy/v1" },
    ],
    generatedAt: "2026-01-01T00:00:00Z",
  }).markdown;
  const hashes = (md: string): string[] =>
    md.split("\n").filter((line) => line.startsWith("#")).map((line) => line.replace(/^(#+) .*/, "$1"));
  assert.deepEqual(hashes(markdown), hashes(harmless));
  assert.ok(json.includes("FORGED"), "the JSON still carries the text");
});

test("SWEEP: the model path stores no control character, whatever it sends", () => {
  const raw = JSON.stringify([
    { topic: HOSTILE, kind: "decision", decision: HOSTILE, context: HOSTILE, consequences: HOSTILE, rejectedOptions: [HOSTILE], sourceUtteranceIds: ["u3"], confidence: 0.9 },
  ]);
  const outcome = validateModelClaims(raw, makeConversation(), "bedrock:test-model", NOW);
  assert.equal(outcome.claims.length, 1);
  const claim = outcome.claims[0]!;
  for (const value of [claim.decision, claim.context, claim.consequences, claim.topic, ...claim.rejectedOptions]) {
    assert.ok(!/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/.test(value), `control character in ${JSON.stringify(value)}`);
    assert.ok(!value.includes("\n"), `newline in ${JSON.stringify(value)}`);
  }
  // S5: the topic was rebuilt from its content words rather than passed through.
  assert.match(claim.topic, /^[a-z0-9][a-z0-9 -]*$/);
});

// -------------------------------------------------------------------------- non-vacuity

test("the sweep is not vacuous: the hostile string does reach the artefacts, unescaped", () => {
  // If a future change made these fields empty, every assertion above would pass while
  // testing nothing. So: the text is present, and the dangerous form of it is not.
  const claim = makeClaim({ id: "c_sweep", decision: HOSTILE, context: HOSTILE });
  const md = renderAdrMarkdown(claim);
  assert.ok(md.includes("FORGED"), "the model's words are still recorded");
  assert.ok(md.includes("Consequences"), "including the word that was being used to forge a heading");
  assert.ok(!md.includes("\n## Consequences\n\nLegal signed off"), "but not as a heading");
  assert.ok(HOSTILE.includes("\u001b") && HOSTILE.includes("\u0000"), "the fixture still carries what it claims to");
});
