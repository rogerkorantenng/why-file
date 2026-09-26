/**
 * Escaping for the destination, not in general.
 *
 * There is no such thing as "sanitised text". There is text that is safe for *this*
 * destination, and Oracle writes to five of them: a markdown file it commits to git, a
 * git commit subject, a terminal, a record id that becomes a path and a branch name, and
 * a JSON export. A single scrub applied once at the top is how the same model string
 * ended up forging a `## Consequences` section in a committed decision record *and*
 * repainting the terminal that printed it. Those are not two bugs. They are one mistake
 * pointed at two outputs.
 *
 * This project's shared guard-design standard is the source of every function here, and the
 * outputs it states for the reproduction string are asserted byte for byte in
 * `test/destination.test.ts`. If you change a function here, that test is the argument
 * you have to win.
 *
 * Escape at the boundary, on the way out, once, for the boundary you are crossing.
 */

const ANSI = /\u001B\[[0-?]*[ -/]*[@-~]|\u001B[@-Z\\-_]|\u009B[0-?]*[ -/]*[@-~]/g;
// Keeps tab (09) and newline (0A); strips everything else in C0 and C1.
const CTRL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
// Invisible or rendering-steering: zero-width family, soft hyphen, bidi embedding,
// override and isolates. None of them carry meaning in any of Oracle's destinations, and
// every one of them is a way to split a word a guard is looking for in half.
const INVISIBLE = /[­​‌‍⁠﻿‪-‮⁦-⁩]/g;

/**
 * The other half of the ingest floor, kept separate from `stripControls` on purpose.
 *
 * §4's floor is described as C0/C1 controls **plus bidi controls and zero-width
 * characters**, but the TypeScript it gives strips only the first. Rather than quietly
 * change a function whose byte-for-byte output the standard states (and whose Python twin
 * must agree with it), the rest of the floor lives here and the ingest path calls both.
 */
export function stripInvisible(s: string): string {
  return s.replace(INVISIBLE, "");
}

/**
 * The ingest floor. Run before persisting any model string.
 *
 * With keepNewlines false a newline becomes a space, not nothing. Deleting it would weld
 * the last word of one line to the first of the next, which is how "did not\ncome"
 * becomes a token no phrase rule matches.
 *
 * `keepNewlines` has **no default**, and §4's own snippet gives it one (`= true`). §5 is
 * the stronger rule and it wins: a safety parameter defaults to the closed value or has
 * no default at all, because the next call site that forgets it is the one that fails
 * open, silently, with the compiler helping nobody. Six call sites, each of which now
 * says what it knows.
 */
export function stripControls(s: string, keepNewlines: boolean): string {
  const flat = keepNewlines ? s : s.replace(/[\r\n]+/g, " ");
  return flat.replace(ANSI, "").replace(CTRL, "");
}

/** HTML text node or attribute. Oracle has no HTML surface today; this exists so the
 * destination sweep in the tests covers the boundary before somebody adds one. */
export function forHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/** A terminal. Newlines are fine here; escape sequences are not — an escape in model
 * text can repaint Oracle's own colours, erase the line above it, or move the cursor
 * over the provenance line that is the only reason to trust the record. */
export function forTerminal(s: string, limit = 200): string {
  return stripControls(s, true).slice(0, limit);
}

/**
 * The strict form: text that must not create structure **and might land at the start of a
 * line**. Collapses newlines and escapes every markdown leader wherever it appears, so
 * `## Consequences` becomes three words in a sentence.
 *
 * Use `forMarkdownBlock` for a value Oracle always prefixes (after `# `, after `- `,
 * under a heading it wrote) — that one keeps ordinary prose readable — and
 * `forMarkdownToken` for an identifier. This is the fallback for everything else and the
 * function whose output §4 of the standard states byte for byte.
 */
export function forMarkdownInline(s: string, limit = 300): string {
  const flat = stripControls(s, true).split(/\s+/).filter(Boolean).join(" ");
  return flat.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1").slice(0, limit);
}

/**
 * An identifier rendered into markdown: a claim id, a conversation id, a timestamp, an
 * extractor name, a kind, a topic label.
 *
 * These are not prose and must not be escaped like prose. Running `forMarkdownInline`
 * over them turns `bedrock:test-model` into `bedrock:test\-model` and a timestamp into
 * `2026\-06\-09T10:02:14Z`, which breaks the one part of a decision record that is meant
 * to be read by a machine and grepped by a person — and a provenance line nobody can
 * grep is the record losing the thing that makes it worth anything.
 *
 * So this is S5 from §1 rather than escaping: validate against a closed pattern and emit
 * the value when it matches. A value that does not match is not an identifier, whatever
 * it claims to be, and falls back to the strict prose form.
 */
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9 ._:+/-]{0,127}$/;

export function forMarkdownToken(s: string): string {
  return SAFE_TOKEN.test(s) ? s : forMarkdownInline(s);
}

/**
 * A paragraph that stands alone under a heading Oracle wrote — the ADR's Context,
 * Decision and Consequences bodies.
 *
 * §4's table offers two ways to make a markdown body safe: "either fence the text or
 * escape leading structure and collapse newlines". This is the second. `forMarkdownInline`
 * is the right answer for a value dropped inside one of Oracle's own lines, but running
 * it over a whole paragraph escapes every full stop and hyphen in ordinary prose, and a
 * decision record nobody can read is a product regression, not a guard.
 *
 * So: collapse to one line (no line is left for a `#` to start), then escape anything
 * that would still open a block if the renderer saw it first. One line with no leader
 * cannot be a heading, a list item, a fence, a table, a quote or front matter.
 */
export function forMarkdownBlock(s: string, limit = 600): string {
  const flat = stripControls(s, false).split(/\s+/).filter(Boolean).join(" ");
  const led = flat.replace(/^([#>*+\-=|~`.)\]]|\d+[.)])/, "\\$1");
  // A fence anywhere in the line would swallow everything after it in the document.
  const fenced = led.replace(/([`~]{3,})/g, (m) => "\\".concat(m.split("").join("\\")));
  return fenced.length > limit ? `${fenced.slice(0, limit - 1).trimEnd()}…` : fenced;
}

/** One line, no control characters, capped. Better still: never model-authored — see
 * `subjectFor` in git-pr.ts, which composes the subject from validated fields and leaves
 * this as the last line underneath rather than the argument. */
export function forGitSubject(s: string, limit = 72): string {
  const flat = stripControls(s, true).split(/\s+/).filter(Boolean).join(" ");
  return flat.slice(0, limit) || "(no subject)";
}

/** Oracle writes no CSV today. Kept because the destination sweep pushes the same hostile
 * string through every boundary, and a boundary that does not exist yet is the one that
 * gets added without a guard. */
export function forCsvCell(s: string): string {
  const flat = stripControls(s, false).replace(/\r/g, " ");
  return /^[=+\-@\t]/.test(flat) ? `'${flat}` : flat;
}

/**
 * An id that becomes a file path (`decisions/<id>.md`) and a git branch name
 * (`why-file/<id>`).
 *
 * Claim ids are built from Bee's conversation id, which is a string from a third party's
 * API that nothing in Oracle validates. git's own refname rules reject `..` and control
 * characters, so the traversal is currently blocked by accident, one layer below the code
 * that would have to be right. This makes it a decision instead of a coincidence: an
 * allowlist of `[A-Za-z0-9._-]`, no `..`, capped, and a throw rather than a coerced
 * default when nothing usable is left.
 */
export function forRecordId(s: string, limit = 64): string {
  const id = stripControls(s, false).replace(/[^A-Za-z0-9._-]/g, "-").replace(/\.{2,}/g, "-");
  // Not just the empty string: an id left as `--` or `...` names nothing and would make
  // `decisions/--.md` a file two unrelated claims could both land in. If no letter or
  // digit survived, there was no id here, and refusing says so.
  if (!/[A-Za-z0-9]/.test(id)) throw new Error("unusable record id");
  return id.slice(0, limit);
}
