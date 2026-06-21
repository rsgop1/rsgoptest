import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import { testSeriesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import type { QuestionData } from "@workspace/db";

interface GroupQuizSession {
  testId: string;
  title: string;
  questions: QuestionData[];
  currentIndex: number;
  pollId: string | null;
  scores: Map<number, { correct: number; total: number; name: string }>;
  timerHandle: ReturnType<typeof setTimeout> | null;
  groupId: number;
}

const groupSessions = new Map<number, GroupQuizSession>();

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

export function getGroupSessions(): Map<number, GroupQuizSession> {
  return groupSessions;
}

async function sendGroupQuestion(bot: Bot, session: GroupQuizSession, groupId: number): Promise<void> {
  const q = session.questions[session.currentIndex];
  if (!q) {
    await endGroupQuiz(bot, session, groupId);
    return;
  }

  const total = session.questions.length;
  const options = q.options;
  const correctIdx = q.correctOptionIndex;

  try {
    const pollMsg = await bot.api.sendPoll(
      groupId,
      `Q${session.currentIndex + 1}/${total}: ${q.question}`,
      options,
      {
        type: "quiz",
        correct_option_ids: [correctIdx],
        explanation: q.explanation ? q.explanation.slice(0, 200) : undefined,
        open_period: 25,
        is_anonymous: false,
      }
    );

    session.pollId = pollMsg.poll.id;

    if (session.timerHandle) clearTimeout(session.timerHandle);
    session.timerHandle = setTimeout(async () => {
      session.pollId = null;
      session.currentIndex++;
      if (session.currentIndex < session.questions.length) {
        await sendGroupQuestion(bot, session, groupId);
      } else {
        await endGroupQuiz(bot, session, groupId);
      }
    }, 30000);
  } catch (err) {
    logger.warn({ err, groupId }, "Could not send group quiz question");
    groupSessions.delete(groupId);
  }
}

async function endGroupQuiz(bot: Bot, session: GroupQuizSession, groupId: number): Promise<void> {
  if (session.timerHandle) clearTimeout(session.timerHandle);
  groupSessions.delete(groupId);

  const entries = Array.from(session.scores.values()).sort((a, b) => b.correct - a.correct);
  const medals = ["🥇", "🥈", "🥉"];

  const leaderboard =
    entries.length === 0
      ? "_No one answered any questions_"
      : entries
          .slice(0, 10)
          .map((e, i) => {
            const medal = medals[i] ?? `${i + 1}\\.`;
            const pct = e.total > 0 ? Math.round((e.correct / e.total) * 100) : 0;
            return `${medal} *${escMd(e.name)}* — *${e.correct}*/${e.total} \\(${pct}%\\)`;
          })
          .join("\n");

  try {
    await bot.api.sendMessage(
      groupId,
      `🏆 *GROUP QUIZ — FINAL RESULTS*\n\n` +
        `📝 *${escMd(session.title)}*\n` +
        `📊 *${session.questions.length}* Questions • ${entries.length} participants\n\n` +
        `${leaderboard}\n\n` +
        `Practice individually → @gt\\_testprobot 🎯`,
      { parse_mode: "MarkdownV2" }
    );
  } catch (err) {
    logger.warn({ err }, "Could not post group quiz leaderboard");
  }
}

export function registerGroupQuizHandlers(bot: Bot): void {
  bot.command("quiz", async (ctx) => {
    const chatType = ctx.chat?.type;
    if (chatType !== "group" && chatType !== "supergroup") {
      await ctx.reply(
        "💡 `/quiz` is for group chats only\\.\nFor personal tests, use /test\\_series in DM\\!",
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    const groupId = ctx.chat.id;
    if (groupSessions.has(groupId)) {
      await ctx.reply("⚠️ A quiz is already running in this group! Wait for it to finish or use /stopquiz to cancel.");
      return;
    }

    const tests = await db
      .select({ testId: testSeriesTable.testId, testName: testSeriesTable.testName, mainCategory: testSeriesTable.mainCategory })
      .from(testSeriesTable)
      .where(eq(testSeriesTable.isActive, true))
      .limit(15);

    if (tests.length === 0) {
      await ctx.reply("❌ No free tests available for group quiz right now.");
      return;
    }

    const kb = new InlineKeyboard();
    tests.forEach((t) => {
      kb.text(`📝 ${t.testName} (${t.mainCategory})`, `gquiz_start_${t.testId}`).row();
    });

    await ctx.reply(
      `🎯 *Group Quiz Mode*\n\n` +
        `Select a test series to start\\!\n\n` +
        `📌 *How it works:*\n` +
        `• One question every *30 seconds*\n` +
        `• Correct answers shown immediately\n` +
        `• Leaderboard posted at the end\n` +
        `• Max 15 questions per session\n\n` +
        `⚡ All group members can participate\\!`,
      { parse_mode: "MarkdownV2", reply_markup: kb }
    );
  });

  bot.callbackQuery(/^gquiz_start_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatType = ctx.chat?.type;
    if (chatType !== "group" && chatType !== "supergroup") return;

    const groupId = ctx.chat!.id;
    if (groupSessions.has(groupId)) {
      await ctx.reply("⚠️ A quiz is already running in this group!");
      return;
    }

    const testId = ctx.callbackQuery.data.replace("gquiz_start_", "");
    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
    if (!test || !Array.isArray(test.questionsData) || test.questionsData.length === 0) {
      await ctx.reply("❌ Test not found or has no questions.");
      return;
    }

    const allQuestions = test.questionsData as QuestionData[];
    const questions = allQuestions.slice(0, 15);

    const session: GroupQuizSession = {
      testId,
      title: test.testName,
      questions,
      currentIndex: 0,
      pollId: null,
      scores: new Map(),
      timerHandle: null,
      groupId,
    };

    groupSessions.set(groupId, session);

    try {
      await ctx.editMessageText(
        `✅ *${escMd(test.testName)}* selected\\!\n\n` +
          `🚀 Starting in *5 seconds*\\.\\.\\.\n` +
          `📊 *${questions.length}* questions • 30s each\n\n` +
          `Get ready everyone\\! 💪`,
        { parse_mode: "MarkdownV2" }
      );
    } catch { }

    setTimeout(async () => {
      await sendGroupQuestion(bot, session, groupId);
    }, 5000);
  });

  bot.on("poll_answer", async (ctx) => {
    const pollAnswer = ctx.pollAnswer;
    const user = pollAnswer.user;
    if (!user || pollAnswer.option_ids.length === 0) return;

    for (const [groupId, session] of groupSessions.entries()) {
      if (session.pollId === pollAnswer.poll_id) {
        const q = session.questions[session.currentIndex];
        if (!q) break;

        const correctIdx = q.correctOptionIndex;
        const isCorrect = pollAnswer.option_ids[0] === correctIdx;

        const existing = session.scores.get(user.id) ?? {
          correct: 0,
          total: 0,
          name: [user.first_name, user.last_name].filter(Boolean).join(" ") || `User ${user.id}`,
        };
        session.scores.set(user.id, {
          correct: existing.correct + (isCorrect ? 1 : 0),
          total: existing.total + 1,
          name: existing.name,
        });
        break;
      }
    }
  });

  bot.command("stopquiz", async (ctx) => {
    const chatType = ctx.chat?.type;
    if (chatType !== "group" && chatType !== "supergroup") return;

    const groupId = ctx.chat.id;
    const session = groupSessions.get(groupId);
    if (!session) {
      await ctx.reply("No quiz is currently running in this group.");
      return;
    }

    await ctx.reply("🛑 Quiz stopped by admin.");
    await endGroupQuiz(bot, session, groupId);
  });
}
