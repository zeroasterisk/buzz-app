import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ConversationExtensions,
  TargetOpener,
} from "../../features/conversation/contracts";
import { MessageMarkdown } from "../../features/messages/MessageMarkdown";
import type { ChannelMessage } from "../../features/relay/contracts";
import { useRelayConnection } from "../../features/relay/react";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import type { ThreadSnapshot, ThreadView } from "../../features/relay/threads";
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
const noThread: ThreadSnapshot | undefined = undefined;

// Rows in one thread share one reader: the session caps open views at 64.
const readers = new WeakMap<
  RelaySession,
  Map<string, { view: ThreadView; count: number }>
>();

function acquireThread(
  session: RelaySession,
  channelId: string,
  rootId: string,
): ThreadView {
  let open = readers.get(session);
  if (!open) {
    open = new Map();
    readers.set(session, open);
  }
  const key = `${channelId}:${rootId}`;
  const shared = open.get(key);
  if (shared) {
    shared.count += 1;
    return shared.view;
  }
  const view = session.thread(channelId, rootId);
  open.set(key, { view, count: 1 });
  void view.refresh();
  return view;
}

function releaseThread(
  session: RelaySession,
  channelId: string,
  rootId: string,
) {
  const open = readers.get(session);
  const key = `${channelId}:${rootId}`;
  const shared = open?.get(key);
  if (!shared) return;
  shared.count -= 1;
  if (shared.count > 0) return;
  open?.delete(key);
  shared.view.dispose();
}

/** A thread reply whose root is outside the channel window reads the thread through a
 * reader shared by every row of that thread (disposed with the last one), so earlier
 * blocks it updates are still found. */
function useThreadReader(
  session: RelaySession,
  channelId: string,
  rootId: string,
  needed: boolean,
): ThreadSnapshot | undefined {
  const [view, setView] = useState<ThreadView>();
  useEffect(() => {
    if (!needed) return;
    let owned: ThreadView;
    try {
      owned = acquireThread(session, channelId, rootId);
    } catch {
      return; // No capacity or no valid id: fall back to the window alone.
    }
    setView(owned);
    return () => {
      setView(undefined);
      releaseThread(session, channelId, rootId);
    };
  }, [session, channelId, rootId, needed]);
  return useSyncExternalStore(
    (listener) => view?.subscribe(listener) ?? (() => {}),
    () => view?.snapshot() ?? noThread,
    () => noThread,
  );
}

/** The thread's agent replies with `<a2ui>`, oldest first, so a later block can update an earlier surface.
 * `loading` while a thread reader is still fetching blocks the window doesn't hold. */
function useThreadBlocks(
  relay: RelayData,
  session: RelaySession,
  message: ChannelMessage,
  rootId: string,
): { blocks: readonly A2uiThreadBlock[]; loading: boolean } {
  const rows = useSyncExternalStore(
    (listener) => session.channels.subscribeWindow(message.channelId, listener),
    () => session.channels.window(message.channelId).rows ?? none,
    () => none,
  );
  // The channel window holds top-level rows only: a reply whose root is outside it, and a
  // root with replies (a later reply may update its surface), both read the thread.
  const needed = message.threadRootId
    ? !rows.some((row) => row.id === rootId)
    : message.replyCount > 0;
  const thread = useThreadReader(session, message.channelId, rootId, needed);
  // Only a reply waits for its root; a root keeps drawing while its replies load.
  const loading =
    needed &&
    !!message.threadRootId &&
    thread?.status !== "ready" &&
    thread?.status !== "error";
  const blocks = useMemo(() => {
    const byId = new Map<string, ChannelMessage>();
    const read = thread ? [thread.root, ...thread.replies] : [];
    for (const row of [...rows, ...read])
      if (
        row &&
        row.id !== message.id &&
        (row.threadRootId ?? row.id) === rootId &&
        isA2uiMessage(relay, row)
      )
        byId.set(row.id, row);
    const ordered = [...byId.values(), message].sort(
      (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1),
    );
    return a2uiThreadBlocks(
      ordered.map((row) => ({
        id: row.id,
        text: row.content,
        authorId: row.authorId,
      })),
    );
  }, [rows, thread, message, rootId, relay]);
  return { blocks, loading };
}

export function createA2uiMessage(
  relay: RelayData,
  extensions: ConversationExtensions,
) {
  return function A2uiMessage({
    message,
    canOpen,
    open,
  }: TargetOpener & { message: ChannelMessage }) {
    const state = useRelayConnection(relay);
    if (state.status !== "ready") return <pre>{message.content}</pre>;
    return (
      <SessionMessage
        relay={relay}
        session={state.session}
        extensions={extensions}
        message={message}
        canOpen={canOpen}
        open={open}
      />
    );
  };
}

function SessionMessage({
  relay,
  session,
  extensions,
  message,
  canOpen,
  open,
}: TargetOpener & {
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
  const { blocks, loading } = useThreadBlocks(relay, session, message, rootId);
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
            onOpenLink={open}
            canOpenLink={canOpen}
          />
        ) : segment.closed && !loading ? (
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
