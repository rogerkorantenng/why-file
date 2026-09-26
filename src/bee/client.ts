/**
 * The Bee API client. Talks to `/v1/*` over HTTP — the same shape whether the
 * base URL points at the mock server in mock-server.ts or at a real
 * `bee proxy` (port 8787) sitting in front of the real Bee cloud. Nothing in
 * this file or below it can tell the difference, which is the point of
 * mocking at the boundary rather than above it.
 *
 * `stripSpeakers` is the attribution boundary: it is the last place in the
 * codebase that ever sees a `speaker` field, and it deletes it. Every type
 * downstream (Utterance, Claim, DraftRecord) has no field that could hold one.
 */
import type { Conversation, RawConversation, RawUtterance, Utterance } from "../types.ts";

export interface BeeClientOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

function stripSpeaker(u: RawUtterance): Utterance {
  return { id: u.id, text: u.text, startMs: u.startMs, endMs: u.endMs };
}

export function stripSpeakers(raw: RawConversation): Conversation {
  return {
    id: raw.id,
    roomId: raw.roomId,
    startedAt: raw.startedAt,
    endedAt: raw.endedAt,
    utterances: raw.utterances.map(stripSpeaker),
  };
}

export class BeeClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BeeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async listConversationIds(): Promise<string[]> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/conversations`);
    if (!res.ok) throw new Error(`GET /v1/conversations -> ${res.status}`);
    const body = (await res.json()) as { conversations: Array<{ id: string }> };
    return body.conversations.map((c) => c.id);
  }

  /** Returns the conversation with speakers already stripped — callers never
   * receive a RawConversation. */
  async getConversation(id: string): Promise<Conversation> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/conversations/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`GET /v1/conversations/${id} -> ${res.status}`);
    const raw = (await res.json()) as RawConversation;
    return stripSpeakers(raw);
  }
}
