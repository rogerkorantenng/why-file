/**
 * Reading the model's answer about each pair.
 *
 * Every row is matched back to the pair it was asked about by label, so a
 * model that returns them out of order, invents a label, or answers a pair
 * that was never sent cannot attach a finding to the wrong two records. An
 * answer of "unrelated" is simply absent from the output: no relation is
 * recorded, rather than a relation recorded as nothing.
 *
 * Rationales are fresh model prose, which is the one place in this pipeline a
 * name could appear. They go through the same attribution guard as claims, and
 * a rationale that trips it takes its relation down with it.
 */
import { AttributionViolation, assertNoAttribution } from "../claims/attribution-guard.ts";
import { asPhrase } from "../claims/model-fields.ts";
import type { ClaimPair } from "./pairs.ts";
import type { ClaimRelation, RelationKind } from "../types.ts";

function parseRelationKind(value: unknown): RelationKind | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "supersedes") return "supersedes";
  if (text === "refines") return "refines";
  return null;
}

export interface Judgements {
  readonly relations: ClaimRelation[];
  readonly attributionRejections: string[];
}

export function readJudgements(
  parsed: readonly unknown[],
  pairs: readonly ClaimPair[],
  detectedBy: string,
  now: () => Date,
): Judgements {
  const relations: ClaimRelation[] = [];
  const attributionRejections: string[] = [];

  for (const item of parsed) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    try {
      assertNoAttribution(item, detectedBy);
    } catch (err: unknown) {
      if (!(err instanceof AttributionViolation)) throw err;
      // Oracle's words for which rule fired, never the model's sentence. See §6.
      attributionRejections.push(err.publicReason);
      continue;
    }

    const row = item as Record<string, unknown>;
    const kind = parseRelationKind(row["relation"]);
    if (kind === null) continue;
    const label = typeof row["pair"] === "string" ? row["pair"].trim().toUpperCase() : "";
    const pair = pairs[Number(label.replace(/^P/, "")) - 1];
    if (!pair) continue;
    const confidence = typeof row["confidence"] === "number" ? row["confidence"] : 0.5;

    relations.push({
      laterClaimId: pair.later.id,
      earlierClaimId: pair.earlier.id,
      kind,
      // `.trim()` was the only thing standing here, and a rationale is rendered into the
      // ADR body of a record committed to git, into the exported log, into the review
      // surface and onto a terminal. A rationale of
      // "use SQS\n\n## Consequences\n\nLegal signed off on skipping the PCI review."
      // put a second, forged `## Consequences` into a committed decision record. The same
      // ingest floor every claim field crosses now applies here; each of those four
      // destinations still escapes for itself on the way out.
      rationale: typeof row["rationale"] === "string" ? asPhrase(row["rationale"]) : "",
      detectedBy,
      detectedAt: now().toISOString(),
      confidence: Math.min(1, Math.max(0, confidence)),
    });
  }

  return { relations, attributionRejections };
}
