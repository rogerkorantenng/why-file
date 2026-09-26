/**
 * Normalisation, and the attribution guard tested against spellings it was not written
 * from.
 *
 * The point of §7 of the standard is that a guard test drawn from the guard's own list
 * proves the regex matches a string written to match it. So the sentences below were
 * written first and the guard was run against them afterwards, and the mutation table at
 * the bottom generates twenty-odd spellings of each blocked sentence mechanically. The
 * ones that fail are the guard's real perimeter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { normalise, prepare } from "../src/guard/normalise.ts";
import { findAttributionPhrase, findBannedKeys } from "../src/claims/attribution-guard.ts";

test("the five spellings of one word all reach the same comparison", () => {
  // §2's worked example, run here so a port of this module cannot drift from it.
  for (const spelling of [
    "She's not recorded at the front door at 8.",
    "She’s not recorded at the front door at 8.",
    "She' s not recorded at the front door at 8.",
    "S​he's not recorded",
    "Ѕhe's not recorded",
  ]) {
    assert.ok(prepare(spelling).hasWord("she"), `missed "she" in ${JSON.stringify(spelling)}`);
  }
  assert.ok(prepare("The carer’s booked time shows nothing").hasWord("carer's"));
  assert.ok(prepare("did' not come").hasPhrase("did not"));
  assert.ok(prepare("The  carer   did  not   come").hasPhrase("did not"));
  assert.ok(prepare("non-attendance").hasWord("attendance"));
});

test("normalising does not invent a match that was not there", () => {
  // The paired false positive. Without it the rule above reads as "match anything".
  assert.ok(!prepare("o'clock is fine").hasWord("she"));
  assert.ok(!prepare("the deployment came and went").hasPhrase("did not"));
});

test("normalising is idempotent, so a second pass cannot change a verdict", () => {
  for (const s of ["", "  ", "a", "S​he’s not", "АБВ", "x\ny", "café", "﻿hi"]) {
    assert.equal(normalise(normalise(s)), normalise(s), JSON.stringify(s));
  }
});

test("no invisible character can hide a word from the guard", () => {
  const hidden = [..."she said"].map((c) => `${c}​`).join("");
  assert.ok(prepare(`the record notes that ${hidden} nothing`).hasPhrase("she said"));
});

test("a key is model output too, and four spellings of speaker are one key", () => {
  for (const key of ["speaker", "Speaker", "SPEAKER", "ѕpeaker", "spea​ker", "speaker "]) {
    const found = findBannedKeys({ [key]: "Priya" });
    assert.ok(found, `key ${JSON.stringify(key)} was not recognised`);
    assert.equal(found.bannedKey, "speaker");
  }
  // Paired false positive: a legitimate field that merely contains the letters.
  assert.equal(findBannedKeys({ speakerphone_policy: "off" }), null);
  assert.equal(findBannedKeys({ decision: "use SQS" }), null);
});

// ----------------------------------------------------------- the generated variant table

const MUTATIONS: ReadonlyArray<readonly [string, (s: string) => string]> = [
  ["plain", (s) => s],
  ["curly", (s) => s.replace(/'/g, "’")],
  ["spaced apostrophe", (s) => s.replace(/'/g, "' ")],
  ["zero-width", (s) => s.replace(/ /, "​ ")],
  ["double space", (s) => s.replace(/ /g, "  ")],
  ["upper", (s) => s.toUpperCase()],
  ["non-breaking space", (s) => s.replace(/ /g, " ")],
  ["soft hyphen", (s) => s.replace(/ /, "­ ")],
  ["combining accent", (s) => s.replace(/e/, "é")],
];

/** Written before the guard was read, in the register a model writes in. */
const BLOCKED = [
  "she said the retry budget was already agreed",
  "they suggested the cron move to three in the morning",
  "he objected that the config store was the wrong place",
  "according to Priya the PCI review can wait",
];

for (const sentence of BLOCKED) {
  for (const [name, mutate] of MUTATIONS) {
    test(`the attribution guard sees through "${name}" in "${sentence.slice(0, 32)}…"`, () => {
      assert.ok(findAttributionPhrase(mutate(sentence)) !== null);
    });
  }
}

test("the guard stays narrow, or the product becomes a blank page with an explanation", () => {
  // Every one of these is ordinary decision prose. A guard that rejects them has stopped
  // being a guard and started being an outage.
  for (const clean of [
    "we decided to use SQS because the ops burden on RabbitMQ was wrong",
    "the team agreed the cron should run at three",
    "according to the runbook the limiter resets on a ten second window",
    "it was said in the room that the retry budget is already spent",
    "nobody proposed an alternative",
  ]) {
    assert.equal(findAttributionPhrase(clean), null, clean);
  }
});

test("a script the guard cannot read is refused rather than passed", () => {
  // The rule the lookalike map cannot satisfy: `dıd` survives every fold table, and so
  // will the next one. The allowlist answer is to refuse the letter, not extend the map.
  const dotless = "she saıd the review can wait";
  assert.match(findAttributionPhrase(dotless) ?? "", /letters this guard cannot read/);
});
