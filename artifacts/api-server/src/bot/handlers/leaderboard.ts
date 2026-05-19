import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import { userHistoryTable, testSeriesTable, usersTable } from "@workspace/db";
import { eq, desc, avg, count, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";

function progressBar(value: number, max: number, length = 10): string {
  const filled = Math.round((value / max) * length);
  return "█".repeat(filled) + "░".repeat(length - filled);
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
      logger.error({ err }, "leaderboard command error");
    }
  });

  bot.callbackQuery("lb_global", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      const top = await db
        .select({
          userId: userHistoryTable.userId,
          avgScore: avg(userHistoryTable.score).as("avg_score"),
          avgAccuracy: avg(userHistoryTable.accuracy).as("avg_accuracy"),
          tests: count(userHistoryTable.id).as("tests"),
        })
        .from(userHistoryTable)
        .groupBy(userHistoryTable.userId)
        .orderBy(desc(sql`avg_score`))
        .limit(10);

      if (!top.length) {
        await ctx.editMessageText("🏆 *Global Leaderboard*\n\nNo data yet\\. Be the first to complete a test\\!", { parse_mode: "MarkdownV2" });
        return;
      }

      const userIds = top.map(r => r.userId);
      const users = await db.select({ userId: usersTable.userId, fullName: usersTable.fullName })
        .from(usersTable).where(sql`${usersTable.userId} = ANY(ARRAY[${sql.join(userIds.map(id => sql`${id}`), sql`,`)}]::bigint[])`);
      const nameMap = new Map(users.map(u => [u.userId, u.fullName]));

      const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
      let text = "🏆 *GLOBAL LEADERBOARD — TOP 10*\n\n";
      text += "```\n";
      text += `${"Rank".padEnd(6)} ${"Name".padEnd(18)} ${"Avg%".padEnd(7)} Tests\n`;
      text += "─".repeat(40) + "\n";

      top.forEach((row, i) => {
        const name = (nameMap.get(row.userId) ?? "Unknown").slice(0, 16);
        const acc = parseFloat(String(row.avgAccuracy ?? 0)).toFixed(1);
        const tests = row.tests;
        text += `${medals[i] ?? `#${i + 1}`} ${name.padEnd(18)} ${(acc + "%").padEnd(7)} ${tests}\n`;
      });
      text += "```";

      await ctx.editMessageText(text, { parse_mode: "MarkdownV2" });
    } catch (err) {
      logger.error({ err }, "lb_global error");
    }
  });

  bot.callbackQuery(/^lb_test_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("lb_test_", "");
    try {
      const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
      if (!test) { await ctx.reply("Test not found."); return; }

      const top = await db
        .select({
          userId: userHistoryTable.userId,
          score: userHistoryTable.score,
          accuracy: userHistoryTable.accuracy,
          correct: userHistoryTable.correctCount,
        })
        .from(userHistoryTable)
        .where(eq(userHistoryTable.testId, testId))
        .orderBy(desc(userHistoryTable.score))
        .limit(10);

      if (!top.length) {
        await ctx.editMessageText(`🏆 *${escMd(test.testName)}*\n\nNo one has attempted this test yet\\. Be the first\\!`, { parse_mode: "MarkdownV2" });
        return;
      }

      const userIds = top.map(r => r.userId);
      const users = await db.select({ userId: usersTable.userId, fullName: usersTable.fullName })
        .from(usersTable).where(sql`${usersTable.userId} = ANY(ARRAY[${sql.join(userIds.map(id => sql`${id}`), sql`,`)}]::bigint[])`);
      const nameMap = new Map(users.map(u => [u.userId, u.fullName]));

      const myRank = top.findIndex(r => r.userId === ctx.from.id);
      const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];

      let text = `🏆 *LEADERBOARD: ${escMd(test.testName)}*\n\n`;
      text += "```\n";
      text += `${"Rank".padEnd(5)} ${"Name".padEnd(16)} ${"Score".padEnd(8)} Acc%\n`;
      text += "─".repeat(38) + "\n";
      top.forEach((row, i) => {
        const name = (nameMap.get(row.userId) ?? "Unknown").slice(0, 14);
        const marker = row.userId === ctx.from.id ? " ◀" : "";
        text += `${medals[i] ?? `#${i + 1}`}  ${name.padEnd(16)} ${String(row.score).padEnd(8)} ${row.accuracy.toFixed(1)}%${marker}\n`;
      });
      text += "```";

      if (myRank >= 0) text += `\n\n👤 Your rank: *\\#${myRank + 1}*`;

      await ctx.editMessageText(text, { parse_mode: "MarkdownV2" });
    } catch (err) {
      logger.error({ err }, "lb_test error");
    }
  });
}

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}
