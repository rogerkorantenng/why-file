/**
 * The shared adversarial corpus, §8.
 *
 * `fixtures/adversarial.jsonl` is copied byte for byte across the apps rather than
 * imported, because they do not share a package. Keeping the rows identical is the point:
 * a defect found in one app gets checked in all of them.
 *
 * Oracle claims only a few of these rows. Most of the corpus is about clinical advice,
 * carer no-shows and statutory records, which are other apps' hazards. Each row Oracle
 * does not claim carries a reason below, and the reasons are two different kinds — "not a
 * hazard this app has" and "a hazard this app has and does not yet guard". The second kind
 * is a finding, and saying so here is the only thing that stops it being forgotten.
 *
 * The rule that makes this file worth anything: **do not fix a failing row by adding its
 * text to a list.** A failing row means the field needs a stronger shape from §1, or a
 * rule that matches the class rather than the sentence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { findAttributionPhrase } from "../src/claims/attribution-guard.ts";
import { renderAdrMarkdown } from "../src/adr.ts";
import { subjectFor } from "../src/git-pr.ts";
import { forTerminal } from "../src/guard/destination.ts";
import { makeClaim } from "./helpers.ts";

interface Row {
  readonly id: string;
  readonly text: string;
  readonly expect: "blocked" | "clean";
  readonly why: string;
  readonly tags: readonly string[];
}

const rows: Row[] = readFileSync(new URL("./fixtures/adversarial.jsonl", import.meta.url), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Row);

/**
 * Rows Oracle does not claim, each with the reason it does not.
 *
 * Marked `GAP` where the hazard is real for this app and the guard does not cover it, so
 * a reader can tell the difference between a row about somebody else's product and a row
 * that is a to-do.
 */
const NOT_OURS: Record<string, string> = {
  "apos-01": "no carer-attendance claim; Oracle records engineering decisions",
  "apos-02": "no carer-attendance claim either; the possessive hides a job title Oracle never prints",
  "para-01": "no grounded-number promise: Oracle quotes utterance ids, it does not count events",
  "para-02": "no delivery or attendance claim",
  "advice-01": "no clinical field",
  "advice-02": "no clinical field",
  "advice-03": "no clinical field",
  "legal-01": "no statutory field",
  "pii-01":
    "GAP. A physical description identifies a speaker as surely as a name does, and the " +
    "attribution guard only recognises a subject attached to a verb of saying. Adding " +
    "'red jacket' to a list would be the wrong fix; the right one is a span design for " +
    "the prose fields (§1 S3), which is larger than this change.",
  "health-01": "no health claim",
  "health-02": "no health claim",
  "health-03": "no health claim",
  "inject-02": "no voice path and no directive surface",
  "clean-02": "the control for a 'scan'/'dose' denylist Oracle does not have",
  "clean-03":
    "'She said' is attribution in Oracle's terms, so this row is correctly blocked here " +
    "and correctly clean elsewhere. The corpus row belongs to the other apps.",
};

/**
 * What "blocked" means for Oracle: either the attribution guard refuses it, or it cannot
 * reach a destination in a form that does anything there. Both are real answers and they
 * are checked separately, because a row that only passes the second test is telling you
 * the text is still being recorded — which is often right.
 */
function refusedByAttribution(text: string): boolean {
  return findAttributionPhrase(text) !== null;
}

function inertAtEveryDestination(text: string): boolean {
  const claim = makeClaim({ id: "c_corpus", decision: text, context: text, consequences: text });
  const md = renderAdrMarkdown(claim);
  const subject = subjectFor(claim);
  const terminal = forTerminal(text);
  const bodyHeadings = md.split("\n").filter((l) => l.startsWith("## "));
  return (
    bodyHeadings.length === 5 &&
    !md.includes("\u001b") &&
    !subject.includes("\u001b") &&
    subject.split("\n").length === 1 &&
    !terminal.includes("\u001b")
  );
}

for (const row of rows) {
  test(`corpus ${row.id}: ${row.why}`, { skip: NOT_OURS[row.id] }, () => {
    if (row.expect === "blocked") {
      assert.ok(
        refusedByAttribution(row.text) || inertAtEveryDestination(row.text),
        `${row.id} passed every guard Oracle has: ${row.why}`,
      );
    } else {
      assert.equal(findAttributionPhrase(row.text), null, `${row.id} was a false positive: ${row.why}`);
      assert.ok(inertAtEveryDestination(row.text));
    }
  });
}

test("the corpus is wired to something, and the rows Oracle skips are declared", () => {
  // Non-vacuity, §7 class 6. Two companions for the assertions above: proof the file was
  // actually read, and proof every skip has a stated reason rather than a silent absence.
  assert.equal(rows.length, 19, "the corpus shrank; rows are added, never removed");
  assert.ok(rows.some((r) => r.expect === "clean"), "a corpus with no controls measures nothing");
  for (const id of Object.keys(NOT_OURS)) {
    assert.ok(rows.some((r) => r.id === id), `${id} is skipped but is not in the corpus`);
    assert.ok(NOT_OURS[id]!.length > 10, `${id} is skipped without a reason worth reading`);
  }
  const claimed = rows.filter((r) => !NOT_OURS[r.id]);
  assert.ok(claimed.length >= 4, "Oracle claims too few rows for this file to be doing work");
  assert.ok(claimed.some((r) => r.expect === "clean"), "every claimed row is a blocked one, so nothing proves the guard is narrow");
});

test("a spelling cannot change the guard's answer, which is what the unicode rows are for", () => {
  // uni-02 would otherwise pass for a weak reason — a zero-width space forges no heading,
  // so the destination half of `blocked` is satisfied without the guard doing anything.
  // The property that matters is that the guard reaches the same verdict either way.
  const plain = "The carer did not come on Wednesday. She said so herself.";
  const hidden = plain.replace(/ /, "\u200b ").replace("not", "n\u043et");
  assert.equal(findAttributionPhrase(plain) === null, false, "the control sentence must trip something");
  assert.ok(findAttributionPhrase(hidden) !== null, "the same sentence, respelt, walked past the guard");
});

test("the rows Oracle does claim are the injection and unicode ones, and they are blocked", () => {
  // Stated explicitly so this cannot quietly become a file of nineteen skips.
  const claimed = rows.filter((r) => !NOT_OURS[r.id]).map((r) => r.id).sort();
  assert.deepEqual(claimed, ["clean-01", "inject-01", "uni-01", "uni-02"].sort());
});
