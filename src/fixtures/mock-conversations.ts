/**
 * Fixture data for the mock Bee `/v1/*` server.
 *
 * This is mocked data, declared as such here and in the README. It is shaped the
 * way Bee's own published `bee now` example output is shaped: every speaker is
 * "Unknown", utterances are fragments, sentences start mid-thought, following Bee's own
 * published example output. We did not smooth this out to make extraction easier — the point of
 * the demo is that Oracle works on data this rough.
 *
 * Two things in here are deliberate and carry features:
 *
 * - `conv_6529877` covers two subjects in one recording, separated by the kind
 *   of pause a room makes when it changes topic. It is what topic segmentation
 *   is for: one conversation, two records.
 * - The retry budget is settled at five in March and quietly settled again at
 *   three in June, in a different conversation, with nobody editing the March
 *   record. That is the contradiction the product exists to catch, and it is a
 *   pair of ordinary conversations, neither of which mentions the other.
 */
import type { RawConversation } from "../types.ts";

export const MOCK_CONVERSATIONS: readonly RawConversation[] = [
  {
    id: "conv_6529877",
    roomId: "room_war-room-3",
    startedAt: "2026-03-18T09:31:07Z",
    endedAt: "2026-03-18T09:32:08Z",
    utterances: [
      { id: "u1", speaker: "Unknown", text: "ok so the retry budget on the payments call", startMs: 0, endMs: 2200 },
      { id: "u2", speaker: "Unknown", text: "we're at one right now which is basically no retries", startMs: 2200, endMs: 5000 },
      { id: "u3", speaker: "Unknown", text: "and the upstream flakes in bursts, like two or three", startMs: 5000, endMs: 7800 },
      { id: "u4", speaker: "Unknown", text: "hundred milliseconds and then it's fine again", startMs: 7800, endMs: 9900 },
      { id: "u5", speaker: "Unknown", text: "so five it is, that covers a burst without", startMs: 10400, endMs: 12900 },
      { id: "u6", speaker: "Unknown", text: "waiting forever on a real outage.", startMs: 12900, endMs: 14300 },
      // Long pause: the room changes subject here. Topic segmentation splits on it.
      { id: "u7", speaker: "Unknown", text: "different thing. where do the feature flags live", startMs: 39000, endMs: 41600 },
      { id: "u8", speaker: "Unknown", text: "no, not Consul, the operational load is wrong for", startMs: 41600, endMs: 44300 },
      { id: "u9", speaker: "Unknown", text: "a team this size and we'd be running another", startMs: 44300, endMs: 46900 },
      { id: "u10", speaker: "Unknown", text: "quorum for four booleans", startMs: 46900, endMs: 49000 },
      { id: "u11", speaker: "Unknown", text: "so the flags table, and we move them out if the flag", startMs: 49400, endMs: 52000 },
      { id: "u12", speaker: "Unknown", text: "count gets past a couple of hundred.", startMs: 52000, endMs: 53800 },
    ],
  },
  {
    id: "conv_6531525",
    roomId: "room_war-room-3",
    startedAt: "2026-06-04T14:18:02Z",
    endedAt: "2026-06-04T14:26:40Z",
    utterances: [
      { id: "u1", speaker: "Unknown", text: "so the cron, yeah so it kicks off", startMs: 0, endMs: 2100 },
      { id: "u2", speaker: "Unknown", text: "at three am because that's the low traffic window", startMs: 2100, endMs: 5400 },
      { id: "u3", speaker: "Unknown", text: "and so if we ran it during business hours it would", startMs: 5900, endMs: 8300 },
      { id: "u4", speaker: "Unknown", text: "lock the reporting tables and that's the thing that broke", startMs: 8300, endMs: 11200 },
      { id: "u5", speaker: "Unknown", text: "in March.", startMs: 11200, endMs: 11900 },
      { id: "u6", speaker: "Unknown", text: "right the March incident yeah", startMs: 12400, endMs: 14000 },
      { id: "u7", speaker: "Unknown", text: "we looked at four am too but the backup job", startMs: 14500, endMs: 17100 },
      { id: "u8", speaker: "Unknown", text: "already owns that slot so", startMs: 17100, endMs: 18600 },
      { id: "u9", speaker: "Unknown", text: "three am it is. not changing it without", startMs: 19000, endMs: 21400 },
      { id: "u10", speaker: "Unknown", text: "a real reason.", startMs: 21400, endMs: 22100 },
    ],
  },
  {
    id: "conv_6531611",
    roomId: "room_war-room-3",
    startedAt: "2026-06-09T10:02:14Z",
    endedAt: "2026-06-09T10:11:55Z",
    utterances: [
      { id: "u1", speaker: "Unknown", text: "no, not DynamoDB, the access pattern is wrong", startMs: 0, endMs: 2600 },
      { id: "u2", speaker: "Unknown", text: "for this. we've got ad hoc joins across", startMs: 2600, endMs: 5100 },
      { id: "u3", speaker: "Unknown", text: "like six tables for the billing reconciliation", startMs: 5100, endMs: 7800 },
      { id: "u4", speaker: "Unknown", text: "and so I think being able to like get shared", startMs: 8200, endMs: 10600 },
      { id: "u5", speaker: "Unknown", text: "transactional consistency across those matters more than", startMs: 10600, endMs: 13200 },
      { id: "u6", speaker: "Unknown", text: "the write throughput we'd get from Dynamo.", startMs: 13200, endMs: 15400 },
      { id: "u7", speaker: "Unknown", text: "and I'm number one worried about the migration cost too", startMs: 15900, endMs: 18600 },
      { id: "u8", speaker: "Unknown", text: "if we get this wrong twice.", startMs: 18600, endMs: 20100 },
      { id: "u9", speaker: "Unknown", text: "so postgres, and we revisit if reconciliation", startMs: 20600, endMs: 23000 },
      { id: "u10", speaker: "Unknown", text: "moves off the join-heavy path.", startMs: 23000, endMs: 24500 },
    ],
  },
  {
    id: "conv_6531702",
    roomId: "room_war-room-3",
    startedAt: "2026-06-15T16:40:00Z",
    endedAt: "2026-06-15T16:44:12Z",
    utterances: [
      { id: "u1", speaker: "Unknown", text: "and so I have that retry budget set to three", startMs: 0, endMs: 2400 },
      { id: "u2", speaker: "Unknown", text: "because the upstream rate limiter resets on a", startMs: 2400, endMs: 5000 },
      { id: "u3", speaker: "Unknown", text: "ten second window and three gets us past a blip", startMs: 5000, endMs: 7900 },
      { id: "u4", speaker: "Unknown", text: "without hammering it if it's actually down.", startMs: 7900, endMs: 10200 },
      { id: "u5", speaker: "Unknown", text: "we tried five in staging and it just", startMs: 10700, endMs: 13000 },
      { id: "u6", speaker: "Unknown", text: "made the outage worse, so.", startMs: 13000, endMs: 14300 },
      { id: "u7", speaker: "Unknown", text: "yeah so three it is, on the payments call", startMs: 14800, endMs: 17200 },
      { id: "u8", speaker: "Unknown", text: "until the limiter changes.", startMs: 17200, endMs: 18400 },
    ],
  },
];
