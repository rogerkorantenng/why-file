/**
 * Whatever the guard refuses is output too.
 *
 * Oracle shows its rejections on purpose: "the model tried to say something it was not
 * allowed to say and was stopped" is one of the more interesting things this tool does,
 * and a guard that silently fixes things teaches a reviewer nothing about the model
 * behind it. But that render is a second output path *around* the guard. The text that
 * was too dangerous to record was being printed one line lower with a label on it, and
 * the model-chosen key it was found under was printed beside it — so the guard firing is
 * what delivered the payload.
 *
 * A rejection is not metadata. It is model output with a frame around it.
 *
 * So the error carries two payloads: `rule` and `field`, which Oracle wrote and which are
 * safe to render, and `text`, which the model wrote and which goes to the log at the
 * developer's end and nowhere else, per this project's shared guard-design standard.
 */

/** The field names Oracle knows. A model-chosen key is normalised to one of these, or
 * reported as its position, before it can reach a screen. */
const KNOWN_FIELDS = new Set([
  "decision",
  "context",
  "consequences",
  "rejectedOptions",
  "topic",
  "kind",
  "confidence",
  "sourceUtteranceIds",
  "rationale",
  "relation",
  "pair",
]);

/**
 * A JSON path like `$.speaker` or `$[2].notes` reduced to something Oracle is willing to
 * print. A key it recognises survives; anything else becomes its position, because a key
 * the model invented is model output and gets the same treatment as the value under it.
 */
export function safeFieldLabel(where: string): string {
  const segments = where.split(/[.[\]]+/).filter((s) => s !== "" && s !== "$");
  const parts = segments.map((seg) => {
    if (/^\d+$/.test(seg)) return `item ${seg}`;
    return KNOWN_FIELDS.has(seg) ? seg : "an unrecognised field";
  });
  return parts.length === 0 ? "the record" : parts.join(" / ");
}

export class Refused extends Error {
  /** App-authored. Which rule fired. Safe to render. */
  readonly rule: string;
  /** App-authored. Which field it fired on, never the model's own key. Safe to render. */
  readonly field: string;
  /** Model-authored. The log, and nowhere else. */
  readonly text: string;

  // Written out longhand rather than as parameter properties: this repo runs TypeScript
  // through node's strip-only mode, which cannot compile `constructor(readonly x: T)`.
  constructor(rule: string, field: string, text: string) {
    super(`${rule} in ${field}: ${JSON.stringify(text)}`);
    this.name = "Refused";
    this.rule = rule;
    this.field = field;
    this.text = text;
  }

  /**
   * Safe to render. Contains nothing the model wrote — not the text, and not the key it
   * arrived under. "A candidate record was dropped (decision): it attributes a statement
   * to a named subject." tells a reviewer everything reprinting the sentence would, and
   * is the only version that is safe.
   */
  get publicReason(): string {
    return `A candidate record was dropped (${this.field}): it ${this.rule}.`;
  }
}
