import { db } from "@workspace/db";
import { achievementsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getApi } from "../api-instance.js";
import { logger } from "../../lib/logger.js";
import { getConfig } from "./helpers.js";
import type { Bot } from "grammy";

export const ACHIEVEMENT_DEFS: Record<string, { title: string; emoji: string; description: string }> = {
  accuracy_god:      { title: "🎯 Accuracy God",      emoji: "🎯", description: "100% accuracy in a single test" },
  the_flash:         { title: "⚡ The Flash",          emoji: "⚡", description: "20 consecutive correct answers" },
  night_owl:         { title: "🦉 Night Owl",          emoji: "🦉", description: "Completed 5 tests between 11 PM – 5 AM" },
  iron_brain:        { title: "🧠 Iron Brain",         emoji: "🧠", description: "Completed 50 tests total" },
  comeback_king:     { title: "👑 Comeback King",      emoji: "👑", description: "Improved score by 20%+ on a re-attempt" },
  marathon_runner:   { title: "🏃 Marathon Runner",    emoji: "🏃", description: "Completed 5 tests in a single day" },
};

function getTitleForUser(achievementTypes: string[]): string | null {
  const priority = ["accuracy_god", "the_flash", "iron_brain", "comeback_king", "night_owl", "marathon_runner"];
  for (const t of priority) {
    if (achievementTypes.includes(t)) {
      return ACHIEVEMENT_DEFS[t]?.title ?? null;
    }
  }
  return null;
}

async function hasAchievement(userId: number, type: string): Promise<boolean> {
  const [row] = await db.select().from(achievementsTable)
    .where(and(eq(achievementsTable.userId, userId), eq(achievementsTable.achievementType, type)))
    .limit(1);
  return !!row;
}

async function awardAchievement(userId: number, type: string): Promise<boolean> {
  if (await hasAchievement(userId, type)) return false;
  await db.insert(achievementsTable).values({ userId, achievementType: type });
  return true;
}

export interface QuizResult {
  testId: string;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  score: number;
  prevScore?: number;
  consecutiveCorrect: number;
  totalTestsTaken: number;
}

export async function checkAndAwardAchievements(userId: number, result: QuizResult): Promise<string[]> {
  const api = getApi();
  const newAchievements: string[] = [];
  const total = result.correctCount + result.wrongCount + result.skippedCount;

  if (total > 0 && result.wrongCount === 0 && result.skippedCount === 0) {
    if (await awardAchievement(userId, "accuracy_god")) newAchievements.push("accuracy_god");
  }

  if (result.consecutiveCorrect >= 20) {
    if (await awardAchievement(userId, "the_flash")) newAchievements.push("the_flash");
  }

  const hour = new Date().getHours();
  if (hour >= 23 || hour < 5) {
    const existing = await db.select().from(achievementsTable)
      .where(and(eq(achievementsTable.userId, userId), eq(achievementsTable.achievementType, "night_owl")));
    if (!existing.length) {
      const nightCount = await db.select().from(achievementsTable)
        .where(eq(achievementsTable.userId, userId));
      if (nightCount.length >= 4) {
        if (await awardAchievement(userId, "night_owl")) newAchievements.push("night_owl");
      }
    }
  }

  if (result.totalTestsTaken >= 50) {
    if (await awardAchievement(userId, "iron_brain")) newAchievements.push("iron_brain");
  }

  if (result.prevScore !== undefined && result.prevScore > 0) {
    const improvement = ((result.score - result.prevScore) / result.prevScore) * 100;
    if (improvement >= 20) {
      if (await awardAchievement(userId, "comeback_king")) newAchievements.push("comeback_king");
    }
  }

  for (const type of newAchievements) {
    const def = ACHIEVEMENT_DEFS[type];
    if (!def) continue;
    try {
      await api.sendMessage(userId,
        `🏆 *Achievement Unlocked\\!*\n\n${def.emoji} *${escMd(def.title)}*\n_${escMd(def.description)}_\n\nCongratulations\\! This title will appear in configured groups\\.`,
        { parse_mode: "MarkdownV2" }
      );
    } catch (err) {
      logger.error({ err }, "Failed to send achievement notification");
    }

    await trySetGroupTitles(userId);
  }

  return newAchievements;
}

export async function trySetGroupTitles(userId: number): Promise<void> {
  try {
    const api = getApi();
    const allAchievements = await db.select().from(achievementsTable)
      .where(eq(achievementsTable.userId, userId));
    const types = allAchievements.map(a => a.achievementType);
    const title = getTitleForUser(types);
    if (!title) return;

    const groupsRaw = await getConfig("bot_groups");
    if (!groupsRaw) return;
    const groups: Array<{ id: number | string; name?: string }> = JSON.parse(groupsRaw);

    for (const group of groups) {
      try {
        await api.promoteChatMember(group.id as number, userId, {
          can_change_info: false,
          can_post_messages: false,
          can_edit_messages: false,
          can_delete_messages: false,
          can_invite_users: true,
          can_restrict_members: false,
          can_pin_messages: false,
          can_promote_members: false,
        });
        await new Promise(r => setTimeout(r, 500));
        await api.setChatAdministratorCustomTitle(group.id as number, userId, title);
      } catch (err) {
        logger.warn({ err, groupId: group.id }, "Could not set group title");
      }
    }
  } catch (err) {
    logger.error({ err }, "trySetGroupTitles error");
  }
}

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

export function registerAchievementHandlers(bot: Bot): void {
  bot.on("chat_member", async (ctx) => {
    try {
      const update = ctx.chatMember;
      const newStatus = update.new_chat_member.status;
      const userId = update.new_chat_member.user.id;

      if (newStatus !== "member" && newStatus !== "administrator") return;

      const groupsRaw = await getConfig("bot_groups");
      if (!groupsRaw) return;
      const groups: Array<{ id: number | string }> = JSON.parse(groupsRaw);
      const chatId = ctx.chat.id;
      const isConfigured = groups.some(g => Number(g.id) === chatId || g.id === String(chatId));
      if (!isConfigured) return;

      await trySetGroupTitles(userId);
    } catch (err) {
      logger.error({ err }, "chat_member achievement handler error");
    }
  });
}
