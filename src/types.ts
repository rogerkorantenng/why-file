/**
 * Core data model.
 *
 * Deliberate omission: no type in this file has a `speaker`, `name`, `who`, or
 * `person` field. That is the design, not an oversight — see SPEC.md. Bee's own
 * `/v1/conversations/:id` response does carry a `speaker` field (always "Unknown"
 * in practice; see fixtures/mock-conversations.ts), but `stripSpeakers()` in
 * bee/client.ts removes it before any utterance reaches extraction. Nothing
 * downstream of that boundary can name a claimant even by accident, because the
 * field it would need does not exist on the type.
 */

/** A single fragment of transcript, as Bee's own docs publish them: fragmentary,
 * mid-sentence, source of the utterance never asserted beyond "someone". */
export interface RawUtterance {
  readonly id: string;
  readonly speaker: "Unknown" | string;
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

/** The same utterance after the consent/attribution boundary. No speaker field
 * exists on this type — compare RawUtterance above. */
export interface Utterance {
  readonly id: string;
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

export interface RawConversation {
  readonly id: string;
  readonly roomId: string;
  readonly startedAt: string; // ISO 8601
  readonly endedAt: string;
  readonly utterances: readonly RawUtterance[];
}

export interface Conversation {
  readonly id: string;
  readonly roomId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly utterances: readonly Utterance[];
}

/** Provenance is a conversation id and a timestamp. Never a quoted name. */
export interface Provenance {
  readonly conversationId: string;
  readonly timestamp: string; // ISO 8601, the utterance's startMs resolved against startedAt
  readonly sourceUtteranceIds: readonly string[];
}

export type ClaimKind = "decision" | "constraint" | "rejected-option";

/** An ADR-shaped claim. Context, Decision, Consequences. No name field.
 *
 * `topic` is a short subject label ("nightly reconciliation cron"), used to
 * group claims and to decide which pairs are worth comparing for a
 * contradiction. It labels the subject, never a person. `extractor` records
 * which path produced the claim — a Bedrock model id or "rules" — so a
 * reviewer can see whether a judgement or a regex is behind it. */
export interface Claim {
  readonly id: string;
  readonly kind: ClaimKind;
  readonly topic: string;
  readonly context: string;
  readonly decision: string;
  readonly rejectedOptions: readonly string[];
  readonly consequences: string;
  readonly provenance: Provenance;
  readonly extractedAt: string;
  /** "rules" or "bedrock:<model id>". Never a person. */
  readonly extractor: string;
  /** 0 to 1. The rule-based path reports its own certainty, not the model's. */
  readonly confidence: number;
}

/** How a later claim stands to an earlier one on the same subject.
 *
 * "supersedes" is the finding the product exists for: a decision taken in one
 * month that a conversation two months later quietly reverses, with nobody
 * editing the record in between. */
export type RelationKind = "supersedes" | "refines";

export interface ClaimRelation {
  readonly laterClaimId: string;
  readonly earlierClaimId: string;
  readonly kind: RelationKind;
  /** Why, in one sentence about the subject. Passed through the attribution
   * guard like every other piece of model prose. */
  readonly rationale: string;
  /** "bedrock:<model id>" or "heuristic". */
  readonly detectedBy: string;
  readonly detectedAt: string;
  readonly confidence: number;
}

export interface DraftRecord {
  readonly claimId: string;
  readonly branch: string;
  readonly filePath: string;
  readonly commitSha: string;
  readonly commitAuthor: string;
  readonly title: string;
  readonly body: string;
}

/** A session's expected roster is who paired a device/badge into the room — not
 * who the transcript claims is speaking. Used only to decide whether to discard
 * a segment, never to attribute one. */
export interface SessionRoster {
  readonly roomId: string;
  readonly expectedParticipantDeviceIds: readonly string[];
}

export interface ConsentAnnouncement {
  readonly roomId: string;
  readonly sessionId: string;
  readonly announcedAt: string;
  readonly announcementText: string;
  readonly policyRef: string;
}

export interface Session {
  readonly sessionId: string;
  readonly roomId: string;
  readonly announcement: ConsentAnnouncement;
  readonly roster: SessionRoster;
  readonly openedAt: string;
  closedAt: string | null;
}
