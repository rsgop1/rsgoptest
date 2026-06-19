import { pgTable, serial, bigint, text, timestamp } from "drizzle-orm/pg-core";

export const achievementsTable = pgTable("achievements", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  achievementType: text("achievement_type").notNull(),
  awardedAt: timestamp("awarded_at").notNull().defaultNow(),
});

export type Achievement = typeof achievementsTable.$inferSelect;
