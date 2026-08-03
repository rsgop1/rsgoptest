import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getApi } from "../api-instance.js";
import { grantVipAccess } from "./vip.js";
import { logger } from "../../lib/logger.js";

export async function activatePremium(
  userId: number,
  days: number,
  reason = "Premium activated",
): Promise<Date> {
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    throw new Error("Premium duration must be between 1 and 3650 days");
  }
  const [user] = await db.select({ premiumExpiry: usersTable.premiumExpiry })
    .from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
  if (!user) throw new Error("User not found");

  const base = user.premiumExpiry && user.premiumExpiry > new Date()
    ? new Date(user.premiumExpiry)
    : new Date();
  base.setDate(base.getDate() + days);
  await db.update(usersTable)
    .set({ tier: "Premium", premiumExpiry: base })
    .where(eq(usersTable.userId, userId));

  const date = base.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  await getApi().sendMessage(
    userId,
    `💎 <b>Premium Activated!</b>\n\n` +
      `Welcome to Series TestPro Premium.\n` +
      `📅 Active until: <b>${date}</b>\n\n` +
      `✨ Your Premium access includes:\n` +
      `• All tests and detailed solutions\n• AI Space and custom PDF tests\n• Personal VIP study group\n• Advanced performance analytics\n\n` +
      `Use /menu to explore your Premium features.`,
    { parse_mode: "HTML" },
  ).catch((error) => logger.warn({ error, userId }, "Premium welcome message failed"));
  await grantVipAccess(userId, reason);
  return base;
}