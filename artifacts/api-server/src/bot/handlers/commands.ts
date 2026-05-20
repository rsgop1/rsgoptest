import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import {
  testSeriesTable,
  usersTable,
  wrongQuestionsTable,
  purchasedTestsTable,
  flashSalesTable,
} from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import type { QuestionData } from "@workspace/db";
import { updateSession } from "../session.js";
import { paymentKeyboard, premiumKeyboard } from "../keyboards.js";
import { sendNextQuestion } from "./quiz.js";
import { logger } from "../../lib/logger.js";

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

async function getActiveSale(testId: string) {
  const now = new Date();
  const [sale] = await db
    .select()
    .from(flashSalesTable)
    .where(and(
      eq(flashSalesTable.testId, testId),
      eq(flashSalesTable.isActive, true),
      lte(flashSalesTable.createdAt, now),
      gte(flashSalesTable.endsAt, now),
    ))
    .limit(1);
  return sale ?? null;
}

export function registerCommandHandlers(bot: Bot): void {
  bot.command("test_series", async (ctx) => {
    try {
      const userId = ctx.from!.id;
      const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
      const tests = await db.select().from(testSeriesTable).where(eq(testSeriesTable.isActive, true));

      if (!tests.length) {
        await ctx.reply("📭 No tests available yet\\. Check back soon\\!", { parse_mode: "MarkdownV2" });
        return;
      }

      const purchased = await db.select().from(purchasedTestsTable).where(eq(purchasedTestsTable.userId, userId));
      const purchasedIds = new Set(purchased.map(p => p.testId));
      const isPremium = user?.tier === "Premium";

      let msg = "📚 *Available Mock Tests:*\n\n";
      const kb = new InlineKeyboard();

      for (const test of tests) {
        const isFree = test.priceInr === 0 && test.priceInStars === 0;
        const hasAccess = isFree || isPremium || purchasedIds.has(test.testId);
        const sale = (!hasAccess && !isFree) ? await getActiveSale(test.testId) : null;
        const lock = hasAccess ? "🔓" : (sale ? "🔥" : "🔒");

        msg += `${lock} *${escMd(test.testName.trim())}*\n`;
        msg += `   📁 ${escMd(test.mainCategory)} → ${escMd(test.subCategory)}\n`;

        if (!isFree) {
          if (sale) {
            msg += `   ~~₹${test.priceInr}~~ 🔥 *₹${sale.discountInr}* \\| ⭐ ${sale.discountStars} Stars \\(SALE\\)\n`;
          } else {
            msg += `   💰 ₹${test.priceInr} \\| ⭐ ${test.priceInStars} Stars\n`;
          }
        } else {
          msg += `   ✅ Free\n`;
        }
        msg += "\n";

        if (hasAccess) {
          kb.text(`▶️ ${test.testName.trim().slice(0, 30)}`, `start_test_${test.testId}`).row();
        } else {
          const btnLabel = sale ? `🔥 ${test.testName.trim().slice(0, 24)} — Sale!` : `🔒 ${test.testName.trim().slice(0, 25)} — Unlock`;
          kb.text(btnLabel, `unlock_test_${test.testId}`).row();
        }
      }

      await ctx.reply(msg, { parse_mode: "MarkdownV2", reply_markup: kb });
    } catch (err) {
      logger.error({ err }, "test_series error");
      await ctx.reply("❌ Error loading tests. Please try again.");
    }
  });

  bot.callbackQuery(/^unlock_test_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("unlock_test_", "");
    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);

    if (!test) { await ctx.reply("❌ Test not found."); return; }

    const sale = await getActiveSale(testId);
    const saleMsg = sale ? `\n\n🔥 *FLASH SALE\\!* ~~₹${test.priceInr}~~ → *₹${sale.discountInr}*` : "";

    await ctx.reply(
      `🔒 *${escMd(test.testName.trim())}*${saleMsg}\n\nUnlock this test to access all questions, solutions, and global ranking\\.`,
      { parse_mode: "MarkdownV2", reply_markup: paymentKeyboard(test.testId, sale?.discountInr ?? test.priceInr, sale?.discountStars ?? test.priceInStars) }
    );
  });

  bot.command("premium", async (ctx) => {
    await ctx.reply(
      `💎 *Series TestPro Premium*\n\n*What you get:*\n✅ All mock tests unlocked\n✅ AI Doubt Solver\n✅ Detailed solutions for every question\n✅ Global rank & performance analytics\n✅ Wrong question notebook\n✅ Flash sale early access\n\n💰 *Plan:* 30 Days Premium\n💲 ₹199 \\| ⭐ 500 Telegram Stars\n\nChoose your payment method:`,
      { parse_mode: "MarkdownV2", reply_markup: premiumKeyboard() }
    );
  });

  bot.command("doubt", async (ctx) => {
    const text = ctx.message?.text?.replace(/^\/doubt\s*/, "").trim();

    if (!text) {
      await ctx.reply(
        `🤖 *AI Doubt Solver*\n\nType your doubt directly after the command:\n\`/doubt your question here\`\n\nExamples:\n• \`/doubt What is passive voice?\`\n• \`/doubt Explain compound interest formula\`\n• \`/doubt RRB NTPC syllabus 2024\``,
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    const thinkMsg = await ctx.reply("🤔 Solving your doubt\\.\\.\\.", { parse_mode: "MarkdownV2" });

    try {
      const baseUrl = process.env["AI_INTEGRATIONS_OPENROUTER_BASE_URL"];
      const apiKey = process.env["AI_INTEGRATIONS_OPENROUTER_API_KEY"];

      if (!baseUrl || !apiKey) {
        await ctx.api.editMessageText(ctx.chat.id, thinkMsg.message_id,
          "❌ AI service not configured yet. Please try again later."
        );
        return;
      }

      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "deepseek/deepseek-v4-flash:free",
          messages: [
            {
              role: "system",
              content: "You are a helpful educational AI for Indian competitive exam students (SSC, Railway, Banking, UPSC, State GovtJobs). Answer doubts clearly and concisely in English. Keep responses under 250 words. Use simple formatting without markdown symbols."
            },
            { role: "user", content: text }
          ],
          max_tokens: 500,
        }),
      });

      const data = await resp.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message: string };
      };

      if (data.error) {
        throw new Error(data.error.message);
      }

      const answer = data.choices?.[0]?.message?.content ?? "Could not get an answer. Please try again.";

      await ctx.api.editMessageText(
        ctx.chat.id,
        thinkMsg.message_id,
        `🤖 *AI Doubt Solver*\n\n*Question:* ${escMd(text.slice(0, 100))}\n\n*Answer:*\n${escMd(answer)}`,
        { parse_mode: "MarkdownV2" }
      );
    } catch (err) {
      logger.error({ err }, "doubt solver error");
      await ctx.api.editMessageText(ctx.chat.id, thinkMsg.message_id,
        "❌ AI service unavailable right now. Please try again in a moment."
      );
    }
  });

  bot.command("notebook", async (ctx) => {
    try {
      const userId = ctx.from!.id;
      const wrongQ = await db.select().from(wrongQuestionsTable).where(eq(wrongQuestionsTable.userId, userId));

      if (!wrongQ.length) {
        await ctx.reply(
          `📓 *Wrong Question Notebook*\n\nNo wrong questions yet\\! 🎉\n\nAttempt a test via /test\\_series and your incorrect answers will be saved here for practice\\.`,
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      const byTest = new Map<string, number[]>();
      for (const wq of wrongQ) {
        if (!byTest.has(wq.testId)) byTest.set(wq.testId, []);
        byTest.get(wq.testId)!.push(wq.questionIndex);
      }

      const questions: QuestionData[] = [];
      for (const [testId, indices] of byTest) {
        if (testId === "notebook") continue;
        const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
        if (!test) continue;
        const allQ = test.questionsData as QuestionData[];
        for (const idx of indices) {
          if (allQ[idx]) questions.push(allQ[idx]!);
        }
      }

      if (!questions.length) {
        await ctx.reply("📓 Notebook is empty.", { parse_mode: "MarkdownV2" });
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
          timerSeconds: 30,
        },
        solution: undefined,
      });

      await ctx.reply(
        `📓 *Wrong Question Notebook*\n\n*${wrongQ.length}* questions to practice\\!\n⏱️ 30 seconds per question\n\nLet's improve your weak spots 💪`,
        { parse_mode: "MarkdownV2" }
      );
      await sendNextQuestion(userId);
    } catch (err) {
      logger.error({ err }, "notebook error");
      await ctx.reply("❌ Error loading notebook. Please try again.");
    }
  });
}
