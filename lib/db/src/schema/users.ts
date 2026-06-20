import { pgTable, serial, bigint, text, doublePrecision, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull().unique(),
  username: text("username"),
  fullName: text("full_name").notNull(),
  tier: text("tier").notNull().default("Free"),
  premiumExpiry: timestamp("premium_expiry"),
  targetExamMain: text("target_exam_main"),
  targetExamSub: text("target_exam_sub"),
  accuracyRate: doublePrecision("accuracy_rate").notNull().default(0),
  totalTestsTaken: integer("total_tests_taken").notNull().default(0),
  referredBy: bigint("referred_by", { mode: "number" }),
  referralCount: integer("referral_count").notNull().default(0),
  anonDoubtsUsed: integer("anon_doubts_used").notNull().default(0),
  anonDoubtDate: text("anon_doubt_date"),
  aiDoubtCount: integer("ai_doubt_count").notNull().default(0),
  aiDoubtDate: text("ai_doubt_date"),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
