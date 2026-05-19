import { pgTable, serial, bigint, text, doublePrecision, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userHistoryTable = pgTable("user_history", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  testId: text("test_id").notNull(),
  score: doublePrecision("score").notNull(),
  maxScore: doublePrecision("max_score").notNull(),
  correctCount: integer("correct_count").notNull(),
  wrongCount: integer("wrong_count").notNull(),
  skippedCount: integer("skipped_count").notNull(),
  accuracy: doublePrecision("accuracy").notNull(),
  completedAt: timestamp("completed_at").notNull().defaultNow(),
});

export const insertUserHistorySchema = createInsertSchema(userHistoryTable).omit({ id: true });
export type InsertUserHistory = z.infer<typeof insertUserHistorySchema>;
export type UserHistory = typeof userHistoryTable.$inferSelect;
