/**
 * The constraint that outranks every feature in this app: Oracle never states
 * who said anything.
 *
 * Up to this point that was guaranteed structurally. `stripSpeakers()` in
 * bee/client.ts deletes the only field that ever held a speaker label, and no
 * type downstream has one, so a rule-based extractor working on `Utterance[]`
 * cannot name anyone: it has nothing to name them from.
 *
 * A language model changes the threat. It sees only speaker-less text, so it
 * cannot know a real name, but it can invent one, echo Bee's own "Unknown"
 * label, or return a field called `speaker` because that is what transcripts
 * usually have. None of those are attribution in the legal sense. All of them
 * would put something that reads like attribution in front of a reader, which
 * is the thing SPEC.md says Oracle does not do.
 *
 * So model output is checked before it becomes a Claim, and anything that
 * trips the check is dropped rather than rewritten. Dropping is the safe
 * failure: a claim Oracle did not record costs a user one question. A claim
 * that names somebody costs the product its argument.
 *
 * Two things this file used to get wrong, both against this project's shared
 * guard-design standard:
 *
 * The normalisation rule — it matched raw model output against its lists, so the model chose the bytes.
 * `she said`, `she  said`, `ѕhe said` with a Cyrillic ѕ, and `s​he said` with a
 * zero-width space are four strings and one sentence, and only the first was seen.
 * Matching now happens on a normalised copy, which is never stored, never rendered and
 * never logged as the text.
 *
 * The rejection-output rule — the rejection was itself an output. `attributionRejections[]` carried the model's
 * own key names and, through them, its text, and that array is returned by `status` and
 * printed by the demo. The guard firing was what delivered the payload. The error now
 * carries two payloads: `rule` and `field`, which Oracle wrote, and `text`, which goes
 * to the log and nowhere near a screen.
 */
import { normalise, normaliseKeepingCase, prepare } from "../guard/normalise.ts";
import { Refused, safeFieldLabel } from "../guard/refused.ts";

export class AttributionViolation extends Error {
  /** Safe to render: Oracle's own words for which rule fired on which field. */
  readonly publicReason: string;

  constructor(
    message: string,
    publicReason = "A candidate record was dropped: it read like attribution.",
  ) {
    super(message);
    this.name = "AttributionViolation";
    this.publicReason = publicReason;
  }

  /**
   * Built from a two-payload refusal so the caller can choose a channel: `publicReason`
   * for anything a person sees, `message` for the developer's log.
   *
   * `where` is the raw JSON path, model-chosen keys and all, and it stays in the message
   * because that is what makes a rejection debuggable. It is precisely what must not
   * reach a screen, which is why `publicReason` is built from `refused.field` instead.
   */
  static from(refused: Refused, label: string, where: string): AttributionViolation {
    return new AttributionViolation(`${label}: ${refused.message} at ${where}`, refused.publicReason);
  }
}

/** Keys that exist to hold a person. None of them may appear in model output,
 * at any depth, whatever their value. */
const BANNED_KEYS = new Set([
  "speaker",
  "speakers",
  "name",
  "names",
  "who",
  "person",
  "people",
  "author",
  "attribution",
  "attributedto",
  "saidby",
  "said_by",
  "spokenby",
  "spoken_by",
  "participant",
  "participants",
  "voice",
  "username",
  "handle",
  "email",
]);

/** Attribution idioms: a verb of saying with a subject in front of it. "we
 * decided" is fine and ordinary; "he decided" and "Priya decided" are not. */
const SAYING_VERBS =
  "said|says|stated|argued|insisted|noted|mentioned|claimed|suggested|proposed|objected|replied|asked|added|explained|decided|pointed out|brought up";
/**
 * Up to three words may sit between the subject and the verb.
 *
 * Both rules used to require them adjacent, which made the guard a test of one phrasing
 * rather than of the idiom. "she said" was caught and "she had said", "she then said",
 * "she went on to say", "Priya, the staff engineer, said" and "Priya later argued" were
 * not — and a model writes all of those. Widening the gap generalises the rule to the
 * class it was always meant to cover, without adding a single new token to a list.
 */
const GAP = "(?:[a-z][a-z'-]*,?\\s+){0,3}";
const PRONOUN_ATTRIBUTION = new RegExp(`\\b(?:he|she|they|him|her)\\s+${GAP}(?:${SAYING_VERBS})\\b`, "i");
/**
 * A capitalised word is only a name if it is not a function word. "The team decided" and
 * "Priya decided" are the same shape to a regex and opposite things to a reader, and the
 * only reason the narrower version of this rule never noticed is that it demanded the
 * verb be adjacent. The exclusion below is a closed class — English determiners,
 * pronouns and quantifiers — not a list of things that are not names, which is why it can
 * be written out and finished.
 */
const NOT_A_NAME =
  "The|A|An|This|That|These|Those|It|Its|We|Our|They|Their|He|She|His|Her|Everyone|Everybody|Nobody|No|Someone|Somebody|Anyone|Anybody|Both|Each|Either|Neither|Some|Most|All|One|Two|Three|Several|Many|Few|There|Here|What|Which|Who|When|Where|Why|How|If|But|And|So|Then";
const PROPER_NAME_ATTRIBUTION = new RegExp(
  `\\b(?!(?:${NOT_A_NAME})\\b)[A-Z][a-z]{2,},?\\s+${GAP}(?:${SAYING_VERBS})\\b`,
);
const ACCORDING_TO = /\baccording to\s+(?!the\b|this\b|that\b|our\b|their\b|these\b|those\b)[A-Za-z]/;
/** Bee's own placeholder. If it survives into a claim, the pipeline leaked. */
const BEE_SPEAKER_LABEL = /\bUnknown\b/;
/** "[Unknown]:" or "Speaker 2:" style prefixes copied from a transcript. */
const SPEAKER_PREFIX = /(^|\n)\s*(?:\[[^\]]{0,24}\]|speaker\s*\d+)\s*:/i;

export interface AttributionFinding {
  readonly reason: string;
  /** The raw JSON path, model-chosen keys and all. Developer log only. */
  readonly where: string;
  /**
   * The member of `BANNED_KEYS` that matched, which is one of Oracle's own words rather
   * than the model's spelling of it — `Speaker`, `ѕpeaker` and `spea\u200bker` all land
   * on `speaker`. That makes it S1: a member of a closed set the app owns, and therefore
   * safe to name on a screen. The key as the model spelt it is not.
   */
  readonly bannedKey: string;
}

/** Walks any parsed model output and reports the first structural offence. */
export function findBannedKeys(value: unknown, where = "$"): AttributionFinding | null {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const found = findBannedKeys(item, `${where}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    // The key is model output too. `speaker`, `Speaker`, `ѕpeaker` and `spea​ker`
    // are one key; only the first two reached the set before normalisation.
    const folded = normalise(key).replace(/[^a-z_]/g, "");
    if (BANNED_KEYS.has(folded)) {
      return { reason: "could hold a person", where: `${where}.${key}`, bannedKey: folded };
    }
    const found = findBannedKeys(child, `${where}.${key}`);
    if (found) return found;
  }
  return null;
}

/**
 * Reports the first attribution idiom in a piece of prose, or null.
 *
 * Every rule runs against a matching copy, never the bytes the model chose. The copy is
 * built two ways because the rules need different things from it: four of them are
 * case-insensitive and read the fully folded form, and the proper-name rule needs the
 * capital letter that makes a name a name, so it reads the form that keeps case.
 */
export function findAttributionPhrase(text: string): string | null {
  const n = prepare(text);
  // The allowlist that the lookalike table cannot be. `dıd` survives any fold map, and so
  // will the next lookalike; after folding, a letter outside a-z in an English-only
  // guarded field is either a language this guard was never written for or somebody
  // probing it. Refusing costs a claim. Not refusing costs the product its argument.
  const foreign = n.foreignLetters();
  if (foreign.length > 0) {
    return `contains letters this guard cannot read (${foreign.join(" ")}), so it cannot be checked`;
  }
  const folded = n.spaced;
  const cased = normaliseKeepingCase(text);
  if (BEE_SPEAKER_LABEL.test(cased)) return 'carries Bee\'s "Unknown" speaker label';
  if (SPEAKER_PREFIX.test(cased)) return "carries a speaker prefix copied from a transcript";
  if (PRONOUN_ATTRIBUTION.test(folded)) return "attributes a statement to a pronoun subject";
  if (PROPER_NAME_ATTRIBUTION.test(cased)) return "attributes a statement to a named subject";
  if (ACCORDING_TO.test(folded) || ACCORDING_TO.test(cased)) return 'uses "according to" with a subject';
  return null;
}

/**
 * The single gate. Runs both checks over a parsed model object and every
 * string inside it. Throws rather than returning a boolean, because there is
 * no caller for whom continuing would be correct.
 */
export function assertNoAttribution(value: unknown, label = "model output"): void {
  const structural = findBannedKeys(value);
  if (structural) {
    // `structural.where` ends in the key as the model spelt it, and this message is
    // collected into `attributionRejections[]`, which `status` returns and the demo
    // prints. So what reaches a screen is the entry from Oracle's own banned-key list
    // that the key folded onto — a closed set we own — and never the model's spelling.
    // The raw path stays in the developer-side message.
    throw AttributionViolation.from(
      new Refused(structural.reason, `a "${structural.bannedKey}" field`, structural.where),
      label,
      structural.where,
    );
  }
  const strings: Array<{ text: string; where: string }> = [];
  const collect = (v: unknown, where: string): void => {
    if (typeof v === "string") strings.push({ text: v, where });
    else if (Array.isArray(v)) v.forEach((item, i) => collect(item, `${where}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) collect(child, `${where}.${k}`);
    }
  };
  collect(value, "$");
  for (const { text, where } of strings) {
    const phrase = findAttributionPhrase(text);
    // `text` is the refused sentence. It goes into the message, which goes to the log.
    // It does not go into `publicReason`, which is what a person sees.
    if (phrase) throw AttributionViolation.from(new Refused(phrase, safeFieldLabel(where), text), label, where);
  }
}
