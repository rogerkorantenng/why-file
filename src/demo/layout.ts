/**
 * Oracle's look: a manifest, not a ledger.
 *
 * Oracle draws no rails, no boxes and no rules. Its only structural device is a
 * right-aligned gutter thirteen columns wide, and everything in the terminal hangs off
 * the single hard edge that gutter makes. What sits in the gutter says what kind of
 * thing the line is — a field name, an utterance id, a step number — and the column to
 * its right holds the thing itself. That is the whole system, and it is why the output
 * still lines up when a decision is two words and the one under it is two lines.
 *
 * Three colours, one meaning each, and nothing decorative:
 *
 *   the terminal's own ink   words somebody actually said, and prose Oracle wrote
 *   amber                    a value Oracle extracted and is now asserting
 *   slate                    pointers and machinery: labels, ids, provenance, counts
 *
 * Body text is deliberately left uncoloured. Painting it bright white assumes a dark
 * terminal; on a light one it is white on white and the record disappears. The terminal's
 * own foreground is the only colour that is right on both, so the palette spends itself
 * on the two things that carry meaning and leaves the rest alone.
 *
 * The two accents do have to change on a light ground: amber 179 measures under 2:1 on
 * white. `themeIsLight()` reads COLORFGBG, which most terminals set, and ORACLE_THEME
 * overrides it either way. On a light terminal the same two roles are carried by a
 * darker amber and a darker slate, so the convention above survives the move.
 *
 * The whole palette drops out under NO_COLOR, and when nobody is watching a terminal, so
 * `npm run demo > decisions.txt` writes words rather than escape codes.
 * ORACLE_COLOR=always forces it back on for a screenshot.
 */

const PLAIN =
  process.env.NO_COLOR !== undefined ||
  (process.env.ORACLE_COLOR !== "always" && !process.stdout.isTTY);

/** COLORFGBG is "fg;bg" or "fg;;bg"; a high background number means a light terminal. */
function themeIsLight(): boolean {
  if (process.env.ORACLE_THEME === "light") return true;
  if (process.env.ORACLE_THEME === "dark") return false;
  const parts = process.env.COLORFGBG?.split(";");
  const bg = parts ? Number(parts[parts.length - 1]) : Number.NaN;
  return Number.isFinite(bg) && bg >= 7 && bg !== 8;
}

const LIGHT = themeIsLight();
const code = (c: string): string => (PLAIN ? "" : c);

export const AMBER = code(LIGHT ? "\x1b[38;5;130m" : "\x1b[38;5;179m");
export const SLATE = code(LIGHT ? "\x1b[38;5;240m" : "\x1b[38;5;245m");
/** Deliberately empty: plain text keeps the terminal's own foreground. */
export const WHITE = "";
export const BOLD = code("\x1b[1m");
export const RESET = code("\x1b[0m");

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * COLUMNS first, because the demo is often piped — into a screenshot tool, into a file —
 * and a pipe has no width of its own. 76 is the floor because the gutter plus a readable
 * body needs it; 108 is the ceiling because a decision record read across 200 columns is
 * a decision record nobody reads.
 */
export const WIDTH = clamp(Number(process.env.COLUMNS) || process.stdout.columns || 92, 76, 108);
export const GUTTER = 13;
const GAP = 2;
export const BODY = WIDTH - GUTTER - GAP;

export function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line = `${line} ${word}`;
    else {
      out.push(line);
      line = word;
    }
  }
  out.push(line);
  return out;
}

export const PAD = " ".repeat(GUTTER + GAP);

/** The one primitive. Everything else below is a choice of gutter word and colour. */
export function row(gutter: string, gutterColour: string, body: string, bodyColour: string): void {
  const lines = wrap(body, BODY);
  const head = gutter.padStart(GUTTER);
  console.log(`${gutterColour}${head}${RESET}${" ".repeat(GAP)}${bodyColour}${lines[0] ?? ""}${RESET}`);
  for (const line of lines.slice(1)) console.log(`${PAD}${bodyColour}${line}${RESET}`);
}

export function blank(): void {
  console.log("");
}

/** A step in the run. The number lives in the gutter like every other label. */
export function step(n: number | string, title: string): void {
  blank();
  console.log(`${AMBER}${String(n).padStart(GUTTER)}${RESET}${" ".repeat(GAP)}${BOLD}${title}${RESET}`);
  blank();
}

/** A heading inside a step, set flush with the body column. */
export function heading(text: string): void {
  blank();
  console.log(`${PAD}${BOLD}${text}${RESET}`);
}

/** A labelled value. The label is a pointer, so it is slate; the value is plain unless
 * it is something Oracle is asserting, in which case it is amber. */
export function field(label: string, value: string, tone: "plain" | "claim" | "quiet" = "plain"): void {
  row(label, SLATE, value, tone === "claim" ? AMBER : tone === "quiet" ? SLATE : WHITE);
}

/** Prose Oracle wrote, or words that were said: the terminal's own ink. */
export function say(text: string): void {
  row("", "", text, WHITE);
}

/** Machinery: counts, reasons, paths. Never the record itself. */
export function slate(text: string): void {
  row("", "", text, SLATE);
}

export function white(text: string): void {
  row("", "", text, WHITE);
}

export function amber(text: string): void {
  row("", "", text, AMBER);
}

/** A title on the left of the body column with an identifier hung on the right margin,
 * the way a ref sits at the end of a git log line. */
export function titled(title: string, ref: string): void {
  const room = BODY - ref.length - 2;
  const head = title.length > room ? `${title.slice(0, Math.max(0, room - 1))}…` : title;
  console.log(`${PAD}${BOLD}${head}${RESET}${" ".repeat(Math.max(2, room - head.length + 2))}${SLATE}${ref}${RESET}`);
}

/** The convention, stated once, in the colours it describes. */
export function legend(): void {
  field("said", "words the room actually used");
  field("extracted", "what Oracle took from them", "claim");
  field("provenance", "where it came from, and what decided it", "quiet");
}

