# Why File

Why File is a Bee developer-experience tool. It turns ambient, in-person engineering
conversation into version-controlled records of why the code is the way it is, answers a
question like "why does this cron run at 3am" months later from what was actually said,
and flags the records that a later conversation quietly reversed.

It never states who said anything. See `SPEC.md` for the full design and the reasoning
behind it; this file is about running it.

## What is mocked

Two routes. `GET /v1/conversations` and `GET /v1/conversations/:id` are everything Why File
asks of Bee: read-only, no facts, no todos, no writes. `src/bee/mock-server.ts` serves
those two over HTTP in the documented shape and `src/bee/client.ts`, the real client,
is pointed at it, the way Bee's docs describe pointing `bee proxy` at a local process.
The client is not stubbed; it builds the request and parses the response, and only the
origin of the bytes is ours.

It is mocked because every Bee developer path (`bee-cli`, `bee proxy`, the MCP server,
the Skill) requires `bee login`, which requires the iOS app with Developer Mode unlocked.
There is no web login, no API key and no published sample payload set.

The fixtures carry `Unknown` as the speaker on every line, with fragmentary utterances
that start mid-sentence, because that is what Bee's own `bee now` output looks like. The
transcripts are deliberately not cleaned up. An extractor tuned on tidy sentences would
be demonstrating something the device cannot supply. See SPEC.md's "What it deliberately
does not do".

Why File also never pushes to GitHub or calls a code-hosting API. "Opening a pull request"
is a real local git branch and commit against a scratch repository (`src/git-pr.ts`),
inspectable with `git log` and `git diff`.

**Amazon Bedrock is not mocked.** When credentials are present it is called for real.
When it is not reachable, Why File says so on screen and runs the rule-based extractor
instead.

## Requirements

Node 22 or newer (built and tested on Node 25.6.1), which runs the TypeScript sources
directly with no build step. `git` must be on `PATH` for the draft-record step.

For the model path: AWS credentials that can call `bedrock:Converse` in `us-east-1`.
Credentials come from the environment through the AWS SDK's own provider chain, so no
account id or key appears anywhere in this repository. Without them the demo still runs
end to end.

Why File does not hard-code a model. It carries a preference chain, newest first, and
walks down it until one answers:

```
us.anthropic.claude-sonnet-5
us.anthropic.claude-sonnet-4-6
us.anthropic.claude-sonnet-4-5-20250929-v1:0
```

A model this account cannot invoke is refused in about a fifth of a second, remembered
as refused, and never tried again in that process. The day access to a newer model
lands, the build picks it up with no edit. `ORACLE_BEDROCK_MODEL_ID` replaces the chain
with your own, one id or a comma-separated list.

## Install

```bash
npm install
```

## Run the demo

```bash
npm run demo              # with Bedrock
ORACLE_BEDROCK=off npm run demo   # deterministic, no network, no credentials
```

Runs the whole flow against the mock server and the fixture conversations: announce a
room session, capture four conversations and extract the decisions in them, find the
March decision that a June conversation reversed, show one draft record beside the
fragments it came from, commit each record to a local git branch, ask two questions and
show how each answer was ranked, then export the log. Takes a few seconds.

Watch for these four things, which are the demo:

- **conv_6529877 yields two records.** One recording, two subjects, split where the room
  changed topic.
- **The retry budget.** March settles it at five, June settles it at three, in two
  ordinary conversations that never mention each other. Why File reports the reversal.
- **The ranking line under each answer.** The March record is the *better* keyword match
  for "what is the retry budget on the payments call" and still comes second, because
  recency and supersession are in the score and the factors are printed.
- **Run it both ways.** With Bedrock the records are written in sentences. Without it,
  the idioms find "five" and "three" and not much else. That gap is why the model is in
  the product rather than decorating it, and the second run is the honest demonstration
  that losing the network costs quality and not the tool.
- **The line above step 1** names the preferred model. The line under each record names
  the model that actually answered, which is often further down the chain.

## Run the REPL

```bash
npm run repl                       # interactive
node src/repl.ts log               # or one command, straight from the shell, no prompt
ORACLE_BEDROCK=off npm run repl    # deterministic, no network, no credentials
```

`npm run demo` is a script: eight fixed steps and it exits. This is the other shape —
announce a session, pull today's conversations, read the log, ask it a question, review
a draft, commit it, in whatever order the day actually goes, without restarting between
any of them. Tab-completes command names, conversation ids and claim ids; every command
also runs one-shot from the shell exactly as it would at the prompt, which is what makes
`node src/repl.ts ask "..."` work without opening the REPL at all.

Commands: `announce`, `capture [conversationId]`, `log`, `ask <question>`,
`review <claimId>`, `commit <claimId>`, `sweep`, `export [dir]`, `status`, `help`,
`clear`, `exit`. Drawn from what Why File is *for* — the log ends in a git commit, so
`commit` is a command, not `save` or `write`. A sibling Bee project's REPL is a review
queue with a deliberately different vocabulary, chosen because that app's job is not
this one's.

The REPL persists claims to `.oracle/repl-store.json` and commits drafts to
`~/.oracle/repl-repo` by default (both overridable with `ORACLE_STORE_PATH` and
`ORACLE_REPO_DIR` below) — not `./demo-repo`, the MCP server's default, because that
path sits inside this monorepo's own git repository and `git init` on a directory
already nested in one is a no-op.

## Environment

| Variable | Default | What it does |
|---|---|---|
| `ORACLE_BEDROCK` | unset | `off` runs the deterministic path throughout |
| `ORACLE_BEDROCK_MODEL_ID` | the preference chain above | One inference profile id, or several comma-separated, tried in order |
| `ORACLE_BEDROCK_REGION` / `AWS_REGION` | `us-east-1` | Bedrock region |
| `ORACLE_BEDROCK_TIMEOUT_MS` | `12000` | Hard deadline per model call |
| `ORACLE_STORE_PATH` | unset | JSON file the MCP server persists claims to |
| `ORACLE_REPO_DIR` | `./demo-repo` | Scratch git repo for draft records |
| `ORACLE_WEARER_NAME` / `ORACLE_WEARER_EMAIL` | `Why File Wearer` | Commit identity for drafts |

## Run as an MCP server

```bash
npm run mcp
```

Starts Why File on stdio with thirteen tools, three resources and two prompts:

- **Session and consent:** `start_session`, `close_session`, `consent_log`
- **Capture:** `list_conversations`, `capture_conversation`
- **Read:** `list_claims`, `get_claim`, `ask`, `status`
- **Judge:** `review_claim`, `find_contradictions`
- **Ship:** `draft_record`, `export_decision_log`
- **Resources:** `oracle://claims`, `oracle://consent-log`, `oracle://record/{claimId}`
- **Prompts:** `why-is-this-like-this`, `review-a-draft-record`

Point any MCP client at it, for example as a local stdio server in Claude Code or Claude
Desktop's MCP config:

```json
{
  "mcpServers": {
    "oracle": {
      "command": "node",
      "args": ["/absolute/path/to/why-file/src/mcp-server.ts"],
      "env": { "ORACLE_STORE_PATH": "/absolute/path/to/oracle-store.json" }
    }
  }
}
```

`start_session` must be called before `capture_conversation` will accept anything. It is
the consent gate, not a formality (see "Consent design" in SPEC.md).

## Test

```bash
npm test
```

214 tests and 15 skipped, `node --test` against the TypeScript sources directly, no build step. **Every
Bedrock-dependent test runs with the model call stubbed**, so the suite needs no
credentials and no network. Covers: the five consent rules, including that a closed or
un-announced session refuses capture; that a model response carrying a `speaker` field,
or prose that names somebody, is dropped rather than rewritten; that a claim citing an
utterance the transcript does not contain is dropped; that a model this account cannot
invoke is stepped past while a timeout is not, because the deadline is already spent;
that an unreachable model falls
back with the reason attached rather than failing the capture; that one recording with
two subjects becomes two records; that a March decision reversed in June is found and
ranked accordingly; that a reversed record stays findable; that no claim, provenance,
rendered record, export or persisted file ever contains a speaker field or the word
`Unknown`; the mock server's HTTP shape; that `draftRecord` opens a real git branch with
no remote configured; the MCP surface driven through a real client over an in-memory
transport; and the REPL's command dispatch and tab completion (`test/repl.test.ts`) —
every command over the mock day, an unknown command handled without throwing, an
unknown id reported rather than crashing the process, and completion offering command
names, conversation ids and claim ids in the right contexts.

```bash
npm run typecheck
```

`tsc --noEmit` in strict mode.

## Known limitations

- The model can be wrong about what a room settled. That is why nothing merges without a
  human: `review_claim` puts the draft beside the fragments it came from, with the cited
  ones marked and their neighbours shown, because the commonest extraction error is a
  decision lifted out of the sentence that walked it back.
- The rule-based fallback is weak, and is meant to be. It matches a handful of idioms
  (`because`, `if`, `so X it is`, `not X, the`) and misses everything else. It exists so
  the tool still works with no network, not so it can replace the model.
- Contradiction detection compares pairs of claims about the same subject. It will not
  notice a reversal phrased with no shared vocabulary at all, because such a pair never
  becomes a candidate.
- `ask` ranks with BM25 for relevance, matching Bee's own primary search mode. It will
  not find a claim whose wording shares no terms with the question, the same limitation
  Bee's own search has. Bee's separate neural mode is not implemented here and not
  claimed.
- The store is a single JSON file. It is enough for one wearer and one room and would
  not survive concurrent writers.
- Reviewer assignment on the draft record (who is asked to approve) is out of scope. A
  real deployment would source it from the same room roster `consent.ts` already uses,
  known device and badge pairings, never a name the transcript claims to have heard.

## Licence

MIT.
