import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import {
  paymentsTable,
  usersTable,
  testSeriesTable,
  purchasedTestsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { getSession, updateSession } from "../session.js";
import { getConfig } from "./helpers.js";
import { logger } from "../../lib/logger.js";
import { randomUUID } from "crypto";

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

async function generateUpiQr(upiVpa: string, amount: number, userId: number, testId: string): Promise<Buffer> {
  const upiString = `upi://pay?pa=${upiVpa}&pn=TestbookPlus&am=${amount}&cu=INR&tn=User_${userId}_Test_${testId}`;
  return await QRCode.toBuffer(upiString, { type: "png", width: 400, margin: 2 });
}

export function registerPaymentHandlers(bot: Bot): void {
  bot.callbackQuery(/^pay_stars_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("pay_stars_", "");
    const [test] = await db
      .select()
      .from(testSeriesTable)
      .where(eq(testSeriesTable.testId, testId))
      .limit(1);

    if (!test || test.priceInStars <= 0) {
      await ctx.reply("❌ Stars payment available nahi hai is test ke liye.");
      return;
    }

    await ctx.api.sendInvoice(
      ctx.from.id,
      test.testName,
      `Unlocks "${test.testName}" mock test with detailed solutions and scorecard analytics.`,
      `test_${testId}_${ctx.from.id}_${Date.now()}`,
      "",
      "XTR",
      [{ label: "Test Access", amount: test.priceInStars }]
    );
  });

  bot.callbackQuery(/^pay_upi_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const testId = ctx.callbackQuery.data.replace("pay_upi_", "");
    const [test] = await db
      .select()
      .from(testSeriesTable)
      .where(eq(testSeriesTable.testId, testId))
      .limit(1);

    if (!test || test.priceInr <= 0) {
      await ctx.reply("❌ UPI payment available nahi hai is test ke liye.");
      return;
    }

    const upiVpa = (await getConfig("admin_upi_vpa")) ?? "testbookplus@upi";
    const userId = ctx.from.id;

    try {
      const qrBuffer = await generateUpiQr(upiVpa, test.priceInr, userId, testId);
      updateSession(userId, {
        pendingUpiPayment: { testId, isPremium: false, amount: test.priceInr },
      });

      await ctx.api.sendPhoto(userId, new Uint8Array(qrBuffer) as any, {
        caption: `⚡ *SCAN & PAY VIA UPI*\n\n💰 Amount: *₹${test.priceInr}*\n📦 Test: *${escMd(test.testName)}*\n\n👉 Is QR Code ko scan karke kisi bhi UPI App \\(PhonePe, GooglePay, Paytm\\) se payment kijiye\\.\n\n⚠️ *IMPORTANT:* Payment karne ke baad, uska Clear Screenshot \\(jisme Transaction/UTR ID dikhe\\) *DIRECT is chat mein send kijiye* tabhi aapka test unlock hoga\\.`,
        parse_mode: "MarkdownV2",
      });
    } catch (err) {
      logger.error({ err }, "Error generating UPI QR");
      await ctx.reply("❌ QR generate karne mein error. Please admin se contact karein.");
    }
  });

  bot.callbackQuery("premium_stars", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.api.sendInvoice(
      ctx.from.id,
      "Testbook+ Premium Access",
      "Unlocks ALL mock tests, AI Doubt Solver, and premium analytics for 30 Days.",
      `premium_30days_${ctx.from.id}_${Date.now()}`,
      "",
      "XTR",
      [{ label: "Premium 30 Days", amount: 500 }]
    );
  });

  bot.callbackQuery("premium_upi", async (ctx) => {
    await ctx.answerCallbackQuery();
    const upiVpa = (await getConfig("admin_upi_vpa")) ?? "testbookplus@upi";
    const userId = ctx.from.id;

    try {
      const qrBuffer = await generateUpiQr(upiVpa, 199, userId, "premium");
      updateSession(userId, {
        pendingUpiPayment: { isPremium: true, amount: 199 },
      });

      await ctx.api.sendPhoto(userId, new Uint8Array(qrBuffer) as any, {
        caption: `⚡ *SCAN & PAY VIA UPI — PREMIUM*\n\n💰 Amount: *₹199*\n💎 Plan: *30 Days Premium Access*\n\n👉 Is QR Code ko scan karke kisi bhi UPI App se payment kijiye\\.\n\n⚠️ *IMPORTANT:* Payment ka Clear Screenshot \\(jisme UTR ID dikhe\\) *DIRECT is chat mein send kijiye*\\.`,
        parse_mode: "MarkdownV2",
      });
    } catch (err) {
      logger.error({ err }, "Error generating premium UPI QR");
      await ctx.reply("❌ QR generate karne mein error. Please admin se contact karein.");
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
      const paymentId = randomUUID();
      const isPremium = payload.startsWith("premium_");
      const testId = isPremium ? null : payload.split("_")[1] ?? null;

      await db.insert(paymentsTable).values({
        paymentId,
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
          `✅ *Payment Successful\\!*\n\n💎 Aapka *Testbook\\+ Premium* activate ho gaya hai\\!\n📅 Valid till: *${escMd(expiry.toLocaleDateString("en-IN"))}*\n\n/test\\_series se saare tests access karein\\.`,
          { parse_mode: "MarkdownV2" }
        );
      } else if (testId) {
        await db.insert(purchasedTestsTable).values({ userId, testId }).catch(() => {});
        const [test] = await db
          .select()
          .from(testSeriesTable)
          .where(eq(testSeriesTable.testId, testId))
          .limit(1);
        await ctx.reply(
          `✅ *Payment Successful\\!*\n\n🔓 *${escMd(test?.testName ?? testId)}* unlock ho gaya hai\\!\n\n/test\\_series se test start karein\\.`,
          { parse_mode: "MarkdownV2" }
        );
      }
    } catch (err) {
      logger.error({ err }, "Error processing Stars payment");
    }
  });

  bot.on("message:photo", async (ctx) => {
    const userId = ctx.from!.id;
    const session = getSession(userId);

    if (!session.pendingUpiPayment) return;

    const pending = session.pendingUpiPayment;
    const photos = ctx.message.photo!;
    const bestPhoto = photos[photos.length - 1]!;
    const fileId = bestPhoto.file_id;

    try {
      await db.insert(paymentsTable).values({
        paymentId: randomUUID(),
        userId,
        method: "UPI",
        amount: pending.amount,
        testId: pending.testId ?? null,
        screenshotFileId: fileId,
        status: "Pending",
      });

      updateSession(userId, { pendingUpiPayment: undefined });

      await ctx.reply(
        `📥 *Screenshot Received\\!* ✅\n\nAapka transaction validation process mein chala gaya hai\\.\n\nWeb Admin Dashboard par verification hote hi aapka ${pending.isPremium ? "Premium Tier" : "test"} automatic unlock ho jayega\\. Please wait\\.\\.\\.`,
        { parse_mode: "MarkdownV2" }
      );
    } catch (err) {
      logger.error({ err }, "Error saving UPI screenshot");
      await ctx.reply("❌ Screenshot save karne mein error. Please dobara try karein.");
    }
  });
}
