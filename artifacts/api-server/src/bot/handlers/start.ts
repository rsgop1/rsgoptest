import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import { usersTable, testSeriesTable, purchasedTestsTable, liveTestsTable, userHistoryTable, wrongQuestionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  mainCategoryKeyboard,
  sscSubKeyboard,
  railwaySubKeyboard,
  bankingSubKeyboard,
  biharSubKeyboard,
  testDetailWithStartKeyboard,
  paymentKeyboard,
} from "../keyboards.js";
import { getSession, updateSession } from "../session.js";
import { handleChallengeStart } from "./challenge.js";
import { handleCustomSetDeepLink } from "./custom-test.js";
import { getConfig } from "./helpers.js";
import { trySetGroupTitles } from "./achievements.js";
import { logger } from "../../lib/logger.js";
import { emitTelemetry } from "../../lib/telemetry.js";

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

const WELCOME_MSG = `🚀 *Welcome to Series TestPro\\!*

Your exam preparation, automated and supercharged\\.

👇 Select your main exam category below:`;

function dashboardMsg(name: string, sub: string, tier: string, refLink: string): string {
  const premiumLine = tier === "Premium"
    ? "💎 *Premium*"
    : "🆓 Free — /premium to upgrade";
  return `👋 *Welcome back, ${escMd(name)}\\!*

🎯 Target: *${escMd(sub)}*
🏅 Tier: ${premiumLine}

📚 *Commands:*
/test\\_series — Browse & start mock tests
/createtest — 🧪 Create test from your PDF \\(Premium\\)
/mysets — 📂 View your custom test sets
/leaderboard — Top performers ranking
/stats — Your performance analytics
/notebook — Practice wrong questions
/challenge — Start a group challenge
/premium — Upgrade to Premium
/doubt — AI Doubt Solver
/ai\_tutor — Interactive AI Tutor
/dashboard — Profile & progress dashboard
/anon — Post anonymous doubt in group

👥 *Your Referral Link:*
\`${escMd(refLink)}\``;
}

async function upsertUser(
  userId: number, firstName: string, lastName: string | undefined,
  username: string | undefined, referredBy?: number
): Promise<boolean> {
  const existing = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
  if (existing.length === 0) {
    const trialExpiry = new Date();
    trialExpiry.setDate(trialExpiry.getDate() + 1);
    await db.insert(usersTable).values({
      userId,
      username: username ?? null,
      fullName: `${firstName}${lastName ? " " + lastName : ""}`,
      tier: "Premium",
      premiumExpiry: trialExpiry,
      referredBy: referredBy ?? null,
    });
    if (referredBy) {
      await db.update(usersTable)
        .set({ referralCount: sql`${usersTable.referralCount} + 1` })
        .where(eq(usersTable.userId, referredBy))
        .catch(() => {});
    }
    emitTelemetry(`New user joined: ${firstName} (ID: ${userId})`);
    return true;
  } else {
    await db.update(usersTable).set({ username: username ?? null }).where(eq(usersTable.userId, userId));
    return false;
  }
}

export async function checkForceSubStatus(userId: number): Promise<{ allowed: boolean; channel: string }> {
  try {
    const forceSub = await getConfig("force_sub_enabled");
    if (forceSub !== "true") return { allowed: true, channel: "" };
    const channel = await getConfig("force_sub_channel");
    if (!channel) return { allowed: true, channel: "" };

    const { getApi } = await import("../api-instance.js");
    const api = getApi();

    let channelId: string | number = channel.trim();
    if (!channelId.startsWith("@")) {
      const num = Number(channelId);
      channelId = isNaN(num) ? channelId : num;
    }

    const member = await api.getChatMember(channelId as string, userId);
    const allowed = member.status === "member" || member.status === "creator" || member.status === "administrator";
    return { allowed, channel };
  } catch (err) {
    logger.warn({ err }, "Force sub check failed — blocking user as safe default");
    const channel = await getConfig("force_sub_channel") ?? "";
    return { allowed: false, channel };
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

      if (param.startsWith("livetestjoin_")) {
        const liveTestId = parseInt(param.replace("livetestjoin_", ""), 10);
        await upsertUser(from.id, from.first_name, from.last_name, from.username);
        if (isNaN(liveTestId)) { await ctx.reply("❌ Invalid live test link."); return; }
        const [liveTest] = await db.select().from(liveTestsTable).where(eq(liveTestsTable.id, liveTestId)).limit(1);
        if (!liveTest) { await ctx.reply("❌ Live test not found."); return; }
        if (liveTest.status === "completed") { await ctx.reply("❌ This live test has already ended."); return; }
        if (liveTest.status === "live") { await ctx.reply("⚠️ This live test has already started!"); return; }
        const participants = (liveTest.participants ?? []) as number[];
        if (participants.includes(from.id)) {
          const schedTime = new Date(liveTest.scheduledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
          await ctx.reply(`✅ You're already registered!\n\n📝 *${escMd(liveTest.title)}*\n⏰ Starts: *${escMd(schedTime)} IST*`, { parse_mode: "MarkdownV2" });
          return;
        }
        participants.push(from.id);
        await db.update(liveTestsTable).set({ participants }).where(eq(liveTestsTable.id, liveTestId));
        const schedTime = new Date(liveTest.scheduledAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
        await ctx.reply(
          `✅ *Joined Live Test\\!*\n\n📝 *${escMd(liveTest.title)}*\n⏰ Starts: *${escMd(schedTime)} IST*\n\n_Questions will be sent to your DM automatically when the test begins\\. Stay tuned\\!_ 🎯`,
          { parse_mode: "MarkdownV2" }
        );
        return;
      }

      if (param.startsWith("customset_")) {
        const shareToken = param.replace("customset_", "");
        await upsertUser(from.id, from.first_name, from.last_name, from.username);
        await handleCustomSetDeepLink(from.id, shareToken);
        return;
      }

      if (param.startsWith("test_")) {
        const testId = param.replace("test_", "");
        await upsertUser(from.id, from.first_name, from.last_name, from.username);

        const { allowed, channel } = await checkForceSubStatus(from.id);
        if (!allowed) {
          const joinUrl = channel.startsWith("@")
            ? `https://t.me/${channel.replace("@", "")}`
            : `https://t.me/c/${channel.replace("-100", "")}`;
          const joinKb = new InlineKeyboard().url("👉 Join Channel", joinUrl);
          await ctx.reply(
            `🔒 *Channel Membership Required*\n\nJoin our channel first:\n${escMd(channel)}\n\nAfter joining, come back and try again\\.`,
            { parse_mode: "MarkdownV2", reply_markup: joinKb }
          );
          return;
        }

        const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
        if (!test) {
          await ctx.reply("❌ Test not found. Use /test_series to browse available tests.");
          return;
        }

        const [user] = await db.select({ tier: usersTable.tier }).from(usersTable).where(eq(usersTable.userId, from.id)).limit(1);
        const isPremium = user?.tier === "Premium";
        const isFree = test.priceInr === 0 && test.priceInStars === 0;
        const [purchased] = await db.select().from(purchasedTestsTable)
          .where(eq(purchasedTestsTable.userId, from.id))
          .limit(1);
        const hasPurchased = !!purchased;
        const hasAccess = isFree || isPremium || hasPurchased;

        const qCount = Array.isArray(test.questionsData) ? (test.questionsData as unknown[]).length : 0;
        const botUsername = ctx.me.username ?? "gt_testprobot";
        const shareLink = `https://t.me/${botUsername}?start=test_${testId}`;

        await ctx.reply(
          `📋 *${escMd(test.testName.trim())}*\n\n` +
          `📁 ${escMd(test.mainCategory)} → ${escMd(test.subCategory)}\n` +
          `📝 Questions: *${qCount}*\n` +
          `⏱️ Timer: *${test.timerSeconds ?? 30}s* per question\n` +
          `➕ Correct: *\\+${escMd(String(test.positiveMarking))}*   ➖ Wrong: *\\-${escMd(String(test.negativeMarking))}*\n` +
          `💵 ${isFree ? "✅ Free" : `💰 ₹${test.priceInr}`}\n\n` +
          `🔗 *Shareable Link:*\n\`${escMd(shareLink)}\`\n\n` +
          (hasAccess ? `Tap *Start Test* to begin\\!` : `❌ *You don't have access to this test\\.*`),
          {
            parse_mode: "MarkdownV2",
            reply_markup: hasAccess ? testDetailWithStartKeyboard(testId) : undefined,
          }
        );

        if (!hasAccess) {
          await ctx.reply(
            `🔒 *Unlock to Access This Test*\n\nChoose a payment method to get instant access:`,
            { parse_mode: "MarkdownV2", reply_markup: paymentKeyboard(testId, test.priceInr, test.priceInStars) }
          );
        }
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

      const { allowed, channel } = await checkForceSubStatus(from.id);
      if (!allowed) {
        const joinUrl = channel.startsWith("@")
          ? `https://t.me/${channel.replace("@", "")}`
          : `https://t.me/c/${channel.replace("-100", "")}`;
        const joinKb = new InlineKeyboard().url("👉 Join Channel", joinUrl);
        await ctx.reply(
          `🔒 *Channel Membership Required*\n\nJoin our official channel to use Series TestPro:\n${escMd(channel)}\n\nAfter joining, send /start to continue\\.`,
          { parse_mode: "MarkdownV2", reply_markup: joinKb }
        );
        return;
      }

      if (isNew) {
        updateSession(from.id, { onboardingStep: "idle" });
        if (referredBy) {
          await ctx.reply(`🎉 You joined via a referral link\\!\n\nWelcome to *Series TestPro\\!*`, { parse_mode: "MarkdownV2" });
        }

        // Enhanced welcome sequence — slide 1: category selection
        await ctx.reply(WELCOME_MSG, { parse_mode: "MarkdownV2", reply_markup: mainCategoryKeyboard() });

        // Slide 2: premium trial
        await ctx.reply(
          `🎁 *1\\-Day Premium Trial Activated\\!*\n\nWelcome gift from Series TestPro 🎉\n\n✅ All tests unlocked for 24 hours\n✅ AI Info enabled\n✅ No ads\n✅ Custom timer\n✅ AI Doubt Solver unlimited\n\n_Trial expires in 24 hours\\. Use /premium to keep access\\._`,
          { parse_mode: "MarkdownV2" }
        );

        // Slide 3: quick commands overview
        const startKb = new InlineKeyboard()
          .text("📚 Browse Tests", "go_test_series")
          .text("🧪 Create Custom Test", "ctest_entry");
        await ctx.reply(
          `🚀 *Ready to Start\\!*\n\n` +
          `Here's what you can do right now:\n\n` +
          `📚 /test\\_series — Browse all tests\n` +
          `🎯 /createtest — Create test from PDF \\(Premium\\)\n` +
          `🤖 /ai\\_tutor — AI doubt solver\n` +
          `📊 /stats — Track your progress\n\n` +
          `_Select an option below or use commands anytime\\._`,
          { parse_mode: "MarkdownV2", reply_markup: startKb }
        );
      } else {
        const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, from.id)).limit(1);
        const sub = user?.targetExamSub ?? "Not set";
        const tier = user?.tier ?? "Free";
        await ctx.reply(dashboardMsg(from.first_name, sub, tier, refLink), { parse_mode: "MarkdownV2" });
        await trySetGroupTitles(from.id).catch(() => {});
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

  bot.callbackQuery("cat_back_main", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(WELCOME_MSG, { parse_mode: "MarkdownV2", reply_markup: mainCategoryKeyboard() });
  });

  //
  // /dashboard — single-message edit with profile, stats & wallet
  //
  bot.command("dashboard", async (ctx) => {
    try {
      const userId = ctx.from!.id;
      const [user] = await db.select().from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
      if (!user) {
        await ctx.reply("❌ Profile not found. Send /start first.");
        return;
      }

      const botUsername = ctx.me.username ?? "gt_testprobot";
      const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;
      const tierLabel = user.tier === "Premium" ? "💎 Premium" : "🆓 Free";
      const sub = user.targetExamSub ?? "Not set";

      const historyCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(userHistoryTable)
        .where(eq(userHistoryTable.userId, userId))
        .then(r => r[0]?.count ?? 0);

      const avgAccuracy = await db
        .select({
          acc: sql<number>`COALESCE(ROUND(AVG(accuracy)::numeric, 1), 0)::float`,
        })
        .from(userHistoryTable)
        .where(eq(userHistoryTable.userId, userId))
        .then(r => r[0]?.acc ?? 0);

      const wrongCount = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(wrongQuestionsTable)
        .where(eq(wrongQuestionsTable.userId, userId))
        .then(r => r[0]?.count ?? 0);

      const aiLimit = user.tier === "Premium" ? "♾️ Unlimited" : `2/day (used: ${user.aiDoubtCount ?? 0})`;
      const coins = user.referralCount ?? 0;

      const dashKb = new InlineKeyboard()
        .text("📚 Test Series", "go_test_series")
        .text("📊 Stats", "dash_stats")
        .row()
        .text("🤖 AI Tutor", "dash_ai")
        .text("🧪 Create Test", "ctest_entry")
        .row()
        .text("👥 Referral", "dash_ref")
        .text(tierLabel.includes("Premium") ? "⚙️ Account" : "💎 Upgrade", tierLabel.includes("Premium") ? "dash_account" : "premium_upi");

      await ctx.reply(
        `👋 *${escMd(ctx.from!.first_name)}'s Dashboard*\n\n` +
        `🎯 *${escMd(sub)}*  •  ${tierLabel}\n\n` +
        `📝 Tests Attempted: *${historyCount}*\n` +
        `🎯 Avg\\. Accuracy: *${avgAccuracy}%*\n` +
        `📓 Wrong Q\\. in Notebook: *${wrongCount}*\n` +
        `🤖 AI Doubts: *${aiLimit}*\n` +
        `🪙 Referral Coins: *${coins}*\n\n` +
        `👥 *Your Referral Link:*\n\`${escMd(refLink)}\``,
        { parse_mode: "MarkdownV2", reply_markup: dashKb }
      );
    } catch (err) {
      logger.error({ err }, "/dashboard error");
      await ctx.reply("❌ Error loading dashboard.");
    }
  });

  // Dashboard sub-actions
  bot.callbackQuery("dash_stats", async (ctx) => {
    await ctx.answerCallbackQuery();
    ctx.match = ""; // dummy so /stats can reuse
    // Forward to stats
    const { registerStatsHandlers } = await import("./stats.js");
    await ctx.reply("📊 Tap /stats to view detailed analytics.", { parse_mode: "MarkdownV2" });
  });

  bot.callbackQuery("dash_ai", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("🤖 Tap /doubt to ask AI or use /ai_tutor for a dedicated AI session.", { parse_mode: "MarkdownV2" });
  });

  bot.callbackQuery("dash_ref", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const botUsername = ctx.me.username ?? "gt_testprobot";
    const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;
    await ctx.reply(
      `👥 *Refer & Earn*\n\nShare your link and earn rewards\\!\n\n🔗 \`${escMd(refLink)}\`\n\n_When someone joins via your link, you get Referral Coins!\\._`,
      { parse_mode: "MarkdownV2" }
    );
  });

  //
  // /ai_tutor — dedicated AI doubt solver session
  //
  bot.command("ai_tutor", async (ctx) => {
    const userId = ctx.from!.id;
    const [user] = await db.select({ tier: usersTable.tier, aiDoubtCount: usersTable.aiDoubtCount, aiDoubtDate: usersTable.aiDoubtDate }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);

    if (!user) {
      await ctx.reply("❌ Please /start first.");
      return;
    }

    // Check daily limit for free users
    if (user.tier !== "Premium") {
      const today = new Date().toISOString().slice(0, 10);
      const lastDate = user.aiDoubtDate ?? "";
      const count = lastDate === today ? (user.aiDoubtCount ?? 0) : 0;

      if (count >= 2) {
        const kb = new InlineKeyboard().text("💎 Upgrade to Premium", "premium_upi");
        await ctx.reply(
          "🤖 *AI Tutor — Daily Limit Reached*\n\n" +
          "Free users get *2 AI doubts per day*\\.\nYou've used all your doubts for today\\!\n\n" +
          "💎 Upgrade to Premium for unlimited AI access\\.",
          { parse_mode: "MarkdownV2", reply_markup: kb }
        );
        return;
      }
    }

    updateSession(userId, { pendingAiTutor: true });
    await ctx.reply(
      `🧠 *AI Tutor* — Your Personal Study Assistant\n\n` +
      `Ask me anything about your exam preparation\\!\n\n` +
      `I can help with:\n` +
      `📖 Concept explanations\n` +
      `🔍 Doubt solving from any topic\n` +
      `📝 Practice question generation\n` +
      `💡 Study tips & strategies\n\n` +
      `_Type your question below or use /doubt <question>_\n` +
      (user.tier !== "Premium" ? `_Free: 2 doubts/day — Upgrade to Premium for unlimited_\n` : `_♾️ Unlimited for Premium users_\n`) +
      `_Send /cancel to stop_`,
      { parse_mode: "MarkdownV2" }
    );
  });

  // ctest_entry — entry to custom test creation
  bot.callbackQuery("ctest_entry", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const [user] = await db.select({ tier: usersTable.tier }).from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
    if (user?.tier === "Premium") {
      const { getSession, updateSession } = await import("../session.js");
      updateSession(userId, { pendingCustomTest: { step: "awaiting_language" } });
      try { await ctx.deleteMessage(); } catch {}
      const kb = new InlineKeyboard()
        .text("🇮🇳 Hindi", "ctest_lang_hi").text("🇬🇧 English", "ctest_lang_en").row()
        .text("❌ Cancel", "ctest_cancel");
      await ctx.reply(
        "🧪 *Create Your Own Test*\n\nUpload any PDF and AI will generate a custom test for you\\!\n\n*Step 1 of 3:* Choose the language:",
        { parse_mode: "MarkdownV2", reply_markup: kb }
      );
    } else {
      await ctx.reply(
        "🔒 *Premium Feature*\n\nUpload any PDF and AI will generate a personalized test\\!\n👉 Use /premium to upgrade\\!",
        { parse_mode: "MarkdownV2" }
      );
    }
  });

  bot.callbackQuery(/^cat_sub_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const raw = ctx.callbackQuery.data.replace("cat_sub_", "");
    const parts = raw.split("_");
    const main = parts[0] ?? "SSC";
    const sub = parts.slice(1).join(" ");

    const mainFull =
      main === "SSC" ? "SSC Exams" :
      main === "Railway" ? "Railway Exams" :
      main === "Banking" ? "Banking Exams" :
      main === "Bihar" ? "Bihar Govt Exams" : main;

    await db.update(usersTable).set({ targetExamMain: mainFull, targetExamSub: sub }).where(eq(usersTable.userId, userId));
    updateSession(userId, { onboardingStep: "idle", pendingCategory: undefined });

    const botUsername = ctx.me.username ?? "gt_testprobot";
    const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

    await ctx.editMessageText(
      `✅ *Target set: ${escMd(sub)}*\n\n🎉 Welcome to *Series TestPro\\!*\n\nYour exam preparation starts now\\.\n\n👥 *Your Referral Link:*\n\`${escMd(refLink)}\`\n\n📚 Use /test\\_series to start practicing\\!`,
      { parse_mode: "MarkdownV2" }
    );
  });
}
