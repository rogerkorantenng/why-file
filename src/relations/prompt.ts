/**
 * What the model is asked about a pair, and how the pair is shown to it.
 *
 * "Be strict" is in the prompt because the deterministic pairing already
 * guarantees shared vocabulary; without that instruction the model treats
 * overlap as evidence and calls unrelated decisions a reversal. The house rule
 * about naming nobody is repeated here even though the records never carry a
 * name, because a rationale is fresh prose and fresh prose is where one would
 * appear.
 */
import type { Claim } from "../types.ts";
import type { ClaimPair } from "./pairs.ts";

export const RELATION_SYSTEM_PROMPT = `You compare pairs of engineering decisions taken at different times and say whether the later one reverses the earlier one.

For each pair, answer with one of:
  "supersedes" - the later decision settles the same question a different way, so the earlier record is now wrong
  "refines"    - the later decision keeps the earlier one and adds a condition, a limit, or a reason
  "unrelated"  - they are about different questions, or the later one does not touch the earlier one

Be strict. Two decisions that merely share vocabulary are unrelated. A reversal has to be about the same question.

These records name nobody, and neither do you. Never write a name, a pronoun subject with a verb of saying, or the word Unknown. Write about the subject.

Reply with JSON only, an array with one object per pair:
  pair: the pair label given below
  relation: "supersedes" | "refines" | "unrelated"
  rationale: one sentence about the subject, saying what changed
  confidence: 0 to 1`;

export function renderPairs(pairs: readonly ClaimPair[]): string {
  return pairs
    .map((p, i) => {
      const render = (c: Claim, when: string): string =>
        [
          `  ${when} (${c.provenance.timestamp}):`,
          `    topic: ${c.topic}`,
          `    decision: ${c.decision || "(none stated)"}`,
          `    rejected: ${c.rejectedOptions.join(", ") || "(none)"}`,
          `    context: ${c.context || "(none stated)"}`,
          `    consequences: ${c.consequences || "(none stated)"}`,
        ].join("\n");
      return [`P${i + 1}`, render(p.earlier, "earlier"), render(p.later, "later")].join("\n");
    })
    .join("\n\n");
}
