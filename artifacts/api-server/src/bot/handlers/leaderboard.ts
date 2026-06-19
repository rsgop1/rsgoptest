import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import { userHistoryTable, testSeriesTable, usersTable } from "@workspace/db";
import { eq, desc, avg, count, sql, max } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { getConfig, setConfig } from "./helpers.js";
import { getApi } from "../api-instance.js";
import { emitTelemetry } from "../../lib/telemetry.js";

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

async function buildLeaderboardText(testId?: string): Promise<string> {
  const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

  if (testId) {
    const [test] = await db.select({ testName: testSeriesTable.testName }).from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
    const topRows = await db
      .select({
        userId: userHistoryTable.userId,
        bestScore: max(userHistoryTable.score),
        attempts: count(userHistoryTable.id),
      })
      .from(userHistoryTable)
      .where(eq(userHistoryTable.testId, testId))
      .groupBy(userHistoryTable.userId)
      .orderBy(desc(max(userHistoryTable.score)))
      .limit(10);

    if (!topRows.length) return `🏆 *Leaderboard — ${escMd(test?.testName ?? testId)}*\n\n_No attempts yet\\._`;

    const userIds = topRows.map(r => r.userId);
    const users = await db.select({ userId: usersTable.userId, fullName: usersTable.fullName }).from(usersTable)
      .where(sql`${usersTable.userId} = ANY(ARRAY[${sql.join(userIds.map(id => sql`${id}`), sql`,`)}]::bigint[])`);
    const nameMap = new Map(users.map(u => [u.userId, u.fullName]));

    let text = `🏆 *${escMd(test?.testName ?? testId)} Leaderboard*\n\n`;
    topRows.forEach((r, i) => {
      const name = (nameMap.get(r.userId) ?? String(r.userId)).slice(0, 18);
      text += `${medals[i] ?? `${i + 1}\\.`} *${escMd(name)}* — ${escMd(String(r.bestScore))}\n`;
    });
    text += `\n_Updated: ${new Date().toLocaleTimeString("en-IN")}_`;
    return text;
  } else {
    const topRows = await db
      .select({
        userId: userHistoryTable.userId,
        totalTests: count(userHistoryTable.id),
        avgAccuracy: avg(userHistoryTable.accuracy),
      })
      .from(userHistoryTable)
      .groupBy(userHistoryTable.userId)
      .orderBy(desc(avg(userHistoryTable.accuracy)), desc(count(userHistoryTable.id)))
      .limit(10);

    if (!topRows.length) return `🌍 *Global Leaderboard*\n\n_No attempts yet\\._`;

    const userIds = topRows.map(r => r.userId);
    const users = await db.select({ userId: usersTable.userId, fullName: usersTable.fullName }).from(usersTable)
      .where(sql`${usersTable.userId} = ANY(ARRAY[${sql.join(userIds.map(id => sql`${id}`), sql`,`)}]::bigint[])`);
    const nameMap = new Map(users.map(u => [u.userId, u.fullName]));

    let text = `🌍 *Global Leaderboard*\n_Ranked by accuracy across all tests_\n\n`;
    topRows.forEach((r, i) => {
      const name = (nameMap.get(r.userId) ?? String(r.userId)).slice(0, 18);
      const acc = parseFloat(String(r.avgAccuracy ?? 0)).toFixed(1);
      text += `${medals[i] ?? `${i + 1}\\.`} *${escMd(name)}* — ${escMd(acc)}% \\(${r.totalTests} tests\\)\n`;
    });
    text += `\n_Updated: ${escMd(new Date().toLocaleTimeString("en-IN"))} IST_`;
    return text;
  }
}

export async function updateChannelLeaderboard(): Promise<void> {
  try {
    const channel = await getConfig("leaderboard_channel");
    if (!channel) return;

    const text = await buildLeaderboardText();
    const api = getApi();
    const pinnedMsgId = await getConfig("leaderboard_pinned_msg_id");

    if (pinnedMsgId) {
      try {
        await api.editMessageText(channel, parseInt(pinnedMsgId), text, { parse_mode: "MarkdownV2" });
        emitTelemetry(`Leaderboard updated in channel ${channel}`);
        return;
      } catch {
        // Message might have been deleted, send a new one
      }
    }

    const newMsg = await api.sendMessage(channel, text, { parse_mode: "MarkdownV2" });
    await setConfig("leaderboard_pinned_msg_id", String(newMsg.message_id));
    try { await api.pinChatMessage(channel, newMsg.message_id, { disable_notification: true }); } catch { }
    emitTelemetry(`Leaderboard created & pinned in channel ${channel}`);
  } catch (err) {
    logger.error({ err }, "Error updating channel leaderboard");
  }
}

export function registerLeaderboardHandlers(bot: Bot): void {
  bot.command("leaderboard", async (ctx) => {
    try {
      const tests = await db.select({ testId: testSeriesTable.testId, testName: testSeriesTable.testName })
        .from(testSeriesTable).where(eq(testSeriesTable.isActive, true));

      if (!tests.length) {
        await ctx.reply("📭 No tests available yet.");
        return;
      }

      const kb = new InlineKeyboard();
      for (const t of tests.slice(0, 10)) {
        kb.text(t.testName.slice(0, 40), `lb_test_${t.testId}`).row();
      }
      kb.text("🌍 Overall Global Rank", "lb_global");

      await ctx.reply("🏆 *Leaderboard*\n\nChoose a test to view rankings:", {
        parse_mode: "MarkdownV2",
        reply_markup: kb,
      });
    } catch (err) {
      logger.error({ err }, "leaderboard error");
    }
  });

  bot.callbackQuery(/^lb_test_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("lb_test_", "");
    const text = await buildLeaderboardText(testId);
    await ctx.editMessageText(text, { parse_mode: "MarkdownV2" });
  });

  bot.callbackQuery("lb_global", async (ctx) => {
    await ctx.answerCallbackQuery();
    const text = await buildLeaderboardText();
    await ctx.editMessageText(text, { parse_mode: "MarkdownV2" });
  });
}
