import type { ChannelMessage } from "../../features/relay/contracts";
import type { RelayData } from "../../features/relay/service";

/** Same evidence as the agent squircle in MessageRow: an agent envelope, a known
 * agent key or a self-declared agent profile. Workflow posts and people stay text. */
export function isA2uiMessage(relay: RelayData, message: ChannelMessage) {
  if (!message.content.includes("<a2ui>") || message.workflowOwnerId)
    return false;
  if (message.agentEnvelope) return true;
  const state = relay.snapshot();
  if (state.status !== "ready") return false;
  const { session } = state;
  if (session.profiles.snapshot().get(message.authorId)?.isAgent) return true;
  return session.agentChoices
    .snapshot()
    .identities.some((agent) => agent.pubkey === message.authorId);
}
