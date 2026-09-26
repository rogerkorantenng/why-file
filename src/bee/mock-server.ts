/**
 * A mock of two Bee routes, and only two.
 *
 * `GET /v1/conversations` and `GET /v1/conversations/:id`. That is Why File's entire
 * surface against Bee: read-only, no facts, no todos, no journals, no write path of any
 * kind. The real API serves all of those and this file does not pretend to cover them,
 * because covering them would be mocking capability the product never asks for.
 *
 * It exists because every Bee developer path needs `bee login`, which needs the iOS app
 * with Developer Mode unlocked, and this build has no device. So the documented response
 * shapes are served over real HTTP and the real client in `client.ts` is pointed at them,
 * which is the same mechanism Bee's own docs describe for `bee login --proxy
 * http://127.0.0.1:8787`. The client builds the paths and parses the payloads for real.
 * Only the origin of the bytes is ours.
 *
 * The fixtures are transcribed the way Bee's own published `bee now` output is written:
 * `speaker: "Unknown"` on every line, utterances as fragments, sentences starting
 * mid-thought. That is not a simplification made to be easy on the extractor. It is the
 * hardest input the real device would produce, and it is why the extractor has no name
 * field to fill in.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { MOCK_CONVERSATIONS } from "../fixtures/mock-conversations.ts";
import type { RawConversation } from "../types.ts";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

export function createMockBeeServer(conversations: readonly RawConversation[] = MOCK_CONVERSATIONS): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] !== "v1" || parts[1] !== "conversations") {
      sendJson(res, 404, { error: "not_found", message: `mock Bee server has no route for ${url.pathname}` });
      return;
    }

    if (parts.length === 2) {
      sendJson(res, 200, {
        conversations: conversations.map((c) => ({ id: c.id, roomId: c.roomId, startedAt: c.startedAt })),
        cursor: null,
      });
      return;
    }

    const id = parts[2];
    const found = conversations.find((c) => c.id === id);
    if (!found) {
      sendJson(res, 404, { error: "not_found", message: `no conversation ${id}` });
      return;
    }
    sendJson(res, 200, found);
  });
}

export async function listenOnEphemeralPort(server: Server): Promise<{ port: number; baseUrl: string }> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected an AddressInfo from an ephemeral port bind");
  }
  return { port: address.port, baseUrl: `http://127.0.0.1:${address.port}` };
}
