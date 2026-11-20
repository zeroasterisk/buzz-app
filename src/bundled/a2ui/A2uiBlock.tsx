// One closed `<a2ui>` block: compiled and validated by the thread store, drawn with Buzz controls.
import { A2uiSurface, type ReactCatalogComponent } from "@a2ui/react";
import { useEffect, useSyncExternalStore } from "react";
import { type A2uiThreadBlock, a2uiThreadStore } from "./a2uiThread";
import styles from "./A2ui.module.css";
import { buzzBasicCatalog } from "./catalog";

export default function A2uiBlock({
  source,
  threadKey,
  blockKey,
  blocks,
  onSendMessage,
}: {
  source: string;
  threadKey: string;
  blockKey: string;
  blocks: readonly A2uiThreadBlock[];
  onSendMessage: (text: string, authorId: string | undefined) => Promise<void>;
}) {
  const store = a2uiThreadStore<ReactCatalogComponent>(
    threadKey,
    buzzBasicCatalog,
  );
  useEffect(() => {
    store.setSendMessage(onSendMessage);
    store.sync(blocks);
  }, [store, blocks, onSendMessage]);
  const version = useSyncExternalStore(store.subscribe, store.getVersion);
  const view = store.view(blockKey, version);
  const result = view.result;
  if (!result) return <div className={styles.pending} data-a2ui-pending="" />;
  if (!result.ok)
    return (
      <div role="note" className={styles.blocked} data-a2ui-error="">
        <p className="text-body-sm">Interactive reply blocked</p>
        <p className="text-caption">
          It uses something Buzz can’t draw. Nothing was loaded or run.
        </p>
        <details>
          <summary className="text-caption">Details</summary>
          <p className="text-caption">{result.error.split(" - Help:")[0]}</p>
          <pre className="text-caption">{source}</pre>
        </details>
      </div>
    );
  if (view.live.length === 0)
    return (
      <p className="text-caption" data-a2ui-superseded="">
        Updated below
      </p>
    );
  return (
    <div
      className={styles.stack}
      data-a2ui-surface=""
      aria-busy={view.states.includes("sending") || undefined}
    >
      {view.live.map((surfaceId, index) => {
        const surface = view.surfaces[index];
        const sent = view.states[index];
        const locked = sent === "sending" || sent === "sent";
        if (!surface) return null;
        return (
          <div key={surfaceId} className={styles.stack}>
            <div
              inert={locked}
              data-a2ui-locked={locked || undefined}
              className={locked ? styles.locked : undefined}
            >
              <A2uiSurface surface={surface} />
            </div>
            {sent === "sent" && (
              <p className="text-caption">Sent to the agent</p>
            )}
            {sent === "failed" && (
              <p className="text-caption" role="alert">
                Couldn’t send. Try again.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
