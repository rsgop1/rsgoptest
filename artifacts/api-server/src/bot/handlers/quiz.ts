import type { Bot } from "grammy";
import { db } from "@workspace/db";
import {
  testSeriesTable,
  userHistoryTable,
  wrongQuestionsTable,
  purchasedTestsTable,
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

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
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
        await api.sendMessage(
          userId,
          `🔒 Test continue karne ke liye pehle humara channel join karein:\n${channel}\n\nJoin karne ke baad dobara test start karein.`
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
      correct_option_id: question.correctOptionIndex,
      explanation: question.explanation || undefined,
      is_anonymous: false,
    });

    quiz.currentPollMessageId = msg.message_id;
    const pollData = (msg as any).poll;
    quiz.currentPollId = pollData?.id as string | undefined;

    const pollIdSnapshot = quiz.currentPollId;
    quiz.timer = setTimeout(async () => {
      const currentSession = getSession(userId);
      if (!currentSession.quiz || currentSession.quiz.currentPollId !== pollIdSnapshot) return;
      const q = currentSession.quiz;
      try {
        await api.stopPoll(userId, q.currentPollMessageId!);
      } catch (_) {}
      q.skippedCount++;
      q.currentIndex++;
      q.timer = undefined;
      updateSession(userId, { quiz: q });
      await api.sendMessage(userId, "⏳ Time out\\! Aapne is question ka jawab samay par nahi diya\\.", {
        parse_mode: "MarkdownV2",
      });
      await sendNextQuestion(userId);
    }, 30000);

    updateSession(userId, { quiz });
  } catch (err) {
    logger.error({ err, userId }, "Error sending poll");
  }
}

async function generateScorecard(userId: number): Promise<void> {
  const api = getApi();
  const session = getSession(userId);
  const quiz = session.quiz;
  if (!quiz) return;

  const [test] = await db
    .select()
    .from(testSeriesTable)
    .where(eq(testSeriesTable.testId, quiz.testId))
    .limit(1);

  if (!test) { clearQuiz(userId); return; }

  const pos = test.positiveMarking;
  const neg = test.negativeMarking;
  const score = parseFloat((quiz.correctCount * pos - quiz.wrongCount * neg).toFixed(2));
  const maxScore = parseFloat((quiz.questions.length * pos).toFixed(2));
  const totalAnswered = quiz.correctCount + quiz.wrongCount;
  const accuracy = totalAnswered > 0
    ? parseFloat(((quiz.correctCount / totalAnswered) * 100).toFixed(1))
    : 0;

  await db.insert(userHistoryTable).values({
    userId,
    testId: quiz.testId,
    score,
    maxScore,
    correctCount: quiz.correctCount,
    wrongCount: quiz.wrongCount,
    skippedCount: quiz.skippedCount,
    accuracy,
  });

  if (quiz.wrongQuestionIds.length > 0) {
    await db.insert(wrongQuestionsTable).values(
      quiz.wrongQuestionIds.map((wq) => ({
        userId,
        testId: wq.testId,
        questionIndex: wq.questionIndex,
      }))
    );
  }

  const [rankRow] = await db
    .select({ cnt: count() })
    .from(userHistoryTable)
    .where(and(eq(userHistoryTable.testId, quiz.testId), gt(userHistoryTable.score, score)));
  const rank = (rankRow?.cnt ?? 0) + 1;
  const [totalRow] = await db
    .select({ cnt: count() })
    .from(userHistoryTable)
    .where(eq(userHistoryTable.testId, quiz.testId));
  const totalParticipants = totalRow?.cnt ?? 1;

  const scorecard = `📊 *TEST ANALYSIS REPORT: ${escMd(quiz.testName)}*

✅ Correct Answers: *${quiz.correctCount}*
❌ Wrong Answers: *${quiz.wrongCount}*
⏳ Skipped: *${quiz.skippedCount}*

📈 Your Score: *${score} / ${maxScore}*
🎯 Accuracy: *${accuracy}%*

🏆 Global Rank: *\\#${rank}* out of *${totalParticipants}*`;

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

  await api.sendMessage(userId, scorecard, {
    parse_mode: "MarkdownV2",
    reply_markup: scorecardKeyboard(quiz.testId),
  });
}

function buildSolutionText(session: SolutionSession): string {
  const { questions, currentIndex, userAnswers } = session;
  const q = questions[currentIndex]!;
  const userAns = userAnswers[currentIndex];
  const correct = q.correctOptionIndex;

  let optionLines = q.options.map((opt, i) => {
    let prefix = "⚪";
    if (i === correct && i === userAns) prefix = "🟢";
    else if (i === correct) prefix = "🟢";
    else if (i === userAns) prefix = "🔴";
    return `${prefix} ${escMd(opt)}`;
  });

  return `📖 *SOLUTION BOOK: \\[Question ${currentIndex + 1}/${questions.length}\\]*\n\n*${escMd(q.question)}*\n\n${optionLines.join("\n")}\n\n📝 *Detailed Solution:*\n${escMd(q.explanation || "No explanation available.")}`;
}

export function registerQuizHandlers(bot: Bot): void {
  bot.callbackQuery("view_solutions", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (!session.solution) {
      await ctx.reply("❌ Koi solution available nahi hai. Pehle test complete karein.");
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
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (!session.solution) return;
    const idx = parseInt(ctx.callbackQuery.data.split("_")[2] ?? "0", 10);
    session.solution.currentIndex = Math.max(0, idx - 1);
    updateSession(userId, { solution: session.solution });
    await ctx.editMessageText(buildSolutionText(session.solution), {
      parse_mode: "MarkdownV2",
      reply_markup: solutionNavKeyboard(session.solution.currentIndex, session.solution.questions.length),
    });
  });

  bot.callbackQuery(/^sol_next_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (!session.solution) return;
    const idx = parseInt(ctx.callbackQuery.data.split("_")[2] ?? "0", 10);
    session.solution.currentIndex = Math.min(session.solution.questions.length - 1, idx + 1);
    updateSession(userId, { solution: session.solution });
    await ctx.editMessageText(buildSolutionText(session.solution), {
      parse_mode: "MarkdownV2",
      reply_markup: solutionNavKeyboard(session.solution.currentIndex, session.solution.questions.length),
    });
  });

  bot.callbackQuery("sol_noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("doubt_ai", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "🤖 *AI Doubt Solver*\n\nYeh feature jaldi available hoga\\! Admin OpenRouter integration setup kar raha hai\\.\n\nTab tak detailed solution section mein explanation padh sakte hain\\.",
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.callbackQuery(/^reattempt_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("reattempt_", "");
    const userId = ctx.from.id;
    const [test] = await db
      .select()
      .from(testSeriesTable)
      .where(eq(testSeriesTable.testId, testId))
      .limit(1);

    if (!test) {
      await ctx.reply("❌ Test nahi mila.");
      return;
    }

    const questions = test.questionsData as QuestionData[];
    if (!questions.length) {
      await ctx.reply("❌ Is test mein abhi koi question nahi hai.");
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
        wrongQuestionIds: [],
        cheatWarnings: 0,
      },
    });

    await ctx.reply(`🚀 *${escMd(test.testName)}* shuru ho raha hai\\!\n\n⏱️ Har question ke liye 30 seconds\\.`, {
      parse_mode: "MarkdownV2",
    });
    await sendNextQuestion(userId);
  });

  bot.on("poll_answer", async (ctx) => {
    const pollAnswer = ctx.pollAnswer;
    const userId = pollAnswer.user.id;
    const session = getSession(userId);

    if (!session.quiz || session.quiz.currentPollId !== pollAnswer.poll_id) return;

    const quiz = session.quiz;

    if (quiz.timer) {
      clearTimeout(quiz.timer);
      quiz.timer = undefined;
    }

    const question = quiz.questions[quiz.currentIndex]!;
    const userAnswerIndex = pollAnswer.option_ids[0];

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
          await ctx.api.sendMessage(
            userId,
            "🚨 *Anti\\-Cheat Warning:* Web browser/chat switching activity ya excessive delays detect hui hain\\. Please test par focus karein warna system auto\\-submit kar dega\\!",
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

    const [test] = await db
      .select()
      .from(testSeriesTable)
      .where(eq(testSeriesTable.testId, testId))
      .limit(1);

    if (!test) {
      await ctx.reply("❌ Test nahi mila.");
      return;
    }

    const questions = test.questionsData as QuestionData[];
    if (!questions.length) {
      await ctx.reply("❌ Is test mein abhi koi question nahi hai. Admin jald hi questions add karega.");
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
        wrongQuestionIds: [],
        cheatWarnings: 0,
      },
    });

    await ctx.reply(
      `🚀 *${escMd(test.testName)}* shuru ho raha hai\\!\n\nTotal Questions: *${questions.length}*\n⏱️ Har question ke liye *30 seconds*\n\nAll the best\\! 💪`,
      { parse_mode: "MarkdownV2" }
    );
    await sendNextQuestion(userId);
  });
}
