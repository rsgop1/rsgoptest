import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const couponCodesTable = pgTable("coupon_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  discountInr: integer("discount_inr").notNull().default(0),
  discountStars: integer("discount_stars").notNull().default(0),
  discountPct: integer("discount_pct").notNull().default(0),
  premiumDays: integer("premium_days").notNull().default(30),
  perUserLimit: integer("per_user_limit").notNull().default(1),
  grantPremium: boolean("grant_premium").notNull().default(false),
  campaignName: text("campaign_name"),
  internalNote: text("internal_note"),
  usageLimit: integer("usage_limit").notNull().default(100),
  usedCount: integer("used_count").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCouponCodeSchema = createInsertSchema(couponCodesTable).omit({ id: true });
export type InsertCouponCode = z.infer<typeof insertCouponCodeSchema>;
export type CouponCode = typeof couponCodesTable.$inferSelect;
