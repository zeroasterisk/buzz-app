import { lazy, Suspense, useMemo, useSyncExternalStore } from "react";
import type {
  ConversationExtensions,
  TargetOpener,
} from "../../features/conversation/contracts";
import { MessageMarkdown } from "../../features/messages/MessageMarkdown";
import type { ChannelMessage } from "../../features/relay/contracts";
import { useRelayConnection } from "../../features/relay/react";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import { LoadingRegion } from "../../shared/design-system/ui/LoadingRegion";
import { ShimmerText } from "../../shared/design-system/ui/ShimmerText";
import {
  type A2uiThreadBlock,
  a2uiBlockKey,
  a2uiThreadBlocks,
  splitA2uiSegments,
} from "./a2uiMessage";
import styles from "./A2ui.module.css";
import { isA2uiMessage } from "./trust";

// The Express parser and renderer are large; only messages with a closed block load them.
const A2uiBlock = lazy(() => import("./A2uiBlock"));

export function A2uiPending() {
  return (
    <LoadingRegion
      pending
      label={<ShimmerText>Drawing interactive reply…</ShimmerText>}
    >
      <div className={styles.pending} data-a2ui-pending="" />
    </LoadingRegion>
  );
}

const none: readonly ChannelMessage[] = [];

/** The thread's agent replies with `<a2ui>`, oldest first, so a later block can update an earlier surface. */
function useThreadBlocks(
  relay: RelayData,
  session: RelaySession,
  message: ChannelMessage,
  rootId: string,
): readonly A2uiThreadBlock[] {
  const rows = useSyncExternalStore(
    (listener) => session.channels.subscribeWindow(message.channelId, listener),
    () => session.channels.window(message.channelId).rows ?? none,
    () => none,
  );
  return useMemo(() => {
    const thread = rows.filter(
      (row) =>
        row.id !== message.id &&
        (row.threadRootId ?? row.id) === rootId &&
        isA2uiMessage(relay, row),
    );
    const ordered = [...thread, message].sort(
      (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
    );
    return a2uiThreadBlocks(
      ordered.map((row) => ({
        id: row.id,
        text: row.content,
        authorId: row.authorId,
      })),
    );
  }, [rows, message, rootId, relay]);
}

export function createA2uiMessage(
  relay: RelayData,
  extensions: ConversationExtensions,
) {
  return function A2uiMessage({
    message,
  }: TargetOpener & { message: ChannelMessage }) {
    const state = useRelayConnection(relay);
    if (state.status !== "ready") return <pre>{message.content}</pre>;
    return (
      <SessionMessage
        relay={relay}
        session={state.session}
        extensions={extensions}
        message={message}
      />
    );
  };
}

function SessionMessage({
  relay,
  session,
  extensions,
  message,
}: {
  relay: RelayData;
  session: RelaySession;
  extensions: ConversationExtensions;
  message: ChannelMessage;
}) {
  const segments = useMemo(
    () => splitA2uiSegments(message.content),
    [message.content],
  );
  const rootId = message.threadRootId ?? message.id;
  const blocks = useThreadBlocks(relay, session, message, rootId);
  // Actions answer in the thread and mention the agent that owns the surface (the author of
  // the block that created it), whichever block set the thread's sender.
  const sendMessage = async (text: string, ownerId: string | undefined) => {
    const authorId = ownerId ?? message.authorId;
    const channel = session.channels
      .list()
      .channels.find((item) => item.id === message.channelId);
    if (channel?.channelType === "solo" && !message.threadRootId)
      await session.messages.send(message.channelId, text, [authorId]);
    else
      await session.messages.reply(message.channelId, rootId, text, [authorId]);
  };
  return (
    <div className={styles.message}>
      {segments.map((segment) =>
        segment.kind === "markdown" ? (
          <MessageMarkdown
            key={segment.offset}
            row={{ ...message, content: segment.markdown }}
            session={session}
            extensions={extensions}
            media={(url) => session.media(url)}
            onOpenLink={() => false}
          />
        ) : segment.closed ? (
          <Suspense key={segment.offset} fallback={<A2uiPending />}>
            <A2uiBlock
              source={segment.source}
              threadKey={`${message.channelId}:${rootId}`}
              blockKey={a2uiBlockKey(message.id, segment.offset)}
              blocks={blocks}
              onSendMessage={sendMessage}
            />
          </Suspense>
        ) : (
          <A2uiPending key={segment.offset} />
        ),
      )}
    </div>
  );
}
