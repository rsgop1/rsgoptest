import { pgTable, serial, bigint, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const wrongQuestionsTable = pgTable("wrong_questions", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  testId: text("test_id").notNull(),
  questionIndex: integer("question_index").notNull(),
  savedAt: timestamp("saved_at").notNull().defaultNow(),
});

export const insertWrongQuestionSchema = createInsertSchema(wrongQuestionsTable).omit({ id: true });
export type InsertWrongQuestion = z.infer<typeof insertWrongQuestionSchema>;
export type WrongQuestion = typeof wrongQuestionsTable.$inferSelect;
