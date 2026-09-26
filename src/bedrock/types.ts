/**
 * The model boundary.
 *
 * Everything that wants a judgement from Amazon Bedrock goes through
 * `ModelInvoker`, an interface with one method and one failure type. Two
 * things follow from that: every test can pass a stub and never touch the
 * network, and every caller has exactly one error to handle and one
 * deterministic fallback for it.
 */

export interface ModelRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export interface ModelInvoker {
  /** Identifies the extractor in stored records, for example
   * "bedrock:us.anthropic.claude-sonnet-4-6". After a call it names the model
   * that actually answered, which is what gets written onto a claim. It never
   * holds a person's name. */
  readonly describe: string;
  invoke(req: ModelRequest): Promise<string>;
}
