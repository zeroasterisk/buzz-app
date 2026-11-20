// The agent side of interactive replies: `a2ui_rules` hands an agent the full A2UI Express
// prompt on demand (it is 5x over the instructions cap), and `send_a2ui` checks a reply's
// blocks against the thread's surfaces before posting it as the agent. Loaded on first call,
// so the parser never joins the main chunk.
import { ExpressPromptGenerator } from "@a2ui/agent";
import { Catalog, type ComponentApi } from "@a2ui/web_core";
import {
  BASIC_COMPONENTS,
  BASIC_FUNCTIONS,
  BasicCatalogThemeSchema,
} from "@a2ui/web_core/catalogs/basic/v1";
import type { BuzzClient, BuzzEvent, Context } from "../../buzz-mcp/client";
import { a2uiThreadBlocks, splitA2uiSegments } from "./a2uiMessage";
import { A2uiThreadStore } from "./a2uiThread";

// Schema-only: the same id, components and functions the renderer's catalog registers.
const catalog = new Catalog<ComponentApi>(
  "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
  "1.0",
  BASIC_COMPONENTS,
  BASIC_FUNCTIONS,
  BasicCatalogThemeSchema,
);

let rules: string | undefined;
export function a2uiRules(): string {
  rules ??= new ExpressPromptGenerator([catalog]).generate();
  return rules;
}

const HEX = /^[0-9a-f]{64}$/;
/** Thread messages: chat (9) and agent envelopes (40002). */
const THREAD_KINDS = [9, 40002];
const THREAD_LIMIT = 500;

/** The thread's messages, oldest first, as the renderer orders them. */
async function threadMessages(
  client: BuzzClient,
  channel: string,
  root: string,
): Promise<readonly BuzzEvent[]> {
  const events = await client.query([
    { kinds: THREAD_KINDS, "#h": [channel], "#e": [root], limit: THREAD_LIMIT },
    { ids: [root], kinds: THREAD_KINDS, limit: 1 },
  ]);
  return [...new Map(events.map((event) => [event.id, event])).values()].sort(
    (a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1),
  );
}

/**
 * Checks every `<a2ui>` block in `text` the way the thread's renderer will apply it, after
 * the thread's earlier blocks, and returns the first error. `update=true` therefore checks
 * against the surfaces the thread really has, and their owners.
 */
export function checkA2uiReply(
  text: string,
  earlier: readonly { id: string; text: string; authorId: string }[],
  authorId: string,
): string | undefined {
  const segments = splitA2uiSegments(text).filter(
    (segment) => segment.kind === "a2ui",
  );
  if (segments.length === 0)
    return "No <a2ui>…</a2ui> block: post plain text with send.";
  if (segments.some((segment) => !segment.closed))
    return "An <a2ui> block is not closed with </a2ui> on its own line.";
  const store = new A2uiThreadStore(catalog);
  const before = a2uiThreadBlocks(earlier);
  const mine = a2uiThreadBlocks([{ id: "new", text, authorId }]);
  store.sync([...before, ...mine]);
  for (const block of mine) {
    const result = store.result(block.key);
    if (!result?.ok) return result?.error ?? "The block drew nothing.";
  }
  return undefined;
}

/** The agent's own relay writer: the host's send/reply, with its access checks and tags. */
export type A2uiPoster = {
  send(channelId: string, content: string): unknown;
  reply(channelId: string, rootId: string, content: string): unknown;
};

export async function sendA2ui(
  client: BuzzClient,
  messages: A2uiPoster | undefined,
  context: Context,
  args: Record<string, unknown>,
): Promise<string> {
  const text = typeof args.text === "string" ? args.text : "";
  const channel = context.channel;
  if (!channel || !messages)
    throw new Error("send_a2ui needs this conversation's community.");
  const given = typeof args.reply === "string" ? args.reply.toLowerCase() : "";
  const root = given || (context.topLevel ? undefined : context.root);
  if (root !== undefined && !HEX.test(root))
    throw new Error(`Not an event id: ${root}`);
  const earlier = root
    ? (await threadMessages(client, channel, root)).map((event) => ({
        id: event.id,
        text: event.content,
        authorId: event.pubkey,
      }))
    : [];
  const error = checkA2uiReply(text, earlier, client.pubkey);
  if (error) throw new Error(`Nothing was posted. ${error}`);
  const id = await (root
    ? messages.reply(channel, root, text)
    : messages.send(channel, text));
  return typeof id === "string" ? `sent ${id}` : "sent";
}
