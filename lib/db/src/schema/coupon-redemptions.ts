import { bigint, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const couponRedemptionsTable = pgTable("coupon_redemptions", {
  id: serial("id").primaryKey(),
  couponId: integer("coupon_id").notNull(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  redeemedAt: timestamp("redeemed_at").notNull().defaultNow(),
  grantedPremiumDays: integer("granted_premium_days").notNull().default(0),
  outcome: text("outcome").notNull().default("applied"),
});

export type CouponRedemption = typeof couponRedemptionsTable.$inferSelect;