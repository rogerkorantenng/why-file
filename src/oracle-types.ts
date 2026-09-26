/**
 * The shapes the Oracle class takes in and hands back.
 *
 * `CaptureResult` and `OracleStatus` both exist to make fallback visible. A
 * capture that ran on the rule-based extractor because Bedrock was unreachable
 * is not the same record as one a model wrote, and every surface that shows a
 * record shows which it was and why.
 */
import type { BeeClient } from "./bee/client.ts";
import type { ModelInvoker } from "./bedrock/invoker.ts";
import type { ExtractionResult } from "./claims/model-extract.ts";
import type { GitIdentity } from "./git-pr.ts";
import type { ClaimStore } from "./store.ts";

export interface OracleOptions {
  readonly beeClient: BeeClient;
  readonly repoDir: string;
  readonly wearer: GitIdentity;
  readonly store?: ClaimStore;
  /** Null means run the deterministic path throughout. */
  readonly invoker?: ModelInvoker | null;
  /** When set, the store is written here after every change. */
  readonly persistTo?: string;
  readonly now?: () => Date;
}

export interface CaptureResult extends ExtractionResult {
  readonly conversationId: string;
  /** Utterances the consent gate refused, and why, when it refused them. */
  readonly refusedReason: string | null;
}

export interface OracleStatus {
  readonly modelConfigured: boolean;
  readonly extractor: string;
  readonly lastExtractorUsed: string | null;
  readonly lastFallbackReason: string | null;
  readonly claimCount: number;
  readonly conversationCount: number;
  readonly announcementCount: number;
  readonly relationCount: number;
  readonly openSessions: readonly string[];
  readonly persistTo: string | null;
}

/** Options with the defaults already applied, so the Oracle constructor is a
 * single assignment rather than eight. */
export interface OracleConfig {
  readonly beeClient: BeeClient;
  readonly repoDir: string;
  readonly wearer: GitIdentity;
  readonly store: ClaimStore;
  readonly invoker: ModelInvoker | null;
  readonly persistTo: string | null;
  readonly now: () => Date;
}

export function resolveOptions(opts: OracleOptions, store: ClaimStore): OracleConfig {
  return {
    beeClient: opts.beeClient,
    repoDir: opts.repoDir,
    wearer: opts.wearer,
    store,
    invoker: opts.invoker ?? null,
    persistTo: opts.persistTo ?? null,
    now: opts.now ?? (() => new Date()),
  };
}
