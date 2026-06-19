import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import {
  challengesTable,
  challengeParticipantsTable,
  testSeriesTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import type { QuestionData } from "@workspace/db";
import { getSession, updateSession } from "../session.js";
import { sendNextQuestion } from "./quiz.js";
import { getApi } from "../api-instance.js";
import { logger } from "../../lib/logger.js";
import { randomUUID } from "crypto";

function escMd(t: string): string {
  return t.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

let BOT_USERNAME = "";

export function setBotUsername(username: string): void {
  BOT_USERNAME = username;
}

export function registerChallengeHandlers(bot: Bot): void {
  bot.command("challenge", async (ctx) => {
    try {
      const tests = await db
        .select({ testId: testSeriesTable.testId, testName: testSeriesTable.testName })
        .from(testSeriesTable)
        .where(eq(testSeriesTable.isActive, true));

      if (!tests.length) {
        await ctx.reply("📭 No tests available to challenge with yet.");
        return;
      }

      const kb = new InlineKeyboard();
      for (const t of tests.slice(0, 8)) {
        kb.text(`⚔️ ${t.testName.slice(0, 32)}`, `chl_pick_${t.testId}`).row();
      }

      await ctx.reply(
        "⚔️ *Group Challenge*\n\nPick a test to challenge others with\\!\n\nI will post a challenge link here — anyone who taps it will compete against you\\.",
        { parse_mode: "MarkdownV2", reply_markup: kb }
      );
    } catch (err) {
      logger.error({ err }, "challenge command error");
    }
  });

  bot.callbackQuery(/^chl_pick_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("chl_pick_", "");
    const userId = ctx.from.id;
    const chatId = ctx.chat?.id ?? userId;
    const isGroup = chatId !== userId;

    try {
      const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
      if (!test) { await ctx.reply("Test not found."); return; }

      const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
      const creatorName = user?.fullName ?? ctx.from.first_name;
      const challengeId = randomUUID().slice(0, 8).toUpperCase();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      await db.insert(challengesTable).values({
        challengeId,
        testId,
        testName: test.testName,
        createdBy: userId,
        creatorName,
        groupChatId: isGroup ? chatId : null,
        expiresAt,
      });

      if (!BOT_USERNAME) {
        try { BOT_USERNAME = (await ctx.api.getMe()).username ?? ""; } catch (_) {}
      }

      const joinUrl = `https://t.me/${BOT_USERNAME}?start=challenge_${challengeId}`;
      const kb = new InlineKeyboard().url("⚔️ Join Challenge", joinUrl);

      const msg = await ctx.reply(
        `⚔️ *CHALLENGE CREATED\\!*\n\n📝 Test: *${escMd(test.testName)}*\n👤 Started by: *${escMd(creatorName)}*\n⏰ Expires in: 30 minutes\n\n👇 Tap below to join and compete\\!`,
        { parse_mode: "MarkdownV2", reply_markup: kb }
      );

      if (isGroup) {
        await db.update(challengesTable)
          .set({ groupMessageId: msg.message_id })
          .where(eq(challengesTable.challengeId, challengeId));
      }
    } catch (err) {
      logger.error({ err }, "chl_pick error");
      await ctx.reply("❌ Error creating challenge. Please try again.");
    }
  });
}

export async function handleChallengeStart(bot: Bot, userId: number, challengeId: string): Promise<void> {
  const api = getApi();
  try {
    const [challenge] = await db
      .select()
      .from(challengesTable)
      .where(eq(challengesTable.challengeId, challengeId))
      .limit(1);

    if (!challenge || !challenge.isActive || challenge.expiresAt < new Date()) {
      await api.sendMessage(userId, "❌ This challenge has expired or doesn't exist.");
      return;
    }

    const alreadyJoined = await db
      .select()
      .from(challengeParticipantsTable)
      .where(
        and(
          eq(challengeParticipantsTable.challengeId, challengeId),
          eq(challengeParticipantsTable.userId, userId)
        )
      )
      .limit(1);

    if (alreadyJoined.length) {
      await api.sendMessage(userId, "⚠️ You have already joined this challenge!");
      return;
    }

    const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
    const userName = user?.fullName ?? "Player";

    await db.insert(challengeParticipantsTable).values({
      challengeId,
      userId,
      userName,
    });

    const [test] = await db
      .select()
      .from(testSeriesTable)
      .where(eq(testSeriesTable.testId, challenge.testId))
      .limit(1);

    if (!test) {
      await api.sendMessage(userId, "❌ Challenge test not found.");
      return;
    }

    const questions = test.questionsData as QuestionData[];
    if (!questions.length) {
      await api.sendMessage(userId, "❌ This test has no questions yet.");
      return;
    }

    updateSession(userId, {
      quiz: {
        testId: test.testId,
        testName: `⚔️ CHALLENGE: ${test.testName}`,
        questions,
        currentIndex: 0,
        correctCount: 0,
        wrongCount: 0,
        skippedCount: 0,
        wrongQuestionIds: [],
        cheatWarnings: 0,
        userAnswers: questions.map(() => null),
        pollMessageIds: [],
        timerSeconds: 30,
        consecutiveCorrect: 0,
      },
      solution: undefined,
    });

    await api.sendMessage(
      userId,
      `⚔️ *CHALLENGE STARTED\\!*\n\n📝 *${escMd(test.testName)}*\n👤 Created by: *${escMd(challenge.creatorName)}*\n\nTotal Questions: *${questions.length}*\n⏱️ 30 seconds per question\n\nGood luck\\! 💪`,
      { parse_mode: "MarkdownV2" }
    );

    await sendNextQuestion(userId);
  } catch (err) {
    logger.error({ err }, "handleChallengeStart error");
  }
}

export async function postChallengeResult(challengeId: string, userId: number, score: number, correct: number, total: number): Promise<void> {
  const api = getApi();
  try {
    await db
      .update(challengeParticipantsTable)
      .set({ score, correctCount: correct, totalQuestions: total, completedAt: new Date() })
      .where(
        and(
          eq(challengeParticipantsTable.challengeId, challengeId),
          eq(challengeParticipantsTable.userId, userId)
        )
      );

    const [challenge] = await db
      .select()
      .from(challengesTable)
      .where(eq(challengesTable.challengeId, challengeId))
      .limit(1);

    if (!challenge) return;

    const participants = await db
      .select()
      .from(challengeParticipantsTable)
      .where(eq(challengeParticipantsTable.challengeId, challengeId))
      .orderBy(desc(challengeParticipantsTable.score));

    const leaderText = participants
      .filter(p => p.completedAt)
      .map((p, i) => {
        const medals = ["🥇", "🥈", "🥉"];
        const medal = medals[i] ?? `#${i + 1}`;
        return `${medal} ${p.userName} — ${p.score?.toFixed(1)} pts (${p.correctCount}/${p.totalQuestions} correct)`;
      })
      .join("\n");

    const resultMsg = `⚔️ *CHALLENGE UPDATE*\n\n📝 *${escMd(challenge.testName)}*\n\n*Current Standings:*\n${escMd(leaderText || "No completions yet")}`;

    if (challenge.groupChatId && challenge.groupMessageId) {
      await api.sendMessage(challenge.groupChatId, resultMsg, { parse_mode: "MarkdownV2" }).catch(() => {});
    }
  } catch (err) {
    logger.error({ err }, "postChallengeResult error");
  }
}
