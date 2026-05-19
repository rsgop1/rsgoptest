import type { Bot } from "grammy";
import { db } from "@workspace/db";
import { userHistoryTable, wrongQuestionsTable, usersTable, testSeriesTable } from "@workspace/db";
import { eq, count, avg, sum, desc, sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";

function bar(value: number, max: number, length = 12): string {
  if (max === 0) return "░".repeat(length);
  const filled = Math.min(Math.round((value / max) * length), length);
  return "█".repeat(filled) + "░".repeat(length - filled);
}

function escMd(t: string): string {
  return t.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
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
        await ctx.reply("📊 *Your Stats*\n\nNo tests attempted yet\\. Use /test\\_series to get started\\!", { parse_mode: "MarkdownV2" });
        return;
      }

      const totalTests = history.length;
      const totalCorrect = history.reduce((s, h) => s + h.correctCount, 0);
      const totalWrong = history.reduce((s, h) => s + h.wrongCount, 0);
      const totalSkipped = history.reduce((s, h) => s + h.skippedCount, 0);
      const totalAnswered = totalCorrect + totalWrong;
      const overallAccuracy = totalAnswered > 0 ? (totalCorrect / totalAnswered) * 100 : 0;
      const bestScore = Math.max(...history.map(h => h.accuracy));
      const avgScore = history.reduce((s, h) => s + h.accuracy, 0) / totalTests;
      const [wrongCount] = await db.select({ cnt: count() }).from(wrongQuestionsTable).where(eq(wrongQuestionsTable.userId, userId));

      const byTest = new Map<string, { correct: number; total: number }>();
      for (const h of history) {
        const prev = byTest.get(h.testId) ?? { correct: 0, total: 0 };
        byTest.set(h.testId, {
          correct: prev.correct + h.correctCount,
          total: prev.total + h.correctCount + h.wrongCount + h.skippedCount,
        });
      }

      const recentTests = history.slice(0, 5);
      const testIds = [...new Set(recentTests.map(h => h.testId))];
      const tests = await db.select({ testId: testSeriesTable.testId, testName: testSeriesTable.testName })
        .from(testSeriesTable)
        .where(sql`${testSeriesTable.testId} = ANY(ARRAY[${sql.join(testIds.map(id => sql`${id}`), sql`,`)}]::text[])`);
      const nameMap = new Map(tests.map(t => [t.testId, t.testName]));

      const accBar = bar(overallAccuracy, 100);
      const tier = user.tier === "Premium" ? "💎 Premium" : "🆓 Free";

      let card = "```\n";
      card += "╔══════════════════════════════╗\n";
      card += "║   📊  YOUR PERFORMANCE CARD  ║\n";
      card += "╠══════════════════════════════╣\n";
      card += `║ 👤 ${user.fullName.slice(0, 24).padEnd(25)}║\n`;
      card += `║ 🎯 ${(user.targetExamSub ?? "Not set").slice(0, 24).padEnd(25)}║\n`;
      card += `║ ${tier.padEnd(29)}║\n`;
      card += "╠══════════════════════════════╣\n";
      card += `║ 📝 Tests Taken:  ${String(totalTests).padEnd(12)}║\n`;
      card += `║ ✅ Total Correct: ${String(totalCorrect).padEnd(11)}║\n`;
      card += `║ ❌ Total Wrong:   ${String(totalWrong).padEnd(11)}║\n`;
      card += `║ ⏭️ Total Skipped: ${String(totalSkipped).padEnd(11)}║\n`;
      card += "╠══════════════════════════════╣\n";
      card += `║ 🎯 Overall Accuracy: ${overallAccuracy.toFixed(1).padEnd(9)}%║\n`;
      card += `║    [${accBar}] ║\n`;
      card += `║ 🔝 Best Accuracy:    ${bestScore.toFixed(1).padEnd(9)}%║\n`;
      card += `║ 📈 Avg Accuracy:     ${avgScore.toFixed(1).padEnd(9)}%║\n`;
      card += `║ 📓 Wrong Notebook:  ${String(wrongCount?.cnt ?? 0).padEnd(10)}Qs║\n`;
      card += "╠══════════════════════════════╣\n";
      card += "║   📅 RECENT ATTEMPTS          ║\n";

      for (const h of recentTests.slice(0, 3)) {
        const name = (nameMap.get(h.testId) ?? h.testId).slice(0, 18);
        const acc = h.accuracy.toFixed(0) + "%";
        card += `║ • ${name.padEnd(18)} ${acc.padStart(5)}║\n`;
      }

      const trend = history.length >= 2
        ? (history[0]!.accuracy >= history[1]!.accuracy ? "📈 Improving!" : "📉 Keep practicing!")
        : "Just started!";

      card += "╠══════════════════════════════╣\n";
      card += `║ ${trend.padEnd(29)}║\n`;
      card += "╚══════════════════════════════╝\n";
      card += "```";

      await ctx.reply(`*Your Performance Card*\n\n${escMd(card).replace(/```/g, "```")}`.replace(/\\```/g, "```"), { parse_mode: "MarkdownV2" });

    } catch (err) {
      logger.error({ err }, "stats command error");
      await ctx.reply("❌ Error loading stats\\. Please try again\\.", { parse_mode: "MarkdownV2" });
    }
  });
}
