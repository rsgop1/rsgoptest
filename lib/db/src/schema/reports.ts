import { pgTable, serial, bigint, text, integer, timestamp } from "drizzle-orm/pg-core";

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  testId: text("test_id").notNull(),
  questionIndex: integer("question_index").notNull(),
  questionText: text("question_text").notNull(),
  userAnswer: integer("user_answer"),
  correctAnswer: integer("correct_answer").notNull(),
  reportText: text("report_text").notNull(),
  status: text("status").notNull().default("open"),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export type Report = typeof reportsTable.$inferSelect;
