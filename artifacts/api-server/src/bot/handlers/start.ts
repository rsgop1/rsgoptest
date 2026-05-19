import type { Bot } from "grammy";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  mainCategoryKeyboard,
  sscSubKeyboard,
  railwaySubKeyboard,
  bankingSubKeyboard,
  biharSubKeyboard,
} from "../keyboards.js";
import { updateSession } from "../session.js";
import { handleChallengeStart } from "./challenge.js";
import { logger } from "../../lib/logger.js";

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

const WELCOME_MSG = `🚀 *Welcome to Testbook\\+ Engine\\!*

Your exam preparation, automated and supercharged\\.

👇 Select your main exam category below:`;

const DASHBOARD_MSG = (name: string, sub: string, tier: string) =>
  `👋 *Welcome back, ${escMd(name)}\\!*

🎯 Target Exam: *${escMd(sub)}*
💎 Tier: *${escMd(tier === "Premium" ? "💎 Premium" : "🆓 Free")}*

📚 Commands:
/test\\_series — Browse & start mock tests
/leaderboard — Top performers ranking
/stats — Your performance analytics
/notebook — Practice wrong questions
/challenge — Start a group challenge
/premium — Upgrade to Premium
/doubt — AI Doubt Solver \\(coming soon\\)`;

async function upsertUser(userId: number, firstName: string, lastName: string | undefined, username: string | undefined): Promise<void> {
  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
  if (existing.length === 0) {
    await db.insert(usersTable).values({
      userId,
      username: username ?? null,
      fullName: `${firstName}${lastName ? " " + lastName : ""}`,
      tier: "Free",
    });
  } else {
    await db.update(usersTable).set({ username: username ?? null }).where(eq(usersTable.userId, userId));
  }
}

export function registerStartHandlers(bot: Bot): void {
  bot.command("start", async (ctx) => {
    try {
      const from = ctx.from!;
      await upsertUser(from.id, from.first_name, from.last_name, from.username);

      const payload = ctx.match;
      if (payload?.startsWith("challenge_")) {
        const challengeId = payload.replace("challenge_", "");
        await handleChallengeStart(bot, from.id, challengeId);
        return;
      }

      const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, from.id)).limit(1);

      if (user?.targetExamSub) {
        await ctx.reply(DASHBOARD_MSG(user.fullName, user.targetExamSub, user.tier), { parse_mode: "MarkdownV2" });
        return;
      }

      updateSession(from.id, { onboardingStep: "idle" });
      await ctx.reply(WELCOME_MSG, { parse_mode: "MarkdownV2", reply_markup: mainCategoryKeyboard() });
    } catch (err) {
      logger.error({ err }, "Error in /start");
      await ctx.reply("❌ Something went wrong. Please try /start again.");
    }
  });

  bot.callbackQuery("cat_ssc", async (ctx) => {
    await ctx.answerCallbackQuery();
    updateSession(ctx.from.id, { onboardingStep: "awaiting_subcategory", pendingCategory: "SSC Exams" });
    await ctx.editMessageText("🏆 *SSC Exams* — Choose your sub\\-category:", {
      parse_mode: "MarkdownV2", reply_markup: sscSubKeyboard(),
    });
  });

  bot.callbackQuery("cat_railway", async (ctx) => {
    await ctx.answerCallbackQuery();
    updateSession(ctx.from.id, { onboardingStep: "awaiting_subcategory", pendingCategory: "Railway Exams" });
    await ctx.editMessageText("🚆 *Railway Exams* — Choose your sub\\-category:", {
      parse_mode: "MarkdownV2", reply_markup: railwaySubKeyboard(),
    });
  });

  bot.callbackQuery("cat_banking", async (ctx) => {
    await ctx.answerCallbackQuery();
    updateSession(ctx.from.id, { onboardingStep: "awaiting_subcategory", pendingCategory: "Banking Exams" });
    await ctx.editMessageText("🏢 *Banking Exams* — Choose your sub\\-category:", {
      parse_mode: "MarkdownV2", reply_markup: bankingSubKeyboard(),
    });
  });

  bot.callbackQuery("cat_bihar", async (ctx) => {
    await ctx.answerCallbackQuery();
    updateSession(ctx.from.id, { onboardingStep: "awaiting_subcategory", pendingCategory: "Bihar Govt Exams" });
    await ctx.editMessageText("🗺️ *Bihar Govt Exams* — Choose your sub\\-category:", {
      parse_mode: "MarkdownV2", reply_markup: biharSubKeyboard(),
    });
  });

  bot.callbackQuery("back_main", async (ctx) => {
    await ctx.answerCallbackQuery();
    updateSession(ctx.from.id, { onboardingStep: "idle", pendingCategory: undefined });
    await ctx.editMessageText(WELCOME_MSG, { parse_mode: "MarkdownV2", reply_markup: mainCategoryKeyboard() });
  });

  bot.callbackQuery(/^sub_/, async (ctx) => {
    try {
      await ctx.answerCallbackQuery();
      const data = ctx.callbackQuery.data.slice(4);
      const underscoreIdx = data.indexOf("_");
      const mainCategory = data.slice(0, underscoreIdx);
      const subCategory = data.slice(underscoreIdx + 1).replace(/_/g, " ");
      const userId = ctx.from.id;

      await db.update(usersTable)
        .set({ targetExamMain: mainCategory, targetExamSub: subCategory })
        .where(eq(usersTable.userId, userId));

      updateSession(userId, { onboardingStep: "idle", pendingCategory: undefined });

      await ctx.editMessageText(
        `✅ *Profile Complete\\!*\n\nYour target is set to: *${escMd(subCategory)}*\n\nYou now have access to all mock tests, detailed solutions, and premium resources for this exam\\.\n\nUse /test\\_series to start practicing\\.`,
        { parse_mode: "MarkdownV2" }
      );
    } catch (err) {
      logger.error({ err }, "Error in sub_ callback");
    }
  });
}
