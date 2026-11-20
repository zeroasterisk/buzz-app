import type { Context } from "@deepseek-ai/cordis";
import type { AddedTool } from "../../buzz-mcp/session-tools";
import type { A2uiPoster } from "./agentTools";
import { createA2uiMessage } from "./A2uiMessage";
import { isA2uiMessage } from "./trust";

export const A2UI_POINTER = `When a choice, form or confirmation is easier to answer than to type, reply with an interactive reply: prose, then an <a2ui>…</a2ui> block of A2UI Express on its own lines (never a code fence). Use the basic catalog only. To change a surface you drew earlier in this thread, start the block with surface("<id>", update=true). The person's answer comes back as a reply with an a2ui-action block. Search for a2ui_rules before your first interactive reply; post it with send_a2ui to have it checked.`;

export const inject = ["conversation", "relay", "agents"];
export function apply(ctx: Context) {
  ctx.conversation.registerMessage({
    id: "a2ui",
    title: "Interactive reply",
    matches: (message) => isA2uiMessage(ctx.relay, message),
    component: createA2uiMessage(ctx.relay, ctx.conversation),
  });
  ctx.agents.addInstructions({ id: "a2ui", text: A2UI_POINTER });
  addA2uiTools(ctx.agents);
}

type A2uiAgents = {
  addTool(tool: AddedTool): void;
  relay(
    key: string,
  ):
    | { snapshot(): { status: string; session?: { messages: A2uiPoster } } }
    | undefined;
};

/** The full Express prompt on demand, and a send that checks blocks before posting. */
export function addA2uiTools(agents: A2uiAgents) {
  agents.addTool({
    name: "a2ui_rules",
    description:
      "The full A2UI Express rules and basic catalog for interactive replies: syntax, every component and function. Read it once before your first <a2ui> block.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async call() {
      return (await import("./agentTools")).a2uiRules();
    },
  });
  agents.addTool({
    name: "send_a2ui",
    description:
      "Post an interactive reply: prose and <a2ui>…</a2ui> blocks. Every block is checked against this thread's surfaces first, as the renderer will apply it; on an error nothing is posted and the error says what to fix. Without reply, replies in the current thread.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Prose and <a2ui> blocks" },
        reply: {
          type: "string",
          description: "Id of the thread root to reply in",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    async call(client, context, args) {
      const relay = agents.relay(client.key)?.snapshot();
      const messages =
        relay?.status === "ready" ? relay.session?.messages : undefined;
      return (await import("./agentTools")).sendA2ui(
        client,
        messages,
        context,
        args,
      );
    },
  });
}
