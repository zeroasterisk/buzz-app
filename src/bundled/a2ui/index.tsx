import type { Context } from "@deepseek-ai/cordis";
import { createA2uiMessage } from "./A2uiMessage";
import { isA2uiMessage } from "./trust";

export const A2UI_POINTER = `When a choice, form or confirmation is easier to answer than to type, reply with an interactive reply: prose, then an <a2ui>…</a2ui> block of A2UI Express on its own lines (never a code fence). Use the basic catalog only. To change a surface you drew earlier in this thread, start the block with surface("<id>", update=true). The person's answer comes back as a reply with an a2ui-action block.`;

export const inject = ["conversation", "relay", "agents"];
export function apply(ctx: Context) {
  ctx.conversation.registerMessage({
    id: "a2ui",
    title: "Interactive reply",
    matches: (message) => isA2uiMessage(ctx.relay, message),
    component: createA2uiMessage(ctx.relay, ctx.conversation),
  });
  ctx.agents.addInstructions({ id: "a2ui", text: A2UI_POINTER });
}
