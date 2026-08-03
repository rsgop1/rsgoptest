import type { Bot } from "grammy";

export function registerDisabledAiHandlers(bot: Bot): void {
  const disabled = async (ctx: any) => {
    await ctx.reply("🔕 AI chat is currently unavailable. AI intelligence is being prepared in the admin Analysis workspace.");
  };

  bot.command("ai", disabled);
  bot.command("ai_tutor", disabled);
  bot.command("doubt", disabled);
}