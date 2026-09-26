#!/usr/bin/env node
/**
 * Oracle as an MCP server.
 *
 * The earlier build exposed five tools that were the five steps of the demo.
 * That is a script with a protocol on it, not a toolset: a client that wanted
 * to know what claims exist, read one, check whether it had been reversed, or
 * hand the log to somebody had no call to make. This exposes the shape a host
 * can actually work with, registered in three groups: the tools that open a
 * room and capture from it (mcp/tools-session.ts), the tools that read, judge
 * and ship what was captured (mcp/tools-records.ts), and the resources and
 * prompts (mcp/resources.ts).
 *
 * Every tool that can fail on availability reports what it fell back to rather
 * than erroring, so a host driving Oracle on a plane gets records and a
 * sentence explaining which extractor produced them.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BeeClient } from "./bee/client.ts";
import { createMockBeeServer, listenOnEphemeralPort } from "./bee/mock-server.ts";
import { invokerFromEnv } from "./bedrock/invoker.ts";
import { registerPrompts, registerResources } from "./mcp/resources.ts";
import { registerRecordTools } from "./mcp/tools-records.ts";
import { registerSessionTools } from "./mcp/tools-session.ts";
import { Oracle } from "./oracle.ts";
import { ClaimStore } from "./store.ts";

export function buildOracleMcpServer(oracle: Oracle): McpServer {
  const server = new McpServer({ name: "oracle", version: "0.2.0" });
  registerSessionTools(server, oracle);
  registerRecordTools(server, oracle);
  registerResources(server, oracle);
  registerPrompts(server, oracle);
  return server;
}

async function main(): Promise<void> {
  const mockServer = createMockBeeServer();
  const { baseUrl } = await listenOnEphemeralPort(mockServer);

  const persistTo = process.env.ORACLE_STORE_PATH ?? null;
  const store = persistTo ? await ClaimStore.loadFrom(persistTo) : new ClaimStore();

  const oracle = new Oracle({
    beeClient: new BeeClient({ baseUrl }),
    repoDir: process.env.ORACLE_REPO_DIR ?? `${process.cwd()}/demo-repo`,
    wearer: {
      name: process.env.ORACLE_WEARER_NAME ?? "Oracle Wearer",
      email: process.env.ORACLE_WEARER_EMAIL ?? "wearer@localhost",
    },
    store,
    invoker: invokerFromEnv(),
    ...(persistTo ? { persistTo } : {}),
  });

  await buildOracleMcpServer(oracle).connect(new StdioServerTransport());
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err: unknown) => {
    console.error("oracle mcp server failed to start:", err);
    process.exit(1);
  });
}
