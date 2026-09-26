import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { renderAdrMarkdown } from "../src/adr.ts";
import { draftRecord } from "../src/git-pr.ts";
import type { Claim } from "../src/types.ts";

const run = promisify(execFile);

let repoDir: string;

before(async () => {
  repoDir = await mkdtemp(path.join(os.tmpdir(), "oracle-git-test-"));
});

after(async () => {
  await rm(repoDir, { recursive: true, force: true });
});

const claim: Claim = {
  id: "claim_test_1",
  kind: "decision",
  topic: "database for billing reconciliation",
  extractor: "bedrock:test-model",
  confidence: 0.9,
  context: "ad hoc joins across six tables",
  decision: "postgres",
  rejectedOptions: ["DynamoDB"],
  consequences: "we revisit if reconciliation moves off the join-heavy path",
  provenance: { conversationId: "conv_test", timestamp: "2026-06-09T10:02:14Z", sourceUtteranceIds: ["u1", "u9"] },
  extractedAt: "2026-06-09T10:11:55Z",
};

test("renders an ADR with provenance and no name, ever", () => {
  const md = renderAdrMarkdown(claim);
  assert.match(md, /## Context/);
  assert.match(md, /## Decision/);
  assert.match(md, /## Rejected options/);
  assert.match(md, /## Consequences/);
  assert.match(md, /conversation conv_test, 2026-06-09T10:02:14Z/);
  // The footer disclaims speaker attribution in prose ("names no speaker") —
  // that's allowed. What must never appear is Bee's own placeholder name or
  // an actual "Speaker:" attribution line.
  assert.doesNotMatch(md, /Unknown/);
  assert.doesNotMatch(md, /Speaker:/i);
});

test("the record says which extractor produced it, so a reviewer can weigh it", () => {
  const md = renderAdrMarkdown(claim);
  // The three facts moved into a table when the record was redesigned; they are still
  // the three facts, and an identifier still renders as itself rather than escaped.
  assert.match(md, /\| Extracted by \| bedrock:test-model, confidence 0\.90 \|/);
  assert.match(md, /\| Subject \| database for billing reconciliation \|/);
  assert.match(md, /utterances u1, u9/);
});

test("a record a later conversation reversed carries that on its own face", () => {
  const md = renderAdrMarkdown(claim, [
    {
      laterClaimId: "claim_test_9",
      earlierClaimId: "claim_test_1",
      kind: "supersedes",
      rationale: "The store moved to a managed service.",
      detectedBy: "bedrock:test-model",
      detectedAt: "2026-09-22T00:00:00Z",
      confidence: 0.9,
    },
  ]);
  assert.match(md, /## Superseded/);
  assert.match(md, /claim_test_9/);
  assert.match(md, /The store moved to a managed service\./);
});

test("draftRecord opens a real local git branch and commit, never touching a remote", async () => {
  const record = await draftRecord(claim, repoDir, { name: "J. Wearer", email: "wearer@example.com" });

  assert.equal(record.branch, "why-file/claim_test_1");
  assert.equal(record.filePath, path.join("decisions", "claim_test_1.md"));
  assert.match(record.commitSha, /^[0-9a-f]{40}$/);
  assert.equal(record.commitAuthor, "J. Wearer <wearer@example.com>");

  const { stdout: remotes } = await run("git", ["-C", repoDir, "remote"]);
  assert.equal(remotes.trim(), "", "a demo repo must never have a remote configured");

  const { stdout: authorLine } = await run("git", ["-C", repoDir, "show", "-s", "--format=%an <%ae>", record.commitSha]);
  assert.equal(authorLine.trim(), "J. Wearer <wearer@example.com>");

  const { stdout: branchesOut } = await run("git", ["-C", repoDir, "branch", "--list", "why-file/claim_test_1"]);
  assert.match(branchesOut, /why-file\/claim_test_1/);

  const { stdout: currentBranch } = await run("git", ["-C", repoDir, "branch", "--show-current"]);
  assert.equal(currentBranch.trim(), "main", "draftRecord must leave the working tree back on main");
});

test("draftRecord is repeatable against the same repo for a different claim", async () => {
  const second: Claim = { ...claim, id: "claim_test_2", decision: "dynamo-lite" };
  const record = await draftRecord(second, repoDir, { name: "J. Wearer", email: "wearer@example.com" });
  assert.equal(record.branch, "why-file/claim_test_2");
});
