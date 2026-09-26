/**
 * What the model is told, and what it is shown.
 *
 * The system prompt states the house rule in the same words the guard
 * enforces, so a refusal is a second line of defence rather than the only one.
 * The transcript is rendered with utterance ids and nothing else: no speaker
 * field reaches this point, so the model is not asked to ignore a name, it is
 * never given one.
 */
import type { Conversation } from "../types.ts";

export const EXTRACTION_SYSTEM_PROMPT = `You read transcripts of in-person engineering conversations and pull out the decisions that were made, so they can be written down as architecture decision records.

The transcript is fragmentary. Utterances start mid-sentence, run on, and stop. It carries no speaker labels at all, and that is deliberate: this system never states who said anything. Never write a name, a pronoun subject with a verb of saying, a speaker label, or the word Unknown. Write about the subject, not about the room.

One conversation often covers several subjects. Return one claim per subject that was actually settled, discussed as a constraint, or explicitly ruled out. Return an empty array if the conversation settled nothing; small talk is not a claim. Do not invent a decision that was not reached, and do not smooth a half-finished argument into a conclusion.

Reply with JSON only, an array of objects with exactly these fields:
  topic: 2 to 5 words naming the subject, lower case
  kind: one of "decision", "constraint", "rejected-option"
  context: why this came up, one or two sentences, in the room's own terms
  decision: what was settled, as short as it can be said
  rejectedOptions: array of options ruled out, each just the option, or []
  consequences: what follows, or what would reopen the question, or ""
  sourceUtteranceIds: the ids of the utterances this claim came from
  confidence: 0 to 1, how sure you are this was really settled

Every id in sourceUtteranceIds must be an id that appears in the transcript below.`;

export function renderTranscript(conversation: Conversation): string {
  const lines = conversation.utterances.map((u) => `[${u.id}] ${u.text}`);
  return [
    `Conversation ${conversation.id}, recorded ${conversation.startedAt}.`,
    "",
    ...lines,
  ].join("\n");
}
