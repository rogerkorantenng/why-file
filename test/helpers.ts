/** Shared fixtures for the test suite. No tests of its own. */
import type { ModelInvoker, ModelRequest } from "../src/bedrock/invoker.ts";
import type { Claim, Conversation } from "../src/types.ts";

export function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: "c1",
    kind: "decision",
    topic: "unlabelled",
    context: "",
    decision: "",
    rejectedOptions: [],
    consequences: "",
    provenance: { conversationId: "conv_1", timestamp: "2026-01-01T00:00:00Z", sourceUtteranceIds: [] },
    extractedAt: "2026-01-01T00:00:00Z",
    extractor: "rules",
    confidence: 0.5,
    ...overrides,
  };
}

export function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "conv_test",
    roomId: "room_test",
    startedAt: "2026-05-01T09:00:00Z",
    endedAt: "2026-05-01T09:01:00Z",
    utterances: [
      { id: "u1", text: "so the queue, we keep going back and forth", startMs: 0, endMs: 2000 },
      { id: "u2", text: "no, not RabbitMQ, the ops burden is wrong here", startMs: 2000, endMs: 4500 },
      { id: "u3", text: "so SQS it is, because we already run it elsewhere.", startMs: 4500, endMs: 7000 },
    ],
    ...overrides,
  };
}

/** A ModelInvoker that returns canned text, or throws, and records what it
 * was asked. Every Bedrock-dependent test uses one of these: no test in this
 * suite requires Bedrock to be reachable. */
export function stubInvoker(reply: string | (() => never), describe = "bedrock:test-model"): ModelInvoker & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    describe,
    requests,
    async invoke(req: ModelRequest): Promise<string> {
      requests.push(req);
      if (typeof reply === "function") reply();
      return reply as string;
    },
  };
}
