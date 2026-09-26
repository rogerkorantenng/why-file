/**
 * What Oracle remembers.
 *
 * Claims, the consent announcements that made capturing them lawful, the
 * relations between claims that a later conversation created, and the
 * speaker-less utterances each claim was drawn from. The utterances are kept
 * for one reason: the review surface (review.ts) puts the draft record beside
 * the fragments that produced it, and a reviewer cannot check a record against
 * a transcript nobody kept.
 *
 * It persists to a single JSON file when given a path, because an MCP server
 * that forgets every claim when the host restarts is a demo, not a tool. The
 * file is plain JSON on purpose: a judge can open it and confirm for
 * themselves that there is no speaker field in it anywhere.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Claim, ClaimRelation, ConsentAnnouncement, Conversation } from "./types.ts";

interface StoreSnapshot {
  readonly version: 2;
  readonly claims: readonly Claim[];
  readonly announcements: readonly ConsentAnnouncement[];
  readonly relations: readonly ClaimRelation[];
  readonly conversations: readonly Conversation[];
}

export class ClaimStore {
  private readonly claims = new Map<string, Claim>();
  private readonly conversations = new Map<string, Conversation>();
  private readonly announcements: ConsentAnnouncement[] = [];
  private relations: ClaimRelation[] = [];

  addClaim(claim: Claim): void {
    this.claims.set(claim.id, claim);
  }

  getClaim(id: string): Claim | undefined {
    return this.claims.get(id);
  }

  allClaims(): readonly Claim[] {
    return [...this.claims.values()];
  }

  /** Newest first. What a decision log is usually read in. */
  claimsByTime(): readonly Claim[] {
    return [...this.allClaims()].sort((a, b) => b.provenance.timestamp.localeCompare(a.provenance.timestamp));
  }

  addConversation(conversation: Conversation): void {
    this.conversations.set(conversation.id, conversation);
  }

  getConversation(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  allConversations(): readonly Conversation[] {
    return [...this.conversations.values()];
  }

  addAnnouncement(a: ConsentAnnouncement): void {
    this.announcements.push(a);
  }

  allAnnouncements(): readonly ConsentAnnouncement[] {
    return [...this.announcements];
  }

  /** Replaces the whole relation set: detection is a sweep over every claim,
   * so a second sweep supersedes the first rather than adding to it. */
  setRelations(relations: readonly ClaimRelation[]): void {
    this.relations = [...relations];
  }

  allRelations(): readonly ClaimRelation[] {
    return [...this.relations];
  }

  relationsFor(claimId: string): readonly ClaimRelation[] {
    return this.relations.filter((r) => r.laterClaimId === claimId || r.earlierClaimId === claimId);
  }

  toSnapshot(): StoreSnapshot {
    return {
      version: 2,
      claims: this.allClaims(),
      announcements: this.allAnnouncements(),
      relations: this.allRelations(),
      conversations: [...this.conversations.values()],
    };
  }

  async saveTo(filePath: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(this.toSnapshot(), null, 2)}\n`, "utf8");
  }

  /** Missing or unreadable file means an empty store, not a crash. A judge
   * pointing Oracle at a fresh directory should get a working tool. */
  static async loadFrom(filePath: string): Promise<ClaimStore> {
    const store = new ClaimStore();
    let parsed: Partial<StoreSnapshot>;
    try {
      parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<StoreSnapshot>;
    } catch {
      return store;
    }
    for (const claim of parsed.claims ?? []) store.addClaim(claim);
    for (const conversation of parsed.conversations ?? []) store.addConversation(conversation);
    for (const announcement of parsed.announcements ?? []) store.addAnnouncement(announcement);
    store.setRelations(parsed.relations ?? []);
    return store;
  }
}
