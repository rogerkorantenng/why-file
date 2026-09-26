/**
 * Why the consent gate dropped a stretch of capture.
 *
 * The gate returns an empty list rather than throwing, because a dropped
 * segment is normal operation and not an error. That leaves the caller with
 * nothing to show a user, which is how a consent rule becomes invisible. This
 * names the rule that fired, in the words of SPEC.md's consent section, so the
 * refusal appears in the capture result and in the MCP response.
 */
export function refusalReason(conversationId: string, conversationRoomId: string, sessionRoomId: string): string {
  if (conversationRoomId !== sessionRoomId) {
    return `conversation ${conversationId} was recorded in ${conversationRoomId}, not this session's room (consent rule 1)`;
  }
  return "no rostered device was present for this stretch of capture (consent rule 3)";
}
