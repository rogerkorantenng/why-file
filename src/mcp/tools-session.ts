/**
 * The tools that open a room, close it, and pull conversation out of Bee.
 *
 * `start_session` is the consent gate and is registered first on purpose: no
 * other tool in this file will accept anything until it has run, and its
 * description says so rather than leaving a host to discover it by failing.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Oracle } from "../oracle.ts";
import { text } from "./text.ts";

export function registerSessionTools(server: McpServer, oracle: Oracle): void {
  server.registerTool(
    "start_session",
    {
      title: "Start a capture session",
      description:
        "Announce and open a room-scoped session. Refuses to start without an announcement and a reference to the organisation's own recording policy (consent rules 2 and 4). The announcement is written to the log before any capture is accepted.",
      inputSchema: {
        roomId: z.string().describe("The room this session covers. Capture from any other room is dropped."),
        sessionId: z.string(),
        announcementText: z.string().describe("What was announced out loud to the room."),
        policyRef: z.string().describe("URL or document id of the organisation's recording policy."),
        expectedParticipantDeviceIds: z.array(z.string()).describe("Devices or badges paired into the room. Not people."),
      },
    },
    async ({ roomId, sessionId, announcementText, policyRef, expectedParticipantDeviceIds }) =>
      text(oracle.startSession({ roomId, sessionId, announcementText, policyRef, roster: { roomId, expectedParticipantDeviceIds } })),
  );

  server.registerTool(
    "close_session",
    {
      title: "Close a capture session",
      description: "Ends the session and stamps it closed. Capture against a closed session is refused by the consent gate, not merely discouraged.",
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) => text(oracle.closeSession(sessionId)),
  );

  server.registerTool(
    "list_conversations",
    {
      title: "List conversations available from Bee",
      description: "GET /v1/conversations at the Bee API boundary, which this build mocks. Returns conversation ids that capture_conversation will accept.",
      inputSchema: {},
    },
    async () => text(await oracle.listConversations()),
  );

  server.registerTool(
    "capture_conversation",
    {
      title: "Capture a conversation and extract claims",
      description:
        "Pulls a conversation from Bee's /v1/conversations/:id, strips speaker labels at the client boundary, then asks Amazon Bedrock for the decisions in it. One conversation can yield several claims: the model segments the recording by subject. Falls back to a rule-based extractor if Bedrock is unreachable and says so in the result.",
      inputSchema: {
        sessionId: z.string(),
        conversationId: z.string(),
        presentDeviceIds: z.array(z.string()).describe("Devices actually in the room for this stretch of capture."),
      },
    },
    async ({ sessionId, conversationId, presentDeviceIds }) => text(await oracle.captureConversation(sessionId, conversationId, presentDeviceIds)),
  );

  server.registerTool(
    "consent_log",
    {
      title: "Show the consent announcement log",
      description: "Every announcement Oracle has logged, each one written before any capture under it was accepted. This is the record that makes the capture lawful.",
      inputSchema: {},
    },
    async () => text(oracle.store.allAnnouncements()),
  );
}
