import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import {
  testSeriesTable,
  usersTable,
  wrongQuestionsTable,
  purchasedTestsTable,
  flashSalesTable,
  reportsTable,
} from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import type { QuestionData } from "@workspace/db";
import { getSession, updateSession, clearQuiz } from "../session.js";
import { paymentKeyboard, premiumKeyboard, testDetailWithStartKeyboard, paymentKeyboard as pkb } from "../keyboards.js";
import { sendNextQuestion, startQuizForUser } from "./quiz.js";
import { logger } from "../../lib/logger.js";
import { emitTelemetry } from "../../lib/telemetry.js";

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

const KNOWN_COMMANDS = [
  "/start", "/test_series", "/leaderboard", "/stats",
  "/notebook", "/challenge", "/premium", "/doubt",
  "/stop", "/myid", "/anon", "/live",
];

function looksLikeTypo(text: string): string | null {
  const typoMap: Record<string, string> = {
    "/tset": "/test_series", "/tsst": "/test_series", "/tesst": "/test_series",
    "/test": "/test_series", "/tests": "/test_series", "/tesr": "/test_series",
    "/strat": "/start", "/satrt": "/start",
    "/premuim": "/premium", "/premum": "/premium", "/prmium": "/premium",
    "/notenook": "/notebook", "/notbook": "/notebook", "/nootbook": "/notebook",
    "/leaederboard": "/leaderboard", "/leadeboard": "/leaderboard",
    "/stat": "/stats", "/sttas": "/stats",
    "/dout": "/doubt", "/duobt": "/doubt",
    "/challegne": "/challenge", "/challege": "/challenge",
  };
  const lower = text.toLowerCase().split(/\s/)[0] ?? "";
  return typoMap[lower] ?? null;
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
  bot.command("stop", async (ctx) => {
    const userId = ctx.from!.id;
    const session = getSession(userId);
    if (!session.quiz) {
      await ctx.reply("❌ No active test to stop\\. Use /test\\_series to start one\\.", { parse_mode: "MarkdownV2" });
      return;
    }
    clearQuiz(userId);
    emitTelemetry(`User ${userId} stopped test manually`);
    await ctx.reply(
      "🛑 *Test stopped\\.* Your progress has been discarded\\.\n\nUse /test\\_series to start a new test or /stats to see your history\\.",
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.command("myid", async (ctx) => {
    const userId = ctx.from!.id;
    updateSession(userId, { pendingFileIdMode: true });
    await ctx.reply(
      `📎 *File ID Helper*\n\nForward or send any image, video, or GIF to me and I'll give you its Telegram File ID\\.\n\nUse that file ID in the admin panel to set up ads\\.\n\n_Send /stop to cancel_`,
      { parse_mode: "MarkdownV2" }
    );
  });

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

      let msg = "📚 *Available Mock Tests:*\n_Click any test to see details before starting_\n\n";
      const kb = new InlineKeyboard();

      for (const test of tests) {
        const isFree = test.priceInr === 0 && test.priceInStars === 0;
        const hasAccess = isFree || isPremium || purchasedIds.has(test.testId);
        const sale = (!hasAccess && !isFree) ? await getActiveSale(test.testId) : null;
        const lock = hasAccess ? "🔓" : (sale ? "🔥" : "🔒");
        const qCount = Array.isArray(test.questionsData) ? (test.questionsData as unknown[]).length : 0;

        msg += `${lock} *${escMd(test.testName.trim())}*\n`;
        msg += `   📁 ${escMd(test.mainCategory)} → ${escMd(test.subCategory)}\n`;
        msg += `   📝 ${qCount} questions \\| ⏱️ ${test.timerSeconds ?? 30}s per Q\n`;

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

        kb.text(`${lock} ${test.testName.trim().slice(0, 30)}`, `start_test_${test.testId}`).row();
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
    const userId = ctx.from!.id;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, userId)).limit(1);

    if (user?.tier === "Premium" && user.premiumExpiry && user.premiumExpiry > new Date()) {
      const expDate = user.premiumExpiry.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      const daysLeft = Math.ceil((user.premiumExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      await ctx.reply(
        `💎 *You're Already Premium\\!*\n\n` +
        `✅ Status: *Active*\n` +
        `📅 Valid till: *${escMd(expDate)}*\n` +
        `⏳ Days remaining: *${daysLeft} day${daysLeft !== 1 ? "s" : ""}*\n\n` +
        `_Want more days? Tap Renew below to extend your Premium\\._`,
        { parse_mode: "MarkdownV2", reply_markup: premiumKeyboard() }
      );
      return;
    }

    await ctx.reply(
      `💎 *Series TestPro Premium*\n\n*What you get:*\n✅ All mock tests unlocked\n✅ AI Info for every question\n✅ No ads before tests\n✅ *Custom timer* \\(30s–120s per question\\)\n✅ Global rank & performance analytics\n✅ Wrong question notebook\n✅ Flash sale early access\n\n💰 *Plan:* 30 Days Premium\n💲 ₹199 \\| ⭐ 500 Telegram Stars\n\nChoose your payment method:`,
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
      const apiKey = process.env["OPENROUTER_API_KEY"] ?? process.env["AI_INTEGRATIONS_OPENROUTER_API_KEY"];
      const baseUrl = process.env["AI_INTEGRATIONS_OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1";

      if (!apiKey) {
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
          model: "deepseek/deepseek-r1-0528-qwen3-8b:free",
          messages: [
            {
              role: "system",
              content: "You are a sharp educational AI for Indian competitive exam students (SSC, Railway, Banking, Bihar/State Govt). Answer the question directly and concisely. No filler words. No markdown symbols (no **, no __, no #). Max 120 words. Give the direct answer first, then 1-2 supporting facts if needed. End with one exam tip if relevant."
            },
            { role: "user", content: text }
          ],
          max_tokens: 300,
        }),
      });

      const data = await resp.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message: string };
      };

      if (data.error) throw new Error(data.error.message);

      const answer = data.choices?.[0]?.message?.content ?? "Could not get an answer. Please try again.";

      await ctx.api.editMessageText(
        ctx.chat.id,
        thinkMsg.message_id,
        `🤖 *Doubt Solved*\n\n*Q:* ${escMd(text.slice(0, 120))}\n\n${escMd(answer)}`,
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
          userAnswers: questions.map(() => null),
          pollMessageIds: [],
          wrongQuestionIds: [],
          cheatWarnings: 0,
          timerSeconds: 30,
          consecutiveCorrect: 0,
        },
        solution: undefined,
      });

      await ctx.reply(
        `📓 *Wrong Question Notebook*\n\n*${wrongQ.length}* questions to practice\\!\n⏱️ 30 seconds per question\n\nLet's improve your weak spots 💪\n_Type /stop anytime to end_`,
        { parse_mode: "MarkdownV2" }
      );
      await sendNextQuestion(userId);
    } catch (err) {
      logger.error({ err }, "notebook error");
      await ctx.reply("❌ Error loading notebook. Please try again.");
    }
  });

  bot.on("message:photo", async (ctx, next) => {
    const userId = ctx.from!.id;
    const session = getSession(userId);
    if (session.pendingFileIdMode) {
      const photos = ctx.message.photo!;
      const best = photos[photos.length - 1]!;
      await ctx.reply(
        `📎 *Image File ID:*\n\`${best.file_id}\`\n\n_Copy this and paste in the Admin Panel → Ads section_`,
        { parse_mode: "MarkdownV2" }
      );
      return;
    }
    return next();
  });

  bot.on("message:video", async (ctx, next) => {
    const userId = ctx.from!.id;
    const session = getSession(userId);
    if (session.pendingFileIdMode) {
      const video = ctx.message.video!;
      await ctx.reply(
        `📎 *Video File ID:*\n\`${video.file_id}\`\n\n_Copy this and paste in the Admin Panel → Ads section_`,
        { parse_mode: "MarkdownV2" }
      );
      return;
    }
    return next();
  });

  bot.on("message:animation", async (ctx, next) => {
    const userId = ctx.from!.id;
    const session = getSession(userId);
    if (session.pendingFileIdMode) {
      const gif = ctx.message.animation!;
      await ctx.reply(
        `📎 *GIF/Animation File ID:*\n\`${gif.file_id}\`\n\n_Copy this and paste in the Admin Panel → Ads section_`,
        { parse_mode: "MarkdownV2" }
      );
      return;
    }
    return next();
  });

  bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from!.id;
    const session = getSession(userId);
    const text = ctx.message.text ?? "";

    if (session.pendingReport?.step === "awaiting_text") {
      updateSession(userId, { pendingReport: undefined });

      const report = session.pendingReport!;
      try {
        await db.insert(reportsTable).values({
          userId,
          testId: report.testId,
          questionIndex: report.questionIndex,
          questionText: report.questionText,
          userAnswer: report.userAnswer ?? undefined,
          correctAnswer: report.correctAnswer,
          reportText: text,
          status: "open",
        });

        await ctx.reply(
          `✅ *Report Submitted\\!*\n\nYour report for Q${report.questionIndex + 1} has been sent to the admin\\.\nYou'll receive a notification once it's reviewed\\.`,
          { parse_mode: "MarkdownV2" }
        );
      } catch (err) {
        logger.error({ err }, "Failed to save report");
        await ctx.reply("❌ Failed to submit report. Please try again.");
      }
      return;
    }

    if (text.startsWith("/") && !text.startsWith("//")) {
      const suggestion = looksLikeTypo(text);
      if (suggestion) {
        try {
          await ctx.deleteMessage();
        } catch { }
        await ctx.reply(
          `⚠️ Did you mean *${escMd(suggestion)}*?\n\n_Tip: Type the command correctly to avoid errors_`,
          { parse_mode: "MarkdownV2" }
        );
        return;
      }
    }

    return next();
  });
}
