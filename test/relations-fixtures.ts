/** Three claims that stand in for the demo's own history: a retry budget
 * settled in March, settled again differently in June, and an unrelated cron
 * decision that must never be paired with either. No tests of their own. */
import { makeClaim } from "./helpers.ts";

export const NOW = () => new Date("2026-09-22T00:00:00Z");

export const march = makeClaim({
  id: "claim_march",
  topic: "payments call retry budget",
  decision: "five",
  context: "the upstream flakes in bursts of two or three hundred milliseconds",
  provenance: { conversationId: "conv_march", timestamp: "2026-03-18T09:31:17Z", sourceUtteranceIds: ["u5"] },
});

export const june = makeClaim({
  id: "claim_june",
  topic: "payments call retry budget",
  decision: "three",
  context: "the upstream rate limiter resets on a ten second window",
  provenance: { conversationId: "conv_june", timestamp: "2026-06-15T16:40:02Z", sourceUtteranceIds: ["u7"] },
});

export const unrelated = makeClaim({
  id: "claim_cron",
  topic: "nightly cron schedule",
  decision: "three am",
  context: "the low traffic window, the reporting tables lock during business hours",
  provenance: { conversationId: "conv_cron", timestamp: "2026-06-04T14:18:04Z", sourceUtteranceIds: ["u9"] },
});

