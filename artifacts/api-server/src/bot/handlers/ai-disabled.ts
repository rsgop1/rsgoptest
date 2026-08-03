import type { Bot } from "grammy";
import { openAgenticWorkspace } from "../agentic.js";
import { getSession } from "../session.js";

export function registerDisabledAiHandlers(bot: Bot): void {
  const disabled = async (ctx: any) => {
    await ctx.reply("🔕 This legacy AI command is replaced by the Premium AI Space. Open /menu and tap AI Space.");
  };

  bot.command("ai", async (ctx) => {
    const userId = ctx.from!.id;
    const session = getSession(userId);
    if (session.agenticActive) return;
    await openAgenticWorkspace(ctx);
  });
  bot.command("ai_tutor", disabled);
  bot.command("doubt", disabled);
}