/**
 * The orchestrator: announce, capture, extract, draft, ask, plus the three
 * things a second day of using this tool needs, which are finding what has
 * been reversed, reviewing a draft against its transcript, and exporting.
 *
 * It owns the state and delegates each step to the module that holds that
 * step's reasoning. Shared by the MCP server and the CLI demo so both surfaces
 * run the identical pipeline, including the identical fallback when Bedrock is
 * not reachable. Nothing here throws because a model is unavailable; it
 * records which extractor ran and why.
 */
import { runCapture } from "./capture.ts";
import { buildExport, writeExport, type WrittenExport } from "./export.ts";
import { draftRecord } from "./git-pr.ts";
import { citedFragments } from "./adr.ts";
import { describeStatus, exportInput } from "./log-queries.ts";
import { resolveOptions, type OracleConfig } from "./oracle-types.ts";
import { detectRelations, supersededClaimIds, type RelationDetection } from "./relations.ts";
import { buildReview, type ReviewSurface } from "./review.ts";
import { searchClaims, type SearchHit, type SearchOptions } from "./search.ts";
import { SessionBook } from "./sessions.ts";
import { ClaimStore } from "./store.ts";
import type { StartSessionInput } from "./consent.ts";
import type { CaptureResult, OracleOptions, OracleStatus } from "./oracle-types.ts";
import type { Claim, DraftRecord, Session } from "./types.ts";

export type { CaptureResult, OracleOptions, OracleStatus } from "./oracle-types.ts";

export class Oracle {
  readonly store: ClaimStore;
  private readonly cfg: OracleConfig;
  private readonly book: SessionBook;
  private lastExtractorUsed: string | null = null;
  private lastFallbackReason: string | null = null;

  constructor(opts: OracleOptions) {
    this.store = opts.store ?? new ClaimStore();
    this.cfg = resolveOptions(opts, this.store);
    this.book = new SessionBook(this.store);
  }

  private async persist(): Promise<void> {
    if (this.cfg.persistTo) await this.store.saveTo(this.cfg.persistTo);
  }

  private requireClaim(claimId: string): Claim {
    const claim = this.store.getClaim(claimId);
    if (!claim) throw new Error(`no such claim: ${claimId}`);
    return claim;
  }

  startSession(input: StartSessionInput): Session {
    const session = this.book.start(input);
    void this.persist();
    return session;
  }

  closeSession(sessionId: string): Session {
    return this.book.close(sessionId, this.cfg.now);
  }

  async listConversations(): Promise<readonly string[]> {
    return this.cfg.beeClient.listConversationIds();
  }

  /** Consent gate first, then Bedrock. One conversation can produce several
   * records, because segmentation is part of extraction now. */
  async captureConversation(sessionId: string, conversationId: string, presentDeviceIds: readonly string[]): Promise<CaptureResult> {
    const result = await runCapture(this.cfg, this.book.require(sessionId), conversationId, presentDeviceIds);
    this.lastExtractorUsed = result.extractor;
    this.lastFallbackReason = result.fallbackReason;
    await this.persist();
    return result;
  }

  /** Sweeps every stored claim for a later record that reverses an earlier
   * one. Replaces the previous sweep's findings. */
  async findContradictions(): Promise<RelationDetection> {
    const detection = await detectRelations(this.store.allClaims(), this.cfg.invoker, this.cfg.now);
    this.store.setRelations(detection.relations);
    await this.persist();
    return detection;
  }

  review(claimId: string): ReviewSurface {
    const claim = this.requireClaim(claimId);
    return buildReview(claim, this.store.getConversation(claim.provenance.conversationId), this.store.relationsFor(claimId));
  }

  async draftRecordForClaim(claimId: string): Promise<DraftRecord> {
    const claim = this.requireClaim(claimId);
    const conversation = this.store.getConversation(claim.provenance.conversationId);
    return draftRecord(claim, this.cfg.repoDir, this.cfg.wearer, this.store.relationsFor(claimId), citedFragments(claim, conversation));
  }

  /** Relevance and recency together, with reversed records pushed below the
   * record that reversed them. */
  ask(question: string, options: SearchOptions = {}): readonly SearchHit[] {
    const supersededIds = supersededClaimIds(this.store.allRelations());
    return searchClaims(this.store.allClaims(), question, { now: this.cfg.now(), supersededIds, ...options });
  }

  claims(): readonly Claim[] {
    return this.store.claimsByTime();
  }

  exportLog(): ReturnType<typeof buildExport> {
    return buildExport(exportInput(this.store, this.cfg.now().toISOString()));
  }

  async exportLogTo(outDir: string): Promise<WrittenExport> {
    return writeExport(exportInput(this.store, this.cfg.now().toISOString()), outDir);
  }

  status(): OracleStatus {
    return describeStatus({
      ...this.cfg,
      lastExtractorUsed: this.lastExtractorUsed,
      lastFallbackReason: this.lastFallbackReason,
      openSessions: this.book.openSessionIds(),
    });
  }
}
