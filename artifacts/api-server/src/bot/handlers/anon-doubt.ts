import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import { usersTable, anonDoubtsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSession, updateSession } from "../session.js";
import { getApi } from "../api-instance.js";
import { getConfig } from "./helpers.js";
import { logger } from "../../lib/logger.js";

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

const anonDoubtMap = new Map<number, number>();

export function registerAnonDoubtHandlers(bot: Bot): void {
  bot.command("anon", async (ctx) => {
    const userId = ctx.from!.id;

    const groupId = await getConfig("anon_doubt_group");
    if (!groupId) {
      await ctx.reply("❌ Anonymous doubts are not configured yet. Ask admin to set a group.");
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
    if (!user) {
      await ctx.reply("Please /start first.");
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const usedToday = (user.anonDoubtDate === today) ? (user.anonDoubtsUsed ?? 0) : 0;

    if (usedToday >= 3) {
      await ctx.reply(
        `⚠️ *Daily Limit Reached*\n\nYou can ask only *3 anonymous doubts per day*\\.\n\nCome back tomorrow\\!`,
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    const remaining = 3 - usedToday;
    updateSession(userId, { pendingAnonDoubt: true });
    await ctx.reply(
      `🕵️ *Anonymous Doubt*\n\nType your doubt in the next message\\. It will be posted anonymously in our study group\\.\n\n📊 Remaining today: *${remaining}/3*\n\n_Your identity will be completely hidden\\._`,
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from!.id;
    const session = getSession(userId);
    if (!session.pendingAnonDoubt) return next();

    updateSession(userId, { pendingAnonDoubt: false });

    const doubtText = ctx.message.text;
    if (doubtText.startsWith("/")) return next();

    const groupIdRaw = await getConfig("anon_doubt_group");
    if (!groupIdRaw) return next();

    const api = getApi();
    const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
    const today = new Date().toISOString().slice(0, 10);
    const usedToday = (user?.anonDoubtDate === today) ? (user?.anonDoubtsUsed ?? 0) : 0;

    if (usedToday >= 3) {
      await ctx.reply("❌ Daily limit reached. Try again tomorrow.");
      return;
    }

    try {
      const groupId = isNaN(Number(groupIdRaw)) ? groupIdRaw : Number(groupIdRaw);
      const replyKb = new InlineKeyboard().text("💡 I know the answer! (Reply in group)", "anon_noop");

      const postedMsg = await api.sendMessage(
        groupId as number,
        `🕵️ *Anonymous Student asks:*\n\n"${escMd(doubtText)}"\n\n_Reply to this message to help them\\!_`,
        { parse_mode: "MarkdownV2", reply_markup: replyKb }
      );

      try {
        await api.pinChatMessage(groupId as number, postedMsg.message_id, { disable_notification: true });
      } catch { }

      const [inserted] = await db.insert(anonDoubtsTable).values({
        userId,
        doubtText,
        groupMessageId: postedMsg.message_id,
        groupChatId: Number(groupId),
      }).returning();

      if (inserted) {
        anonDoubtMap.set(postedMsg.message_id, inserted.id);
      }

      await db.update(usersTable).set({
        anonDoubtsUsed: usedToday + 1,
        anonDoubtDate: today,
      }).where(eq(usersTable.userId, userId));

      await ctx.reply(
        `✅ *Doubt Posted Anonymously\\!*\n\nYour question has been posted in the study group\\.\n\nYou'll get a notification when someone answers\\.\n\n📊 Remaining today: *${2 - usedToday}/3*`,
        { parse_mode: "MarkdownV2" }
      );
    } catch (err) {
      logger.error({ err }, "Failed to post anon doubt");
      await ctx.reply("❌ Failed to post doubt. Please try again.");
    }
  });

  bot.on("message", async (ctx, next) => {
    try {
      const msg = ctx.message;
      if (!msg || !msg.reply_to_message) return next();

      const repliedMsgId = msg.reply_to_message.message_id;
      const doubtRecordId = anonDoubtMap.get(repliedMsgId);
      if (!doubtRecordId) return next();

      const [doubt] = await db.select().from(anonDoubtsTable).where(eq(anonDoubtsTable.id, doubtRecordId)).limit(1);
      if (!doubt || doubt.status === "resolved") return next();

      await db.update(anonDoubtsTable).set({ status: "resolved" }).where(eq(anonDoubtsTable.id, doubtRecordId));
      anonDoubtMap.delete(repliedMsgId);

      const api = getApi();
      const answererName = ctx.from?.first_name ?? "Someone";
      await api.sendMessage(
        doubt.userId,
        `🔔 *Someone answered your anonymous doubt\\!*\n\n_"${escMd(doubt.doubtText.slice(0, 100))}"_\n\n✅ *${escMd(answererName)}* replied in the study group\\. Check it out\\!`,
        { parse_mode: "MarkdownV2" }
      );
    } catch { }
    return next();
  });

  bot.callbackQuery("anon_noop", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Reply to this message in the group to answer!", show_alert: true });
  });
}
