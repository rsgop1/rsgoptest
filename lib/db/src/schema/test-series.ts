import { pgTable, serial, text, doublePrecision, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const testSeriesTable = pgTable("test_series", {
  id: serial("id").primaryKey(),
  testId: text("test_id").notNull().unique(),
  testName: text("test_name").notNull(),
  mainCategory: text("main_category").notNull(),
  subCategory: text("sub_category").notNull(),
  positiveMarking: doublePrecision("positive_marking").notNull().default(1),
  negativeMarking: doublePrecision("negative_marking").notNull().default(0.25),
  priceInr: integer("price_inr").notNull().default(0),
  priceInStars: integer("price_in_stars").notNull().default(0),
  questionsData: jsonb("questions_data").notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
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
}
