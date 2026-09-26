/** Every Oracle tool answers with one text block: JSON for structured
 * results, plain prose when the answer is already prose. Kept in one place so
 * no tool invents its own envelope. */
export function text(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}
