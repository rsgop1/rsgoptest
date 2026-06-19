import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import { liveTestsTable, liveTestAnswersTable, testSeriesTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import type { QuestionData } from "@workspace/db";
import { getApi } from "../api-instance.js";
import { getSession, updateSession } from "../session.js";
import { logger } from "../../lib/logger.js";
import { emitTelemetry } from "../../lib/telemetry.js";
import { liveTestJoinKeyboard } from "../keyboards.js";

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

const activeLiveSessions = new Map<number, { pollIds: Map<number, string>; timers: Map<number, ReturnType<typeof setTimeout>> }>();

export function registerLiveTestHandlers(bot: Bot): void {
  bot.callbackQuery(/^live_join_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const liveTestId = parseInt(ctx.callbackQuery.data.replace("live_join_", ""), 10);
    const userId = ctx.from.id;

    const [liveTest] = await db.select().from(liveTestsTable).where(eq(liveTestsTable.id, liveTestId)).limit(1);
    if (!liveTest) {
      await ctx.reply("❌ Live test not found.");
      return;
    }
    if (liveTest.status === "live") {
      await ctx.reply("⚠️ Live test already started! Ask admin to join next time.");
      return;
    }
    if (liveTest.status === "completed") {
      await ctx.reply("❌ This live test is already completed.");
      return;
    }

    const participants = (liveTest.participants ?? []) as number[];
    if (participants.includes(userId)) {
      await ctx.reply("✅ You are already registered for this live test!");
      return;
    }

    participants.push(userId);
    await db.update(liveTestsTable).set({ participants }).where(eq(liveTestsTable.id, liveTestId));

    const schedTime = new Date(liveTest.scheduledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    await ctx.reply(
      `✅ *Joined Live Test\\!*\n\n📝 *${escMd(liveTest.title)}*\n⏰ Starts at: *${escMd(schedTime)} IST*\n\n_You will automatically receive the questions when the test begins\\._`,
      { parse_mode: "MarkdownV2" }
    );

    emitTelemetry(`User ${userId} joined live test: ${liveTest.title}`);
  });

  bot.on("poll_answer", async (ctx, next) => {
    const { poll_id, option_ids, user } = ctx.pollAnswer;
    if (!user) return next();

    const userId = user.id;
    const session = activeLiveSessions.get(userId);
    if (!session) return next();

    const expectedPollId = session.pollIds.get(userId);
    if (poll_id !== expectedPollId) return next();

    const timer = session.timers.get(userId);
    if (timer) {
      clearTimeout(timer);
      session.timers.delete(userId);
    }
    session.pollIds.delete(userId);
  });
}

export async function startLiveTest(liveTestId: number): Promise<void> {
  const api = getApi();

  const [liveTest] = await db.select().from(liveTestsTable).where(eq(liveTestsTable.id, liveTestId)).limit(1);
  if (!liveTest || liveTest.status !== "notified") {
    logger.warn({ liveTestId }, "Live test not ready to start");
    return;
  }

  const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, liveTest.testId)).limit(1);
  if (!test) return;

  const questions = test.questionsData as QuestionData[];
  const participants = (liveTest.participants ?? []) as number[];

  if (participants.length === 0) {
    await db.update(liveTestsTable).set({ status: "completed" }).where(eq(liveTestsTable.id, liveTestId));
    return;
  }

  await db.update(liveTestsTable).set({ status: "live" }).where(eq(liveTestsTable.id, liveTestId));
  emitTelemetry(`Live test started: ${liveTest.title} — ${participants.length} participants`);

  for (const userId of participants) {
    const answers: (number | null)[] = questions.map(() => null);
    await db.insert(liveTestAnswersTable).values({
      liveTestId,
      userId,
      score: 0,
      correctCount: 0,
      answers,
    }).catch(() => {});

    try {
      await api.sendMessage(userId,
        `🔴 *LIVE TEST STARTED\\!*\n\n📝 *${escMd(liveTest.title)}*\n👥 Participants: *${participants.length}*\n\nGet ready\\! First question coming in 5 seconds…`,
        { parse_mode: "MarkdownV2" }
      );
    } catch { }
  }

  await new Promise(r => setTimeout(r, 5000));

  const scores = new Map<number, { score: number; correct: number; answers: (number | null)[] }>();
  for (const p of participants) scores.set(p, { score: 0, correct: 0, answers: questions.map(() => null) });

  const timerSec = test.timerSeconds ?? 30;

  for (let qIdx = 0; qIdx < questions.length; qIdx++) {
    const q = questions[qIdx]!;
    const pollIds = new Map<number, string>();

    for (const userId of participants) {
      try {
        const msg = await api.sendPoll(
          userId,
          `Q${qIdx + 1}/${questions.length}: ${q.question.slice(0, 280)}`,
          q.options.map(o => ({ text: o.slice(0, 100) })),
          {
            type: "quiz",
            correct_option_ids: [q.correctOptionIndex],
            explanation: q.explanation ? q.explanation.slice(0, 200) : undefined,
            is_anonymous: false,
            open_period: timerSec,
          }
        );
        const pollData = (msg as any).poll;
        if (pollData?.id) pollIds.set(userId, pollData.id as string);
      } catch { }
    }

    await new Promise(r => setTimeout(r, (timerSec + 2) * 1000));

    for (const [, session] of activeLiveSessions) {
      session.pollIds.clear();
      session.timers.forEach(t => clearTimeout(t));
      session.timers.clear();
    }

    if (qIdx < questions.length - 1) {
      const leaderboard = buildLeaderboard(scores);
      if (liveTest.groupChatId) {
        try {
          await api.sendMessage(
            liveTest.groupChatId,
            `📊 *After Q${qIdx + 1}/${questions.length} — Live Leaderboard*\n\n${leaderboard}\n\n⏳ Next question in 5s…`,
            { parse_mode: "MarkdownV2" }
          );
        } catch { }
      }
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  const finalLeaderboard = buildLeaderboard(scores);
  if (liveTest.groupChatId) {
    try {
      await api.sendMessage(
        liveTest.groupChatId,
        `🏆 *FINAL RESULTS — ${escMd(liveTest.title)}*\n\n${finalLeaderboard}\n\n🎉 Congratulations to all participants\\!`,
        { parse_mode: "MarkdownV2" }
      );
    } catch { }
  }

  for (const userId of participants) {
    const userScore = scores.get(userId);
    if (!userScore) continue;
    try {
      await api.sendMessage(userId,
        `🏁 *Live Test Completed\\!*\n\n📝 *${escMd(liveTest.title)}*\n\n✅ Correct: *${userScore.correct}*\n📊 Score: *${userScore.score}*\n\nCheck the group for the final leaderboard\\!`,
        { parse_mode: "MarkdownV2" }
      );
    } catch { }
  }

  await db.update(liveTestsTable).set({ status: "completed" }).where(eq(liveTestsTable.id, liveTestId));
  emitTelemetry(`Live test completed: ${liveTest.title}`);
}

function buildLeaderboard(scores: Map<number, { score: number; correct: number; answers: (number | null)[] }>): string {
  const sorted = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const medals = ["🥇", "🥈", "🥉"];
  return sorted.slice(0, 10).map(([userId, s], i) => {
    const medal = medals[i] ?? `${i + 1}.`;
    return `${medal} User ${userId} — Score: *${s.score}* \\(${s.correct} correct\\)`;
  }).join("\n") || "_No scores yet_";
}

export async function notifyLiveTestParticipants(liveTestId: number): Promise<void> {
  const api = getApi();
  const [liveTest] = await db.select().from(liveTestsTable).where(eq(liveTestsTable.id, liveTestId)).limit(1);
  if (!liveTest) return;

  const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, liveTest.testId)).limit(1);

  const allUsers = await db.select({ userId: usersTable.userId }).from(usersTable);
  const schedTime = new Date(liveTest.scheduledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  for (const { userId } of allUsers) {
    try {
      await api.sendMessage(userId,
        `🔴 *LIVE MOCK TEST IN 30 MINUTES\\!*\n\n📝 *${escMd(liveTest.title)}*\n${test ? `📁 ${escMd(test.mainCategory)}` : ""}\n⏰ Starts: *${escMd(schedTime)} IST*\n\nJoin now to participate with everyone simultaneously\\!`,
        { parse_mode: "MarkdownV2", reply_markup: liveTestJoinKeyboard(liveTestId) }
      );
      await new Promise(r => setTimeout(r, 50));
    } catch { }
  }

  await db.update(liveTestsTable).set({ status: "notified" }).where(eq(liveTestsTable.id, liveTestId));
}

export function startLiveTestScheduler(): void {
  setInterval(async () => {
    try {
      const now = new Date();
      const in30 = new Date(now.getTime() + 31 * 60 * 1000);
      const in29 = new Date(now.getTime() + 29 * 60 * 1000);

      const liveTests = await db.select().from(liveTestsTable).where(eq(liveTestsTable.status, "scheduled"));

      for (const lt of liveTests) {
        const schedAt = new Date(lt.scheduledAt);
        if (schedAt >= in29 && schedAt <= in30) {
          await notifyLiveTestParticipants(lt.id);
        }
        if (schedAt <= now) {
          await db.update(liveTestsTable).set({ status: "notified" }).where(eq(liveTestsTable.id, lt.id));
          startLiveTest(lt.id).catch(err => logger.error({ err }, "Live test start failed"));
        }
      }

      const notified = await db.select().from(liveTestsTable).where(eq(liveTestsTable.status, "notified"));
      for (const lt of notified) {
        if (new Date(lt.scheduledAt) <= now) {
          startLiveTest(lt.id).catch(err => logger.error({ err }, "Live test start failed"));
        }
      }
    } catch (err) {
      logger.error({ err }, "Live test scheduler error");
    }
  }, 60 * 1000);
}
