import type { Bot } from "grammy";
import { db } from "@workspace/db";
import {
  testSeriesTable,
  userHistoryTable,
  wrongQuestionsTable,
  purchasedTestsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, count, gt } from "drizzle-orm";
import type { QuestionData } from "@workspace/db";
import {
  getSession,
  updateSession,
  clearQuiz,
  type QuizSession,
  type SolutionSession,
} from "../session.js";
import { getApi } from "../api-instance.js";
import { scorecardKeyboard, solutionNavKeyboard } from "../keyboards.js";
import { logger } from "../../lib/logger.js";
import { getConfig } from "./helpers.js";
import { postChallengeResult } from "./challenge.js";

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

function progressBar(value: number, max: number, length = 12): string {
  if (max === 0) return "░".repeat(length);
  const filled = Math.min(Math.round((value / max) * length), length);
  return "█".repeat(filled) + "░".repeat(length - filled);
}

function buildScorecardCard(
  testName: string, score: number, maxScore: number,
  correct: number, wrong: number, skipped: number,
  accuracy: number, rank: number, total: number
): string {
  const accBar = progressBar(accuracy, 100);
  const scoreBar = progressBar(score, maxScore);
  const totalQ = correct + wrong + skipped;
  const grade = accuracy >= 85 ? "A+ 🏆" : accuracy >= 70 ? "A 🌟" : accuracy >= 55 ? "B+ 👍" : accuracy >= 40 ? "B 📚" : "C 💪";

  return "```\n" +
    "╔══════════════════════════════╗\n" +
    "║     📊 TEST RESULT CARD      ║\n" +
    "╠══════════════════════════════╣\n" +
    `║ ${testName.slice(0, 28).padEnd(28)}  ║\n` +
    "╠══════════════════════════════╣\n" +
    `║ Score:  ${String(score).padEnd(6)} / ${String(maxScore).padEnd(6)}              ║\n` +
    `║         [${scoreBar}]    ║\n` +
    "╠══════════════════════════════╣\n" +
    `║ ✅ Correct:  ${String(correct).padEnd(16)}║\n` +
    `║ ❌ Wrong:    ${String(wrong).padEnd(16)}║\n` +
    `║ ⏭️ Skipped:  ${String(skipped).padEnd(16)}║\n` +
    "╠══════════════════════════════╣\n" +
    `║ 🎯 Accuracy: ${(accuracy.toFixed(1) + "%").padEnd(16)}║\n` +
    `║    [${accBar}]     ║\n` +
    `║ 📊 Grade: ${grade.padEnd(19)}║\n` +
    "╠══════════════════════════════╣\n" +
    `║ 🏆 Rank: #${String(rank).padEnd(5)} of ${String(total).padEnd(14)}║\n` +
    "╚══════════════════════════════╝\n" +
    "```";
}

export async function sendNextQuestion(userId: number): Promise<void> {
  const api = getApi();
  const session = getSession(userId);
  const quiz = session.quiz;
  if (!quiz) return;

  const forceSub = await getConfig("force_sub_enabled");
  const channel = await getConfig("force_sub_channel");
  if (forceSub === "true" && channel) {
    try {
      const member = await api.getChatMember(channel, userId);
      if (member.status === "left" || member.status === "kicked") {
        await api.sendMessage(userId,
          `🔒 Please join our channel to continue the test:\n${channel}\n\nJoin and then send /start to resume.`
        );
        clearQuiz(userId);
        return;
      }
    } catch (_) {}
  }

  if (quiz.currentIndex >= quiz.questions.length) {
    await generateScorecard(userId);
    return;
  }

  const question = quiz.questions[quiz.currentIndex]!;
  quiz.questionSentAt = Date.now();

  try {
    const msg = await api.sendPoll(userId, question.question, question.options, {
      type: "quiz",
      correct_option_ids: [question.correctOptionIndex],
      explanation: question.explanation || undefined,
      is_anonymous: false,
    });

    quiz.currentPollMessageId = msg.message_id;
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
      await api.sendMessage(userId, "⏳ *Time's up!* You didn't answer this question in time.", { parse_mode: "Markdown" });
      await sendNextQuestion(userId);
    }, 30000);

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

  const isChallenge = quiz.testId.startsWith("challenge_") || quiz.testName.startsWith("⚔️");

  let pos = 1, neg = 0.25;
  if (quiz.testId !== "notebook") {
    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, quiz.testId)).limit(1);
    if (test) { pos = test.positiveMarking; neg = test.negativeMarking; }
  }

  const score = parseFloat((quiz.correctCount * pos - quiz.wrongCount * neg).toFixed(2));
  const maxScore = parseFloat((quiz.questions.length * pos).toFixed(2));
  const totalAnswered = quiz.correctCount + quiz.wrongCount;
  const accuracy = totalAnswered > 0 ? parseFloat(((quiz.correctCount / totalAnswered) * 100).toFixed(1)) : 0;

  if (quiz.testId !== "notebook") {
    await db.insert(userHistoryTable).values({
      userId, testId: quiz.testId, score, maxScore,
      correctCount: quiz.correctCount, wrongCount: quiz.wrongCount,
      skippedCount: quiz.skippedCount, accuracy,
    });
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

  const userAnswers: (number | null)[] = quiz.questions.map(() => null);
  updateSession(userId, {
    quiz: undefined,
    solution: {
      testId: quiz.testId,
      testName: quiz.testName,
      questions: quiz.questions,
      userAnswers,
      currentIndex: 0,
    },
  });

  const challengeId = quiz.testId.startsWith("challenge_") ? quiz.testId.replace("challenge_", "") : null;
  if (challengeId) {
    await postChallengeResult(challengeId, userId, score, quiz.correctCount, quiz.questions.length).catch(() => {});
  }

  await api.sendMessage(userId, `*Test Completed\\!*\n\n${escMd(card).replace(/```/g, "```")}`.replace(/\\```/g, "```"), {
    parse_mode: "MarkdownV2",
    reply_markup: scorecardKeyboard(quiz.testId),
  });
}

function buildSolutionText(session: SolutionSession): string {
  const { questions, currentIndex, userAnswers } = session;
  const q = questions[currentIndex]!;
  const userAns = userAnswers[currentIndex];
  const correct = q.correctOptionIndex;

  const optionLines = q.options.map((opt, i) => {
    let prefix = "⚪";
    if (i === correct && i === userAns) prefix = "🟢";
    else if (i === correct) prefix = "🟢";
    else if (i === userAns) prefix = "🔴";
    return `${prefix} ${escMd(opt)}`;
  });

  return `📖 *SOLUTION BOOK — Question ${currentIndex + 1}/${questions.length}*\n\n*${escMd(q.question)}*\n\n${optionLines.join("\n")}\n\n📝 *Detailed Explanation:*\n${escMd(q.explanation || "No explanation available.")}`;
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

  bot.callbackQuery("sol_noop", async (ctx) => { await ctx.answerCallbackQuery(); });

  bot.callbackQuery("doubt_ai", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "🤖 *AI Doubt Solver*\n\nComing soon\\! OpenRouter integration is being configured\\.\n\nFor now, the detailed explanation above covers the solution step by step\\.",
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.callbackQuery(/^reattempt_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("reattempt_", "");
    const userId = ctx.from.id;
    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);

    if (!test) { await ctx.reply("❌ Test not found."); return; }
    const questions = test.questionsData as QuestionData[];
    if (!questions.length) { await ctx.reply("❌ No questions in this test yet."); return; }

    updateSession(userId, {
      solution: undefined,
      quiz: { testId: test.testId, testName: test.testName, questions, currentIndex: 0, correctCount: 0, wrongCount: 0, skippedCount: 0, wrongQuestionIds: [], cheatWarnings: 0 },
    });

    await ctx.reply(`🔄 *Re-attempting: ${escMd(test.testName)}*\n\n⏱️ 30 seconds per question\n\nGood luck! 💪`, { parse_mode: "MarkdownV2" });
    await sendNextQuestion(userId);
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
      quiz.skippedCount++;
    } else if (userAnswerIndex === question.correctOptionIndex) {
      quiz.correctCount++;
    } else {
      quiz.wrongCount++;
      quiz.wrongQuestionIds.push({ testId: quiz.testId, questionIndex: quiz.currentIndex });
      const responseTime = Date.now() - (quiz.questionSentAt ?? Date.now());
      if (responseTime < 800) {
        quiz.cheatWarnings++;
        if (quiz.cheatWarnings >= 3) {
          await ctx.api.sendMessage(userId,
            "🚨 *Anti-Cheat Warning:* Suspicious activity detected \\(extremely fast answers\\)\\. Please answer honestly — the system will auto\\-submit if this continues\\.",
            { parse_mode: "MarkdownV2" }
          );
        }
      }
    }

    quiz.currentIndex++;
    updateSession(userId, { quiz });
    await sendNextQuestion(userId);
  });

  bot.callbackQuery(/^start_test_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("start_test_", "");
    const userId = ctx.from.id;
    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);

    if (!test) { await ctx.reply("❌ Test not found."); return; }
    const questions = test.questionsData as QuestionData[];
    if (!questions.length) {
      await ctx.reply("❌ This test has no questions yet. Admin will add them soon.");
      return;
    }

    updateSession(userId, {
      solution: undefined,
      quiz: { testId: test.testId, testName: test.testName, questions, currentIndex: 0, correctCount: 0, wrongCount: 0, skippedCount: 0, wrongQuestionIds: [], cheatWarnings: 0 },
    });

    await ctx.reply(
      `🚀 *${escMd(test.testName)}* starting\\!\n\n📝 Total Questions: *${questions.length}*\n⏱️ Time per question: *30 seconds*\n➕ Correct: *\\+${test.positiveMarking}*  ➖ Wrong: *\\-${test.negativeMarking}*\n\nAll the best\\! 💪`,
      { parse_mode: "MarkdownV2" }
    );
    await sendNextQuestion(userId);
  });
}
