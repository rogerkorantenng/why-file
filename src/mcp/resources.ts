/**
 * Resources and prompts.
 *
 * Resources let a host read the log and any one record by URI, without
 * spending a tool call on it. The prompts carry the house rule into the
 * client's own context: a host that asks a model to answer from these records
 * has to be told, in the prompt, that the records name nobody deliberately and
 * that the answer must not guess.
 */
import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderAdrMarkdown } from "../adr.ts";
import type { Oracle } from "../oracle.ts";

export function registerResources(server: McpServer, oracle: Oracle): void {
  server.registerResource(
    "claims",
    "oracle://claims",
    { title: "Every claim", description: "The decision log as JSON, newest first.", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(oracle.claims(), null, 2) }] }),
  );

  server.registerResource(
    "consent-log",
    "oracle://consent-log",
    { title: "Consent announcements", description: "The announcements that made each capture lawful.", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(oracle.store.allAnnouncements(), null, 2) }] }),
  );

  server.registerResource(
    "decision-record",
    new ResourceTemplate("oracle://record/{claimId}", { list: undefined }),
    { title: "One decision record", description: "The rendered markdown record for a claim, with any reversal noted.", mimeType: "text/markdown" },
    async (uri, variables) => {
      const claimId = String(variables["claimId"]);
      const claim = oracle.store.getClaim(claimId);
      const body = claim ? renderAdrMarkdown(claim, oracle.store.relationsFor(claimId)) : `No claim ${claimId}.`;
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: body }] };
    },
  );
}

function userMessage(body: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text: body } }] };
}

export function registerPrompts(server: McpServer, _oracle: Oracle): void {
  server.registerPrompt(
    "why-is-this-like-this",
    {
      title: "Answer a why question from the decision log",
      description: "Asks Oracle and answers with provenance, without naming anybody.",
      argsSchema: { question: z.string() },
    },
    ({ question }) =>
      userMessage(
        `Use the oracle "ask" tool to answer: ${question}\n\nAnswer from the records it returns. Quote the decision and the reason. Cite provenance as the conversation id and timestamp exactly as the record gives it. Never say or guess who said anything: these records name nobody, deliberately, and neither should the answer. If the top record has been reversed by a later one, lead with the later one and say the earlier one was reversed.`,
      ),
  );

  server.registerPrompt(
    "review-a-draft-record",
    {
      title: "Review a draft decision record",
      description: "Checks a drafted record against the fragments it came from before it is merged.",
      argsSchema: { claimId: z.string() },
    },
    ({ claimId }) =>
      userMessage(
        `Use the oracle "review_claim" tool on ${claimId}. Read the record beside the transcript fragments. Say whether the room actually settled this, whether the decision was lifted out of a sentence that walked it back, and whether anything in the record is not supported by a cited fragment. Do not suggest adding who said what: that is out of scope by design.`,
      ),
  );
}
