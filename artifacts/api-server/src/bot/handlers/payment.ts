import type { Bot } from "grammy";
import { db } from "@workspace/db";
import {
  paymentsTable,
  usersTable,
  testSeriesTable,
  purchasedTestsTable,
  flashSalesTable,
} from "@workspace/db";
import { eq, and, lte, gte } from "drizzle-orm";
import { getSession, updateSession } from "../session.js";
import { getConfig } from "./helpers.js";
import { logger } from "../../lib/logger.js";
import { randomUUID } from "crypto";

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

async function getAdminUpi(): Promise<string> {
  const configured = await getConfig("admin_upi_vpa");
  return configured ?? "8102289714@ptyes";
}

async function getEffectivePrice(testId: string, priceInr: number, priceInStars: number): Promise<{ inr: number; stars: number; isOnSale: boolean }> {
  const now = new Date();
  const sale = await db
    .select()
    .from(flashSalesTable)
    .where(and(
      eq(flashSalesTable.testId, testId),
      eq(flashSalesTable.isActive, true),
      lte(flashSalesTable.createdAt, now),
      gte(flashSalesTable.endsAt, now),
    ))
    .limit(1);

  if (sale.length) {
    return { inr: sale[0]!.discountInr, stars: sale[0]!.discountStars, isOnSale: true };
  }
  return { inr: priceInr, stars: priceInStars, isOnSale: false };
}

function scheduleCartAbandonment(bot: Bot, userId: number, amount: number, testId?: string): ReturnType<typeof setTimeout> {
  return setTimeout(async () => {
    const session = getSession(userId);
    if (!session.pendingUpiPayment) return;

    const discountAmount = Math.round(amount * 0.9);
    const adminUpi = await getAdminUpi();

    try {
      await bot.api.sendMessage(
        userId,
        `💸 *Payment Incomplete\\?*\n\nWe noticed you generated a payment QR but haven't completed the transaction yet\\.\n\n🎁 *Special Offer:* Pay *₹${discountAmount}* instead of *₹${amount}* \\(10% OFF\\!\\)\n\nThis offer is valid for the next *5 minutes* only\\!\n\n🏦 UPI ID: \`${escMd(adminUpi)}\`\n\nSend screenshot after payment to unlock instantly\\! ⚡`,
        { parse_mode: "MarkdownV2" }
      );
    } catch (err) {
      logger.warn({ err, userId }, "Cart abandonment message failed");
    }
  }, 3 * 60 * 1000);
}

export function registerPaymentHandlers(bot: Bot): void {
  bot.callbackQuery(/^pay_upi_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("pay_upi_", "");
    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);

    if (!test || test.priceInr <= 0) {
      await ctx.reply("❌ UPI payment is not available for this test.");
      return;
    }

    const userId = ctx.from.id;
    const { inr, isOnSale } = await getEffectivePrice(testId, test.priceInr, test.priceInStars);
    const saleTag = isOnSale ? " 🔥 *SALE PRICE*" : "";
    const adminUpi = await getAdminUpi();

    const cartTimer = scheduleCartAbandonment(bot, userId, inr, testId);
    updateSession(userId, { pendingUpiPayment: { testId, isPremium: false, amount: inr, cartAbandonTimer: cartTimer } });

    await ctx.reply(
      `💳 *PAY VIA UPI*${saleTag}\n\n` +
      `📦 Test: *${escMd(test.testName)}*\n` +
      `💰 Amount: *₹${inr}*\n\n` +
      `🏦 UPI ID: \`${escMd(adminUpi)}\`\n\n` +
      `*Steps:*\n` +
      `1\\. Open PhonePe / GPay / Paytm\n` +
      `2\\. Send *₹${inr}* to: \`${escMd(adminUpi)}\`\n` +
      `3\\. Note/Remark: \`User\\_${userId}\\_Test\\_${escMd(testId)}\`\n` +
      `4\\. Take a screenshot showing UTR/Transaction ID\n` +
      `5\\. Send that screenshot *in this chat*\n\n` +
      `⚠️ Your test will be unlocked after admin verification\\.`,
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.callbackQuery(/^pay_stars_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("pay_stars_", "");
    const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);

    if (!test || test.priceInStars <= 0) {
      await ctx.reply("❌ Stars payment is not configured for this test.");
      return;
    }

    const { stars, isOnSale } = await getEffectivePrice(testId, test.priceInr, test.priceInStars);

    try {
      await ctx.api.sendInvoice(
        ctx.from.id,
        test.testName,
        `Unlocks "${test.testName}" with detailed solutions and scorecard analytics.`,
        `test_${testId}_${ctx.from.id}_${Date.now()}`,
        "XTR",
        [{ label: isOnSale ? "Sale Price" : "Test Access", amount: stars }],
        { provider_token: "" }
      );
    } catch (err) {
      logger.error({ err }, "Stars invoice error");
      const adminUpi = await getAdminUpi();
      await ctx.reply(
        `⚠️ *Telegram Stars payment failed\\.*\n\nPossible reasons:\n• Stars payments not enabled for this bot \\(enable via BotFather → Payments\\)\n• Invalid price configuration\n\nPlease use UPI payment instead\\.\nUPI ID: \`${escMd(adminUpi)}\``,
        { parse_mode: "MarkdownV2" }
      );
    }
  });

  bot.callbackQuery("premium_upi", async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const adminUpi = await getAdminUpi();
    const cartTimer = scheduleCartAbandonment(bot, userId, 199);
    updateSession(userId, { pendingUpiPayment: { isPremium: true, amount: 199, cartAbandonTimer: cartTimer } });

    await ctx.reply(
      `💳 *PAY VIA UPI — PREMIUM UPGRADE*\n\n` +
      `💎 Plan: *30 Days Premium Access*\n` +
      `💰 Amount: *₹199*\n\n` +
      `🏦 UPI ID: \`${escMd(adminUpi)}\`\n\n` +
      `*Steps:*\n` +
      `1\\. Open PhonePe / GPay / Paytm\n` +
      `2\\. Send *₹199* to: \`${escMd(adminUpi)}\`\n` +
      `3\\. Note/Remark: \`Premium\\_${userId}\`\n` +
      `4\\. Take a clear screenshot showing UTR/Transaction ID\n` +
      `5\\. Send that screenshot *in this chat*\n\n` +
      `⚠️ Premium will be activated after admin verifies your payment\\.`,
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.callbackQuery("premium_stars", async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.api.sendInvoice(
        ctx.from.id,
        "Testbook+ Premium — 30 Days",
        "Unlocks ALL mock tests, AI Info Solver, and premium analytics for 30 Days.",
        `premium_30days_${ctx.from.id}_${Date.now()}`,
        "XTR",
        [{ label: "Premium 30 Days", amount: 500 }],
        { provider_token: "" }
      );
    } catch (err) {
      logger.error({ err }, "Stars premium invoice error");
      const adminUpi = await getAdminUpi();
      await ctx.reply(
        `⚠️ *Stars payment failed\\.*\n\nPlease use UPI payment instead\\.\n\nUPI ID: \`${escMd(adminUpi)}\`\nAmount: *₹199*`,
        { parse_mode: "MarkdownV2" }
      );
    }
  });

  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on("message:successful_payment", async (ctx) => {
    const payment = ctx.message.successful_payment!;
    const userId = ctx.from!.id;
    const payload = payment.invoice_payload;

    try {
      const isPremium = payload.startsWith("premium_");
      const testId = isPremium ? null : payload.split("_")[1] ?? null;

      await db.insert(paymentsTable).values({
        paymentId: randomUUID(),
        userId,
        method: "TG_Stars",
        amount: payment.total_amount,
        testId,
        status: "Approved",
      });

      if (isPremium) {
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 30);
        await db.update(usersTable).set({ tier: "Premium", premiumExpiry: expiry }).where(eq(usersTable.userId, userId));
        await ctx.reply(
          `✅ *Payment Successful\\!*\n\n💎 *Testbook\\+ Premium* is now active\\!\n📅 Valid till: *${escMd(expiry.toLocaleDateString("en-IN"))}*\n\nUse /test\\_series to access all tests\\.`,
          { parse_mode: "MarkdownV2" }
        );
      } else if (testId) {
        await db.insert(purchasedTestsTable).values({ userId, testId }).catch(() => {});
        const [test] = await db.select().from(testSeriesTable).where(eq(testSeriesTable.testId, testId)).limit(1);
        await ctx.reply(
          `✅ *Payment Successful\\!*\n\n🔓 *${escMd(test?.testName ?? testId)}* is now unlocked\\!\n\nUse /test\\_series to start the test\\.`,
          { parse_mode: "MarkdownV2" }
        );
      }
    } catch (err) {
      logger.error({ err }, "Stars payment processing error");
    }
  });

  bot.on("message:photo", async (ctx, next) => {
    const userId = ctx.from!.id;
    const session = getSession(userId);
    if (!session.pendingUpiPayment) return next();

    const pending = session.pendingUpiPayment;
    if (pending.cartAbandonTimer) {
      clearTimeout(pending.cartAbandonTimer);
    }
    const photos = ctx.message.photo!;
    const bestPhoto = photos[photos.length - 1]!;

    try {
      await db.insert(paymentsTable).values({
        paymentId: randomUUID(),
        userId,
        method: "UPI",
        amount: pending.amount,
        testId: pending.testId ?? null,
        screenshotFileId: bestPhoto.file_id,
        status: "Pending",
      });

      updateSession(userId, { pendingUpiPayment: undefined });

      await ctx.reply(
        `📥 *Screenshot Received\\!* ✅\n\nYour payment is under review\\.\n\nYour ${pending.isPremium ? "Premium tier" : "test"} will be unlocked automatically once the admin verifies your payment\\. This usually takes a few minutes\\.`,
        { parse_mode: "MarkdownV2" }
      );
    } catch (err) {
      logger.error({ err }, "Error saving UPI screenshot");
      await ctx.reply("❌ Error saving screenshot. Please try again.");
    }
  });
}
