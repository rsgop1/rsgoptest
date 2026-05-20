import type { Bot } from "grammy";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  mainCategoryKeyboard,
  sscSubKeyboard,
  railwaySubKeyboard,
  bankingSubKeyboard,
  biharSubKeyboard,
} from "../keyboards.js";
import { getSession, updateSession } from "../session.js";
import { handleChallengeStart } from "./challenge.js";
import { logger } from "../../lib/logger.js";

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

const WELCOME_MSG = `🚀 *Welcome to Series TestPro\\!*

Your exam preparation, automated and supercharged\\.

👇 Select your main exam category below:`;

function dashboardMsg(name: string, sub: string, tier: string, refLink: string): string {
  return `👋 *Welcome back, ${escMd(name)}\\!*

🎯 Target: *${escMd(sub)}*
💎 Tier: *${escMd(tier === "Premium" ? "💎 Premium" : "🆓 Free")}*

📚 Commands:
/test\\_series — Browse & start mock tests
/leaderboard — Top performers ranking
/stats — Your performance analytics
/notebook — Practice wrong questions
/challenge — Start a group challenge
/premium — Upgrade to Premium
/doubt — AI Doubt Solver

👥 *Your Referral Link:*
\`${escMd(refLink)}\``;
}

async function upsertUser(
  userId: number, firstName: string, lastName: string | undefined,
  username: string | undefined, referredBy?: number
): Promise<boolean> {
  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
  if (existing.length === 0) {
    await db.insert(usersTable).values({
      userId,
      username: username ?? null,
      fullName: `${firstName}${lastName ? " " + lastName : ""}`,
      tier: "Free",
      referredBy: referredBy ?? null,
    });
    if (referredBy) {
      await db.update(usersTable)
        .set({ referralCount: sql`${usersTable.referralCount} + 1` })
        .where(eq(usersTable.userId, referredBy))
        .catch(() => {});
    }
    return true;
  } else {
    await db.update(usersTable).set({ username: username ?? null }).where(eq(usersTable.userId, userId));
    return false;
  }
}

export function registerStartHandlers(bot: Bot): void {
  bot.command("start", async (ctx) => {
    try {
      const from = ctx.from!;
      const param = ctx.match?.trim() ?? "";

      if (param.startsWith("challenge_")) {
        const challengeId = param.replace("challenge_", "");
        await upsertUser(from.id, from.first_name, from.last_name, from.username);
        await handleChallengeStart(bot, from.id, challengeId);
        return;
      }

      let referredBy: number | undefined;
      if (param.startsWith("ref_")) {
        const refId = parseInt(param.replace("ref_", ""), 10);
        if (!isNaN(refId) && refId !== from.id) {
          referredBy = refId;
        }
      }

      const isNew = await upsertUser(from.id, from.first_name, from.last_name, from.username, referredBy);
      const botUsername = ctx.me.username ?? "gt_testprobot";
      const refLink = `https://t.me/${botUsername}?start=ref_${from.id}`;

      if (isNew) {
        updateSession(from.id, { onboardingStep: "idle" });
        if (referredBy) {
          await ctx.reply(`🎉 You joined via a referral link\\!\n\nWelcome to *Series TestPro\\!*`, { parse_mode: "MarkdownV2" });
        }
        await ctx.reply(WELCOME_MSG, { parse_mode: "MarkdownV2", reply_markup: mainCategoryKeyboard() });
      } else {
        const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, from.id)).limit(1);
        const sub = user?.targetExamSub ?? "Not set";
        const tier = user?.tier ?? "Free";
        await ctx.reply(dashboardMsg(from.first_name, sub, tier, refLink), { parse_mode: "MarkdownV2" });
      }
    } catch (err) {
      logger.error({ err }, "start command error");
      await ctx.reply("⚠️ Something went wrong. Please try /start again.");
    }
  });

  bot.callbackQuery(/^cat_main_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const category = ctx.callbackQuery.data.replace("cat_main_", "");
    updateSession(ctx.from.id, { onboardingStep: "awaiting_subcategory", pendingCategory: category });

    let kb;
    if (category === "SSC") kb = sscSubKeyboard();
    else if (category === "Railway") kb = railwaySubKeyboard();
    else if (category === "Banking") kb = bankingSubKeyboard();
    else kb = biharSubKeyboard();

    await ctx.editMessageText(
      `📚 *${escMd(category)} Exams*\n\nSelect your target exam:`,
      { parse_mode: "MarkdownV2", reply_markup: kb }
    );
  });

  bot.callbackQuery(/^cat_sub_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const sub = ctx.callbackQuery.data.replace("cat_sub_", "").replace(/_/g, " ");
    const session = getSession(userId);
    const main = session.pendingCategory ?? "SSC";

    await db.update(usersTable).set({ targetExamMain: main, targetExamSub: sub }).where(eq(usersTable.userId, userId));
    updateSession(userId, { onboardingStep: "idle", pendingCategory: undefined });

    const botUsername = ctx.me.username ?? "gt_testprobot";
    const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

    await ctx.editMessageText(
      `✅ *Target set: ${escMd(sub)}*\n\n🎉 Welcome to *Series TestPro\\!*\n\nYour exam preparation starts now\\.\n\n👥 *Your Referral Link:*\n\`${escMd(refLink)}\`\n\n📚 Use /test\\_series to start practicing\\!`,
      { parse_mode: "MarkdownV2" }
    );
  });
}
