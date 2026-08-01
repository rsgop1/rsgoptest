import type { Bot } from "grammy";
import { db } from "@workspace/db";
import {
  testSeriesTable,
  userHistoryTable,
  wrongQuestionsTable,
  usersTable,
  adsTable,
  reportsTable,
  purchasedTestsTable,
} from "@workspace/db";
import { eq, and, count, gt, desc, sql } from "drizzle-orm";
import type { QuestionData } from "@workspace/db";
import {
  getSession,
  updateSession,
  clearQuiz,
  type SolutionSession,
} from "../session.js";
import { getApi } from "../api-instance.js";
import { scorecardKeyboard, solutionNavKeyboard, attemptsKeyboard, reattemptChoiceKeyboard, skipQuestionKeyboard, practiceCountKeyboard } from "../keyboards.js";
import { logger } from "../../lib/logger.js";
import { getConfig } from "./helpers.js";
import { postChallengeResult } from "./challenge.js";
import { emitTelemetry } from "../../lib/telemetry.js";
import { checkAndAwardAchievements } from "./achievements.js";
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

function buildFullRecap(questions: QuestionData[], userAnswers: (number | null)[]): string[] {
  const lines: string[] = [];
  lines.push("📋 *Full Test Recap*\n");

  const grid: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const ans = userAnswers[i];
    const correct = questions[i]!.correctOptionIndex;
    if (ans === null || ans === undefined) grid.push("⏭️");
    else if (ans === correct) grid.push("✅");
    else grid.push("❌");
  }

  const gridRows: string[] = [];
  for (let i = 0; i < grid.length; i += 10) {
    const chunk = grid.slice(i, i + 10);
    gridRows.push(`Q${i + 1}–${i + chunk.length}: ${chunk.join(" ")}`);
  }
  lines.push(gridRows.join("\n"));

  const wrongLines: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const ans = userAnswers[i];
    const q = questions[i]!;
    const correct = q.correctOptionIndex;
    if (ans !== null && ans !== undefined && ans !== correct) {
      const userOptText = q.options[ans] ?? "?";
      const correctOptText = q.options[correct] ?? "?";
      wrongLines.push(`❌ *Q${i + 1}:* ${escMd(q.question.slice(0, 60))}…\n   Your: _${escMd(userOptText.slice(0, 40))}_\n   Correct: _${escMd(correctOptText.slice(0, 40))}_`);
    }
  }

  const skippedLines: string[] = [];
  for (let i = 0; i < questions.length; i++) {
    const ans = userAnswers[i];
    if (ans === null || ans === undefined) {
      skippedLines.push(`⏭️ Q${i + 1}: ${escMd(questions[i]!.question.slice(0, 60))}…`);
    }
  }

  const messages: string[] = [];
  const header = lines.join("\n");

  let wrongSection = "";
  if (wrongLines.length > 0) {
    wrongSection = `\n\n❌ *Wrong Answers \\(${wrongLines.length}\\):*\n\n` + wrongLines.slice(0, 15).join("\n\n");
  }
  if (wrongLines.length > 15) {
    wrongSection += `\n\n_\\.\\.\\. and ${wrongLines.length - 15} more — use Solution Book to review all_`;
  }

  let skippedSection = "";
  if (skippedLines.length > 0) {
    skippedSection = `\n\n⏭️ *Skipped \\(${skippedLines.length}\\):*\n` + skippedLines.slice(0, 10).join("\n");
  }

  const full = header + wrongSection + skippedSection;
  if (full.length < 3800) {
    messages.push(full);
  } else {
    messages.push(header + (wrongLines.length > 0 ? `\n\n❌ Wrong: *${wrongLines.length}*` : "") + (skippedLines.length > 0 ? `\n⏭️ Skipped: *${skippedLines.length}*` : ""));
    if (wrongSection.length > 0) {
      messages.push(`❌ *Wrong Answers:*\n\n` + wrongLines.slice(0, 15).join("\n\n"));
    }
  }

  return messages;
}

async function checkForceSub(userId: number): Promise<boolean> {
  try {
    const forceSub = await getConfig("force_sub_enabled");
    if (forceSub !== "true") return true;
    const channel = await getConfig("force_sub_channel");
    if (!channel) return true;
    const api = getApi();
    let channelId: string | number = channel.trim();
    if (!channelId.startsWith("@")) {
      const num = Number(channelId);
      channelId = isNaN(num) ? channelId : num;
    }
    const member = await api.getChatMember(channelId as string, userId);
    const allowed = member.status === "member" || member.status === "creator" || member.status === "administrator";
    return allowed;
  } catch (err) {
    logger.warn({ err }, "checkForceSub error — defaulting to block");
    return false;
  }
}

async function deletePollMessages(userId: number, messageIds: number[]): Promise<void> {
  const api = getApi();
  const toDelete = messageIds.slice(-50);
  for (const msgId of toDelete) {
    try {
      await api.deleteMessage(userId, msgId);
      await new Promise((r) => setTimeout(r, 100));
    } catch { }
  }
}

export async function startQuizForUser(
  userId: number,
  test: { testId: string; testName: string; questionsData: unknown; timerSeconds: number | null; positiveMarking: number; negativeMarking: number },
  sendStartMsg = true,
  customTimer?: number,
  startQuestion = 1,
  questionCount?: number
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
    const channelDisplay = channel ?? "";
    const joinUrl = channelDisplay.startsWith("@")
      ? `https://t.me/${channelDisplay.replace("@", "")}`
      : `https://t.me/c/${channelDisplay.replace("-100", "")}`;
    const joinKb = new InlineKeyboard().url("👉 Join Channel", joinUrl);
    await api.sendMessage(userId,
      `🔒 *Channel Membership Required*\n\nYou must join our official channel to access tests:\n${escMd(channelDisplay)}\n\nAfter joining, send /start to continue\\.`,
      { parse_mode: "MarkdownV2", reply_markup: joinKb }
    );
    return;
  }

  const safeStart = Math.max(1, Math.min(startQuestion, questions.length));
  const availableQuestions = questions.slice(safeStart - 1);
  const selectedQuestions = questionCount ? availableQuestions.slice(0, questionCount) : availableQuestions;
  const timerSeconds = customTimer ?? test.timerSeconds ?? 30;
  const noTimer = timerSeconds === 0;

  updateSession(userId, {
    solution: undefined,
    quiz: {
      testId: test.testId,
      testName: test.testName,
      questions: selectedQuestions,
      currentIndex: 0,
      correctCount: 0,
      wrongCount: 0,
      skippedCount: 0,
      userAnswers: selectedQuestions.map(() => null),
      pollMessageIds: [],
      wrongQuestionIds: [],
      cheatWarnings: 0,
      timerSeconds,
      consecutiveCorrect: 0,
    },
  });

  if (sendStartMsg) {
    const timerDisplay = noTimer ? "♾️ No Limit \\(Premium\\)" : `*${timerSeconds}s* per question`;
    await api.sendMessage(userId,
      `🚀 *${escMd(test.testName.trim())}* starting\\!\n\n📝 Questions: *${selectedQuestions.length}*\n⏱️ Timer: ${timerDisplay}\n➕ Correct: *\\+${escMd(String(test.positiveMarking))}*  ➖ Wrong: *\\-${escMd(String(test.negativeMarking))}*\n\nAll the best\\! 💪\n\n_Type /stop anytime to end the test_`,
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
  const noTimer = timerSec === 0;

  try {
    const pollOpts: any = {
      type: "quiz",
      correct_option_ids: [question.correctOptionIndex],
      explanation: question.explanation ? question.explanation.slice(0, 200) : undefined,
      is_anonymous: false,
    };
    if (!noTimer) {
      pollOpts.open_period = timerSec;
    }

    const msg = await api.sendPoll(
      userId,
      question.question.slice(0, 300),
      question.options.map(o => ({ text: o.slice(0, 100) })),
      pollOpts
    );

    quiz.currentPollMessageId = msg.message_id;
    quiz.pollMessageIds.push(msg.message_id);
    const pollData = (msg as any).poll;
    quiz.currentPollId = pollData?.id as string | undefined;

    if (noTimer) {
      const skipMsg = await api.sendMessage(userId,
        `⏭️ Q${quiz.currentIndex + 1}/${quiz.questions.length} — _No time limit mode_`,
        { parse_mode: "MarkdownV2", reply_markup: skipQuestionKeyboard(msg.message_id) }
      );
      quiz.pollMessageIds.push(skipMsg.message_id);
    } else {
      const pollIdSnapshot = quiz.currentPollId;
      quiz.timer = setTimeout(async () => {
        const s = getSession(userId);
        if (!s.quiz || s.quiz.currentPollId !== pollIdSnapshot) return;
        const q = s.quiz;
        try { await api.stopPoll(userId, q.currentPollMessageId!); } catch (_) {}
        q.skippedCount++;
        q.consecutiveCorrect = 0;
        q.currentIndex++;
        q.timer = undefined;
        updateSession(userId, { quiz: q });
        await api.sendMessage(userId, "⏳ *Time's up\\!* Moving to next question\\.", { parse_mode: "MarkdownV2" });
        await sendNextQuestion(userId);
      }, timerSec * 1000);
    }

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
  const savedAnswers = [...quiz.userAnswers];
  const savedQuestions = [...quiz.questions];

  let attemptId: number | undefined;
  let prevScore: number | undefined;

  if (quiz.testId !== "notebook") {
    const prevAttempts = await db.select({ score: userHistoryTable.score })
      .from(userHistoryTable)
      .where(and(eq(userHistoryTable.userId, userId), eq(userHistoryTable.testId, quiz.testId)))
      .orderBy(desc(userHistoryTable.completedAt))
      .limit(1);
    prevScore = prevAttempts[0]?.score;

    const [inserted] = await db.insert(userHistoryTable).values({
      userId, testId: quiz.testId, score, maxScore,
      correctCount: quiz.correctCount, wrongCount: quiz.wrongCount,
      skippedCount: quiz.skippedCount, accuracy,
      userAnswers: quiz.userAnswers,
    }).returning({ id: userHistoryTable.id });
    attemptId = inserted?.id;

    await db.update(usersTable).set({
      totalTestsTaken: sql`${usersTable.totalTestsTaken} + 1`,
      accuracyRate: accuracy,
    }).where(eq(usersTable.userId, userId)).catch(() => {});
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
      questions: savedQuestions,
      userAnswers: savedAnswers,
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

  const recapMessages = buildFullRecap(savedQuestions, savedAnswers);
  for (const msg of recapMessages) {
    try {
      await api.sendMessage(userId, msg, { parse_mode: "MarkdownV2" });
    } catch { }
  }

  if (quiz.testId !== "notebook") {
    const [userRow] = await db.select({ totalTestsTaken: usersTable.totalTestsTaken })
      .from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
    await checkAndAwardAchievements(userId, {
      testId: quiz.testId,
      correctCount: quiz.correctCount,
      wrongCount: quiz.wrongCount,
      skippedCount: quiz.skippedCount,
      score,
      prevScore,
      consecutiveCorrect: quiz.consecutiveCorrect,
      totalTestsTaken: userRow?.totalTestsTaken ?? 0,
    }).catch(() => {});
  }

  setTimeout(async () => {
    emitTelemetry(`Auto-cleanup: deleting ${Math.min(pollMsgIds.length, 50)} poll messages for user ${userId}`);
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
      reply_markup: solutionNavKeyboard(0, session.solution.questions.length, session.solution.testId),
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
      reply_markup: solutionNavKeyboard(session.solution.currentIndex, session.solution.questions.length, session.solution.testId),
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
      reply_markup: solutionNavKeyboard(session.solution.currentIndex, session.solution.questions.length, session.solution.testId),
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
  bot.callbackQuery("ad_noop", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "⏳ Please wait 15 seconds before skipping...", show_alert: false });
  });

  bot.callbackQuery(/^skip_q_/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: "⏭️ Question skipped" });
    const userId = ctx.from.id;
    const session = getSession(userId);
    const quiz = session.quiz;
    if (!quiz || quiz.timerSeconds !== 0) return;
    const pollMsgId = quiz.currentPollMessageId;
    if (pollMsgId) {
      try { await ctx.api.stopPoll(userId, pollMsgId); } catch (_) {}
    }
    try { await ctx.deleteMessage(); } catch (_) {}
    quiz.skippedCount++;
    quiz.consecutiveCorrect = 0;
    quiz.userAnswers[quiz.currentIndex] = null;
    quiz.currentIndex++;
    updateSession(userId, { quiz });
    await sendNextQuestion(userId);
  });

  bot.callbackQuery(/^ai_info_/, async (ctx) => {
    const userId = ctx.from.id;

    const [userRow] = await db.select({ tier: usersTable.tier }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
    if (userRow?.tier !== "Premium") {
      await ctx.answerCallbackQuery({ text: "❌ Premium feature! Use /premium to upgrade.", show_alert: true });
      await ctx.reply(
        `❌ *AI Info is a Premium Feature\\!*\n\nFree users cannot access AI analysis\\.\n\n💎 *Upgrade to Premium to unlock:*\n✅ AI Info for every question\n✅ All mock tests unlocked\n✅ No ads before tests\n✅ Custom timer \\(30s–120s\\)\n\n👉 Use /premium to upgrade\\!`,
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    await ctx.answerCallbackQuery({ text: "🤖 Getting AI analysis…" });
    const session = getSession(userId);
    if (!session.solution) {
      await ctx.reply("❌ No solution session active.");
      return;
    }

    const qIdx = parseInt(ctx.callbackQuery.data.replace("ai_info_", ""), 10);
    const q = session.solution.questions[qIdx];
    if (!q) { await ctx.reply("❌ Question not found."); return; }

    const userAns = session.solution.userAnswers[qIdx];
    const correctOpt = q.options[q.correctOptionIndex] ?? "?";
    const userOptText = userAns !== null && userAns !== undefined ? (q.options[userAns] ?? "?") : "Skipped";
    const wrongOpts = q.options.filter((_, i) => i !== q.correctOptionIndex);

    const apiKey = process.env["OPENROUTER_API_KEY"] ?? process.env["AI_INTEGRATIONS_OPENROUTER_API_KEY"];
    const baseUrl = process.env["AI_INTEGRATIONS_OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1";

    if (!apiKey) {
      await ctx.reply("❌ AI service not configured. Ask admin to add OpenRouter API key.");
      return;
    }

    const thinkMsg = await ctx.reply("🤖 *AI analyzing…*", { parse_mode: "MarkdownV2" });

    try {
      const difficulty = (q as any).difficulty ?? "medium";
      const wrongOptsText = q.options
        .map((o, i) => i !== q.correctOptionIndex ? `• ${o}` : null)
        .filter(Boolean)
        .join("\n");

      const prompt = `You are an expert AI tutor for Indian competitive exams (SSC, Railway, Banking, Bihar Govt).

Question from: ${session.solution.testName}
Difficulty: ${difficulty}
Question: ${q.question}
Options: ${q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join(" | ")}
Correct Answer: ${correctOpt}
Explanation: ${q.explanation || "None provided"}

Write a structured response in EXACTLY this format (no markdown symbols like *, _, etc.):

✅ Correct Answer: ${correctOpt}

📝 Why Correct:
[2-3 clear sentences. Explain why this is right. Include 1 exam-relevant fact tied to the category.]

📌 Exam Point:
[One sharp exam tip or fact related to this topic that students must know for ${session.solution.testName}.]

❌ Why Wrong Options Fail:
${wrongOptsText}
[For each wrong option above, write exactly ONE line: "Option text — reason it's wrong or a quick one-liner exam fact"]

Keep total response under 180 words. Plain English only. No bullet symbols except the ones shown.`;

      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b:free",
          messages: [
            { role: "system", content: "You are a concise educational AI for Indian competitive exam students. Always respond in plain English with no markdown formatting symbols." },
            { role: "user", content: prompt }
          ],
          max_tokens: 600,
        }),
      });

      const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message: string } };
      if (data.error) throw new Error(data.error.message);

      const rawAnswer = data.choices?.[0]?.message?.content ?? "Could not get analysis.";
      const cleanAnswer = rawAnswer.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);

      const statusIcon = userAns === null || userAns === undefined ? "⏭️" : userAns === q.correctOptionIndex ? "✅" : "❌";
      const userAnswerLine = userAns === null || userAns === undefined
        ? "You skipped this question"
        : `You answered: ${userOptText}`;

      const chatId = ctx.chat?.id ?? ctx.from.id;
      await ctx.api.editMessageText(chatId, thinkMsg.message_id,
        `🤖 *AI Info — Q${qIdx + 1}*\n${statusIcon} _${escMd(userAnswerLine)}_\n\n${cleanAnswer}`,
        { parse_mode: "MarkdownV2" }
      );
    } catch (err) {
      logger.error({ err }, "AI info error");
      const chatId = ctx.chat?.id ?? ctx.from.id;
      await ctx.api.editMessageText(chatId, thinkMsg.message_id,
        "❌ AI service unavailable. Please try again later."
      );
    }
  });

  bot.callbackQuery(/^report_q_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const session = getSession(userId);
    if (!session.solution) {
      await ctx.reply("❌ No solution session active.");
      return;
    }

    const qIdx = parseInt(ctx.callbackQuery.data.replace("report_q_", ""), 10);
    const q = session.solution.questions[qIdx];
    if (!q) { await ctx.reply("❌ Question not found."); return; }

    const userAns = session.solution.userAnswers[qIdx];

    updateSession(userId, {
      pendingReport: {
        testId: session.solution.testId,
        questionIndex: qIdx,
        questionText: q.question,
        userAnswer: userAns ?? null,
        correctAnswer: q.correctOptionIndex,
        step: "awaiting_text",
      }
    });

    await ctx.reply(
      `🚩 *Report Question Q${qIdx + 1}*\n\n_"${escMd(q.question.slice(0, 100))}"_\n\nPlease type your issue/concern about this question:\n\\(e\\.g\\. "Incorrect answer", "Wrong explanation", "Question is unclear"\\)`,
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

    const sol = getSession(userId).solution!;
    await ctx.editMessageText(header, {
      parse_mode: "MarkdownV2",
      reply_markup: { inline_keyboard: [[{ text: "📖 Review Q1", callback_data: "view_solutions" }]] },
    });

    await ctx.reply(buildSolutionText(sol), {
      parse_mode: "MarkdownV2",
      reply_markup: solutionNavKeyboard(0, questions.length, attempt.testId),
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

  bot.callbackQuery(/^begin_test_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("begin_test_", "");
    const userId = ctx.from.id;

    const inSub = await checkForceSub(userId);
    if (!inSub) {
      const channel = await getConfig("force_sub_channel") ?? "";
      const joinUrl = channel.startsWith("@") ? `https://t.me/${channel.replace("@", "")}` : `https://t.me/${channel}`;
      const joinKb = new InlineKeyboard().url("👉 Join Channel", joinUrl);
      await ctx.reply(
        `🔒 *Channel Membership Required*\n\nJoin our channel first:\n${escMd(channel)}\n\nThen come back and try again\\.`,
        { parse_mode: "MarkdownV2", reply_markup: joinKb }
      );
      return;
    }

    const [user] = await db.select({ tier: usersTable.tier }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
    const isPremium = user?.tier === "Premium";
    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
    if (!test) { await ctx.reply("❌ Test not found."); return; }
    const qCount = Array.isArray(test.questionsData) ? (test.questionsData as unknown[]).length : 0;

    if (isPremium) {
      updateSession(userId, { pendingPractice: {
        testId,
        totalQuestions: qCount,
        awaiting: "start",
      }});
      await ctx.reply(
        `▶️ *Where do you want to start?*\n\nType the question serial number from which you want to continue\\.\n\nExample: type *21* to start from question 21\\.`,
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    const [ad] = await db.select().from(adsTable).where(eq(adsTable.isActive, true)).limit(1);
    if (ad) {
      await showAdGateway(userId, testId, ad);
      return;
    }

    await startQuizForUser(userId, test);
  });

  bot.callbackQuery(/^timer_sel_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const parts = ctx.callbackQuery.data.replace("timer_sel_", "").split("_");
    const timerSec = parseInt(parts[parts.length - 1] ?? "30", 10);
    const testId = parts.slice(0, -1).join("_");
    const userId = ctx.from.id;

    try { await ctx.deleteMessage(); } catch { }

    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
    if (!test) { await ctx.reply("❌ Test not found."); return; }

    const pending = getSession(userId).pendingPractice;
    if (pending) {
      updateSession(userId, { pendingPractice: { ...pending, timerSeconds: timerSec, awaiting: "count" } });
      await ctx.reply(
        `🔢 *How many questions do you want to practice?*\n\nTotal number of questions in this set: *${pending.totalQuestions}*\n\nYou can choose any number up to ${pending.totalQuestions}\\.`,
        { parse_mode: "MarkdownV2", reply_markup: practiceCountKeyboard(testId, pending.totalQuestions) }
      );
    } else {
      updateSession(userId, { pendingTimerSelect: undefined });
      await startQuizForUser(userId, test, true, timerSec);
    }
  });

  bot.callbackQuery(/^practice_count_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const parts = ctx.callbackQuery.data.replace("practice_count_", "").split("_");
    const value = parts.pop()!;
    const testId = parts.join("_");
    const userId = ctx.from.id;
    const pending = getSession(userId).pendingPractice;
    if (!pending || pending.testId !== testId) return;
    const count = value === "all" ? pending.totalQuestions : Number(value);
    if (!Number.isInteger(count) || count < 1 || count > pending.totalQuestions) {
      await ctx.reply("❌ Invalid question count.");
      return;
    }
    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
    if (!test) return;
    updateSession(userId, { pendingPractice: undefined });
    try { await ctx.deleteMessage(); } catch {}
    await startQuizForUser(userId, test, true, pending.timerSeconds, pending.startQuestion, count);
  });

  bot.callbackQuery(/^practice_custom_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("practice_custom_", "");
    const pending = getSession(ctx.from.id).pendingPractice;
    if (!pending || pending.testId !== testId) return;
    updateSession(ctx.from.id, { pendingPractice: { ...pending, awaiting: "count" } });
    await ctx.reply(
      `✍️ *Enter number of questions to practice*\n\nEnter a number between 1 and ${pending.totalQuestions}\\.`,
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.callbackQuery(/^start_test_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("start_test_", "");
    const userId = ctx.from.id;
    const chatType = ctx.chat?.type ?? "private";
    const isGroup = chatType === "group" || chatType === "supergroup";

    if (isGroup) {
      try {
        const member = await ctx.api.getChatMember(ctx.chat!.id, userId);
        if (member.status !== "creator" && member.status !== "administrator") {
          await ctx.answerCallbackQuery({ text: "⚠️ Only group admins can start tests here!", show_alert: true });
          return;
        }
      } catch (_) {}
    }

    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
    if (!test) { await ctx.reply("❌ Test not found."); return; }

    const qCount = Array.isArray(test.questionsData) ? (test.questionsData as unknown[]).length : 0;
    const isFree = test.priceInr === 0 && test.priceInStars === 0;
    const [userRow] = await db.select().from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
    const isPremium = userRow?.tier === "Premium";
    const [purchasedRow] = await db.select().from(purchasedTestsTable).where(and(eq(purchasedTestsTable.userId, userId), eq(purchasedTestsTable.testId, testId))).limit(1);
    const hasAccess = isFree || isPremium || !!purchasedRow;

    const botUsername = ctx.me.username ?? "gt_testprobot";
    const shareLink = `https://t.me/${botUsername}?start=test_${testId}`;

    if (!hasAccess) {
      const { paymentKeyboard } = await import("../keyboards.js");
      await ctx.reply(
        `📋 *${escMd(test.testName.trim())}*\n\n` +
        `📁 ${escMd(test.mainCategory)} → ${escMd(test.subCategory)}\n` +
        `📝 Questions: *${qCount}*\n` +
        `⏱️ Timer: *${test.timerSeconds ?? 30}s* per question\n` +
        `💵 💰 ₹${test.priceInr}\n\n` +
        `🔒 *Unlock to access this test:*`,
        { parse_mode: "MarkdownV2", reply_markup: paymentKeyboard(testId, test.priceInr, test.priceInStars) }
      );
      return;
    }

    const [prevAttempt] = await db.select({ id: userHistoryTable.id })
      .from(userHistoryTable)
      .where(and(eq(userHistoryTable.userId, userId), eq(userHistoryTable.testId, testId)))
      .limit(1);

    const { testDetailWithStartKeyboard, reattemptChoiceKeyboard } = await import("../keyboards.js");
    const keyboard = prevAttempt ? reattemptChoiceKeyboard(testId) : testDetailWithStartKeyboard(testId);
    const reattemptNote = prevAttempt ? `\n\n🔄 _You've attempted this test before\\!_` : "";

    await ctx.reply(
      `📋 *${escMd(test.testName.trim())}*\n\n` +
      `📁 ${escMd(test.mainCategory)} → ${escMd(test.subCategory)}\n` +
      `📝 Questions: *${qCount}*\n` +
      `⏱️ Timer: *${test.timerSeconds ?? 30}s* per question\n` +
      `➕ Correct: *\\+${escMd(String(test.positiveMarking))}*   ➖ Wrong: *\\-${escMd(String(test.negativeMarking))}*\n\n` +
      `🔗 *Shareable Link:*\n\`${escMd(shareLink)}\`` +
      reattemptNote,
      { parse_mode: "MarkdownV2", reply_markup: keyboard }
    );
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
      quiz.consecutiveCorrect = 0;
    } else {
      quiz.userAnswers[quiz.currentIndex] = userAnswerIndex;
      if (userAnswerIndex === question.correctOptionIndex) {
        quiz.correctCount++;
        quiz.consecutiveCorrect = (quiz.consecutiveCorrect ?? 0) + 1;
      } else {
        quiz.wrongCount++;
        quiz.consecutiveCorrect = 0;
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
      kb.text("✅ Skip Ad & Start Test", `ad_skip_${testId}`);
      await api.editMessageReplyMarkup(userId, sentMsgId, { reply_markup: kb });
    } catch { }
  }, 15000);

  updateSession(userId, { pendingAd: { testId, adMessageId: sentMsgId, skipTimer } });
}
