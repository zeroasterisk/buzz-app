// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { ConversationService } from "../../features/conversation/service";
import { createPluginManager } from "../../plugins/manager";
import type { ChannelMessage } from "../../features/relay/contracts";
import type { RelayData } from "../../features/relay/service";
import { createA2uiMessage } from "./A2uiMessage";
import { isA2uiMessage } from "./trust";

const disposals: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  cleanup();
  for (const dispose of disposals.splice(0)) await dispose();
});
function conversation() {
  const ctx = new Context();
  const plugins = createPluginManager(ctx, { bundled: [] });
  disposals.push(async () => {
    await plugins.dispose();
    await ctx.fiber.dispose();
  });
  return new ConversationService(ctx);
}

const agent = "a".repeat(64);
const person = "b".repeat(64);
const FORM = `Here is the triage.

<a2ui>
surface("triage")
title = Text("Flaky test triage")
pick = ChoicePicker(label="Next step", options=[{label: "Retry", value: "retry"}, {label: "Revert", value: "revert"}], value=$/choice, variant="mutuallyExclusive")
go = Button(Text("Apply"), variant="primary", action=Event("apply", {choice: $/choice}))
root = Card(Column([title, pick, go]))
$/choice = ["retry"]
</a2ui>`;

function row(
  content: string,
  extra: Partial<ChannelMessage> = {},
): ChannelMessage {
  return {
    id: "c".repeat(64),
    channelId: "channel",
    authorId: agent,
    content,
    createdAt: 1,
    mentions: [],
    participants: [],
    attachments: [],
    reactions: [],
    replyCount: 0,
    ...extra,
  } as ChannelMessage;
}

function fakeRelay(rows: ChannelMessage[]) {
  const reply = vi.fn();
  const send = vi.fn();
  const session = {
    channels: {
      list: () => ({ channels: [{ id: "channel", channelType: "stream" }] }),
      window: () => ({ rows }),
      subscribeWindow: () => () => {},
      subscribeList: () => () => {},
    },
    messages: { reply, send },
    profiles: {
      snapshot: () => new Map([[agent, { isAgent: true }]]),
      subscribe: () => () => {},
      ensure: async () => {},
    },
    agentChoices: { snapshot: () => ({ identities: [] }) },
    media: () => undefined,
  };
  const ready = { status: "ready", generation: 1, session };
  const relay = {
    snapshot: () => ready,
    subscribe: () => () => {},
  } as unknown as RelayData;
  return { relay, reply, send };
}

it("matches only agent-authored, non-workflow messages with an <a2ui> block", () => {
  const { relay } = fakeRelay([]);
  expect(isA2uiMessage(relay, row(FORM))).toBe(true);
  expect(isA2uiMessage(relay, row(FORM, { authorId: person }))).toBe(false);
  expect(
    isA2uiMessage(relay, row(FORM, { authorId: person, agentEnvelope: true })),
  ).toBe(true);
  expect(isA2uiMessage(relay, row(FORM, { workflowOwnerId: agent }))).toBe(
    false,
  );
  expect(isA2uiMessage(relay, row("no block"))).toBe(false);
});

it("leaves a tag mentioned in prose or shown in a fence as a normal message", () => {
  const { relay } = fakeRelay([]);
  expect(
    isA2uiMessage(relay, row("Wrap the form in an <a2ui> tag, then close it.")),
  ).toBe(false);
  expect(isA2uiMessage(relay, row(`Example:\n\n\`\`\`\n${FORM}\n\`\`\``))).toBe(
    false,
  );
  expect(isA2uiMessage(relay, row(`Example:\n\n~~~\n${FORM}\n~~~`))).toBe(
    false,
  );
});

it("opens links in the prose around a block through the host opener", async () => {
  const message = row(
    `See [the run](https://example.com/run/7).\n\n${FORM.split("\n\n")[1]}`,
  );
  const { relay } = fakeRelay([message]);
  const open = vi.fn(() => true);
  const A2uiMessage = createA2uiMessage(relay, conversation());
  render(<A2uiMessage message={message} canOpen={() => true} open={open} />);
  expect(await screen.findByText("Flaky test triage")).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("link", { name: "the run" }));
  expect(open).toHaveBeenCalledWith("https://example.com/run/7");
});

it("draws the form natively and replies in the thread, mentioning the agent", async () => {
  const message = row(FORM);
  const { relay, reply } = fakeRelay([message]);
  const A2uiMessage = createA2uiMessage(relay, conversation());
  render(
    <A2uiMessage message={message} canOpen={() => false} open={() => false} />,
  );
  expect(await screen.findByText("Flaky test triage")).toBeInTheDocument();
  expect(screen.getByText("Here is the triage.")).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("ChoicePicker");
  const user = userEvent.setup();
  await user.click(screen.getByRole("radio", { name: "Revert" }));
  await user.click(screen.getByRole("button", { name: "Apply" }));
  await expect.poll(() => reply.mock.calls.length).toBe(1);
  const [channelId, rootId, text, mentions] = reply.mock.calls[0] ?? [];
  expect([channelId, rootId, mentions]).toEqual([
    "channel",
    message.id,
    [agent],
  ]);
  const payload = JSON.parse(
    /```a2ui-action\n(.*)\n```/.exec(String(text))?.[1] ?? "{}",
  );
  expect(payload).toMatchObject({
    surfaceId: "triage",
    name: "apply",
    context: { choice: ["revert"] },
  });
  expect(await screen.findByText("Sent to the agent")).toBeInTheDocument();
});

it("shows a loading state, never raw DSL, while a block streams", () => {
  const message = row('Working…\n\n<a2ui>\nsurface("x")\nroot = Text("hi');
  const { relay } = fakeRelay([message]);
  const A2uiMessage = createA2uiMessage(relay, conversation());
  render(
    <A2uiMessage message={message} canOpen={() => false} open={() => false} />,
  );
  expect(document.querySelector("[data-a2ui-pending]")).not.toBeNull();
  expect(document.body.textContent).not.toContain("surface(");
});

it("blocks off-catalog components and shows the source, not a frame", async () => {
  const message = row(
    '<a2ui>\nsurface("bad")\nroot = Iframe(src="https://example.com")\n</a2ui>',
  );
  const { relay } = fakeRelay([message]);
  const A2uiMessage = createA2uiMessage(relay, conversation());
  render(
    <A2uiMessage message={message} canOpen={() => false} open={() => false} />,
  );
  expect(
    await screen.findByText("Interactive reply blocked"),
  ).toBeInTheDocument();
  expect(document.querySelector("iframe")).toBeNull();
});
