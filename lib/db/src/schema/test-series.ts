import { pgTable, serial, text, doublePrecision, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const testSeriesTable = pgTable("test_series", {
  id: serial("id").primaryKey(),
  testId: text("test_id").notNull().unique(),
  testName: text("test_name").notNull(),
  mainCategory: text("main_category").notNull(),
  subCategory: text("sub_category").notNull(),
  subject: text("subject").notNull().default("General"),
  subSubject: text("sub_subject").notNull().default("General"),
  topicTags: jsonb("topic_tags").$type<string[]>().notNull().default([]),
  topicTaggedAt: timestamp("topic_tagged_at"),
  topicTaggingVersion: text("topic_tagging_version"),
  positiveMarking: doublePrecision("positive_marking").notNull().default(1),
  negativeMarking: doublePrecision("negative_marking").notNull().default(0.25),
  priceInr: integer("price_inr").notNull().default(0),
  priceInStars: integer("price_in_stars").notNull().default(0),
  questionsData: jsonb("questions_data").notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  timerSeconds: integer("timer_seconds").notNull().default(30),
  webTimerSeconds: integer("web_timer_seconds").notNull().default(3600),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTestSeriesSchema = createInsertSchema(testSeriesTable).omit({ id: true });
export type InsertTestSeries = z.infer<typeof insertTestSeriesSchema>;
export type TestSeries = typeof testSeriesTable.$inferSelect;

export interface QuestionData {
  id: string;
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation: string;
  language?: "en" | "hi";
  topics?: string[];
  topic?: string;
  skills?: string[];
  difficulty?: "easy" | "medium" | "hard";
  focus?: string;
}
