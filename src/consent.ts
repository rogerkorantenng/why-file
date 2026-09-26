/**
 * Consent, for a room where colleagues argue and the output is a commit.
 *
 * Cal. Penal Code 632 offers this setting no exclusion: a closed meeting is not a public
 * gathering under 632(c), and 632(f) is about hearing aids. The only way out is 632(b),
 * which excludes from "person" anyone known by all parties to be recording. Washington
 * RCW 9.73.030(3) gives the procedure: announce "in any reasonably effective manner",
 * and record the announcement. Hence `startSession`, which cannot return a session
 * without announcement text, and writes that text as the session's first fact.
 *
 * The announcement covers the listening. It does not cover the commit, which outlives
 * the room and will be read by people who were never in it. That second problem is
 * answered in `adr.ts` and `git-pr.ts` rather than here: the record carries no claimant,
 * and identity re-enters as a git author and a human merge. See SPEC.md, "The
 * conversation ends. The commit does not."
 *
 * Three things this module refuses:
 *
 * - A session without an announcement, or without a `policyRef`. The office already has
 *   a recording policy and Oracle points at it rather than inventing one.
 * - Capture from outside the session's room or its open-to-close window. There is no
 *   always-on path; `acceptUtterances` drops cross-room segments without reading them.
 * - Capture with no expected participant present, judged against the roster of device
 *   ids paired into the room, never against a speaker label. Bee labels every speaker
 *   `Unknown` and this code treats that as permanent.
 *
 * Audio is excluded by the type system rather than by a check here. `assertTextOnly`
 * exists to catch a payload from outside that shape.
 */
import type { ConsentAnnouncement, Session, SessionRoster, Utterance } from "./types.ts";

export class ConsentViolation extends Error {}

export interface StartSessionInput {
  readonly roomId: string;
  readonly sessionId: string;
  readonly announcementText: string;
  readonly policyRef: string;
  readonly roster: SessionRoster;
  readonly now?: () => Date;
}

export function startSession(input: StartSessionInput): Session {
  if (!input.announcementText.trim()) {
    throw new ConsentViolation("cannot start a session without an announcement (rule 2: announce and log)");
  }
  if (!input.policyRef.trim()) {
    throw new ConsentViolation(
      "cannot start a session without policyRef (rule 4: sit inside an institution's existing policy)",
    );
  }
  if (input.roster.roomId !== input.roomId) {
    throw new ConsentViolation("roster.roomId must match the session's roomId (rule 1: room-scoped)");
  }

  const now = input.now ?? (() => new Date());
  const announcedAt = now().toISOString();
  const announcement: ConsentAnnouncement = {
    roomId: input.roomId,
    sessionId: input.sessionId,
    announcedAt,
    announcementText: input.announcementText,
    policyRef: input.policyRef,
  };

  return {
    sessionId: input.sessionId,
    roomId: input.roomId,
    announcement,
    roster: input.roster,
    openedAt: announcedAt,
    closedAt: null,
  };
}

export function closeSession(session: Session, now: () => Date = () => new Date()): Session {
  return { ...session, closedAt: now().toISOString() };
}

/** Rule 3: discard segments with no expected speaker present. `presentDeviceIds`
 * is who paired into the room for this stretch of capture, never a claim read
 * off the transcript. */
export function acceptUtterances(
  session: Session,
  utterancesRoomId: string,
  utterances: readonly Utterance[],
  presentDeviceIds: readonly string[],
): readonly Utterance[] {
  if (session.closedAt !== null) {
    throw new ConsentViolation(`session ${session.sessionId} is closed`);
  }
  if (utterancesRoomId !== session.roomId) {
    return []; // rule 1: room-scoped, silently drop cross-room capture
  }
  const anyExpectedPresent = session.roster.expectedParticipantDeviceIds.some((id) => presentDeviceIds.includes(id));
  if (!anyExpectedPresent) {
    return []; // rule 3: no expected speaker present, discard the segment
  }
  return utterances;
}

const AUDIO_FIELD_NAMES = ["audio", "audioUrl", "audioBlob", "wav", "pcm", "recordingUrl"];

/** Rule 5: keep text, not audio. Defensive runtime check on top of the type
 * system, in case an upstream payload (real Bee, not our mock) ever carries
 * an audio field — it gets rejected here rather than silently stored. */
export function assertTextOnly(payload: Record<string, unknown>): void {
  for (const field of AUDIO_FIELD_NAMES) {
    if (field in payload) {
      throw new ConsentViolation(`payload carries an audio field ("${field}") — rule 5 keeps text, not audio`);
    }
  }
}
