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
  liveTestsTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, ne } from "drizzle-orm";
import type { QuestionData } from "@workspace/db";
import { getSession, updateSession, clearQuiz } from "../session.js";
import { paymentKeyboard, premiumKeyboard, testDetailWithStartKeyboard, paymentKeyboard as pkb, timerSelectKeyboard } from "../keyboards.js";
import { sendNextQuestion, startQuizForUser } from "./quiz.js";
import { getConfig } from "./helpers.js";
import { logger } from "../../lib/logger.js";
import { emitTelemetry } from "../../lib/telemetry.js";
import { askGroq, BOT_HELP_CONTEXT } from "../ai.js";

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

const KNOWN_COMMANDS = [
  "/start", "/test_series", "/leaderboard", "/stats",
  "/notebook", "/challenge", "/premium", "/doubt",
   "/stop", "/myid", "/anon", "/live", "/ai_tutor", "/dashboard",
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

function formatIST(date: Date): string {
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

const DEFAULT_SUBJECTS: Record<string, string[]> = {
  Maths: ["Arithmetic", "Algebra", "Geometry", "Trigonometry", "Data Interpretation"],
  GK: ["History", "Polity", "Geography", "Economics", "General Science"],
  English: ["Grammar", "Vocabulary", "Reading Comprehension", "Cloze Test"],
  Reasoning: ["Verbal Reasoning", "Non-Verbal Reasoning", "Puzzles", "Analogy", "Series"],
  "Current Affairs": ["National", "International", "Economy", "Sports", "Science & Technology"],
  General: ["General"],
};

async function loadSubjects(): Promise<Record<string, string[]>> {
  const raw = await getConfig("subjects");
  if (!raw) return DEFAULT_SUBJECTS;
  try {
    return JSON.parse(raw) as Record<string, string[]>;
  } catch {
    return DEFAULT_SUBJECTS;
  }
}

function subjectIcon(subject: string): string {
  return ({ Maths: "➗", GK: "🌍", English: "🔤", Reasoning: "🧠", "Current Affairs": "📰" } as Record<string, string>)[subject] ?? "📘";
}

function subjectKey(value: string): string {
  return encodeURIComponent(value).replace(/%/g, "~");
}

function decodeSubjectKey(value: string): string {
  return decodeURIComponent(value.replace(/~/g, "%"));
}

function subjectKeyboard(subjects: Record<string, string[]>): InlineKeyboard {
  const kb = new InlineKeyboard();
  Object.keys(subjects).forEach((subject, index) => {
    kb.text(`${subjectIcon(subject)} ${subject}`, `browse_subject_${subjectKey(subject)}`);
    if (index % 2 === 1) kb.row();
  });
  if (Object.keys(subjects).length % 2 === 1) kb.row();
  return kb.text("📋 All Tests", "browse_all_tests");
}

function subSubjectKeyboard(subject: string, subSubjects: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  subSubjects.forEach((subSubject, index) => {
    kb.text(`• ${subSubject}`, `browse_subsubject_${subjectKey(subject)}_${subjectKey(subSubject)}`);
    if (index % 2 === 1) kb.row();
  });
  if (subSubjects.length % 2 === 1) kb.row();
  return kb.text(`📚 All ${subject}`, `browse_subject_all_${subjectKey(subject)}`).row()
    .text("⬅️ Subjects", "browse_subjects");
}

async function renderTestList(ctx: any, subject?: string, subSubject?: string): Promise<void> {
  const userId = ctx.from.id;
  const [user, purchased] = await Promise.all([
    db.select().from(usersTable).where(eq(usersTable.userId, userId)).limit(1),
    db.select().from(purchasedTestsTable).where(eq(purchasedTestsTable.userId, userId)),
  ]);
  const filters = [eq(testSeriesTable.isActive, true)];
  if (subject) filters.push(eq(testSeriesTable.subject, subject));
  if (subSubject) filters.push(eq(testSeriesTable.subSubject, subSubject));
  const tests = await db.select().from(testSeriesTable).where(and(...filters));
  const purchasedIds = new Set(purchased.map((p) => p.testId));
  const isPremium = user[0]?.tier === "Premium";
  const title = subSubject ? `${subjectIcon(subject ?? "")} ${subject} › ${subSubject}` : subject ? `${subjectIcon(subject)} ${subject}` : "📋 All Tests";

  if (!tests.length) {
    await ctx.editMessageText(
      `📚 *${escMd(title)}*\n\n_Abhi is section mein tests available nahi hain\\._`,
      { parse_mode: "MarkdownV2", reply_markup: subject ? subSubjectKeyboard(subject, (await loadSubjects())[subject] ?? []) : subjectKeyboard(await loadSubjects()) },
    );
    return;
  }

  const kb = new InlineKeyboard();
  let msg = `📚 *${escMd(title)}*\n\n_Choose a test to view details:_\n\n`;
  for (const test of tests) {
    const free = test.priceInr === 0 && test.priceInStars === 0;
    const access = free || isPremium || purchasedIds.has(test.testId);
    const qCount = Array.isArray(test.questionsData) ? test.questionsData.length : 0;
    msg += `${access ? "🔓" : "🔒"} *${escMd(test.testName.trim())}*\n`;
    msg += `   ${escMd(test.mainCategory)} · ${qCount} Q · ${test.timerSeconds ?? 30}s/Q\n\n`;
    kb.text(`${access ? "🔓" : "🔒"} ${test.testName.trim().slice(0, 28)}`, `start_test_${test.testId}`).row();
  }
  kb.text("⬅️ Subjects", "browse_subjects");
  await ctx.editMessageText(msg, { parse_mode: "MarkdownV2", reply_markup: kb });
}

export function registerCommandHandlers(bot: Bot): void {
  bot.command("help", async (ctx) => {
    await ctx.reply(
      `📚 *Series TestPro — Commands*\n\n` +
      `*Study & Practice:*\n` +
      `/test\\_series — Browse & start mock tests\n` +
      `/notebook — Practice your wrong questions\n` +
      `/doubt — AI doubt solver \\(3/day free\\)\n\n` +
      `*Stats & Rankings:*\n` +
      `/leaderboard — Top performers ranking\n` +
      `/stats — Your personal analytics\n\n` +
      `*Live Tests:*\n` +
      `/live — Upcoming live mock tests\n\n` +
      `*Challenges & Social:*\n` +
      `/challenge — Challenge a friend to a test duel\n` +
      `/anon — Anonymous doubt in study group\n\n` +
      `*Account:*\n` +
      `/premium — Upgrade to Premium 💎\n` +
      `/start — Home & referral link\n` +
      `/stop — Stop current test\n\n` +
      `💡 _Premium = all tests unlocked \\+ unlimited AI \\+ no ads \\+ custom timer_`,
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.command("live", async (ctx) => {
    try {
      const upcoming = await db
        .select()
        .from(liveTestsTable)
        .where(ne(liveTestsTable.status, "completed"))
        .limit(5);

      if (!upcoming.length) {
        await ctx.reply(
          `📡 *No Live Tests Scheduled*\n\nNo upcoming live mock tests right now\\.\n\nFollow our group or channel to get notified when a live test is announced\\! 🔔`,
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      let msg = `🔴 *Upcoming Live Mock Tests*\n\n`;
      const kb = new InlineKeyboard();

      for (const lt of upcoming) {
        const schedTime = new Date(lt.scheduledAt).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "2-digit", month: "short",
          hour: "2-digit", minute: "2-digit", hour12: true,
        });
        const participants = Array.isArray(lt.participants) ? lt.participants.length : 0;
        const statusEmoji = lt.status === "live" ? "🔴 LIVE" : lt.status === "notified" ? "⚡ Starting Soon" : "📅";

        msg += `${statusEmoji} *${escMd(lt.title)}*\n`;
        msg += `⏰ ${escMd(schedTime)} IST\n`;
        msg += `👥 ${participants} joined\n\n`;

        if (lt.status !== "live") {
          kb.url(`✅ Join: ${lt.title.slice(0, 25)}`, `https://t.me/gt_testprobot?start=livetestjoin_${lt.id}`).row();
        }
      }

      msg += `_Join before the test starts\\! Questions are sent to your DM automatically\\._`;
      await ctx.reply(msg, { parse_mode: "MarkdownV2", reply_markup: kb });
    } catch (err) {
      logger.error({ err }, "live command error");
      await ctx.reply("❌ Error loading live tests. Please try again.");
    }
  });

  bot.command("stop", async (ctx) => {
    const userId = ctx.from!.id;
    const session = getSession(userId);
    if (!session.quiz) {
      await ctx.reply("❌ No active test to stop\\. Use /test\\_series to start one\\.", { parse_mode: "MarkdownV2" });
      return;
    }
    const pollIds = [...(session.quiz.pollMessageIds ?? [])];
    if (session.quiz.currentPollMessageId) {
      try { await ctx.api.stopPoll(userId, session.quiz.currentPollMessageId); } catch {}
    }
    for (const messageId of pollIds) {
      try { await ctx.api.deleteMessage(userId, messageId); } catch {}
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
      const subjects = await loadSubjects();
      const testCount = await db.select({ count: sql<number>`count(*)::int` }).from(testSeriesTable).where(eq(testSeriesTable.isActive, true));
      if (!testCount[0]?.count) {
        await ctx.reply("📭 No tests available yet\\. Check back soon\\!", { parse_mode: "MarkdownV2" });
        return;
      }
      await ctx.reply(
        `📚 *Test Series Hub*\n\n` +
        `Choose a subject to explore focused mock tests\\.\n` +
        `_${escMd(String(testCount[0].count))} active tests available_`,
        { parse_mode: "MarkdownV2", reply_markup: subjectKeyboard(subjects) },
      );
    } catch (err) {
      logger.error({ err }, "test_series error");
      await ctx.reply("❌ Error loading tests. Please try again.");
    }
  });

  bot.callbackQuery("browse_subjects", async (ctx) => {
    await ctx.answerCallbackQuery();
    const subjects = await loadSubjects();
    await ctx.editMessageText("📚 *Test Series Hub*\n\nChoose a subject to explore focused mock tests\\.", {
      parse_mode: "MarkdownV2",
      reply_markup: subjectKeyboard(subjects),
    });
  });

  bot.callbackQuery("browse_all_tests", async (ctx) => {
    await ctx.answerCallbackQuery();
    await renderTestList(ctx);
  });

  bot.callbackQuery(/^browse_subject_(?!all_)/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const subject = decodeSubjectKey(ctx.callbackQuery.data.replace("browse_subject_", ""));
    const subjects = await loadSubjects();
    await ctx.editMessageText(`${subjectIcon(subject)} *${escMd(subject)}*\n\nChoose a focused topic:`, {
      parse_mode: "MarkdownV2",
      reply_markup: subSubjectKeyboard(subject, subjects[subject] ?? []),
    });
  });

  bot.callbackQuery(/^browse_subject_all_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const subject = decodeSubjectKey(ctx.callbackQuery.data.replace("browse_subject_all_", ""));
    await renderTestList(ctx, subject);
  });

  bot.callbackQuery(/^browse_subsubject_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const parts = ctx.callbackQuery.data.replace("browse_subsubject_", "").split("_");
    const subject = decodeSubjectKey(parts.shift() ?? "");
    const subSubject = decodeSubjectKey(parts.join("_"));
    await renderTestList(ctx, subject, subSubject);
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
    const userId = ctx.from!.id;
    const text = ctx.message?.text?.replace(/^\/doubt\s*/, "").trim();

    if (!text) {
      await ctx.reply(
        `🤖 *AI Doubt Solver*\n\nType your doubt directly after the command:\n\`/doubt your question here\`\n\nExamples:\n• \`/doubt What is passive voice?\`\n• \`/doubt Explain compound interest formula\`\n• \`/doubt RRB NTPC syllabus 2024\``,
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    const [userRow] = await db.select({ tier: usersTable.tier, aiDoubtCount: usersTable.aiDoubtCount, aiDoubtDate: usersTable.aiDoubtDate })
      .from(usersTable).where(eq(usersTable.userId, userId)).limit(1);

    const isPremium = userRow?.tier === "Premium";
    const MAX_FREE_DOUBTS = 3;

    if (!isPremium) {
      const today = new Date().toISOString().slice(0, 10);
      const lastDate = userRow?.aiDoubtDate ?? "";
      const usedToday = lastDate === today ? (userRow?.aiDoubtCount ?? 0) : 0;

      if (usedToday >= MAX_FREE_DOUBTS) {
        await ctx.reply(
          `🤖 *Daily Doubt Limit Reached*\n\nFree users can ask *${MAX_FREE_DOUBTS} doubts per day*\\.\n\nYou've used all ${MAX_FREE_DOUBTS} doubts for today\\.  Come back tomorrow\\!\n\n💎 *Upgrade to Premium* for unlimited doubt solving:\n/premium`,
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      const newCount = usedToday + 1;
      await db.update(usersTable)
        .set({ aiDoubtCount: newCount, aiDoubtDate: today })
        .where(eq(usersTable.userId, userId))
        .catch(() => {});
    }

    const thinkMsg = await ctx.reply("🤔 Solving your doubt\\.\\.\\.", { parse_mode: "MarkdownV2" });

    try {
      const aiEnabled = await getConfig("ai_enabled");
      if (aiEnabled === "false") {
        await ctx.api.editMessageText(ctx.chat.id, thinkMsg.message_id,
          "🔧 AI Doubt Solver is temporarily offline for maintenance\\. Please try again later\\.",
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      const customPrompt = await getConfig("doubt_prompt");
       const systemPrompt = `${BOT_HELP_CONTEXT}\n${customPrompt || "You are a sharp educational AI for Indian competitive exam students. Answer directly and concisely. No filler words. No markdown symbols. Max 120 words. End with one exam tip if relevant."}`;
       const answer = await askGroq([
         { role: "system", content: systemPrompt },
         { role: "user", content: text },
       ], { maxTokens: 8192 });
      const limitNote = !isPremium ? `\n\n_Free doubts left today: ${MAX_FREE_DOUBTS - (userRow?.aiDoubtCount ?? 0)}_` : "";

      await ctx.api.editMessageText(
        ctx.chat.id,
        thinkMsg.message_id,
        `🤖 *Doubt Solved*\n\n*Q:* ${escMd(text.slice(0, 120))}\n\n${escMd(answer)}${escMd(limitNote)}`,
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

    if (session.pendingAiTutor && !text.startsWith("/")) {
      updateSession(userId, { pendingAiTutor: false });
      const thinkMsg = await ctx.reply("🧠 Tutor is thinking\\.\\.\\.", { parse_mode: "MarkdownV2" });
      try {
        const [user] = await db.select({
          tier: usersTable.tier,
          aiDoubtCount: usersTable.aiDoubtCount,
          aiDoubtDate: usersTable.aiDoubtDate,
        }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
        if (user?.tier !== "Premium") {
          const today = new Date().toISOString().slice(0, 10);
          const usedToday = user?.aiDoubtDate === today ? (user.aiDoubtCount ?? 0) : 0;
          if (usedToday >= 2) {
            await ctx.api.editMessageText(ctx.chat.id, thinkMsg.message_id, "🤖 AI Tutor daily limit reached\\. Use /premium for unlimited access\\.", { parse_mode: "MarkdownV2" });
            return;
          }
          await db.update(usersTable).set({ aiDoubtCount: usedToday + 1, aiDoubtDate: today }).where(eq(usersTable.userId, userId));
        }
         const answer = await askGroq([
          { role: "system", content: "You are Series TestPro's exam tutor. Explain clearly for Indian competitive exam students. Answer directly, show steps for calculations, use short headings, and finish with one practice tip. Never invent facts." },
          { role: "user", content: text.slice(0, 4000) },
        ]);
        await ctx.api.editMessageText(ctx.chat.id, thinkMsg.message_id, `🤖 *AI Tutor*\n\n${escMd(answer)}\n\n_Ask another question with /ai\\_tutor_`, { parse_mode: "MarkdownV2" });
      } catch (error) {
        logger.error({ error, userId }, "ai tutor error");
        await ctx.api.editMessageText(ctx.chat.id, thinkMsg.message_id, "❌ AI Tutor is temporarily unavailable. Please try again shortly.");
      }
      return;
    }
    if (text === "/cancel" && session.pendingAiTutor) {
      updateSession(userId, { pendingAiTutor: false });
      await ctx.reply("✅ AI Tutor session closed.");
      return;
    }

    const pendingPractice = session.pendingPractice;
    if (pendingPractice && /^\d+$/.test(text.trim())) {
      const value = Number(text.trim());
      const [test] = await db.select().from(testSeriesTable)
        .where(eq(testSeriesTable.testId, pendingPractice.testId)).limit(1);
      if (!test) {
        updateSession(userId, { pendingPractice: undefined });
        await ctx.reply("❌ Test not found. Please open the test again.");
        return;
      }

      if (pendingPractice.awaiting === "start") {
        if (value < 1 || value > pendingPractice.totalQuestions) {
          await ctx.reply(`❌ Please enter a serial number between 1 and ${pendingPractice.totalQuestions}.`);
          return;
        }
        updateSession(userId, {
          pendingPractice: { ...pendingPractice, startQuestion: value, awaiting: "count" },
        });
        await ctx.reply(
          `⏱️ *Select Your Timer*\n\n💎 Choose how long you want per question:\n_Choose ♾️ No Time Limit for self\\-paced practice_`,
          { parse_mode: "MarkdownV2", reply_markup: timerSelectKeyboard(test.testId, true) }
        );
        return;
      }

      if (value < 1 || value > pendingPractice.totalQuestions) {
        await ctx.reply(`❌ Please enter a number between 1 and ${pendingPractice.totalQuestions}.`);
        return;
      }
      updateSession(userId, { pendingPractice: undefined });
      await startQuizForUser(
        userId, test, true, pendingPractice.timerSeconds,
        pendingPractice.startQuestion, value
      );
      return;
    }

    if (pendingPractice?.awaiting === "start") {
      await ctx.reply(`❌ Please enter a valid question serial number between 1 and ${pendingPractice.totalQuestions}.`);
      return;
    }

    if (pendingPractice?.awaiting === "count") {
      await ctx.reply(`❌ Please enter a valid number between 1 and ${pendingPractice.totalQuestions}.`);
      return;
    }

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
