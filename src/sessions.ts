/**
 * The open sessions, and the announcement each one was opened with.
 *
 * Kept apart from the orchestrator because this is the consent half of the
 * product and it has one job: a session cannot exist without an announcement,
 * and the announcement reaches the log before the session is handed back. The
 * ordering in `start` below is the whole legal argument in three lines, so it
 * lives somewhere a reader can find it rather than buried in a capture method.
 */
import { closeSession as stampClosed, startSession as openSession, type StartSessionInput } from "./consent.ts";
import type { ClaimStore } from "./store.ts";
import type { Session } from "./types.ts";

export class SessionBook {
  private readonly sessions = new Map<string, Session>();
  private readonly store: ClaimStore;

  // Written out rather than as a parameter property: Node's strip-only
  // TypeScript mode, which is how this project runs with no build step,
  // rejects `constructor(private readonly store: ClaimStore)` outright.
  constructor(store: ClaimStore) {
    this.store = store;
  }

  /** Refuses without an announcement and a policy reference; logs the
   * announcement before the session is usable for anything. */
  start(input: StartSessionInput): Session {
    const session = openSession(input);
    this.store.addAnnouncement(session.announcement);
    this.sessions.set(session.sessionId, session);
    return session;
  }

  close(sessionId: string, now: () => Date): Session {
    const closed = stampClosed(this.require(sessionId), now);
    this.sessions.set(sessionId, closed);
    return closed;
  }

  require(sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`no such session: ${sessionId}`);
    return session;
  }

  all(): readonly Session[] {
    return [...this.sessions.values()];
  }

  openSessionIds(): readonly string[] {
    return this.all().filter((s) => s.closedAt === null).map((s) => s.sessionId);
  }
}
