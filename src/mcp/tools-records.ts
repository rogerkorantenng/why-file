/**
 * The tools that read, judge and ship what has been captured.
 *
 * This half is what turns Oracle from a five-step demo script into something
 * a host can actually work with: list, read, review against the transcript,
 * sweep for reversals, ask, draft, export, and ask what Oracle is running on.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Oracle } from "../oracle.ts";
import { renderReview } from "../review.ts";
import { text } from "./text.ts";

export function registerRecordTools(server: McpServer, oracle: Oracle): void {
  server.registerTool(
    "list_claims",
    { title: "List every claim, newest first", description: "The whole decision log as structured records, newest first, each with its provenance and the extractor that produced it.", inputSchema: {} },
    async () => text(oracle.claims()),
  );

  server.registerTool(
    "get_claim",
    { title: "Read one claim", description: "One record and its provenance: a conversation id and a timestamp, never a name. Answers rather than throwing when the id is unknown.", inputSchema: { claimId: z.string() } },
    async ({ claimId }) => {
      const claim = oracle.store.getClaim(claimId);
      return claim ? text(claim) : text(`no such claim: ${claimId}`);
    },
  );

  server.registerTool(
    "review_claim",
    {
      title: "Review a draft record beside its transcript",
      description:
        "Returns the rendered decision record, the exact speaker-less fragments it was drawn from with the cited ones marked, the fragments either side for context, and anything a reviewer should check before merging.",
      inputSchema: { claimId: z.string(), render: z.boolean().optional().describe("Return the two-column text layout instead of JSON.") },
    },
    async ({ claimId, render }) => {
      const review = oracle.review(claimId);
      return text(render ? renderReview(review) : review);
    },
  );

  server.registerTool(
    "find_contradictions",
    {
      title: "Find decisions a later conversation reversed",
      description:
        "Sweeps every stored claim for a later record that settles the same subject differently. Pairing is deterministic; the judgement is one batched Bedrock call, with a word-overlap heuristic as the fallback.",
      inputSchema: {},
    },
    async () => text(await oracle.findContradictions()),
  );

  server.registerTool(
    "ask",
    {
      title: "Ask why something is the way it is",
      description:
        "Ranks claims by relevance and recency together, and pushes a record that a later conversation reversed below the one that reversed it. Each hit shows its own relevance, recency and supersession factors. Answers carry provenance, never a name.",
      inputSchema: { question: z.string(), limit: z.number().int().positive().optional() },
    },
    async ({ question, limit }) => text(oracle.ask(question, limit === undefined ? {} : { limit })),
  );

  server.registerTool(
    "draft_record",
    {
      title: "Draft a pull request for a claim",
      description: "Opens a local git branch and commit for a claim (never pushed, never calls a code-hosting API). The wearer's configured git identity is the commit author.",
      inputSchema: { claimId: z.string() },
    },
    async ({ claimId }) => text(await oracle.draftRecordForClaim(claimId)),
  );

  server.registerTool(
    "export_decision_log",
    {
      title: "Export the decision log",
      description: "The whole log as one markdown document plus JSON, including the consent announcements and every reversal found. Writes to disk when given a directory.",
      inputSchema: { outDir: z.string().optional().describe("Directory to write decision-log.md and decision-log.json into.") },
    },
    async ({ outDir }) => text(outDir ? await oracle.exportLogTo(outDir) : oracle.exportLog().markdown),
  );

  server.registerTool(
    "status",
    { title: "What Oracle is running on", description: "Which extractor is configured, which one last ran, why it fell back if it did, how much is stored, and which sessions are open.", inputSchema: {} },
    async () => text(oracle.status()),
  );
}
