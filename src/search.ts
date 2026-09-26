/**
 * Search: relevance and recency together, and a word about what happened
 * since.
 *
 * BM25 alone answers "which record uses these words". That is the wrong
 * question for a decision log, where the same subject is argued more than once
 * and the newest argument is usually the one that binds. Ask "why does the
 * cron run at three am" against a log that holds both the March conversation
 * and the June one that moved it, and a pure keyword ranking hands back the
 * March record with a straight face.
 *
 * So the score is three factors a reviewer can read separately:
 *
 *   score = relevance x recency x supersession
 *
 * - relevance is BM25, matching Bee's own primary search mode (BM25 over
 *   conversations, daily summaries and facts; Bee's neural mode is separate and
 *   Oracle does not claim it).
 * - recency is an exponential decay with a half-life, floored at 0.45 so age
 *   alone can never bury a record that is plainly the right answer.
 * - supersession multiplies by 0.4 when a later record has reversed this one.
 *   Reversed records stay findable: the old reasoning is still why the code
 *   looked that way for three months, and hiding it is how the log starts
 *   lying again.
 *
 * Every hit carries its own three factors, so the ranking is inspectable
 * rather than a number to be trusted.
 */
import type { Claim } from "./types.ts";

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function claimDocument(claim: Claim): string {
  return [claim.topic, claim.context, claim.decision, claim.rejectedOptions.join(" "), claim.consequences].join(" ");
}

const K1 = 1.5;
const B = 0.75;
const DEFAULT_HALF_LIFE_DAYS = 120;
const RECENCY_FLOOR = 0.45;
const SUPERSEDED_MULTIPLIER = 0.4;
const MS_PER_DAY = 86_400_000;

export interface SearchOptions {
  readonly now?: Date;
  readonly halfLifeDays?: number;
  readonly supersededIds?: ReadonlySet<string>;
  readonly limit?: number;
}

export interface SearchHit {
  readonly claim: Claim;
  readonly score: number;
  /** BM25 on its own, before time is considered. */
  readonly relevance: number;
  readonly recencyWeight: number;
  readonly supersededPenalty: number;
  readonly ageDays: number;
  readonly superseded: boolean;
}

export function recencyWeight(ageDays: number, halfLifeDays = DEFAULT_HALF_LIFE_DAYS): number {
  const age = Math.max(ageDays, 0);
  const decay = Math.pow(2, -age / halfLifeDays);
  return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * decay;
}

/** BM25 scores for a query across a claim set. Exported so a test can pin the
 * relevance half of the ranking without the clock in the way. */
export function relevanceScores(claims: readonly Claim[], query: string): Map<string, number> {
  const docs = claims.map((claim) => ({ claim, tokens: tokenize(claimDocument(claim)) }));
  const avgLen = docs.reduce((sum, d) => sum + d.tokens.length, 0) / (docs.length || 1);
  const queryTerms = tokenize(query);

  const df = new Map<string, number>();
  for (const term of new Set(queryTerms)) {
    df.set(term, docs.filter((d) => d.tokens.includes(term)).length);
  }

  const out = new Map<string, number>();
  for (const { claim, tokens } of docs) {
    let score = 0;
    for (const term of queryTerms) {
      const n = df.get(term) ?? 0;
      if (n === 0) continue;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      const tf = tokens.filter((t) => t === term).length;
      const denom = tf + K1 * (1 - B + (B * tokens.length) / (avgLen || 1));
      score += idf * ((tf * (K1 + 1)) / (denom || 1));
    }
    out.set(claim.id, score);
  }
  return out;
}

export function searchClaims(claims: readonly Claim[], query: string, options: SearchOptions = {}): readonly SearchHit[] {
  const now = options.now ?? new Date();
  const halfLifeDays = options.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS;
  const superseded = options.supersededIds ?? new Set<string>();
  const relevance = relevanceScores(claims, query);

  const hits: SearchHit[] = [];
  for (const claim of claims) {
    const base = relevance.get(claim.id) ?? 0;
    if (base <= 0) continue;
    const ageMs = now.getTime() - new Date(claim.provenance.timestamp).getTime();
    const ageDays = ageMs / MS_PER_DAY;
    const recency = recencyWeight(ageDays, halfLifeDays);
    const isSuperseded = superseded.has(claim.id);
    const penalty = isSuperseded ? SUPERSEDED_MULTIPLIER : 1;
    hits.push({
      claim,
      score: base * recency * penalty,
      relevance: base,
      recencyWeight: recency,
      supersededPenalty: penalty,
      ageDays: Math.round(ageDays * 10) / 10,
      superseded: isSuperseded,
    });
  }

  hits.sort((a, b) => b.score - a.score || b.claim.provenance.timestamp.localeCompare(a.claim.provenance.timestamp));
  return options.limit ? hits.slice(0, options.limit) : hits;
}
