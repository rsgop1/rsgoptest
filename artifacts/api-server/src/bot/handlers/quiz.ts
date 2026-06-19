import type { Bot } from "grammy";
import { db } from "@workspace/db";
import {
  testSeriesTable,
  userHistoryTable,
  wrongQuestionsTable,
  usersTable,
  adsTable,
} from "@workspace/db";
import { eq, and, count, gt, desc } from "drizzle-orm";
import type { QuestionData } from "@workspace/db";
import {
  getSession,
  updateSession,
  clearQuiz,
  type SolutionSession,
} from "../session.js";
import { getApi } from "../api-instance.js";
import { scorecardKeyboard, solutionNavKeyboard, attemptsKeyboard } from "../keyboards.js";
import { logger } from "../../lib/logger.js";
import { getConfig } from "./helpers.js";
import { postChallengeResult } from "./challenge.js";
import { emitTelemetry } from "../../lib/telemetry.js";
import { InlineKeyboard } from "grammy";

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

function progressBar(value: number, max: number, length = 10): string {
  if (max === 0) return "░".repeat(length);
  const filled = Math.min(Math.max(0, Math.round((value / max) * length)), length);
  return "█".repeat(filled) + "░".repeat(length - filled);
}

function buildScorecardCard(
  testName: string, score: number, maxScore: number,
  correct: number, wrong: number, skipped: number,
  accuracy: number, rank: number, total: number
): string {
  const accBar = progressBar(accuracy, 100);
  const grade =
    accuracy >= 85 ? "Excellent 🏆" :
    accuracy >= 70 ? "Great 🌟" :
    accuracy >= 55 ? "Good 👍" :
    accuracy >= 40 ? "Average 📚" : "Keep Going 💪";

  return (
    `📊 *Series TestPro — Result*\n\n` +
    `📝 *${escMd(testName.trim())}*\n\n` +
    `🔢 Score: *${escMd(String(score))} \\/ ${escMd(String(maxScore))}*\n\n` +
    `✅ Correct: *${correct}*   ❌ Wrong: *${wrong}*   ⏭️ Skipped: *${skipped}*\n\n` +
    `🎯 Accuracy: *${escMd(accuracy.toFixed(1))}%*\n` +
    `\\[${accBar}\\]\n\n` +
    `🏅 Grade: *${escMd(grade)}*\n` +
    `🏆 Rank: *\\#${rank}* of *${total}* students`
  );
}

async function checkForceSub(userId: number): Promise<boolean> {
  try {
    const forceSub = await getConfig("force_sub_enabled");
    if (forceSub !== "true") return true;
    const channel = await getConfig("force_sub_channel");
    if (!channel) return true;
    const api = getApi();
    const channelId = channel.startsWith("@") ? channel : (isNaN(Number(channel)) ? channel : Number(channel));
    const member = await api.getChatMember(channelId as string, userId);
    return member.status !== "left" && member.status !== "kicked" && member.status !== "restricted";
  } catch {
    return true;
  }
}

async function deletePollMessages(userId: number, messageIds: number[]): Promise<void> {
  const api = getApi();
  for (const msgId of messageIds) {
    try {
      await api.deleteMessage(userId, msgId);
      await new Promise((r) => setTimeout(r, 150));
    } catch { }
  }
}

export async function startQuizForUser(
  userId: number,
  test: { testId: string; testName: string; questionsData: unknown; timerSeconds: number | null; positiveMarking: number; negativeMarking: number },
  sendStartMsg = true
): Promise<void> {
  const api = getApi();
  const questions = test.questionsData as QuestionData[];
  if (!questions.length) {
    await api.sendMessage(userId, "❌ This test has no questions yet. Admin will add them soon.");
    return;
  }

  const inSub = await checkForceSub(userId);
  if (!inSub) {
    const channel = await getConfig("force_sub_channel");
    const joinKb = new InlineKeyboard().url("👉 Join Channel", `https://t.me/${(channel ?? "").replace("@", "")}`);
    await api.sendMessage(userId,
      `🔒 *Channel Membership Required*\n\nJoin our channel to access tests and continue:\n${channel ?? ""}\n\nAfter joining, send /start to continue\\.`,
      { parse_mode: "MarkdownV2", reply_markup: joinKb }
    );
    return;
  }

  updateSession(userId, {
    solution: undefined,
    quiz: {
      testId: test.testId,
      testName: test.testName,
      questions,
      currentIndex: 0,
      correctCount: 0,
      wrongCount: 0,
      skippedCount: 0,
      userAnswers: questions.map(() => null),
      pollMessageIds: [],
      wrongQuestionIds: [],
      cheatWarnings: 0,
      timerSeconds: test.timerSeconds ?? 30,
    },
  });

  if (sendStartMsg) {
    await api.sendMessage(userId,
      `🚀 *${escMd(test.testName.trim())}* starting\\!\n\n📝 Questions: *${questions.length}*\n⏱️ Timer: *${test.timerSeconds ?? 30}s* per question\n➕ Correct: *\\+${escMd(String(test.positiveMarking))}*  ➖ Wrong: *\\-${escMd(String(test.negativeMarking))}*\n\nAll the best\\! 💪\n\n_Type /stop anytime to end the test_`,
      { parse_mode: "MarkdownV2" }
    );
  }

  emitTelemetry(`User ${userId} started test: ${test.testName}`);
  await sendNextQuestion(userId);
}

export async function sendNextQuestion(userId: number): Promise<void> {
  const api = getApi();
  const session = getSession(userId);
  const quiz = session.quiz;
  if (!quiz) return;

  if (quiz.currentIndex >= quiz.questions.length) {
    await generateScorecard(userId);
    return;
  }

  const question = quiz.questions[quiz.currentIndex]!;
  quiz.questionSentAt = Date.now();
  const timerSec = quiz.timerSeconds ?? 30;

  try {
    const msg = await api.sendPoll(
      userId,
      question.question.slice(0, 300),
      question.options.map(o => ({ text: o.slice(0, 100) })),
      {
        type: "quiz",
        correct_option_ids: [question.correctOptionIndex],
        explanation: question.explanation ? question.explanation.slice(0, 200) : undefined,
        is_anonymous: false,
        open_period: timerSec,
      }
    );

    quiz.currentPollMessageId = msg.message_id;
    quiz.pollMessageIds.push(msg.message_id);
    const pollData = (msg as any).poll;
    quiz.currentPollId = pollData?.id as string | undefined;

    const pollIdSnapshot = quiz.currentPollId;
    quiz.timer = setTimeout(async () => {
      const s = getSession(userId);
      if (!s.quiz || s.quiz.currentPollId !== pollIdSnapshot) return;
      const q = s.quiz;
      try { await api.stopPoll(userId, q.currentPollMessageId!); } catch (_) {}
      q.skippedCount++;
      q.currentIndex++;
      q.timer = undefined;
      updateSession(userId, { quiz: q });
      await api.sendMessage(userId, "⏳ *Time's up\\!* Moving to next question\\.", { parse_mode: "MarkdownV2" });
      await sendNextQuestion(userId);
    }, timerSec * 1000);

    updateSession(userId, { quiz });
  } catch (err) {
    logger.error({ err, userId }, "Error sending poll question");
  }
}

async function generateScorecard(userId: number): Promise<void> {
  const api = getApi();
  const session = getSession(userId);
  const quiz = session.quiz;
  if (!quiz) return;

  let pos = 1, neg = 0.25;
  if (quiz.testId !== "notebook") {
    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, quiz.testId)).limit(1);
    if (test) { pos = test.positiveMarking; neg = test.negativeMarking; }
  }

  const score = parseFloat((quiz.correctCount * pos - quiz.wrongCount * neg).toFixed(2));
  const maxScore = parseFloat((quiz.questions.length * pos).toFixed(2));
  const totalAnswered = quiz.correctCount + quiz.wrongCount;
  const accuracy = totalAnswered > 0 ? parseFloat(((quiz.correctCount / totalAnswered) * 100).toFixed(1)) : 0;

  const pollMsgIds = [...quiz.pollMessageIds];

  let attemptId: number | undefined;
  if (quiz.testId !== "notebook") {
    const [inserted] = await db.insert(userHistoryTable).values({
      userId, testId: quiz.testId, score, maxScore,
      correctCount: quiz.correctCount, wrongCount: quiz.wrongCount,
      skippedCount: quiz.skippedCount, accuracy,
      userAnswers: quiz.userAnswers,
    }).returning({ id: userHistoryTable.id });
    attemptId = inserted?.id;
  }

  if (quiz.wrongQuestionIds.length > 0) {
    await db.insert(wrongQuestionsTable).values(
      quiz.wrongQuestionIds.map(wq => ({ userId, testId: wq.testId, questionIndex: wq.questionIndex }))
    ).catch(() => {});
  }

  let rank = 1, totalParticipants = 1;
  if (quiz.testId !== "notebook") {
    const [rankRow] = await db.select({ cnt: count() }).from(userHistoryTable)
      .where(and(eq(userHistoryTable.testId, quiz.testId), gt(userHistoryTable.score, score)));
    const [totalRow] = await db.select({ cnt: count() }).from(userHistoryTable)
      .where(eq(userHistoryTable.testId, quiz.testId));
    rank = (rankRow?.cnt ?? 0) + 1;
    totalParticipants = totalRow?.cnt ?? 1;
  }

  const card = buildScorecardCard(
    quiz.testName.replace("⚔️ CHALLENGE: ", ""),
    score, maxScore, quiz.correctCount, quiz.wrongCount, quiz.skippedCount,
    accuracy, rank, totalParticipants
  );

  updateSession(userId, {
    quiz: undefined,
    solution: {
      testId: quiz.testId,
      testName: quiz.testName,
      questions: quiz.questions,
      userAnswers: quiz.userAnswers,
      currentIndex: 0,
      attemptId,
    },
  });

  const challengeId = quiz.testId.startsWith("challenge_") ? quiz.testId.replace("challenge_", "") : null;
  if (challengeId) {
    await postChallengeResult(challengeId, userId, score, quiz.correctCount, quiz.questions.length).catch(() => {});
  }

  emitTelemetry(`User ${userId} completed test: ${quiz.testName} — Score: ${score}/${maxScore}, Accuracy: ${accuracy}%`);

  await api.sendMessage(userId, card, {
    parse_mode: "MarkdownV2",
    reply_markup: scorecardKeyboard(quiz.testId),
  });

  setTimeout(async () => {
    emitTelemetry(`Auto-cleanup: deleting ${pollMsgIds.length} poll messages for user ${userId}`);
    await deletePollMessages(userId, pollMsgIds);
  }, 3000);
}

function buildSolutionText(session: SolutionSession): string {
  const { questions, currentIndex, userAnswers } = session;
  const q = questions[currentIndex]!;
  const userAns = userAnswers[currentIndex];
  const correct = q.correctOptionIndex;

  const optionLines = q.options.map((opt, i) => {
    let prefix = "⚪";
    if (i === correct && i === userAns) prefix = "✅";
    else if (i === correct) prefix = "🟢";
    else if (i === userAns) prefix = "❌";
    return `${prefix} ${escMd(opt)}`;
  });

  const statusLine = userAns === null || userAns === undefined
    ? "⏭️ _You skipped this question_"
    : userAns === correct
      ? "✅ _Your answer was correct\\!_"
      : "❌ _Your answer was wrong_";

  return (
    `📖 *SOLUTION — Q${currentIndex + 1}\\/${questions.length}*\n\n` +
    `*${escMd(q.question)}*\n\n` +
    `${optionLines.join("\n")}\n\n` +
    `${statusLine}\n\n` +
    `📝 *Explanation:*\n${escMd(q.explanation || "No explanation provided.")}`
  );
}

export function registerQuizHandlers(bot: Bot): void {
  bot.callbackQuery("view_solutions", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (!session.solution) {
      await ctx.reply("❌ No solutions available. Complete a test first.");
      return;
    }
    session.solution.currentIndex = 0;
    updateSession(userId, { solution: session.solution });
    await ctx.editMessageText(buildSolutionText(session.solution), {
      parse_mode: "MarkdownV2",
      reply_markup: solutionNavKeyboard(0, session.solution.questions.length),
    });
  });

  bot.callbackQuery(/^sol_prev_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const session = getSession(ctx.from.id);
    if (!session.solution) return;
    const idx = parseInt(ctx.callbackQuery.data.split("_")[2] ?? "0", 10);
    session.solution.currentIndex = Math.max(0, idx - 1);
    updateSession(ctx.from.id, { solution: session.solution });
    await ctx.editMessageText(buildSolutionText(session.solution), {
      parse_mode: "MarkdownV2",
      reply_markup: solutionNavKeyboard(session.solution.currentIndex, session.solution.questions.length),
    });
  });

  bot.callbackQuery(/^sol_next_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const session = getSession(ctx.from.id);
    if (!session.solution) return;
    const idx = parseInt(ctx.callbackQuery.data.split("_")[2] ?? "0", 10);
    session.solution.currentIndex = Math.min(session.solution.questions.length - 1, idx + 1);
    updateSession(ctx.from.id, { solution: session.solution });
    await ctx.editMessageText(buildSolutionText(session.solution), {
      parse_mode: "MarkdownV2",
      reply_markup: solutionNavKeyboard(session.solution.currentIndex, session.solution.questions.length),
    });
  });

  bot.callbackQuery("sol_home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      "🏠 *Series TestPro*\n\nUse /test\\_series to browse tests\\.",
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.callbackQuery("sol_noop", async (ctx) => { await ctx.answerCallbackQuery(); });

  bot.callbackQuery("doubt_ai", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "🤖 *AI Doubt Solver*\n\nType your doubt with the command:\n`/doubt your question here`\n\nExample: `/doubt What is passive voice?`",
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.callbackQuery("go_test_series", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("📚 Use /test\\_series to browse all available tests\\.", { parse_mode: "MarkdownV2" });
  });

  bot.callbackQuery(/^reattempt_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("reattempt_", "");
    const userId = ctx.from.id;
    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
    if (!test) { await ctx.reply("❌ Test not found."); return; }
    await startQuizForUser(userId, test);
  });

  bot.callbackQuery(/^my_attempts_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("my_attempts_", "");
    const userId = ctx.from.id;

    const attempts = await db.select({
      id: userHistoryTable.id,
      score: userHistoryTable.score,
      maxScore: userHistoryTable.maxScore,
      accuracy: userHistoryTable.accuracy,
      completedAt: userHistoryTable.completedAt,
    })
      .from(userHistoryTable)
      .where(and(eq(userHistoryTable.userId, userId), eq(userHistoryTable.testId, testId)))
      .orderBy(userHistoryTable.completedAt);

    if (!attempts.length) {
      await ctx.answerCallbackQuery({ text: "No attempts found for this test.", show_alert: true });
      return;
    }

    let msg = `📊 *Attempt History*\n\nYou have attempted this test *${attempts.length}* time\\(s\\)\\.\n\nSelect an attempt to view detailed analysis:\n\n`;
    attempts.forEach((a, i) => {
      const d = new Date(a.completedAt).toLocaleDateString("en-IN");
      msg += `*${i + 1}\\.* Score: ${escMd(String(a.score))}\\/${escMd(String(a.maxScore))} — ${escMd(a.accuracy.toFixed(1))}% — ${escMd(d)}\n`;
    });

    await ctx.editMessageText(msg, {
      parse_mode: "MarkdownV2",
      reply_markup: attemptsKeyboard(testId, attempts.map(a => a.id)),
    });
  });

  bot.callbackQuery(/^view_attempt_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const attemptId = parseInt(ctx.callbackQuery.data.replace("view_attempt_", ""), 10);
    const userId = ctx.from.id;

    const [attempt] = await db.select().from(userHistoryTable)
      .where(and(eq(userHistoryTable.id, attemptId), eq(userHistoryTable.userId, userId)))
      .limit(1);

    if (!attempt) { await ctx.reply("❌ Attempt not found."); return; }

    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, attempt.testId)).limit(1);
    if (!test) { await ctx.reply("❌ Test no longer available."); return; }

    const questions = test.questionsData as QuestionData[];
    const storedAnswers = (attempt.userAnswers as (number | null)[] | null) ?? questions.map(() => null);

    updateSession(userId, {
      solution: {
        testId: attempt.testId,
        testName: test.testName,
        questions,
        userAnswers: storedAnswers,
        currentIndex: 0,
        attemptId: attempt.id,
      },
    });

    const d = new Date(attempt.completedAt).toLocaleDateString("en-IN");
    const header = (
      `📊 *Attempt Analysis*\n\n` +
      `📝 ${escMd(test.testName)}\n` +
      `📅 ${escMd(d)}\n\n` +
      `✅ Correct: *${attempt.correctCount}*   ❌ Wrong: *${attempt.wrongCount}*   ⏭️ Skipped: *${attempt.skippedCount}*\n` +
      `🎯 Accuracy: *${escMd(attempt.accuracy.toFixed(1))}%*   Score: *${escMd(String(attempt.score))}\\/${escMd(String(attempt.maxScore))}*\n\n` +
      `_Use the buttons below to review each question:_`
    );

    const session = getSession(userId);
    await ctx.editMessageText(header, {
      parse_mode: "MarkdownV2",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📖 Review Q1", callback_data: "view_solutions" }],
        ],
      },
    });

    session.solution!.currentIndex = 0;
    await ctx.reply(buildSolutionText(session.solution!), {
      parse_mode: "MarkdownV2",
      reply_markup: solutionNavKeyboard(0, questions.length),
    });
  });

  bot.callbackQuery(/^deeplink_start_/, async (ctx) => {
    const testId = ctx.callbackQuery.data.replace("deeplink_start_", "");
    const userId = ctx.from.id;

    await ctx.answerCallbackQuery({ text: "🚀 Starting..." });

    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
    if (!test) { await ctx.reply("❌ Test not found."); return; }

    try {
      await ctx.editMessageText("3️⃣");
      await new Promise((r) => setTimeout(r, 1000));
      await ctx.editMessageText("2️⃣");
      await new Promise((r) => setTimeout(r, 1000));
      await ctx.editMessageText("1️⃣");
      await new Promise((r) => setTimeout(r, 1000));
      await ctx.deleteMessage().catch(() => {});
    } catch { }

    await startQuizForUser(userId, test);
  });

  bot.callbackQuery(/^start_test_/, async (ctx) => {
    const testId = ctx.callbackQuery.data.replace("start_test_", "");
    const userId = ctx.from.id;
    const chatId = ctx.chat?.id ?? userId;
    const chatType = ctx.chat?.type ?? "private";
    const isGroup = chatType === "group" || chatType === "supergroup";

    if (isGroup) {
      try {
        const member = await ctx.api.getChatMember(chatId, userId);
        if (member.status !== "creator" && member.status !== "administrator") {
          await ctx.answerCallbackQuery({ text: "⚠️ Only group admins can start tests here!", show_alert: true });
          return;
        }
      } catch (_) {}
    }

    await ctx.answerCallbackQuery();

    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
    if (!test) { await ctx.reply("❌ Test not found."); return; }

    const [user] = await db.select({ tier: usersTable.tier }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
    const isPremium = user?.tier === "Premium";

    if (!isPremium) {
      const [ad] = await db.select().from(adsTable).where(eq(adsTable.isActive, true)).limit(1);
      if (ad) {
        await showAdGateway(userId, testId, ad);
        return;
      }
    }

    await startQuizForUser(userId, test);
  });

  bot.callbackQuery(/^ad_skip_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("ad_skip_", "");
    const userId = ctx.from.id;

    const session = getSession(userId);
    if (session.pendingAd?.skipTimer) clearTimeout(session.pendingAd.skipTimer);
    updateSession(userId, { pendingAd: undefined });

    try { await ctx.deleteMessage(); } catch { }

    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
    if (!test) { await ctx.reply("❌ Test not found."); return; }
    await startQuizForUser(userId, test);
  });

  bot.on("poll_answer", async (ctx) => {
    const { poll_id, option_ids, user } = ctx.pollAnswer;
    if (!user) return;
    const userId = user.id;
    const session = getSession(userId);

    if (!session.quiz || session.quiz.currentPollId !== poll_id) return;

    const quiz = session.quiz;
    if (quiz.timer) { clearTimeout(quiz.timer); quiz.timer = undefined; }

    const question = quiz.questions[quiz.currentIndex]!;
    const userAnswerIndex = option_ids[0];

    if (userAnswerIndex === undefined) {
      quiz.userAnswers[quiz.currentIndex] = null;
      quiz.skippedCount++;
    } else {
      quiz.userAnswers[quiz.currentIndex] = userAnswerIndex;
      if (userAnswerIndex === question.correctOptionIndex) {
        quiz.correctCount++;
      } else {
        quiz.wrongCount++;
        quiz.wrongQuestionIds.push({ testId: quiz.testId, questionIndex: quiz.currentIndex });
        const responseTime = Date.now() - (quiz.questionSentAt ?? Date.now());
        if (responseTime < 800) {
          quiz.cheatWarnings++;
          if (quiz.cheatWarnings >= 3) {
            await ctx.api.sendMessage(userId,
              "🚨 *Anti\\-Cheat:* Suspicious activity detected\\. Please answer honestly\\.",
              { parse_mode: "MarkdownV2" }
            );
          }
        }
      }
    }

    quiz.currentIndex++;
    updateSession(userId, { quiz });
    await sendNextQuestion(userId);
  });
}

async function showAdGateway(userId: number, testId: string, ad: { id: number; adText: string | null; buttonText: string | null; buttonUrl: string | null; telegramFileId: string | null; mediaType: string }): Promise<void> {
  const api = getApi();
  const skipKb = new InlineKeyboard().text("⏳ Skip in 15s...", "ad_noop");
  const adCaption = `📢 *Sponsored Message*\n\n${ad.adText ? escMd(ad.adText) : ""}`;

  let sentMsgId: number;
  try {
    if (ad.telegramFileId) {
      const opts: any = { caption: adCaption, parse_mode: "MarkdownV2", reply_markup: skipKb };
      let msg;
      if (ad.mediaType === "video") {
        msg = await api.sendVideo(userId, ad.telegramFileId, opts);
      } else if (ad.mediaType === "gif") {
        msg = await api.sendAnimation(userId, ad.telegramFileId, opts);
      } else {
        msg = await api.sendPhoto(userId, ad.telegramFileId, opts);
      }
      sentMsgId = msg.message_id;
    } else {
      const msg = await api.sendMessage(userId, adCaption, { parse_mode: "MarkdownV2", reply_markup: skipKb });
      sentMsgId = msg.message_id;
    }
  } catch {
    const msg = await api.sendMessage(userId, adCaption, { parse_mode: "MarkdownV2", reply_markup: skipKb });
    sentMsgId = msg.message_id;
  }

  const skipTimer = setTimeout(async () => {
    try {
      const kb = new InlineKeyboard();
      if (ad.buttonText && ad.buttonUrl) {
        kb.url(ad.buttonText, ad.buttonUrl).row();
      }
      kb.text("▶️ Skip Ad & Start Test →", `ad_skip_${testId}`);
      await api.editMessageReplyMarkup(userId, sentMsgId, { reply_markup: kb });
    } catch { }
    updateSession(userId, { pendingAd: { testId, adMessageId: sentMsgId } });
  }, 15000);

  updateSession(userId, { pendingAd: { testId, adMessageId: sentMsgId, skipTimer } });
  emitTelemetry(`Ad shown to user ${userId} before test ${testId}`);
}
