import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import { liveTestsTable, testSeriesTable, usersTable, userHistoryTable } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { getApi } from "../api-instance.js";
import { startQuizForUser } from "./quiz.js";
import { getConfig } from "./helpers.js";
import { logger } from "../../lib/logger.js";
import { emitTelemetry } from "../../lib/telemetry.js";

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
    `👇 Tap below to join\\! Your questions will be sent to your DM automatically when the test begins\\.`;

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

  await db.update(liveTestsTable).set({ status: "live" }).where(eq(liveTestsTable.id, liveTestId));

  if (liveTest.groupChatId) {
    try {
      await api.sendMessage(
        liveTest.groupChatId,
        `🚀 *LIVE TEST STARTED\\!*\n\n📝 *${escMd(liveTest.title)}*\n👥 *${participants.length}* participants\n\n📱 _Check your DM with @gt\\_testprobot — questions are being sent\\!_\n\n🏆 _Leaderboard will be posted here when the test ends\\._`,
        { parse_mode: "MarkdownV2" }
      );
    } catch { }
  }

  for (const userId of participants) {
    try {
      await startQuizForUser(userId, test, true);
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      logger.warn({ err, userId }, "Could not start live test quiz for participant");
    }
  }

  emitTelemetry(`Live test started: ${liveTest.title} — ${participants.length} participants`);

  const questions = test.questionsData as unknown[];
  const timerSeconds = test.timerSeconds ?? 30;
  const totalTime = (questions.length * timerSeconds + questions.length * 3 + 90) * 1000;

  setTimeout(async () => {
    await postLiveLeaderboard(liveTestId);
  }, totalTime);
}

async function postLiveLeaderboard(liveTestId: number): Promise<void> {
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
  for (const userId of participants) {
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

  entries.sort((a, b) => b.score - a.score);
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

  await db.update(liveTestsTable).set({ status: "completed" }).where(eq(liveTestsTable.id, liveTestId));
  emitTelemetry(`Live test completed with leaderboard: ${liveTest.title}`);
}

export function registerLiveTestHandlers(bot: Bot): void {
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
