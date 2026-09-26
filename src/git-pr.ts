/**
 * "Opens a pull request." Oracle never pushes to a remote or calls a
 * code-hosting API (out of scope, per the build brief's hard rule: do not push
 * to GitHub). Instead this writes a real git branch and commit against a
 * scratch repository, inspectable with `git log` / `git diff`, that a real
 * workflow would push and open a PR from.
 *
 * The commit author is the wearer's own configured git identity — never
 * inferred from the transcript, because nothing past bee/client.ts carries a
 * speaker at all. Reviewers (who is asked to approve) are out of scope for
 * this build too: in a real deployment they would come from a room roster of
 * known git handles (paired devices/badges), the same source consent.ts uses
 * to decide whether to accept a segment — never from a name the transcript
 * claims to have heard.
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { renderAdrMarkdown, type Fragment } from "./adr.ts";
import { forGitSubject, forRecordId } from "./guard/destination.ts";
import type { Claim, ClaimKind, ClaimRelation, DraftRecord } from "./types.ts";

const run = promisify(execFile);

export interface GitIdentity {
  readonly name: string;
  readonly email: string;
}

async function git(repoDir: string, args: string[], identity?: GitIdentity): Promise<string> {
  const env = identity
    ? { ...process.env, GIT_AUTHOR_NAME: identity.name, GIT_AUTHOR_EMAIL: identity.email,
        GIT_COMMITTER_NAME: identity.name, GIT_COMMITTER_EMAIL: identity.email }
    : process.env;
  const { stdout } = await run("git", ["-C", repoDir, ...args], { env });
  return stdout.trim();
}

/** Creates a fresh scratch repo if `repoDir` is not one yet. Idempotent. */
export async function ensureDemoRepo(repoDir: string): Promise<void> {
  await mkdir(repoDir, { recursive: true });
  try {
    await git(repoDir, ["rev-parse", "--git-dir"]);
  } catch {
    await git(repoDir, ["init", "-q", "-b", "main"]);
    await writeFile(path.join(repoDir, "README.md"), "# Why File demo repository\n\nScratch repo for local ADR drafts. Never pushed.\n");
    await git(repoDir, ["add", "README.md"]);
    await git(repoDir, ["commit", "-q", "-m", "init demo repo"], { name: "Why File Demo", email: "why-file-demo@localhost" });
  }
}

const SUBJECT_MAX = 72;

/** Git's own convention: one short line. Truncated on a word where one is near. */
function subjectLine(text: string, max = SUBJECT_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max - 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const KINDS: readonly ClaimKind[] = ["decision", "constraint", "rejected-option"];

/**
 * The commit subject, composed by Oracle rather than by the model.
 *
 * This used to be `subjectLine(\`decision: ${claim.decision}\`)`, and the comment above it
 * said the fields were "already collapsed to one line by asPhrase, so nothing here can
 * forge a second commit-message paragraph". That was true of one of the three paths that
 * produce a Claim. The rule-based extractor reads its fields straight out of the
 * transcript, and a transcript is a third party's ASR output: a claim whose decision was
 * `"use \u001b[31mSQS\u001b[0m\nand skip review"` produced a commit whose subject carried
 * a live ANSI escape and whose message had a second line nobody wrote.
 *
 * The shape is the fix, not the escaping. Everything structural in the subject now comes
 * from a field Oracle validated: the kind is a member of a closed set, and the record id
 * is allowlisted by `forRecordId`. The model's phrase is still there — dropping it would
 * make `git log --oneline` useless, and the fix for a guard is a better guard, not a
 * smaller product — but it is the last element, it is flattened and capped by
 * `forGitSubject`, and the subject is legible without it. Escaping is the last line here,
 * never the argument.
 */
export function subjectFor(claim: Claim): string {
  const kind = KINDS.includes(claim.kind) ? claim.kind : "record";
  const recordId = forRecordId(claim.id);
  const prefix = `${kind} ${recordId}`;
  const room = SUBJECT_MAX - prefix.length - 2;
  const phrase = claim.decision || claim.rejectedOptions[0] || "";
  if (!phrase.trim() || room < 12) return subjectLine(prefix);
  const flat = forGitSubject(phrase, room * 4);
  return forGitSubject(`${prefix}: ${subjectLine(flat, room)}`);
}

export async function draftRecord(
  claim: Claim,
  repoDir: string,
  wearer: GitIdentity,
  relations: readonly ClaimRelation[] = [],
  fragments: readonly Fragment[] = [],
): Promise<DraftRecord> {
  await ensureDemoRepo(repoDir);
  // A claim id is built from Bee's conversation id, which is a string from somebody
  // else's API. Here it becomes two things git cares about — a ref name and a path under
  // `decisions/` — so it crosses the allowlist first. git's refname rules happen to
  // reject `..` today, which meant the traversal was blocked one layer below the code
  // that should have been deciding it. Now it is a decision.
  const recordId = forRecordId(claim.id);
  // Branch namespace matches the product's on-screen name (Why File), not the
  // pipeline's internal `oracle` slug -- this is a git ref a viewer reads on camera
  // (see video/RENAME-ORACLE.md), not an internal path.
  const branch = `why-file/${recordId}`;
  await git(repoDir, ["checkout", "-q", "-B", branch, "main"]);

  const relPath = path.join("decisions", `${recordId}.md`);
  const body = renderAdrMarkdown(claim, relations, fragments);
  await mkdir(path.join(repoDir, "decisions"), { recursive: true });
  await writeFile(path.join(repoDir, relPath), body);

  await git(repoDir, ["add", relPath]);
  const title = subjectFor(claim);
  await git(repoDir, ["commit", "-q", "-m", title], wearer);
  const commitSha = await git(repoDir, ["rev-parse", "HEAD"]);
  await git(repoDir, ["checkout", "-q", "main"]);

  return { claimId: claim.id, branch, filePath: relPath, commitSha, commitAuthor: `${wearer.name} <${wearer.email}>`, title, body };
}
