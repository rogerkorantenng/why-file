/**
 * Reading the log back: what gets exported, and what Oracle says it is
 * running on.
 *
 * Both are pure functions over a store, so the export a judge reads and the
 * export an MCP host writes are assembled by the same code, and `status` can
 * be asserted in a test without building an Oracle.
 */
import type { ExportInput } from "./export.ts";
import type { ModelInvoker } from "./bedrock/invoker.ts";
import type { OracleStatus } from "./oracle-types.ts";
import type { ClaimStore } from "./store.ts";

/** Claims, relations and the announcements together. Exporting records without
 * the announcements would read like a log of secret recording. */
export function exportInput(store: ClaimStore, generatedAt: string): ExportInput {
  return {
    claims: store.allClaims(),
    relations: store.allRelations(),
    announcements: store.allAnnouncements(),
    // The retained conversations, so each record in the exported log can quote the
    // fragments it was drawn from instead of pointing at an id the reader cannot follow.
    conversations: store.allConversations(),
    generatedAt,
  };
}

export interface StatusInput {
  readonly store: ClaimStore;
  readonly invoker: ModelInvoker | null;
  readonly lastExtractorUsed: string | null;
  readonly lastFallbackReason: string | null;
  readonly openSessions: readonly string[];
  readonly persistTo: string | null;
}

/** Answers "which extractor is configured, which one last ran, and why it fell
 * back", which is the first question anyone asks when a record reads thin. */
export function describeStatus(input: StatusInput): OracleStatus {
  const claims = input.store.allClaims();
  const conversations = new Set(claims.map((c) => c.provenance.conversationId));
  return {
    modelConfigured: input.invoker !== null,
    extractor: input.invoker?.describe ?? "rules",
    lastExtractorUsed: input.lastExtractorUsed,
    lastFallbackReason: input.lastFallbackReason,
    claimCount: claims.length,
    conversationCount: conversations.size,
    announcementCount: input.store.allAnnouncements().length,
    relationCount: input.store.allRelations().length,
    openSessions: input.openSessions,
    persistTo: input.persistTo,
  };
}
