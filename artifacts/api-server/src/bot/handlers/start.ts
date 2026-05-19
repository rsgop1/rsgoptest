import type { Bot, Context } from "grammy";
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
import { logger } from "../../lib/logger.js";

const WELCOME_MSG = `🚀 *Welcome to Testbook\\+ Engine\\!*

Aapki exam preparation ko automate aur premium banane ke liye design kiya gaya hai\\.

👇 Pehle niche se apni main category chunein:`;

const DASHBOARD_MSG = (name: string, sub: string, tier: string) =>
  `👋 *Welcome back, ${escMd(name)}\\!*

🎯 Target Exam: *${escMd(sub)}*
💎 Tier: *${escMd(tier)}*

📚 Commands:
/test\\_series — Available mock tests
/notebook — Wrong questions notebook
/premium — Upgrade to Premium
/doubt — AI Doubt Solver \\(coming soon\\)`;

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

async function upsertUser(ctx: Context): Promise<void> {
  const from = ctx.from!;
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.userId, from.id))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(usersTable).values({
      userId: from.id,
      username: from.username ?? null,
      fullName: `${from.first_name}${from.last_name ? " " + from.last_name : ""}`,
      tier: "Free",
    });
  } else {
    await db
      .update(usersTable)
      .set({ username: from.username ?? null })
      .where(eq(usersTable.userId, from.id));
  }
}

export function registerStartHandlers(bot: Bot): void {
  bot.command("start", async (ctx) => {
    try {
      await upsertUser(ctx);
      const userId = ctx.from!.id;
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.userId, userId))
        .limit(1);

      if (user?.targetExamSub) {
        await ctx.reply(
          DASHBOARD_MSG(user.fullName, user.targetExamSub, user.tier),
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      updateSession(userId, { onboardingStep: "idle" });
      await ctx.reply(WELCOME_MSG, {
        parse_mode: "MarkdownV2",
        reply_markup: mainCategoryKeyboard(),
      });
    } catch (err) {
      logger.error({ err }, "Error in /start");
      await ctx.reply("❌ Kuch galat ho gaya. Dobara /start try karein.");
    }
  });

  bot.callbackQuery("cat_ssc", async (ctx) => {
    await ctx.answerCallbackQuery();
    updateSession(ctx.from.id, { onboardingStep: "awaiting_subcategory", pendingCategory: "SSC Exams" });
    await ctx.editMessageText("🏆 *SSC Exams* — Apni sub\\-category chunein:", {
      parse_mode: "MarkdownV2",
      reply_markup: sscSubKeyboard(),
    });
  });

  bot.callbackQuery("cat_railway", async (ctx) => {
    await ctx.answerCallbackQuery();
    updateSession(ctx.from.id, { onboardingStep: "awaiting_subcategory", pendingCategory: "Railway Exams" });
    await ctx.editMessageText("🚆 *Railway Exams* — Apni sub\\-category chunein:", {
      parse_mode: "MarkdownV2",
      reply_markup: railwaySubKeyboard(),
    });
  });

  bot.callbackQuery("cat_banking", async (ctx) => {
    await ctx.answerCallbackQuery();
    updateSession(ctx.from.id, { onboardingStep: "awaiting_subcategory", pendingCategory: "Banking Exams" });
    await ctx.editMessageText("🏢 *Banking Exams* — Apni sub\\-category chunein:", {
      parse_mode: "MarkdownV2",
      reply_markup: bankingSubKeyboard(),
    });
  });

  bot.callbackQuery("cat_bihar", async (ctx) => {
    await ctx.answerCallbackQuery();
    updateSession(ctx.from.id, { onboardingStep: "awaiting_subcategory", pendingCategory: "Bihar Govt Exams" });
    await ctx.editMessageText("🗺️ *Bihar Govt Exams* — Apni sub\\-category chunein:", {
      parse_mode: "MarkdownV2",
      reply_markup: biharSubKeyboard(),
    });
  });

  bot.callbackQuery("back_main", async (ctx) => {
    await ctx.answerCallbackQuery();
    updateSession(ctx.from.id, { onboardingStep: "idle", pendingCategory: undefined });
    await ctx.editMessageText(WELCOME_MSG, {
      parse_mode: "MarkdownV2",
      reply_markup: mainCategoryKeyboard(),
    });
  });

  bot.callbackQuery(/^sub_/, async (ctx) => {
    try {
      await ctx.answerCallbackQuery();
      const data = ctx.callbackQuery.data;
      const parts = data.slice(4).split("_");
      const mainCategory = parts[0] ?? "";
      const subCategory = parts.slice(1).join(" ");

      const userId = ctx.from.id;
      await db
        .update(usersTable)
        .set({ targetExamMain: mainCategory, targetExamSub: subCategory })
        .where(eq(usersTable.userId, userId));

      updateSession(userId, { onboardingStep: "idle", pendingCategory: undefined });

      await ctx.editMessageText(
        `✅ *Profile Complete\\!* Aapka target set ho gaya hai: *${escMd(subCategory)}*\\.\n\nAb aap is exam se jude saare premium resources, high\\-level mock test engines aur detailed solutions use kar sakte hain\\.\n\nUse /test\\_series to check live mocks or /start to view your dashboard\\.`,
        { parse_mode: "MarkdownV2" }
      );
    } catch (err) {
      logger.error({ err }, "Error in sub_ callback");
    }
  });
}
