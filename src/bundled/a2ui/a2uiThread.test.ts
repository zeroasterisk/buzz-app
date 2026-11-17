import { Catalog, type ComponentApi } from "@a2ui/web_core";
import {
  BASIC_COMPONENTS,
  BASIC_FUNCTIONS,
  BasicCatalogThemeSchema,
} from "@a2ui/web_core/catalogs/basic/v1";
import { describe, expect, it } from "vitest";

import { A2uiThreadStore, a2uiThreadStore } from "./a2uiThread";

// Schema-only basic catalog: the store needs the component APIs, not the look.
const catalog = new Catalog<ComponentApi>(
  "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
  "1.0",
  BASIC_COMPONENTS,
  BASIC_FUNCTIONS,
  BasicCatalogThemeSchema,
);

const triage = (text: string) =>
  `surface("triage")\nroot = Column([Text("${text}"), Button(Text("Go"), action=Event("go", {}))])`;
const update = (text: string) =>
  `surface("triage", update=true)\nroot = Column([Text("${text}")])`;

function texts(store: A2uiThreadStore, surfaceId: string): string[] {
  const json = JSON.stringify(store.surface(surfaceId), (_key, value) =>
    value instanceof Map ? Object.fromEntries(value) : value,
  );
  return [...(json ?? "").matchAll(/"text":"([^"]*)"/g)].map(
    ([, text = ""]) => text,
  );
}

describe("A2uiThreadStore", () => {
  it("lets a later block update an earlier block's surface", () => {
    const store = new A2uiThreadStore(catalog);
    store.sync([
      { key: "m1:0", source: triage("first") },
      { key: "m2:0", source: update("second") },
    ]);
    expect(store.result("m2:0")).toEqual({ ok: true, surfaceIds: ["triage"] });
    expect(store.isSuperseded("m1:0", "triage")).toBe(true);
    expect(store.isSuperseded("m2:0", "triage")).toBe(false);
    expect(store.view("m1:0", store.getVersion()).live).toEqual([]);
    expect(store.view("m2:0", store.getVersion()).live).toEqual(["triage"]);
    expect(texts(store, "triage")).toContain("second");
  });

  it("gives blocks without surface() their own surfaces", () => {
    const store = new A2uiThreadStore(catalog);
    store.sync([
      { key: "m1:0", source: 'root = Text("a")' },
      { key: "m2:0", source: 'root = Text("b")' },
    ]);
    expect(store.result("m1:0")).toEqual({
      ok: true,
      surfaceIds: ["a2ui-m1:0"],
    });
    expect(store.result("m2:0")).toEqual({
      ok: true,
      surfaceIds: ["a2ui-m2:0"],
    });
  });

  it("rejects a bad update and keeps the earlier surface", () => {
    const store = new A2uiThreadStore(catalog);
    store.sync([
      { key: "m1:0", source: triage("first") },
      {
        key: "m2:0",
        source: `surface("triage", update=true)\nroot = Iframe(url="https://x")`,
      },
    ]);
    expect(store.result("m2:0")?.ok).toBe(false);
    expect(store.isSuperseded("m1:0", "triage")).toBe(false);
    expect(texts(store, "triage")).toContain("first");
  });

  it("rejects an update to a surface the thread never drew", () => {
    const store = new A2uiThreadStore(catalog);
    store.sync([{ key: "m1:0", source: update("ghost") }]);
    expect(store.result("m1:0")?.ok).toBe(false);
  });

  it("keeps a sent surface locked on replay and unlocks it on a fresh reply", async () => {
    const store = new A2uiThreadStore(catalog);
    const sent: string[] = [];
    store.setSendMessage(async (text) => {
      sent.push(text);
    });
    store.sync([{ key: "m1:0", source: triage("first") }]);
    await store
      .surface("triage")
      ?.dispatchAction({ event: { name: "go" } }, "button");
    await Promise.resolve();
    expect(store.sent("triage")).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('"surfaceId":"triage"');
    store.sync([{ key: "m1:0", source: triage("edited") }]);
    expect(store.sent("triage")).toBe("sent");
    store.sync([
      { key: "m1:0", source: triage("edited") },
      { key: "m2:0", source: update("second") },
    ]);
    expect(store.sent("triage")).toBeUndefined();
  });

  it("marks the surface failed when the reply cannot be sent", async () => {
    const store = new A2uiThreadStore(catalog);
    store.setSendMessage(async () => {
      throw new Error("relay down");
    });
    store.sync([{ key: "m1:0", source: triage("first") }]);
    await store
      .surface("triage")
      ?.dispatchAction({ event: { name: "go" } }, "button");
    await Promise.resolve();
    await Promise.resolve();
    expect(store.sent("triage")).toBe("failed");
  });

  it("applies each block once and rebuilds when an earlier block changes", () => {
    const store = new A2uiThreadStore(catalog);
    const blocks = [{ key: "m1:0", source: triage("first") }];
    store.sync(blocks);
    const surface = store.surface("triage");
    const version = store.getVersion();
    store.sync(blocks);
    expect(store.surface("triage")).toBe(surface);
    expect(store.getVersion()).toBe(version);
    store.sync([{ key: "m1:0", source: triage("edited") }]);
    expect(store.surface("triage")).not.toBe(surface);
    expect(texts(store, "triage")).toContain("edited");
  });

  it("rebuilds when a block is deleted", () => {
    const store = new A2uiThreadStore(catalog);
    store.sync([
      { key: "m1:0", source: triage("first") },
      { key: "m2:0", source: update("second") },
    ]);
    store.sync([{ key: "m1:0", source: triage("first") }]);
    expect(store.isSuperseded("m1:0", "triage")).toBe(false);
    expect(texts(store, "triage")).toContain("first");
  });

  it("notifies subscribers until they unsubscribe", () => {
    const store = new A2uiThreadStore(catalog);
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.sync([{ key: "m1:0", source: triage("first") }]);
    unsubscribe();
    store.sync([{ key: "m1:0", source: triage("edited") }]);
    expect(calls).toBe(1);
  });
});

describe("a2uiThreadStore", () => {
  it("keeps one store per thread and drops the least recently used past 8", () => {
    const first = a2uiThreadStore("lru:0", catalog);
    expect(a2uiThreadStore("lru:0", catalog)).toBe(first);
    expect(first).toBeInstanceOf(A2uiThreadStore);
    for (let index = 1; index <= 8; index += 1)
      a2uiThreadStore(`lru:${index}`, catalog);
    expect(a2uiThreadStore("lru:0", catalog)).not.toBe(first);
  });
});
