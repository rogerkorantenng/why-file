/**
 * Choosing a model, and giving up on one.
 *
 * Oracle does not hard-code a model id. It carries a preference chain, newest
 * first, and walks down it until one answers. That matters because
 * `ListFoundationModels` advertises models this account cannot invoke:
 * `anthropic.claude-sonnet-5` and `anthropic.claude-opus-5` are both listed
 * here and both return AccessDeniedException on a real call. There is no API
 * that says which models are enabled, so the only way to find out is to try
 * one, and the chain turns that into a feature: the day access to a newer
 * model lands, the build picks it up with no edit.
 *
 * A model that refuses on entitlement grounds is remembered as refused and
 * never tried again in this process, so the probe costs one call, not one per
 * request. Anything that is not an entitlement failure (a timeout, a throttle,
 * a torn socket) does not advance the chain: the deadline is already spent,
 * and the caller falls back to the rule-based extractor.
 *
 * The timeout is a hard deadline enforced twice, by the SDK's own socket and
 * request timeouts and by an AbortController the caller cannot outrun, because
 * credential resolution runs before the SDK's request timer starts. A demo
 * that hangs for thirty seconds in front of a judge has already failed.
 */
import { createConverse, type ConverseFn } from "./converse.ts";
import { ModelUnavailable, isEntitlementError } from "./errors.ts";
import type { ModelInvoker, ModelRequest } from "./types.ts";

export { ModelUnavailable, isEntitlementError } from "./errors.ts";
export type { ModelInvoker, ModelRequest } from "./types.ts";

/**
 * Preference order. The first two are not enabled on this account today and
 * are here on purpose: they cost one refused call each, once, and they mean
 * the better model is used automatically the day it is granted. The last is
 * the one verified by a real invocation while this was built.
 */
export const DEFAULT_MODEL_CHAIN: readonly string[] = [
  "us.anthropic.claude-sonnet-5",
  "us.anthropic.claude-sonnet-4-6",
  "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
];
export const DEFAULT_REGION = "us-east-1";
export const DEFAULT_TIMEOUT_MS = 12_000;

export interface BedrockInvokerOptions {
  readonly models?: readonly string[];
  readonly region?: string;
  readonly timeoutMs?: number;
  /** Test seam. Defaults to the real Converse call. */
  readonly converse?: ConverseFn;
}

export class BedrockInvoker implements ModelInvoker {
  private readonly models: readonly string[];
  private readonly timeoutMs: number;
  private readonly converse: ConverseFn;
  private readonly refused = new Set<string>();
  private resolved: string | null = null;

  constructor(opts: BedrockInvokerOptions = {}) {
    const models = opts.models?.length ? opts.models : DEFAULT_MODEL_CHAIN;
    this.models = models;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.converse =
      opts.converse ?? createConverse({ region: opts.region ?? DEFAULT_REGION, timeoutMs: this.timeoutMs });
  }

  /** Names the model that last answered, or the first candidate before any
   * call has been made. This is what gets written onto a claim. */
  get describe(): string {
    return `bedrock:${this.resolved ?? this.models[0] ?? "unconfigured"}`;
  }

  private candidates(): readonly string[] {
    if (this.resolved) return [this.resolved];
    return this.models.filter((id) => !this.refused.has(id));
  }

  async invoke(req: ModelRequest): Promise<string> {
    const candidates = this.candidates();
    if (candidates.length === 0) {
      throw new ModelUnavailable(`no Bedrock model in the preference chain is available to this account (tried ${this.models.join(", ")})`);
    }

    const deadline = Date.now() + this.timeoutMs;
    let lastEntitlementError = "";

    for (const modelId of candidates) {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), Math.max(deadline - Date.now(), 1));
      try {
        const text = (await this.converse(modelId, req, abort.signal)).trim();
        if (!text) throw new ModelUnavailable(`bedrock:${modelId} returned an empty response`);
        this.resolved = modelId;
        return text;
      } catch (err: unknown) {
        if (isEntitlementError(err)) {
          this.refused.add(modelId);
          lastEntitlementError = err instanceof Error ? err.message : String(err);
          continue;
        }
        if (err instanceof ModelUnavailable) throw err;
        const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        throw new ModelUnavailable(`bedrock:${modelId} unreachable (${detail})`, err);
      } finally {
        clearTimeout(timer);
      }
    }

    throw new ModelUnavailable(
      `no Bedrock model in the preference chain is available to this account (last refusal: ${lastEntitlementError})`,
    );
  }
}

/** Comma-separated, so a different account can supply its own chain. */
function chainFromEnv(value: string | undefined): readonly string[] | undefined {
  const ids = (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length ? ids : undefined;
}

/**
 * Builds an invoker from the environment, or returns null to mean "run the
 * deterministic path". `ORACLE_BEDROCK=off` is the switch a judge uses on a
 * plane. Returning null rather than throwing is deliberate: no configuration
 * mistake should be able to stop Oracle running. Credentials are never read
 * here; the SDK resolves them from the environment.
 */
export function invokerFromEnv(env: NodeJS.ProcessEnv = process.env): ModelInvoker | null {
  if ((env.ORACLE_BEDROCK ?? "").toLowerCase() === "off") return null;
  const timeoutMs = Number(env.ORACLE_BEDROCK_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const models = chainFromEnv(env.ORACLE_BEDROCK_MODEL_ID);
  return new BedrockInvoker({
    ...(models ? { models } : {}),
    region: env.AWS_REGION ?? env.ORACLE_BEDROCK_REGION ?? DEFAULT_REGION,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  });
}
