import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { db } from "@workspace/db";
import { supportTicketsTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { emitTelemetry } from "../../lib/telemetry.js";

function escMd(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

const CATEGORIES: Record<string, string> = {
  payment: "💳 Payment Issue",
  bug: "🐛 Bug Report",
  question: "❓ General Query",
  feedback: "💡 Feedback",
  other: "📋 Other",
};

export function registerSupportHandlers(bot: Bot): void {
  // /support — create a support ticket
  bot.command("support", async (ctx) => {
    const userId = ctx.from!.id;

    const kb = new InlineKeyboard()
      .text("💳 Payment", "tkt_cat_payment")
      .text("🐛 Bug", "tkt_cat_bug")
      .row()
      .text("❓ Query", "tkt_cat_question")
      .text("💡 Feedback", "tkt_cat_feedback")
      .row()
      .text("📋 Other", "tkt_cat_other")
      .text("❌ Cancel", "tkt_cancel");

    await ctx.reply(
      "🎫 *Support Ticket*\n\n" +
        "Facing an issue? File a ticket and our team will get back to you\\!\n\n" +
        "Select a category:",
      { parse_mode: "MarkdownV2", reply_markup: kb }
    );
  });

  // Category selection
  bot.callbackQuery(/^tkt_cat_/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const category = ctx.callbackQuery.data.replace("tkt_cat_", "");

    if (category === "cancel") {
      try { await ctx.deleteMessage(); } catch {}
      return;
    }

    const catLabel = CATEGORIES[category] ?? "Other";

    try {
      await ctx.editMessageText(
        `📝 *${escMd(catLabel)}*\n\nPlease describe your issue in a single message\\. Be as detailed as possible\\.\n\n_Your message will be forwarded to the admin team\\._`,
        { parse_mode: "MarkdownV2" }
      );
    } catch {
      try { await ctx.deleteMessage(); } catch {}
      await ctx.reply(
        `📝 *${escMd(catLabel)}*\n\nPlease describe your issue in a single message\\. Be as detailed as possible\\.`,
        { parse_mode: "MarkdownV2" }
      );
    }

    // Store pending ticket
    const { updateSession } = await import("../session.js");
    updateSession(userId, { pendingSupportTicket: { category, step: "awaiting_description" } });
  });

  // Cancel
  bot.callbackQuery("tkt_cancel", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Cancelled." });
    try { await ctx.deleteMessage(); } catch {}
  });

  // Handle ticket description text
  bot.on("message:text", async (ctx, next) => {
    const userId = ctx.from!.id;
    const { getSession, updateSession } = await import("../session.js");
    const session = getSession(userId);

    if (!session.pendingSupportTicket || session.pendingSupportTicket.step !== "awaiting_description") {
      return next();
    }

    const text = ctx.message.text ?? "";
    if (text.length < 10) {
      await ctx.reply("❌ Please describe your issue in at least 10 characters.");
      return;
    }

    const { category } = session.pendingSupportTicket;
    updateSession(userId, { pendingSupportTicket: undefined });

    try {
      await db.insert(supportTicketsTable).values({
        userId,
        category,
        message: text.slice(0, 2000),
        status: "open",
        priority: "normal",
      });

      emitTelemetry(`Support ticket created by user ${userId}: ${category}`);

      const [user] = await db
        .select({ fullName: usersTable.fullName, username: usersTable.username })
        .from(usersTable)
        .where(eq(usersTable.userId, userId))
        .limit(1);

      const name = user?.fullName ?? user?.username ?? `User ${userId}`;

      // Notify admin channel if configured
      const adminChatId = process.env["ADMIN_CHAT_ID"];
      if (adminChatId) {
        const adminKb = new InlineKeyboard()
          .text("✅ Resolve", `tkt_resolve_`)
          .text("🔒 Close", `tkt_close_`);
        const api = (await import("../api-instance.js")).getApi();
        try {
          await api.sendMessage(
            Number(adminChatId),
            `🎫 *New Support Ticket*\n\n👤 *Name:* ${escMd(name)}\n🆔 User ID: \`${userId}\`\n📂 Category: *${escMd(category)}*\n\n📝 *Message:*\n${escMd(text.slice(0, 500))}`,
            { parse_mode: "MarkdownV2", reply_markup: adminKb }
          );
        } catch (adminErr) {
          logger.error({ err: adminErr }, "Failed to notify admin about ticket");
        }
      }

      await ctx.reply(
        `✅ *Ticket Submitted\\!*\n\n` +
          `📂 Category: *${escMd(CATEGORIES[category] ?? category)}*\n` +
          `🆔 Ticket #\\*\\*\\*\\*${String(Date.now()).slice(-4)}\n\n` +
          `Our team will review your issue and get back to you soon\\.\n\n` +
          `_You can check /dashboard anytime for updates\\._`,
        { parse_mode: "MarkdownV2" }
      );
    } catch (err) {
      logger.error({ err, userId }, "Failed to create support ticket");
      await ctx.reply("❌ Failed to create ticket. Please try again later.");
    }
  });
}
