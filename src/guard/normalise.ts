/**
 * Normalisation for guard matching. The output of this module is never displayed.
 *
 * A guard that compares a list against raw model output is comparing against bytes the
 * model picked. Oracle's attribution guard is the case in point: it is the constraint
 * that outranks every feature in this app, and until this module existed it tested
 * `she said` against whatever spelling arrived. `she said`, `she  said`, `ѕhe said`
 * (Cyrillic ѕ) and `s​he said` are four different strings and one sentence.
 *
 * This is the contract this project's shared guard-design standard sets, in full:
 * normalisation produces a **matching copy**. It is never stored, never rendered, never
 * logged as the text, and never sent anywhere. The original is what you keep.
 */

const INVISIBLE = /[­​‌‍⁠﻿‪-‮⁦-⁩]/g;
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

const LOOKALIKE = new Map(
  Object.entries({
    "а": "a", "б": "b", "е": "e", "ѕ": "s", "і": "i", "ј": "j", "ӏ": "l", "о": "o",
    "р": "p", "с": "c", "у": "y", "х": "x", "ԁ": "d", "һ": "h", "ԛ": "q", "ѡ": "w",
    "ν": "v", "ο": "o", "ρ": "p", "α": "a", "ε": "e", "ι": "i", "κ": "k", "τ": "t",
  }),
);

const PUNCT = new Map(
  Object.entries({
    "‘": "'", "’": "'", "‚": "'", "‛": "'", "ʼ": "'",
    "´": "'", "`": "'", "′": "'",
    "“": '"', "”": '"', "„": '"', "″": '"',
    "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-",
    "―": "-", "−": "-",
    " ": " ", " ": " ", " ": " ",
  }),
);

/** A matching copy. Never render the result of this. */
export function normalise(text: string): string {
  let s = text.normalize("NFKC").replace(INVISIBLE, "").replace(CONTROL, "");
  s = s.toLowerCase();
  s = s.normalize("NFD").replace(/\p{Mn}+/gu, "").normalize("NFC");
  s = [...s].map((c) => LOOKALIKE.get(c) ?? PUNCT.get(c) ?? c).join("");
  return s.replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").trim();
}

export interface Normalised {
  readonly original: string;
  readonly spaced: string;
  readonly squeezed: string;
  hasWord(word: string): boolean;
  hasPhrase(phrase: string): boolean;
  foreignLetters(): string[];
}

/**
 * Two forms, because one is not enough. `spaced` turns apostrophes and hyphens into
 * spaces (`she's` -> `she s`), `squeezed` deletes them (`she's` -> `shes`). A guard that
 * has only the first is evaded by `did' not`; one that has only the second is evaded by
 * `non-attendance`. Membership is checked against the union.
 */
export function prepare(text: string): Normalised {
  const n = normalise(text);
  const spaced = n.replace(/\s*['-]\s*/g, " ").replace(/\s+/g, " ").trim();
  const squeezed = n.replace(/\s*['-]\s*/g, "");
  const tokens = new Set(
    [...spaced.split(/[^a-z0-9]+/), ...squeezed.split(/[^a-z0-9]+/)].filter(Boolean),
  );
  return {
    original: text,
    spaced,
    squeezed,
    hasWord: (w) => {
      const m = normalise(w);
      return tokens.has(m) || tokens.has(m.replace(/['-]/g, ""));
    },
    hasPhrase: (p) => {
      const m = normalise(p);
      return (
        spaced.includes(m.replace(/['-]/g, " ").replace(/\s+/g, " ").trim()) ||
        squeezed.includes(m.replace(/['-]/g, ""))
      );
    },
    foreignLetters: () =>
      [...new Set([...squeezed].filter((c) => /\p{L}/u.test(c) && !/[a-z]/.test(c)))].sort(),
  };
}

/**
 * Everything `normalise` does except the case fold, for the one rule that needs capitals.
 *
 * A proper name is recognised by its capital letter, so `PROPER_NAME_ATTRIBUTION` cannot
 * run on a case-folded copy. It still must not run on raw bytes, or a zero-width space
 * splits `Priya` in half. The lookalike table is deliberately not applied here: its keys
 * are lower-case, so folding before the case fold would miss an uppercase Cyrillic Ѕ and
 * give a false sense of cover. The allowlist in `foreignScript` is what closes that hole,
 * for every rule at once.
 */
export function normaliseKeepingCase(text: string): string {
  let s = text.normalize("NFKC").replace(INVISIBLE, "").replace(CONTROL, "");
  s = s.normalize("NFD").replace(/\p{Mn}+/gu, "").normalize("NFC");
  s = [...s].map((c) => PUNCT.get(c) ?? c).join("");
  return s.replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").trim();
}

/**
 * The rule the lookalike map cannot satisfy.
 *
 * `dıd` — dotless Turkish ı — survives the fold, and so will the next lookalike, and the
 * one after. A fold table is a denylist wearing different clothes. The allowlist version
 * is this: after folding, any letter outside a-z in an English-only guarded field is
 * either a language the guard was never written for or somebody probing it. Do not extend
 * the map; refuse the record and log which codepoints appeared.
 */
export function foreignScript(text: string): string[] {
  return prepare(text).foreignLetters();
}
