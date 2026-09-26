/**
 * Pulling JSON back out of a model response.
 *
 * Models are asked for bare JSON and usually give it. Sometimes they wrap it in
 * a fenced code block, and occasionally they put a sentence in front of it.
 * This scans for the first balanced JSON value in the text rather than trusting
 * the whole string to parse, and returns null instead of throwing, because a
 * malformed response is an ordinary event that routes to the fallback path.
 */

function stripFences(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  return fenced?.[1] ? fenced[1].trim() : text.trim();
}

/** Finds the first balanced `{...}` or `[...]`, respecting strings and escapes. */
function firstBalancedValue(text: string): string | null {
  const openIndex = (() => {
    const brace = text.indexOf("{");
    const bracket = text.indexOf("[");
    if (brace === -1) return bracket;
    if (bracket === -1) return brace;
    return Math.min(brace, bracket);
  })();
  if (openIndex === -1) return null;

  const open = text[openIndex]!;
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }
  return null;
}

export function parseJsonBlock(text: string): unknown | null {
  const candidate = firstBalancedValue(stripFences(text));
  if (candidate === null) return null;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
}

/** Convenience: parse and require an array at the top level. */
export function parseJsonArray(text: string): unknown[] | null {
  const value = parseJsonBlock(text);
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const key of ["claims", "results", "items", "judgements", "relations"]) {
      const inner = (value as Record<string, unknown>)[key];
      if (Array.isArray(inner)) return inner;
    }
  }
  return null;
}
