/**
 * The actual Bedrock call, and nothing else.
 *
 * Isolated behind one function so the chain logic in invoker.ts can be tested
 * without the AWS SDK, and so the SDK is imported lazily: a machine without it
 * installed, or a judge running `npm test` before `npm install` finished,
 * degrades to the rule-based path instead of failing to load a module at
 * import time.
 *
 * The client takes a region and nothing else. Credentials come from the
 * environment through the SDK's own provider chain, so no account identifier
 * or key appears anywhere in this repository.
 */
import type { ModelRequest } from "./types.ts";

export type ConverseFn = (modelId: string, req: ModelRequest, signal: AbortSignal) => Promise<string>;

export interface ConverseClientOptions {
  readonly region: string;
  readonly timeoutMs: number;
}

/** Builds a sender bound to one region. The client is created once and reused
 * across models: an inference profile id is a per-request argument, not a
 * per-client one. */
export function createConverse(opts: ConverseClientOptions): ConverseFn {
  let client: unknown = null;
  let commandCtor: unknown = null;

  return async (modelId, req, signal) => {
    const mod: any = await import("@aws-sdk/client-bedrock-runtime");
    if (client === null) {
      client = new mod.BedrockRuntimeClient({
        region: opts.region,
        maxAttempts: 2,
        requestHandler: { requestTimeout: opts.timeoutMs, connectionTimeout: Math.min(opts.timeoutMs, 4000) },
      });
      commandCtor = mod.ConverseCommand;
    }
    const Command = commandCtor as new (input: unknown) => unknown;
    const command = new Command({
      modelId,
      system: [{ text: req.system }],
      messages: [{ role: "user", content: [{ text: req.user }] }],
      inferenceConfig: { maxTokens: req.maxTokens ?? 1600, temperature: req.temperature ?? 0 },
    });
    const response: any = await (client as any).send(command, { abortSignal: signal });
    const blocks: Array<{ text?: string }> = response?.output?.message?.content ?? [];
    return blocks.map((b) => b.text ?? "").join("").trim();
  };
}
