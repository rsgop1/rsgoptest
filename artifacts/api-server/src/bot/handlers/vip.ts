import type { Bot } from "grammy";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { and, eq, gt, lte } from "drizzle-orm";
import { getApi } from "../api-instance.js";
import { getConfig, setConfig } from "./helpers.js";
import { logger } from "../../lib/logger.js";
import { randomBytes } from "crypto";

const DEFAULT_GROUP_ID = "-1004496413344";
const VIP_GROUP_KEY = "vip_group_id";
const VIP_ENABLED_KEY = "vip_enabled";
const VIP_CODE_KEY = "vip_access_code";
const VIP_WELCOME_KEY = "vip_welcome_message";

export async function getVipConfig() {
  return {
    groupId: (await getConfig(VIP_GROUP_KEY)) ?? DEFAULT_GROUP_ID,
    enabled: (await getConfig(VIP_ENABLED_KEY)) !== "false",
    accessCode: (await getConfig(VIP_CODE_KEY)) ?? "VIP-2026",
    welcomeMessage: (await getConfig(VIP_WELCOME_KEY)) ?? "Welcome to the VIP study group. Your premium access is active.",
  };
}

async function vipGroupId(): Promise<number | null> {
  const config = await getVipConfig();
  if (!config.enabled || !config.groupId) return null;
  const id = Number(config.groupId);
  return Number.isSafeInteger(id) ? id : null;
}

export async function createVipInvite(userId: number): Promise<string | null> {
  const groupId = await vipGroupId();
  if (!groupId) return null;
  const user = await db.select({ premiumExpiry: usersTable.premiumExpiry, tier: usersTable.tier })
    .from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
  if (!user[0] || user[0].tier !== "Premium" || !user[0].premiumExpiry || user[0].premiumExpiry <= new Date()) return null;
  const expiry = Math.floor(user[0].premiumExpiry.getTime() / 1000);
  const invite = await getApi().createChatInviteLink(groupId, {
    name: `Premium ${userId}`,
    member_limit: 1,
    expire_date: expiry,
  });
  return invite.invite_link;
}

export async function grantVipAccess(userId: number, reason = "Premium activated"): Promise<boolean> {
  try {
    const invite = await createVipInvite(userId);
    if (!invite) return false;
    const config = await getVipConfig();
    await getApi().sendMessage(
      userId,
      `💎 VIP GROUP ACCESS\n\n${config.welcomeMessage}\n\n🔐 Your personal one-time invite link:\n${invite}\n\n⚠️ Do not share this link. It is limited to your Telegram account/session.\n⏰ Access ends with your Premium expiry.`,
    );
    logger.info({ userId, reason }, "VIP invite sent");
    return true;
  } catch (err) {
    logger.warn({ err, userId }, "Could not grant VIP access");
    return false;
  }
}

export async function removeVipAccess(userId: number): Promise<boolean> {
  const groupId = await vipGroupId();
  if (!groupId) return false;
  try {
    await getApi().banChatMember(groupId, userId);
    await getApi().unbanChatMember(groupId, userId, { only_if_banned: true });
    await getApi().sendMessage(userId, "🔒 Your VIP group access has ended because your Premium access expired.");
    return true;
  } catch (err) {
    logger.warn({ err, userId, groupId }, "Could not remove VIP access");
    return false;
  }
}

export async function syncVipAccess(): Promise<{ sent: number; failed: number }> {
  const users = await db.select({ userId: usersTable.userId })
    .from(usersTable)
    .where(and(eq(usersTable.tier, "Premium"), gt(usersTable.premiumExpiry, new Date())));
  let sent = 0;
  for (const user of users) {
    if (await grantVipAccess(user.userId, "Admin VIP sync")) sent++;
    else await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return { sent, failed: users.length - sent };
}

export async function runVipExpirySweep(): Promise<void> {
  const expired = await db.select({ userId: usersTable.userId })
    .from(usersTable)
    .where(and(eq(usersTable.tier, "Premium"), lte(usersTable.premiumExpiry, new Date())));
  for (const user of expired) {
    await removeVipAccess(user.userId);
    await db.update(usersTable).set({ tier: "Free", premiumExpiry: null }).where(eq(usersTable.userId, user.userId));
  }
}

export function startVipAccessScheduler(): void {
  void runVipExpirySweep().catch((err) => logger.warn({ err }, "Initial VIP expiry sweep failed"));
  setInterval(() => {
    void runVipExpirySweep().catch((err) => logger.warn({ err }, "VIP expiry sweep failed"));
  }, 10 * 60 * 1000);
}

export function registerVipHandlers(bot: Bot): void {
  bot.command("vip", async (ctx) => {
    const code = ctx.match?.trim();
    const userId = ctx.from?.id;
    if (!userId) return;
    const [user] = await db.select({ tier: usersTable.tier, premiumExpiry: usersTable.premiumExpiry })
      .from(usersTable).where(eq(usersTable.userId, userId)).limit(1);
    const config = await getVipConfig();
    const active = user?.tier === "Premium" && !!user.premiumExpiry && user.premiumExpiry > new Date();
    if (!active && code !== config.accessCode) {
      await ctx.reply("🔒 VIP access is for active Premium users. Use /premium to upgrade, then send /vip.");
      return;
    }
    const invite = await createVipInvite(userId);
    if (!invite) { await ctx.reply("⚠️ VIP group is temporarily unavailable. Please contact admin."); return; }
    await ctx.reply(`💎 Your personal VIP invite link:\n\n${invite}\n\n⚠️ One-time link. Please do not forward it.`);
  });
}

export async function rotateVipAccessCode(): Promise<string> {
  const code = `VIP-${randomBytes(4).toString("hex").toUpperCase()}`;
  await setConfig(VIP_CODE_KEY, code);
  return code;
}