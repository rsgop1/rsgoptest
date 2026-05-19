import { pgTable, serial, bigint, integer, text, doublePrecision, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const challengesTable = pgTable("challenges", {
  id: serial("id").primaryKey(),
  challengeId: text("challenge_id").notNull().unique(),
  testId: text("test_id").notNull(),
  testName: text("test_name").notNull(),
  createdBy: bigint("created_by", { mode: "number" }).notNull(),
  creatorName: text("creator_name").notNull(),
  groupChatId: bigint("group_chat_id", { mode: "number" }),
  groupMessageId: integer("group_message_id"),
  isActive: boolean("is_active").notNull().default(true),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const challengeParticipantsTable = pgTable("challenge_participants", {
  id: serial("id").primaryKey(),
  challengeId: text("challenge_id").notNull(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  userName: text("user_name").notNull(),
  score: doublePrecision("score"),
  correctCount: integer("correct_count"),
  totalQuestions: integer("total_questions"),
  completedAt: timestamp("completed_at"),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
});

export const insertChallengeSchema = createInsertSchema(challengesTable).omit({ id: true });
export type InsertChallenge = z.infer<typeof insertChallengeSchema>;
export type Challenge = typeof challengesTable.$inferSelect;

export const insertChallengeParticipantSchema = createInsertSchema(challengeParticipantsTable).omit({ id: true });
export type InsertChallengeParticipant = z.infer<typeof insertChallengeParticipantSchema>;
export type ChallengeParticipant = typeof challengeParticipantsTable.$inferSelect;
