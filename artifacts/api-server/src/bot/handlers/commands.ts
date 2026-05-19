import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import {
  testSeriesTable,
  usersTable,
  wrongQuestionsTable,
  purchasedTestsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { QuestionData } from "@workspace/db";
import { getSession, updateSession } from "../session.js";
import { paymentKeyboard, premiumKeyboard } from "../keyboards.js";
import { sendNextQuestion } from "./quiz.js";
import { logger } from "../../lib/logger.js";

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

export function registerCommandHandlers(bot: Bot): void {
  bot.command("test_series", async (ctx) => {
    try {
      const userId = ctx.from!.id;
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.userId, userId))
        .limit(1);

      const tests = await db
        .select()
        .from(testSeriesTable)
        .where(eq(testSeriesTable.isActive, true));

      if (!tests.length) {
        await ctx.reply("📭 Abhi koi test available nahi hai\\. Jald hi add hoga\\!", { parse_mode: "MarkdownV2" });
        return;
      }

      const purchased = await db
        .select()
        .from(purchasedTestsTable)
        .where(eq(purchasedTestsTable.userId, userId));
      const purchasedIds = new Set(purchased.map((p) => p.testId));
      const isPremium = user?.tier === "Premium";

      let msg = "📚 *Available Mock Tests:*\n\n";
      const kb = new InlineKeyboard();

      for (const test of tests) {
        const isFree = test.priceInr === 0 && test.priceInStars === 0;
        const hasAccess = isFree || isPremium || purchasedIds.has(test.testId);
        const lock = hasAccess ? "🔓" : "🔒";
        msg += `${lock} *${escMd(test.testName)}*\n`;
        msg += `   📁 ${escMd(test.mainCategory)} → ${escMd(test.subCategory)}\n`;
        if (!isFree) msg += `   💰 ₹${test.priceInr} / ⭐ ${test.priceInStars} Stars\n`;
        msg += "\n";

        if (hasAccess) {
          kb.text(`▶️ ${test.testName.slice(0, 30)}`, `start_test_${test.testId}`).row();
        } else {
          kb.text(`🔒 ${test.testName.slice(0, 25)} — Unlock`, `unlock_test_${test.testId}`).row();
        }
      }

      await ctx.reply(msg, { parse_mode: "MarkdownV2", reply_markup: kb });
    } catch (err) {
      logger.error({ err }, "Error in /test_series");
      await ctx.reply("❌ Tests load karne mein error. Please dobara try karein.");
    }
  });

  bot.callbackQuery(/^unlock_test_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("unlock_test_", "");
    const [test] = await db
      .select()
      .from(testSeriesTable)
      .where(eq(testSeriesTable.testId, testId))
      .limit(1);

    if (!test) {
      await ctx.reply("❌ Test nahi mila.");
      return;
    }

    await ctx.reply(
      `🔒 *${escMd(test.testName)}*\n\nIs test ko unlock karne ke liye payment karein:`,
      { parse_mode: "MarkdownV2", reply_markup: paymentKeyboard(test.testId, test.priceInr, test.priceInStars) }
    );
  });

  bot.command("premium", async (ctx) => {
    await ctx.reply(
      `💎 *Testbook\\+ Premium*\n\n*Kya milega?*\n✅ Saare mock tests unlocked\n✅ AI Doubt Solver \\(coming soon\\)\n✅ Detailed solutions\n✅ Performance analytics\n✅ Wrong question notebook\n\n💰 *Plan:* 30 Days Premium\n💲 Price: ₹199 / ⭐ 500 Stars\n\nPayment method choose karein:`,
      { parse_mode: "MarkdownV2", reply_markup: premiumKeyboard() }
    );
  });

  bot.command("doubt", async (ctx) => {
    await ctx.reply(
      `🤖 *AI Doubt Solver*\n\nYeh feature jaldi available hoga\\!\n\nAdmin OpenRouter integration setup kar raha hai\\. Tab tak solution book mein detailed explanations padh sakte hain\\.\n\n/test\\_series se koi test attempt karein aur solutions mein "Clear Doubt via AI" button milega\\.`,
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.command("notebook", async (ctx) => {
    try {
      const userId = ctx.from!.id;
      const wrongQ = await db
        .select()
        .from(wrongQuestionsTable)
        .where(eq(wrongQuestionsTable.userId, userId));

      if (!wrongQ.length) {
        await ctx.reply("📓 *Wrong Question Notebook*\n\nAbhi tak koi galat question nahi mila\\! Badhiya\\! 🎉", {
          parse_mode: "MarkdownV2",
        });
        return;
      }

      const byTest = new Map<string, number[]>();
      for (const wq of wrongQ) {
        if (!byTest.has(wq.testId)) byTest.set(wq.testId, []);
        byTest.get(wq.testId)!.push(wq.questionIndex);
      }

      const questions: QuestionData[] = [];
      for (const [testId, indices] of byTest) {
        const [test] = await db
          .select()
          .from(testSeriesTable)
          .where(eq(testSeriesTable.testId, testId))
          .limit(1);
        if (!test) continue;
        const allQ = test.questionsData as QuestionData[];
        for (const idx of indices) {
          if (allQ[idx]) questions.push(allQ[idx]);
        }
      }

      if (!questions.length) {
        await ctx.reply("📓 Notebook empty hai.", { parse_mode: "MarkdownV2" });
        return;
      }

      updateSession(userId, {
        quiz: {
          testId: "notebook",
          testName: "Wrong Question Notebook",
          questions,
          currentIndex: 0,
          correctCount: 0,
          wrongCount: 0,
          skippedCount: 0,
          wrongQuestionIds: [],
          cheatWarnings: 0,
        },
      });

      await ctx.reply(
        `📓 *Wrong Question Notebook*\n\n${wrongQ.length} galat questions mila hai\\. Abhi practice karte hain\\!\n⏱️ Har question ke liye 30 seconds\\.`,
        { parse_mode: "MarkdownV2" }
      );
      await sendNextQuestion(userId);
    } catch (err) {
      logger.error({ err }, "Error in /notebook");
      await ctx.reply("❌ Notebook load karne mein error. Please dobara try karein.");
    }
  });
}
