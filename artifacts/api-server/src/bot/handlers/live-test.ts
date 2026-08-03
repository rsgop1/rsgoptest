import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import { liveTestsTable, testSeriesTable, usersTable, userHistoryTable } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { getApi } from "../api-instance.js";
import { getConfig } from "./helpers.js";
import { logger } from "../../lib/logger.js";
import { emitTelemetry } from "../../lib/telemetry.js";
import type { QuestionData } from "@workspace/db";

type LiveScore = { correct: number; answered: number; name: string };
type LiveSession = {
  liveTestId: number;
  groupId: number;
  questions: QuestionData[];
  title: string;
  currentIndex: number;
  pollId: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  scores: Map<number, LiveScore>;
};
const liveSessions = new Map<number, LiveSession>();

export function stopLiveTestSession(liveTestId: number): boolean {
  const session = liveSessions.get(liveTestId);
  if (!session) return false;
  if (session.timer) clearTimeout(session.timer);
  liveSessions.delete(liveTestId);
  return true;
}

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

function buildLeaderboard(entries: Array<{ fullName: string; score: number; correct: number; total: number }>): string {
  const medals = ["🥇", "🥈", "🥉"];
  if (!entries.length) return "_No participants completed the test_";
  return entries.slice(0, 10).map((e, i) => {
    const medal = medals[i] ?? `${i + 1}\\.`;
    return `${medal} *${escMd(e.fullName)}* — *${e.score}* pts \\(${e.correct}/${e.total} correct\\)`;
  }).join("\n");
}

async function resolveGroupId(liveTest: { groupChatId: number | null }): Promise<number | null> {
  if (liveTest.groupChatId) return liveTest.groupChatId;
  const configGroup = await getConfig("live_test_group") ?? await getConfig("anon_doubt_group");
  return configGroup ? Number(configGroup) : null;
}

export async function announceLiveTest(liveTestId: number): Promise<void> {
  const api = getApi();
  const [liveTest] = await db.select().from(liveTestsTable).where(eq(liveTestsTable.id, liveTestId)).limit(1);
  if (!liveTest || liveTest.status !== "scheduled") return;

  const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, liveTest.testId)).limit(1);
  const groupId = await resolveGroupId(liveTest);
  const schedTime = new Date(liveTest.scheduledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const qCount = test && Array.isArray(test.questionsData) ? (test.questionsData as unknown[]).length : 0;

  const joinKb = new InlineKeyboard().url(
    "✅ Join Live Test",
    `https://t.me/gt_testprobot?start=livetestjoin_${liveTestId}`
  );

  const msg =
    `🔴 *LIVE MOCK TEST SCHEDULED\\!*\n\n` +
    `📝 *${escMd(liveTest.title)}*\n` +
    (test ? `📁 ${escMd(test.mainCategory)} → ${escMd(test.subCategory)}\n` : "") +
    `📊 *${qCount}* Questions\n` +
    `⏰ Starts: *${escMd(schedTime)} IST*\n\n` +
    `👇 Tap below to join\\! At start, one shared timed poll will appear here for everyone\\.`;

  let pinnedMsgId: number | null = null;
  let finalGroupId: number | null = liveTest.groupChatId;

  if (groupId) {
    try {
      const posted = await api.sendMessage(groupId, msg, { parse_mode: "MarkdownV2", reply_markup: joinKb });
      pinnedMsgId = posted.message_id;
      finalGroupId = groupId;
      try { await api.pinChatMessage(groupId, posted.message_id, { disable_notification: false }); } catch { }
    } catch (err) {
      logger.warn({ err, groupId }, "Could not post live test announcement to group");
    }
  }

  await db.update(liveTestsTable).set({
    status: "announced",
    groupChatId: finalGroupId,
    pinnedMessageId: pinnedMsgId,
  }).where(eq(liveTestsTable.id, liveTestId));

  emitTelemetry(`Live test announced: ${liveTest.title}`);
}

export async function sendLiveTestReminder(liveTestId: number): Promise<void> {
  const api = getApi();
  const [liveTest] = await db.select().from(liveTestsTable).where(eq(liveTestsTable.id, liveTestId)).limit(1);
  if (!liveTest || liveTest.status !== "announced") return;

  const schedTime = new Date(liveTest.scheduledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const participants = (liveTest.participants ?? []) as number[];

  const joinKb = new InlineKeyboard().url(
    "✅ Join Now",
    `https://t.me/gt_testprobot?start=livetestjoin_${liveTestId}`
  );

  const reminderMsg =
    `⚡ *5 MINUTES TO GO\\!*\n\n` +
    `📝 *${escMd(liveTest.title)}*\n` +
    `⏰ Starts: *${escMd(schedTime)} IST*\n` +
    `👥 *${participants.length}* participants registered\n\n` +
    `Get ready\\! 💪`;

  const channelId = await getConfig("live_test_channel") ?? await getConfig("leaderboard_channel");
  if (channelId) {
    try {
      const chId = isNaN(Number(channelId)) ? channelId : Number(channelId);
      await api.sendMessage(chId as number, reminderMsg, { parse_mode: "MarkdownV2", reply_markup: joinKb });
    } catch (err) {
      logger.warn({ err, channelId }, "Could not send 5-min reminder to channel");
    }
  }

  if (liveTest.groupChatId) {
    try {
      await api.sendMessage(liveTest.groupChatId, reminderMsg, { parse_mode: "MarkdownV2", reply_markup: joinKb });
    } catch (err) {
      logger.warn({ err }, "Could not send 5-min reminder to group");
    }
  }

  await db.update(liveTestsTable).set({ status: "notified" }).where(eq(liveTestsTable.id, liveTestId));
}

export async function startLiveTest(liveTestId: number): Promise<void> {
  const api = getApi();
  const [liveTest] = await db.select().from(liveTestsTable).where(eq(liveTestsTable.id, liveTestId)).limit(1);
  if (!liveTest || !["announced", "notified"].includes(liveTest.status)) return;

  const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, liveTest.testId)).limit(1);
  if (!test) {
    await db.update(liveTestsTable).set({ status: "completed" }).where(eq(liveTestsTable.id, liveTestId));
    return;
  }

  const participants = (liveTest.participants ?? []) as number[];
  if (participants.length === 0) {
    await db.update(liveTestsTable).set({ status: "completed" }).where(eq(liveTestsTable.id, liveTestId));
    if (liveTest.groupChatId) {
      try {
        await api.sendMessage(
          liveTest.groupChatId,
          `📭 *Live Test Ended*\n\n📝 *${escMd(liveTest.title)}*\n\n_No one joined this session\\._`,
          { parse_mode: "MarkdownV2" }
        );
      } catch { }
    }
    return;
  }

  const groupId = liveTest.groupChatId;
  if (!groupId) {
    await db.update(liveTestsTable).set({ status: "completed" }).where(eq(liveTestsTable.id, liveTestId));
    logger.warn({ liveTestId }, "Group poll live test has no group chat");
    return;
  }
  const questions = (test.questionsData ?? []) as QuestionData[];
  if (!questions.length) return;
  const session: LiveSession = {
    liveTestId, groupId, questions, title: liveTest.title, currentIndex: 0,
    pollId: null, timer: null, scores: new Map(),
  };
  liveSessions.set(liveTestId, session);
  await db.update(liveTestsTable).set({ status: "live", currentQuestionIndex: 0 }).where(eq(liveTestsTable.id, liveTestId));

  await api.sendMessage(groupId, `🚀 *LIVE GROUP TEST STARTED\\!*\n\n📝 *${escMd(liveTest.title)}*\n👥 *${participants.length}* registered\n\nOne shared poll per question • ${liveTest.timerSeconds}s each\n🏆 Live leaderboard will be posted at the end\\.`, { parse_mode: "MarkdownV2" }).catch(() => {});
  emitTelemetry(`Live group poll started: ${liveTest.title} — ${participants.length} registered`);
  await sendNextGroupPoll(session, liveTest.timerSeconds);
}

async function sendNextGroupPoll(session: LiveSession, timerSeconds: number): Promise<void> {
  const api = getApi();
  const q = session.questions[session.currentIndex];
  if (!q) { await postLiveLeaderboard(session.liveTestId, session.scores); liveSessions.delete(session.liveTestId); return; }
  try {
    const poll = await api.sendPoll(session.groupId, `Q${session.currentIndex + 1}/${session.questions.length}: ${q.question}`, q.options, {
      type: "quiz", correct_option_ids: [q.correctOptionIndex],
      explanation: q.explanation?.slice(0, 200), open_period: timerSeconds, is_anonymous: false,
    });
    session.pollId = poll.poll.id;
    await db.update(liveTestsTable).set({
      currentQuestionIndex: session.currentIndex, currentPollId: poll.poll.id, currentPollMessageId: poll.message_id,
    }).where(eq(liveTestsTable.id, session.liveTestId));
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(async () => {
      session.pollId = null;
      session.currentIndex++;
      await sendNextGroupPoll(session, timerSeconds);
    }, (timerSeconds + 2) * 1000);
  } catch (err) {
    logger.warn({ err, groupId: session.groupId }, "Could not send live group poll");
    await postLiveLeaderboard(session.liveTestId, session.scores);
    liveSessions.delete(session.liveTestId);
  }
}

async function postLiveLeaderboard(liveTestId: number, sessionScores?: Map<number, LiveScore>): Promise<void> {
  const api = getApi();
  const [liveTest] = await db.select().from(liveTestsTable).where(eq(liveTestsTable.id, liveTestId)).limit(1);
  if (!liveTest) return;

  const participants = (liveTest.participants ?? []) as number[];
  const groupId = liveTest.groupChatId;

  const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, liveTest.testId)).limit(1);
  const qCount = test && Array.isArray(test.questionsData) ? (test.questionsData as unknown[]).length : 1;

  if (!groupId) {
    await db.update(liveTestsTable).set({ status: "completed" }).where(eq(liveTestsTable.id, liveTestId));
    return;
  }

  const userRows = participants.length > 0
    ? await db.select({ userId: usersTable.userId, fullName: usersTable.fullName })
        .from(usersTable)
        .where(inArray(usersTable.userId, participants))
    : [];

  const nameMap = new Map(userRows.map(u => [u.userId, u.fullName]));

  const entries: Array<{ fullName: string; score: number; correct: number; total: number }> = [];
  if (sessionScores) {
    for (const score of sessionScores.values()) {
      entries.push({
        fullName: score.name,
        score: score.correct,
        correct: score.correct,
        total: score.answered,
      });
    }
  }
  for (const userId of sessionScores ? [] : participants) {
    const [latest] = await db.select({ score: userHistoryTable.score, correctCount: userHistoryTable.correctCount })
      .from(userHistoryTable)
      .where(and(eq(userHistoryTable.userId, userId), eq(userHistoryTable.testId, liveTest.testId)))
      .orderBy(desc(userHistoryTable.completedAt))
      .limit(1);

    entries.push({
      fullName: nameMap.get(userId) ?? `User ${userId}`,
      score: latest ? Math.round(latest.score) : 0,
      correct: latest?.correctCount ?? 0,
      total: qCount,
    });
  }

  entries.sort((a, b) => b.score - a.score || b.correct - a.correct);
  const leaderboard = buildLeaderboard(entries);

  try {
    await api.sendMessage(
      groupId,
      `🏆 *LIVE TEST — FINAL RESULTS*\n\n📝 *${escMd(liveTest.title)}*\n\n${leaderboard}\n\n🎉 Thanks to all *${participants.length}* participants\\!`,
      { parse_mode: "MarkdownV2" }
    );
  } catch (err) {
    logger.warn({ err }, "Could not post leaderboard to group");
  }

  await db.update(liveTestsTable).set({ status: "completed", currentPollId: null }).where(eq(liveTestsTable.id, liveTestId));
  emitTelemetry(`Live test completed with leaderboard: ${liveTest.title}`);
}

export function registerLiveTestHandlers(bot: Bot): void {
  bot.on("poll_answer", async (ctx) => {
    const answer = ctx.pollAnswer;
    if (!answer.user || !answer.option_ids.length) return;
    for (const session of liveSessions.values()) {
      if (session.pollId !== answer.poll_id) continue;
      const q = session.questions[session.currentIndex];
      if (!q) return;
      const old = session.scores.get(answer.user.id) ?? {
        correct: 0, answered: 0,
        name: [answer.user.first_name, answer.user.last_name].filter(Boolean).join(" ") || `User ${answer.user.id}`,
      };
      session.scores.set(answer.user.id, {
        ...old, answered: old.answered + 1,
        correct: old.correct + (answer.option_ids[0] === q.correctOptionIndex ? 1 : 0),
      });
      return;
    }
  });
  bot.callbackQuery(/^live_join_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const liveTestId = parseInt(ctx.callbackQuery.data.replace("live_join_", ""), 10);
    const userId = ctx.from.id;

    const [liveTest] = await db.select().from(liveTestsTable).where(eq(liveTestsTable.id, liveTestId)).limit(1);
    if (!liveTest) { await ctx.reply("❌ Live test not found."); return; }

    if (liveTest.status === "live") {
      await ctx.reply("⚠️ This live test has already started. Join next time!");
      return;
    }
    if (liveTest.status === "completed") {
      await ctx.reply("❌ This live test has already ended.");
      return;
    }

    const participants = (liveTest.participants ?? []) as number[];
    if (participants.includes(userId)) {
      const schedTime = new Date(liveTest.scheduledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
      await ctx.reply(
        `✅ *Already registered\\!*\n\n📝 *${escMd(liveTest.title)}*\n⏰ Starts: *${escMd(schedTime)} IST*\n\n_Questions will be sent to you automatically when the test begins\\._`,
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    participants.push(userId);
    await db.update(liveTestsTable).set({ participants }).where(eq(liveTestsTable.id, liveTestId));

    const schedTime = new Date(liveTest.scheduledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    await ctx.reply(
      `✅ *Joined Live Test\\!*\n\n📝 *${escMd(liveTest.title)}*\n⏰ Starts: *${escMd(schedTime)} IST*\n\n_Questions will be sent to your DM automatically when the test begins\\. Stay tuned\\!_ 🎯`,
      { parse_mode: "MarkdownV2" }
    );
    emitTelemetry(`User ${userId} joined live test: ${liveTest.title}`);
  });
}

export function startLiveTestScheduler(): void {
  setInterval(async () => {
    try {
      const now = new Date();
      const in5min30 = new Date(now.getTime() + 5 * 60 * 1000 + 30 * 1000);
      const in4min30 = new Date(now.getTime() + 4 * 60 * 1000 + 30 * 1000);

      const scheduled = await db.select().from(liveTestsTable).where(eq(liveTestsTable.status, "scheduled"));
      for (const lt of scheduled) {
        if (new Date(lt.scheduledAt) > now) {
          await announceLiveTest(lt.id).catch(err => logger.warn({ err, liveTestId: lt.id }, "Announce failed"));
        } else {
          await db.update(liveTestsTable).set({ status: "announced" }).where(eq(liveTestsTable.id, lt.id));
          await startLiveTest(lt.id).catch(err => logger.error({ err }, "Live test start failed"));
        }
      }

      const announced = await db.select().from(liveTestsTable).where(eq(liveTestsTable.status, "announced"));
      for (const lt of announced) {
        const schedAt = new Date(lt.scheduledAt);
        if (schedAt <= in5min30 && schedAt >= in4min30) {
          await sendLiveTestReminder(lt.id).catch(err => logger.warn({ err }, "Reminder failed"));
        } else if (schedAt <= now) {
          await startLiveTest(lt.id).catch(err => logger.error({ err }, "Live test start failed"));
        }
      }

      const notified = await db.select().from(liveTestsTable).where(eq(liveTestsTable.status, "notified"));
      for (const lt of notified) {
        if (new Date(lt.scheduledAt) <= now) {
          await startLiveTest(lt.id).catch(err => logger.error({ err }, "Live test start failed"));
        }
      }
    } catch (err) {
      logger.error({ err }, "Live test scheduler error");
    }
  }, 60 * 1000);
}
