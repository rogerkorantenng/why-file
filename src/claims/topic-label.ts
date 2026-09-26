/**
 * A short subject label for a claim, computed without a model.
 *
 * Used by the deterministic extractor, and used to decide which pairs of
 * claims are worth comparing for a contradiction (relations.ts) before any
 * model is asked. Cheap, boring, and it labels a subject, never a person.
 *
 * A topic is not free text, and `safeTopic` at the bottom is the reason. It becomes a
 * `Topic:` line in a record committed to git and a grouping key the reversal sweep runs
 * on, and the set of subjects a conversation can be about is open, so it cannot be an
 * enum. That puts it under this project's shared guard-design standard: validate against a
 * closed pattern, then **re-render from the parsed parts** rather than passing the
 * matched string through. `topicLabel` has always worked that way by accident — it
 * rebuilds a label out of tokens it matched. The model path did not: it took the model's
 * `topic` string as written.
 */
import { stripControls, stripInvisible } from "../guard/destination.ts";

const STOPWORDS = new Set([
  "a","about","actually","after","again","all","also","and","any","are","as","at","back","be","because","been",
  "before","being","but","by","can","could","did","do","does","doing","done","dont","down","each","even","ever",
  "every","for","from","get","gets","getting","go","going","got","had","has","have","he","her","here","him","his",
  "how","i","if","in","into","is","it","its","just","keep","kind","know","like","little","ll","look","lot","m",
  "make","makes","many","matter","matters","maybe","me","mean","might","more","most","much","my","need","no","not",
  "now","of","off","on","once","one","only","or","other","our","out","over","own","really","right","s","said","same",
  "say","see","should","so","some","still","stuff","such","sure","t","take","than","that","thats","the","their",
  "them","then","there","these","they","thing","things","think","this","those","though","three","through","to","too",
  "try","tried","two","up","us","use","used","ve","very","want","was","way","we","well","were","what","when","where",
  "which","while","who","why","will","with","without","wont","would","yeah","yes","yet","you","your",
]);

/** Top content words by frequency, then by first appearance, joined. */
export function topicLabel(text: string, maxTerms = 3): string {
  const counts = new Map<string, { n: number; first: number }>();
  // Controls first, or an escape sequence donates its own bytes to the label: a fragment
  // carrying `\u001b[31mupstream` was labelled "sqs 31mupstream limiter".
  const tokens = stripInvisible(stripControls(text, false)).toLowerCase().match(/[a-z0-9-]+/g) ?? [];
  tokens.forEach((token, i) => {
    if (token.length < 3 || STOPWORDS.has(token)) return;
    const entry = counts.get(token);
    if (entry) entry.n += 1;
    else counts.set(token, { n: 1, first: i });
  });
  const ranked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first);
  const label = ranked.slice(0, maxTerms).map(([token]) => token).join(" ");
  return label || "unlabelled";
}

/** Content words of a label or claim, for overlap tests. */
export function topicTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of text.toLowerCase().match(/[a-z0-9-]+/g) ?? []) {
    if (token.length >= 3 && !STOPWORDS.has(token)) out.add(token);
  }
  return out;
}

/** The pattern a topic label is allowed to have: lower-case words and digits, separated
 * by single spaces or hyphens. Nothing in it can open a markdown block, name a path, or
 * carry an escape. */
const TOPIC_RE = /^[a-z0-9][a-z0-9 -]{0,58}$/;

/**
 * A topic the model proposed, re-rendered from its parts.
 *
 * Not "escape the model's string": take the content words out of it, throw the rest away,
 * and build the label ourselves. Anything that does not survive that was not a topic.
 * An empty result is `"unlabelled"`, which is what the model path already used for a
 * missing topic, so nothing downstream learns a new case.
 */
export function safeTopic(raw: string, maxTerms = 4): string {
  const tokens = (stripInvisible(stripControls(raw, false)).toLowerCase().match(/[a-z0-9-]+/g) ?? [])
    .filter((token) => token.length >= 2 && token.length <= 24)
    .slice(0, maxTerms);
  const label = tokens.join(" ");
  return TOPIC_RE.test(label) ? label : "unlabelled";
}

export function topicOverlap(a: string, b: string): number {
  const ta = topicTokens(a);
  const tb = topicTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared += 1;
  return shared / Math.min(ta.size, tb.size);
}
