import type { Bot } from "grammy";
import { db } from "@workspace/db";
import { userHistoryTable, wrongQuestionsTable, usersTable, testSeriesTable } from "@workspace/db";
import { eq, count, desc, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";

function escMd(t: string): string {
  return t.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

function miniBar(value: number, max: number, length = 8): string {
  if (max === 0) return "░".repeat(length);
  const filled = Math.min(Math.round((value / max) * length), length);
  return "█".repeat(filled) + "░".repeat(length - filled);
}

export function registerStatsHandlers(bot: Bot): void {
  bot.command("stats", async (ctx) => {
    try {
      const userId = ctx.from!.id;

      const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
      if (!user) {
        await ctx.reply("❌ Profile not found\\. Please send /start first\\.", { parse_mode: "MarkdownV2" });
        return;
      }

      const history = await db
        .select()
        .from(userHistoryTable)
        .where(eq(userHistoryTable.userId, userId))
        .orderBy(desc(userHistoryTable.completedAt));

      if (!history.length) {
        await ctx.reply(
          `📊 *Your Stats*\n\n👤 *${escMd(user.fullName)}*\n🎯 Target: *${escMd(user.targetExamSub ?? "Not set")}*\n\nNo tests attempted yet\\.\nUse /test\\_series to start\\! 🚀`,
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      const totalTests = history.length;
      const totalCorrect = history.reduce((s, h) => s + h.correctCount, 0);
      const totalWrong = history.reduce((s, h) => s + h.wrongCount, 0);
      const totalSkipped = history.reduce((s, h) => s + h.skippedCount, 0);
      const totalAnswered = totalCorrect + totalWrong;
      const overallAccuracy = totalAnswered > 0 ? (totalCorrect / totalAnswered) * 100 : 0;
      const bestAccuracy = Math.max(...history.map(h => h.accuracy));
      const avgAccuracy = history.reduce((s, h) => s + h.accuracy, 0) / totalTests;

      const [wrongCount] = await db.select({ cnt: count() }).from(wrongQuestionsTable).where(eq(wrongQuestionsTable.userId, userId));

      const testIds = [...new Set(history.slice(0, 5).map(h => h.testId))];
      const tests = await db.select({ testId: testSeriesTable.testId, testName: testSeriesTable.testName })
        .from(testSeriesTable)
        .where(sql`${testSeriesTable.testId} = ANY(ARRAY[${sql.join(testIds.map(id => sql`${id}`), sql`,`)}]::text[])`);
      const nameMap = new Map(tests.map(t => [t.testId, t.testName]));

      const tier = user.tier === "Premium" ? "💎 Premium" : "🆓 Free";
      const trend = history.length >= 2
        ? (history[0]!.accuracy >= history[1]!.accuracy ? "📈 Improving" : "📉 Needs work")
        : "🆕 Just started";

      let msg = `📊 *Performance Stats*\n\n`;
      msg += `👤 *${escMd(user.fullName)}*\n`;
      msg += `🎯 ${escMd(user.targetExamSub ?? "Target not set")}   ${tier}\n\n`;

      msg += `📝 Tests Taken  —  *${totalTests}*\n`;
      msg += `✅ Correct  —  *${totalCorrect}*\n`;
      msg += `❌ Wrong  —  *${totalWrong}*\n`;
      msg += `⏭️ Skipped  —  *${totalSkipped}*\n`;
      msg += `📓 Notebook  —  *${wrongCount?.cnt ?? 0}* questions\n\n`;

      msg += `🎯 Overall Accuracy\n`;
      msg += `*${escMd(overallAccuracy.toFixed(1))}%*  ${miniBar(overallAccuracy, 100)}\n\n`;

      msg += `🔝 Best: *${escMd(bestAccuracy.toFixed(1))}%*   📈 Avg: *${escMd(avgAccuracy.toFixed(1))}%*\n`;
      msg += `Trend: ${escMd(trend)}\n\n`;

      msg += `📅 *Recent Attempts:*\n`;
      for (const h of history.slice(0, 5)) {
        const name = (nameMap.get(h.testId) ?? h.testId).slice(0, 20);
        const acc = h.accuracy.toFixed(0);
        const emoji = h.accuracy >= 70 ? "✅" : h.accuracy >= 40 ? "🟡" : "❌";
        msg += `${emoji} ${escMd(name)} — *${escMd(acc)}%*\n`;
      }

      await ctx.reply(msg, { parse_mode: "MarkdownV2" });
    } catch (err) {
      logger.error({ err }, "stats command error");
      await ctx.reply("❌ Error loading stats\\. Please try again\\.", { parse_mode: "MarkdownV2" });
    }
  });
}
