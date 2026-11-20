// One A2UI processor per thread, so a later reply can update an earlier reply's surface
// (`surface("<id>", update=true)`). The state is derived from the thread's closed blocks, in
// order: if an earlier block changes (edit, regenerate, deletion), it is rebuilt from the start.
import { ExpressFormat, RendererState } from "@a2ui/agent";
import {
  type Catalog,
  type ComponentApi,
  MessageProcessor,
  type SurfaceModel,
} from "@a2ui/web_core";
import { type A2uiThreadBlock, a2uiActionMessage } from "./a2uiMessage";

export type { A2uiThreadBlock };

export type A2uiBlockResult =
  | { readonly ok: true; readonly surfaceIds: readonly string[] }
  | { readonly ok: false; readonly error: string };

export type A2uiSendState = "sending" | "sent" | "failed";

type ActionHandler = NonNullable<
  ConstructorParameters<typeof MessageProcessor>[1]
>;
/** Sends `text` as a thread reply that mentions `authorId`, the agent that owns the surface. */
type SendMessage = (
  text: string,
  authorId: string | undefined,
) => Promise<void>;

export class A2uiThreadStore<T extends ComponentApi = ComponentApi> {
  private processor: MessageProcessor<T>;
  private state: RendererState;
  private applied: A2uiThreadBlock[] = [];
  private readonly results = new Map<string, A2uiBlockResult>();
  private readonly latestBlockBySurfaceId = new Map<string, string>();
  /** The author of the block that created each surface: only they may update it. */
  private readonly ownerBySurfaceId = new Map<string, string | undefined>();
  private readonly sentBySurfaceId = new Map<string, A2uiSendState>();
  /** Blocks this thread ever applied: a replay must not unlock what a sent action locked. */
  private readonly seen = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private sendMessage: SendMessage | undefined;

  constructor(private readonly catalog: Catalog<T>) {
    this.processor = this.createProcessor();
    this.state = RendererState.of(this.processor);
  }

  private createProcessor(): MessageProcessor<T> {
    const onAction: ActionHandler = (action) => void this.send(action);
    return new MessageProcessor<T>([this.catalog], onAction);
  }

  private reset() {
    this.processor = this.createProcessor();
    this.state = RendererState.of(this.processor);
    this.applied = [];
    this.results.clear();
    this.latestBlockBySurfaceId.clear();
    this.ownerBySurfaceId.clear();
  }

  /**
   * Applies the thread's closed blocks, in order. Call it from an effect or a state initializer,
   * never during render. Blocks already applied are skipped, so calling it again with the same
   * list (StrictMode) changes nothing. If an applied block changed or went away, the processor
   * is rebuilt and every block replayed.
   */
  sync(blocks: readonly A2uiThreadBlock[]) {
    const diverged =
      blocks.length < this.applied.length ||
      this.applied.some(
        (block, index) =>
          block.key !== blocks[index]?.key ||
          block.source !== blocks[index]?.source,
      );
    if (diverged) this.reset();
    if (!diverged && blocks.length === this.applied.length) return;
    for (const block of blocks.slice(this.applied.length)) {
      this.apply(block, !this.seen.has(block.key));
      this.seen.add(block.key);
    }
    this.applied = [...blocks];
    this.notify();
  }

  private apply(block: A2uiThreadBlock, fresh: boolean) {
    // A block without `surface(...)` gets its own surface, so two such blocks never collide.
    const surfaceId = `a2ui-${block.key}`;
    const parser = new ExpressFormat([this.catalog], {
      surfaceId,
    }).createParser();
    try {
      const surfaceIds = new Set<string>();
      const created = new Set<string>();
      // All or nothing: a block that touches another author's surface changes nothing.
      this.state.transaction(() => {
        for (const part of parser.parseResponse(block.source, {
          state: this.state,
          wrapped: false,
        })) {
          if (part.type !== "a2ui") continue;
          for (const message of part.a2ui) {
            const [kind, body] = (Object.entries(message).find(
              ([key]) => key !== "version",
            ) ?? []) as [string?, { surfaceId?: string }?];
            const id = body?.surfaceId;
            if (!id) continue;
            surfaceIds.add(id);
            if (kind === "createSurface") created.add(id);
            else if (
              !created.has(id) &&
              this.ownerBySurfaceId.get(id) !== block.authorId
            )
              throw new Error(`Surface ${id} belongs to another agent`);
          }
        }
      });
      for (const id of created) this.ownerBySurfaceId.set(id, block.authorId);
      if (surfaceIds.size === 0) {
        this.results.set(block.key, { ok: false, error: "No surface" });
        return;
      }
      for (const id of surfaceIds) {
        this.latestBlockBySurfaceId.set(id, block.key);
        // The agent answered: a new reply unlocks the surface it updates.
        if (fresh) this.sentBySurfaceId.delete(id);
      }
      this.results.set(block.key, { ok: true, surfaceIds: [...surfaceIds] });
    } catch (error) {
      this.results.set(block.key, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async send(action: Parameters<ActionHandler>[0]) {
    const sendMessage = this.sendMessage;
    if (!sendMessage) return;
    // One answer per surface: the lock lands a render later, so a fast second click or a
    // programmatic dispatch must not send twice. A failed send may be retried.
    const current = this.sentBySurfaceId.get(action.surfaceId);
    if (current === "sending" || current === "sent") return;
    this.setSent(action.surfaceId, "sending");
    try {
      await sendMessage(
        a2uiActionMessage(action),
        this.ownerBySurfaceId.get(action.surfaceId),
      );
      this.setSent(action.surfaceId, "sent");
    } catch {
      this.setSent(action.surfaceId, "failed");
    }
  }

  private setSent(surfaceId: string, state: A2uiSendState) {
    this.sentBySurfaceId.set(surfaceId, state);
    this.notify();
  }

  private notify() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /** The thread's send function (a reply in the thread), set by its rendered blocks. */
  setSendMessage(sendMessage: SendMessage | undefined) {
    this.sendMessage = sendMessage;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this.version;

  /**
   * What one block shows: its result, the surfaces it still owns, their send state. `_version`
   * is the store version the caller rendered with.
   */
  view(key: string, _version: number) {
    const result = this.results.get(key);
    const live = result?.ok
      ? result.surfaceIds.filter((id) => !this.isSuperseded(key, id))
      : ([] as string[]);
    return {
      result,
      live,
      states: live.map((id) => this.sent(id)),
      surfaces: live.map((id) => this.surface(id)),
    };
  }

  /** Whether an action can reach the agent (a rendered block set the thread's send function). */
  canSend(): boolean {
    return this.sendMessage !== undefined;
  }

  result(key: string): A2uiBlockResult | undefined {
    return this.results.get(key);
  }

  /** Whether a later block updated the surface since `key` drew it. */
  isSuperseded(key: string, surfaceId: string): boolean {
    return this.latestBlockBySurfaceId.get(surfaceId) !== key;
  }

  sent(surfaceId: string): A2uiSendState | undefined {
    return this.sentBySurfaceId.get(surfaceId);
  }

  surface(surfaceId: string): SurfaceModel<T> | undefined {
    return this.processor.model.surfacesMap.get(surfaceId);
  }
}

/** Threads kept in memory; the least recently used is dropped first. */
const MAX_THREADS = 8;
const stores = new Map<string, A2uiThreadStore<ComponentApi>>();

/** The store for `<channelId>:<threadRootId>`. One catalog per app, so the first one wins. */
export function a2uiThreadStore<T extends ComponentApi>(
  threadKey: string,
  catalog: Catalog<T>,
): A2uiThreadStore<T> {
  let store = stores.get(threadKey) as A2uiThreadStore<T> | undefined;
  if (store) stores.delete(threadKey);
  else store = new A2uiThreadStore(catalog);
  stores.set(threadKey, store as unknown as A2uiThreadStore<ComponentApi>);
  for (const key of stores.keys()) {
    if (stores.size <= MAX_THREADS) break;
    stores.delete(key);
  }
  return store;
}
