import { describe, expect, it, vi } from "vitest";
import type { BuzzClient, BuzzEvent } from "../../buzz-mcp/client";
import type { AddedTool } from "../../buzz-mcp/session-tools";
import type { RelayData } from "../../features/relay/service";
import { A2UI_POINTER, addA2uiTools } from "./index";

const agent = "a".repeat(64);
const other = "b".repeat(64);
const person = "e".repeat(64);
const root = "c".repeat(64);
const channel = "chan";

const FORM = `Pick one.
<a2ui>
surface("triage")
root = Column([Text("Which?"), Button(Text("Go"), action=Event("go", {}))])
</a2ui>`;
const IFRAME = `<a2ui>
surface("x")
root = Iframe("https://example.com")
</a2ui>`;
const UPDATE = (id: string) => `<a2ui>
surface("${id}", update=true)
root = Column([Text("Done")])
</a2ui>`;

function event(id: string, pubkey: string, content: string, at: number) {
  return {
    id,
    pubkey,
    content,
    created_at: at,
    kind: 9,
    tags: [],
    sig: "",
  } as BuzzEvent;
}

function setup(thread: BuzzEvent[] = []) {
  const tools: AddedTool[] = [];
  const posts: unknown[][] = [];
  const messages = {
    send: (...args: unknown[]) => {
      posts.push(["send", ...args]);
      return "d".repeat(64);
    },
    reply: (...args: unknown[]) => {
      posts.push(["reply", ...args]);
      return "d".repeat(64);
    },
  };
  addA2uiTools({
    addTool: (tool) => tools.push(tool),
    // Both agents are known agent profiles; `person` is not.
    relay: () =>
      ({
        snapshot: () => ({
          status: "ready",
          session: {
            messages,
            profiles: {
              snapshot: () =>
                new Map([
                  [agent, { isAgent: true }],
                  [other, { isAgent: true }],
                ]),
            },
            agentChoices: { snapshot: () => ({ identities: [] }) },
          },
        }),
      }) as unknown as RelayData,
  });
  const client = {
    pubkey: agent,
    key: agent,
    query: vi.fn(async () => thread),
  } as unknown as BuzzClient;
  const tool = (name: string) => tools.find((item) => item.name === name);
  const send = (args: Record<string, unknown>) =>
    tool("send_a2ui")?.call(client, { channel, root }, args);
  return { tools, tool, send, published: posts };
}

describe("a2ui agent tools", () => {
  it("keeps the instructions pointer under 1 KB", () => {
    expect(Buffer.byteLength(A2UI_POINTER)).toBeLessThanOrEqual(1024);
  });

  it("serves the full Express rules on demand", async () => {
    const { tool } = setup();
    const rules = String(
      await tool("a2ui_rules")?.call({} as BuzzClient, {}, {}),
    );
    expect(rules).toContain("surface(");
    expect(rules).toContain("ChoicePicker");
    expect(Buffer.byteLength(rules)).toBeGreaterThan(4096);
  });

  it("posts a valid form as one thread reply with the exact text", async () => {
    const { send, published } = setup();
    expect(await send({ text: FORM })).toBe(`sent ${"d".repeat(64)}`);
    expect(published).toEqual([["reply", channel, root, FORM]]);
  });

  it("posts at top level when the turn is not in a thread", async () => {
    const { tool, published } = setup();
    const client = { pubkey: agent, key: agent, query: vi.fn() };
    await tool("send_a2ui")?.call(
      client as unknown as BuzzClient,
      { channel, topLevel: true },
      { text: FORM },
    );
    expect(client.query).not.toHaveBeenCalled();
    expect(published).toEqual([["send", channel, FORM]]);
  });

  it("refuses an off-catalog component and posts nothing", async () => {
    const { send, published } = setup();
    await expect(send({ text: IFRAME })).rejects.toThrow(/Nothing was posted/);
    expect(published).toHaveLength(0);
  });

  it("refuses an update to a surface the thread does not have", async () => {
    const { send, published } = setup();
    await expect(send({ text: UPDATE("nope") })).rejects.toThrow(
      /Nothing was posted/,
    );
    expect(published).toHaveLength(0);
  });

  it("checks an update against the thread's real surfaces and owners", async () => {
    const mine = setup([event(root, agent, FORM, 1)]);
    await expect(mine.send({ text: UPDATE("triage") })).resolves.toMatch(
      /^sent/,
    );
    const theirs = setup([event(root, other, FORM, 1)]);
    await expect(theirs.send({ text: UPDATE("triage") })).rejects.toThrow(
      /belongs to another agent/,
    );
    expect(theirs.published).toHaveLength(0);
  });

  it("ignores a person's <a2ui> text, as the renderer does", async () => {
    // The renderer draws a person's block as prose, so it owns no surface:
    // the agent may create "triage", and may not update a surface that was never drawn.
    const thread = [event(root, person, FORM, 1)];
    const create = setup(thread);
    await expect(create.send({ text: FORM })).resolves.toMatch(/^sent/);
    const update = setup(thread);
    await expect(update.send({ text: UPDATE("triage") })).rejects.toThrow(
      /Nothing was posted/,
    );
    expect(update.published).toHaveLength(0);
  });

  it("refuses text with no block or an unclosed block", async () => {
    const { send, published } = setup();
    await expect(send({ text: "just prose" })).rejects.toThrow(/No <a2ui>/);
    await expect(send({ text: '<a2ui>\nsurface("x")' })).rejects.toThrow(
      /not closed/,
    );
    expect(published).toHaveLength(0);
  });
});
