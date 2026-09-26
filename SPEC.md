# Why File: the spec

## What it does

Why File turns a day of ambient, in-person engineering conversation, captured by a Bee
wearable, into version-controlled records of *why* the code looks the way it does. It
answers, months later, a question like "why does this cron run at 3am" or "why Postgres
and not DynamoDB" from a written record, not from memory. It also answers the harder
question nobody thinks to ask: which of those records is no longer true, because a
conversation two months after it quietly settled the same thing a different way.

Why File never states who said something. It extracts the **claim** (a constraint, a
rejected option, a reason), not the claimant. Every record traces to a conversation id
and a timestamp. Attribution comes from git: the wearer is the commit author, and the
people who review and merge the resulting pull request are the ones who supply identity
and assent, because git already holds that cryptographically. The transcript's job is
only to notice that a claim was made.

## Who it is for

An individual engineer who wears a Bee, or a team that keeps one in a room where
architecture gets discussed. The buyer is whoever answers "why is this like this" for
the fifth time this month and would rather point at a merged record.

## The one flow that carries the demo

1. **Announce.** Start a room session. Why File logs the announcement itself, before any
   audio content, as the first record of that session. This is the legal act, not a
   disclaimer (Washington RCW 9.73.030(3), California Penal Code 632(b)).
2. **Capture.** Pull a conversation from Bee's `/v1/conversations/:id`. The fixture used
   for the demo is transcribed exactly the way Bee's own published `bee now` example
   shows it: `speaker: "Unknown"`, fragmentary utterances, mid-sentence starts. This is
   not a simplified stand-in. It is what Bee's own docs demonstrate, deliberately kept
   that way here.
3. **Extract.** Amazon Bedrock reads the speaker-less fragments and proposes claims
   shaped like an ADR: context, decision, rejected options, consequences. One recording
   can produce several records, because one conversation covers several subjects. No
   name field exists anywhere in the type, and model output that reads like attribution
   is dropped before it can become a record (see "Where the model sits" below).
4. **Draft.** Why File opens a local git branch and commit for the claim: a markdown ADR
   file under `decisions/`, authored by the wearer's own git identity (configured, not
   inferred from voice), with a provenance line reading `conversation <id>, <timestamp>`
   and nothing else about who was in the room. This stands in for a pull request; Why File
   never pushes to a remote or calls a code-hosting API.
5. **Ask.** Later, a second person asks Why File a question in plain English. Why File ranks
   the accumulated claims by relevance and recency together and answers with the claim
   text and its provenance: a conversation id and a timestamp, never a quoted name.

Around that spine sit the three things a second day of using the tool needs: find what
a later conversation reversed, review a draft beside the fragments that produced it, and
export the whole log.

The run takes under three minutes and needs no device and no login. It needs Bedrock for
the good answers and runs without it for the plain ones.

## Where the model sits, and what it is not allowed to decide

Claim extraction is the judgement in this product. Deciding that "and so I think being
able to like get shared / transactional consistency across those matters more than / the
write throughput" is a decision about a database, with a reason and a rejected option,
is not a pattern match. The first build matched idioms ("because X", "so X it is",
"not X, the") and missed everything phrased any other way, which the README admitted.
Bedrock does that work now, through a preference chain rather than a hard-coded id.
`ListFoundationModels` advertises models this account cannot invoke, and no API says
which are enabled, so Why File carries an ordered list, newest first, and walks down it
until one answers. A refusal on entitlement grounds is remembered and never retried in
that process; anything else, a timeout or a throttle, does not advance the chain,
because the deadline is already spent. The day access to a newer model lands, the build
uses it with no edit.

Three limits on what the model may decide:

1. **It never supplies provenance.** It picks which utterances a claim came from; the
   conversation id and the timestamp are computed from those utterances' own offsets.
   A model cannot hallucinate a citation into a record when the citation is derived.
   A cited utterance id that does not exist in the transcript takes its claim with it.
2. **It never supplies identity.** It is handed text with no speaker field, so it cannot
   know a name. It can still invent one, echo Bee's `Unknown` label, or return a field
   called `speaker` out of habit. `src/claims/attribution-guard.ts` rejects any object
   key that could hold a person, at any depth, and any prose that attributes a statement
   to a named or pronoun subject. A claim that trips it is dropped, not rewritten,
   because a claim Why File did not record costs one question and a claim that names
   somebody costs the product its argument.
3. **It never gets the last word on availability.** Every call has a hard deadline,
   twice enforced, and one failure type. Timeout, no credentials, no model access,
   malformed JSON: all of it falls back to the rule-based extractor, with the reason
   printed. `ORACLE_BEDROCK=off` takes that path on purpose. Every Bedrock-dependent
   test in the suite runs with the call stubbed.

The same three limits apply to the second model call, contradiction detection.

## What it deliberately does not do

- It does not identify speakers. There is no diarisation, no voiceprint, no name field
  in any data type Why File defines, no code path that could populate one even if Bee
  supplied it, and a guard that drops model output which merely reads as though it does.
- It does not call the real Bee API. `bee login` requires the iOS app with Developer
  Mode unlocked, which this build does not have. Why File mocks Bee's `/v1/*` HTTP shape
  and points the real client shape at it, the same way `bee login --proxy` works in
  Bee's own documented flow. The mock is declared as a mock in the code (see
  `src/bee/mock-server.ts`) and in the README, never disguised as live data.
- It does not push to GitHub, open a real pull request, or call any code-hosting API.
  The "draft PR" is a real local git branch and commit against a scratch repository,
  inspectable with `git log` and `git diff`.
- It does not run unattended. Every draft record needs a human merge, which is what the
  review surface is for. Why File does not claim authority for anything unreviewed.
- It does not store audio. There is no audio field anywhere in the data model. Only
  text, ever.
- It does not run outside a room with an announced session. Capture without a prior,
  logged announcement is refused by the consent gate, not just discouraged.
- It does not hide a record it believes has been reversed. Reversed records rank below
  the record that reversed them and are marked; they are not deleted, because the old
  reasoning is still why the code looked that way for three months.

## Depth beyond the spine

**Topic segmentation.** One conversation is not one decision. The model returns one
claim per subject with the utterances behind each. When it is unreachable, a lexical
cohesion split (`src/claims/segment.ts`) keeps the capability: it takes a boundary where
the vocabulary changes *and* the talking stopped, because requiring both signals stops
it cutting mid-argument, where people restate the same point in new words.

**Contradiction detection across time.** Pairing is deterministic and free: same
subject, different conversations, one strictly later. Judging is one batched Bedrock
call over every candidate pair, which keeps it at one call per sweep. The fallback is
same subject, different decision, later in time; it over-reports, says so in its own
rationale, and reports a low confidence. The demo fixture settles a retry budget at five
in March and at three in June, in two ordinary conversations, neither of which mentions
the other.

**Search that ranks by relevance and recency together.** `score = relevance x recency x
supersession`. Relevance is BM25, matching Bee's own primary search mode. Recency is an
exponential decay with a 120-day half-life, floored at 0.45 so age alone can never bury
the obviously right answer. Supersession multiplies by 0.4. Every hit carries its three
factors so the ranking can be read rather than trusted. On the fixtures the March record
is the better keyword match for "what is the retry budget on the payments call" and
still ranks second, which is the whole point.

**A review surface.** Because a model proposes the records now, the reviewer's question
changed from "is this well written" to "did the room actually settle this". That is
answered in seconds when the cited fragments sit beside the draft with the cited ones
marked and their neighbours shown, since the commonest extraction error is a decision
lifted out of the sentence that walked it back.

**Export.** The whole log as one markdown document and as JSON, carrying the consent
announcements and every reversal found. Exporting the claims without the announcements
would produce a document that reads like a record of secret recording, which is the one
thing this design spends its entire budget avoiding.

**A real MCP toolset.** Thirteen tools, three resources and two prompts, rather than one
tool per demo step. A host can list conversations, capture, list and read claims, review
one against its transcript, sweep for contradictions, ask, draft, export, and read the
consent log. The prompts carry the house rule about naming nobody into the client's own
context. The store persists to a JSON file so a host that reconnects still has the log.

## Consent in a room that keeps minutes

A design argument behind a closed door is the exact case California Penal Code 632 was
written for. None of the statute's escapes are available to it. 632(c) excludes a
communication made in a public gathering, or in any circumstance where the parties may
reasonably expect to be overheard or recorded; four colleagues arguing about a retry
budget in a meeting room are in neither situation, and they would be surprised to learn
otherwise. 632(f) exempts hearing aids, which is not a claim Why File makes. There is no
exclusion here to stand behind, and 637.2 prices being wrong at $5,000 per violation with
no actual damages required.

What is left is 632(b), which excludes from the definition of "person" anyone "known by
all parties... to be recording the communication". That is an instruction rather than a
loophole: announce, and become a known party. Washington RCW 9.73.030(3) supplies the
procedure, consent obtained by announcing "in any reasonably effective manner", provided
"said announcement shall also be recorded". So `startSession()` refuses to return a
session without announcement text, and that announcement is the session's first record,
written before a single utterance is accepted.

That settles the recording. It does not settle Why File's real problem.

### The conversation ends. The commit does not.

Everything else on this track captures something and shows it back to the person who was
there. Why File writes a markdown file into a git repository, on a branch, with a commit
message, under `decisions/`. It will be reviewed by people who were not in the room, and
it will still be there in four years when someone runs `git blame` on the cron schedule
it explains.

Colleagues who agree to be recorded have not thereby agreed to that. A recording is
something you consent to and forget about. A merged decision record is a document with
your argument in it, in a place your employer keeps forever, and the question "who said
the write throughput mattered less" becomes answerable by anyone with a clone. Announcing
the microphone does nothing about this, because the microphone is not the part that
lasts.

Why File's answer is that the artefact has no claimant in it. The extractor takes the
claim, never the speaker: a constraint, a reason, a rejected option. No type in the
codebase has a name field, `attribution-guard.ts` walks the whole parsed model response
and rejects any key at any depth that could hold a person and any prose attributing a
statement to a named or pronoun subject, and a claim that trips it is dropped rather than
repaired. The provenance line on the ADR reads `conversation <id>, <timestamp>` and
nothing else.

Identity then comes back in from the only place that can supply it honestly. The commit
author is the wearer's own configured git identity, set in a config file rather than
inferred from a voice Bee cannot attribute anyway. The people who review the branch and
merge it are supplying assent, in a system built to record exactly that, with their own
credentials. So the room consents to being listened to, and a named human consents to the
document. Those are two different acts and Why File collects them separately, because they
are being asked of two different groups of people at two different times.

### What that means for the session API

There is no always-on mode anywhere in the API. A session belongs to one `roomId` and one
open-to-close window, and `acceptUtterances` silently drops anything arriving from another
room, because capture that outlives the room it was announced in is the failure this
design exists to prevent.

Presence is checked against a roster of device ids: who paired a badge or a laptop into
this room for this stretch. Never against the transcript. The transcript's speaker field
says `Unknown` on every line and the design treats that as permanent rather than as a gap
to fill. If no expected participant is present, the segment is discarded before extraction
sees it.

`startSession()` also requires a `policyRef`, and refuses without one. A workplace already
has a recording policy, in the handbook, agreed under employment terms that predate this
tool. Why File points at that document and declines to author a replacement. This is the one
rule the office setting makes easy: a clinic or a lecture hall has to reason about whose
policy governs, and an employer has already decided.

Audio never exists. No type in this codebase has a field for it, the mock Bee server never
serves one, and `assertTextOnly` rejects any payload carrying an audio-shaped key. A
voiceprint is a biometric identifier in Illinois and Texas, and the product has no use for
one.

The export carries the consent announcements alongside the claims, for the same reason the
ADR carries its provenance line. A decision log exported without the announcements that
produced it is a document that reads like a record of secret recording, which is the thing
this entire design spends its budget avoiding.

## Visual direction

Why File's surface is a command line and an MCP server, not a web app: a developer tool
for a developer audience. The demo output uses a fixed palette in the terminal: claims
render in a deep amber, the colour of a sticky note, deliberately paper-like, because a
claim is a note someone left for later; provenance renders in a muted slate grey,
deliberately recessive, because a conversation id is a footnote and not the headline;
and the consent log renders in plain white, because consent is not decoration. The
review surface is two columns, the record on the left and the transcript on the right,
which is the shape of the judgement being asked for. No other app in this workspace uses
this palette or this CLI-first presentation.

## Stack

TypeScript on Node, run directly (Node's built-in TypeScript support, no build step
needed for the demo). Amazon Bedrock through `@aws-sdk/client-bedrock-runtime`, Converse
API, in `us-east-1`, over a model preference chain rather than one fixed id.
Credentials come from the environment through the SDK's own provider chain, so this
repository holds a region and nothing else. Built as an MCP
server (`@modelcontextprotocol/sdk`, stdio transport) so it plugs into a real MCP client,
plus a CLI demo runner for a judge without an MCP client handy.
