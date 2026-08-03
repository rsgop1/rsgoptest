import { pgTable, serial, text, bigint, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

export const liveTestsTable = pgTable("live_tests", {
  id: serial("id").primaryKey(),
  testId: text("test_id").notNull(),
  title: text("title").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  groupChatId: bigint("group_chat_id", { mode: "number" }),
  status: text("status").notNull().default("scheduled"),
  participants: jsonb("participants").$type<number[]>().default([]),
  pinnedMessageId: integer("pinned_message_id"),
  currentQuestionIndex: integer("current_question_index").notNull().default(0),
  timerSeconds: integer("timer_seconds").notNull().default(30),
  currentPollId: text("current_poll_id"),
  currentPollMessageId: integer("current_poll_message_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const liveTestAnswersTable = pgTable("live_test_answers", {
  id: serial("id").primaryKey(),
  liveTestId: integer("live_test_id").notNull(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  score: integer("score").notNull().default(0),
  correctCount: integer("correct_count").notNull().default(0),
  answers: jsonb("answers").$type<(number | null)[]>().default([]),
});

export type LiveTest = typeof liveTestsTable.$inferSelect;
