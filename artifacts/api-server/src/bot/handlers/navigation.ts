import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import { testSeriesTable, userHistoryTable, usersTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { getApi } from "../api-instance.js";
import { getSession, updateSession } from "../session.js";
import { clearQuizPolls } from "./quiz.js";
import { createVipInvite } from "./vip.js";

export function homeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📚 Test Series", "nav_tests").text("🧪 Create Test", "nav_create").row()
    .text("📊 Dashboard", "nav_dashboard").text("👤 Profile", "nav_profile").row()
    .text("🧠 Agentic AI", "agentic_open").text("📓 Notebook", "nav_notebook").row()
    .text("🏆 Leaderboard", "nav_leaderboard").text("🔴 Live Tests", "nav_live").row()
    .text("💎 Premium", "nav_premium").text("💬 Support", "nav_support").row()
    .text("💎 VIP Group", "nav_vip");
}

function homeText(firstName: string, tier: string, daysLeft: number): string {
  const premium = tier === "Premium"
    ? `💎 Premium active · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
    : "🆓 Free plan · Upgrade for the full experience";
  return `✨ *Series TestPro Study Hub*\n\nHey ${firstName} 👋\n${premium}\n\nChoose what you want to do today:`;
}

async function edit(ctx: any, text: string, keyboard?: InlineKeyboard): Promise<void> {
  try {
    await ctx.editMessageText(text, { parse_mode: "Markdown", reply_markup: keyboard });
  } catch {
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: keyboard });
  }
}

async function home(ctx: any): Promise<void> {
  const [user] = await db.select({ firstName: usersTable.fullName, tier: usersTable.tier, premiumExpiry: usersTable.premiumExpiry })
    .from(usersTable).where(eq(usersTable.userId, ctx.from.id)).limit(1);
  const daysLeft = user?.premiumExpiry && user.premiumExpiry > new Date()
    ? Math.max(0, Math.ceil((user.premiumExpiry.getTime() - Date.now()) / 86400000)) : 0;
  await edit(ctx, homeText(user?.firstName?.split(" ")[0] ?? ctx.from.first_name, user?.tier ?? "Free", daysLeft), homeKeyboard());
}

export async function showHomeForUser(ctx: any): Promise<void> {
  await home(ctx);
}

export function registerNavigationHandlers(bot: Bot): void {
  bot.command("menu", async (ctx) => {
    await home(ctx);
  });

  bot.callbackQuery("nav_home", async (ctx) => {
    await ctx.answerCallbackQuery();
    await home(ctx);
  });

  bot.callbackQuery("nav_tests", async (ctx) => {
    await ctx.answerCallbackQuery();
    const tests = await db.select().from(testSeriesTable).where(eq(testSeriesTable.isActive, true)).limit(12);
    const kb = new InlineKeyboard();
    let text = "📚 *Mock Test Library*\n\nTap any test to start your focused practice session:\n\n";
    for (const test of tests) {
      const count = Array.isArray(test.questionsData) ? test.questionsData.length : 0;
      text += `📝 *${test.testName.trim()}* · ${count} questions\n`;
      kb.text(`🚀 ${test.testName.trim().slice(0, 28)}`, `start_test_${test.testId}`).row();
    }
    if (!tests.length) text += "No tests are published yet. Check back soon.";
    kb.text("🏠 Home", "nav_home");
    await edit(ctx, text, kb);
  });

  bot.callbackQuery("nav_dashboard", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
    const [attempts] = await db.select({ count: sql<number>`count(*)::int`, accuracy: sql<number>`coalesce(round(avg(${userHistoryTable.accuracy})::numeric, 1), 0)::float` })
      .from(userHistoryTable).where(eq(userHistoryTable.userId, userId));
    const wrong = await db.select({ count: sql<number>`count(*)::int` }).from(userHistoryTable).where(and(eq(userHistoryTable.userId, userId), eq(userHistoryTable.userId, userId)));
    const kb = new InlineKeyboard().text("📚 Practice", "nav_tests").text("📓 Notebook", "nav_notebook").row().text("🏠 Home", "nav_home");
    await edit(ctx, `📊 *Your Progress Dashboard*\n\n💎 Plan: ${user?.tier ?? "Free"}\n📝 Tests attempted: *${attempts?.count ?? 0}*\n🎯 Average accuracy: *${attempts?.accuracy ?? 0}%*\n📓 Keep building your streak with one focused test today\\.`, kb);
  });

  bot.callbackQuery("nav_profile", async (ctx) => {
    await ctx.answerCallbackQuery();
    const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, ctx.from.id)).limit(1);
    const active = !!user?.premiumExpiry && user.premiumExpiry > new Date();
    const expiry = active ? user!.premiumExpiry!.toLocaleDateString("en-IN") : "Not active";
    const kb = new InlineKeyboard().text(active ? "🔄 Renew Premium" : "💎 Upgrade Premium", active ? "renew_premium" : "premium_upi").row().text("🏠 Home", "nav_home");
    await edit(ctx, `👤 *Your Profile*\n\nName: ${user?.fullName ?? ctx.from.first_name}\nTarget exam: ${user?.targetExamSub ?? "Not set"}\nStatus: ${active ? "💎 Premium" : "🆓 Free"}\nValid till: ${expiry}\n\nPersonalize your preparation and keep improving every day\\.`, kb);
  });

  bot.callbackQuery("nav_premium", async (ctx) => {
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard().text("⭐ Stars", "premium_stars").row().text("💳 UPI", "premium_upi").row().text("🏠 Home", "nav_home");
    await edit(ctx, "💎 *Premium Study Experience*\n\n✅ All mock tests unlocked\n✅ Unlimited AI Tutor and AI Info\n✅ No ads before tests\n✅ Custom timers and advanced analytics\n✅ Personal VIP group access\n✅ Priority support\n\nChoose your secure payment method:", kb);
  });

  bot.callbackQuery("nav_ai", async (ctx) => {
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard().text("🧠 AI Tutor", "nav_ai_tutor").text("❓ Doubt Solver", "nav_doubt").row().text("📝 AI Practice", "ai_menu_questions").row().text("🏠 Home", "nav_home");
    await edit(ctx, "🤖 *AI Study Center*\n\nYour personal exam companion for concepts, doubts, explanations, and practice questions:", kb);
  });

  bot.callbackQuery("nav_ai_tutor", async (ctx) => {
    await ctx.answerCallbackQuery();
    updateSession(ctx.from.id, { pendingAiTutor: true });
    await edit(ctx, "🧠 *AI Tutor is ready*\n\nSend your question in the next message\\. I’ll explain it step by step for your exam\\.\n\n_Tap Home anytime to return to the Study Hub\\._", new InlineKeyboard().text("🏠 Home", "nav_home"));
  });

  bot.callbackQuery("nav_doubt", async (ctx) => {
    await ctx.answerCallbackQuery();
    await edit(ctx, "❓ *Doubt Solver ready*\n\nSend your doubt as your next message, or use `/doubt your question`.", new InlineKeyboard().text("🏠 Home", "nav_home"));
  });

  bot.callbackQuery("nav_create", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("🧪 *Create a Custom Test*\n\nTurn your PDF into a focused AI practice set with language, question count, and timer controls.", { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("🚀 Start Creating", "ctest_entry").row().text("🏠 Home", "nav_home") });
  });

  bot.callbackQuery("nav_vip", async (ctx) => {
    await ctx.answerCallbackQuery();
    const invite = await createVipInvite(ctx.from.id);
    const kb = new InlineKeyboard().text("💎 Premium Plans", "nav_premium").row().text("🏠 Home", "nav_home");
    await edit(ctx, invite
      ? `💎 *Your VIP Study Group*\n\nYour personal invite link is ready:\n\n${invite}\n\n⚠️ Do not forward this one-time link\\. Access ends with Premium expiry\\.`
      : "🔒 *VIP Group Access*\n\nActive Premium members get a personal invite to the exclusive study group\\. Upgrade Premium to unlock it\\.", kb);
  });

  bot.callbackQuery("nav_support", async (ctx) => {
    await ctx.answerCallbackQuery();
    await edit(ctx, "💬 *Support Center*\n\nTell us what you need help with in your next message\\. Our team will get back to you as soon as possible\\.", new InlineKeyboard().text("🏠 Home", "nav_home"));
  });

  bot.callbackQuery("nav_notebook", async (ctx) => {
    await ctx.answerCallbackQuery();
    await edit(ctx, "📓 *Solution Notebook*\n\nReview your wrong questions and turn mistakes into marks\\. Use `/notebook` to open your saved practice list\\.", new InlineKeyboard().text("📖 Open Notebook", "nav_notebook_open").row().text("🏠 Home", "nav_home"));
  });

  bot.callbackQuery("nav_notebook_open", async (ctx) => {
    await ctx.answerCallbackQuery();
    await edit(ctx, "📓 Opening your Solution Notebook\\.\\.\\.\n\nUse `/notebook` to browse and practice your saved questions\\.", new InlineKeyboard().text("🏠 Home", "nav_home"));
  });

  bot.callbackQuery("nav_leaderboard", async (ctx) => {
    await ctx.answerCallbackQuery();
    await edit(ctx, "🏆 *Leaderboard*\n\nCompete with fellow aspirants, improve your accuracy, and climb the rankings\\. Use `/leaderboard` to open the live ranking.", new InlineKeyboard().text("🏠 Home", "nav_home"));
  });

  bot.callbackQuery("nav_live", async (ctx) => {
    await ctx.answerCallbackQuery();
    await edit(ctx, "🔴 *Live Tests*\n\nJoin scheduled synchronized group tests and compete on a shared leaderboard\\. Use `/live` to view upcoming sessions.", new InlineKeyboard().text("🏠 Home", "nav_home"));
  });

  bot.callbackQuery("nav_stop", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Test stopped" });
    await clearQuizPolls(ctx.from.id);
    await home(ctx);
  });
}