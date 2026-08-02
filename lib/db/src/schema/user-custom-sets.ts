import { pgTable, serial, bigint, text, integer, doublePrecision, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userCustomSetsTable = pgTable("user_custom_sets", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  title: text("title").notNull(),
  language: text("language").notNull().default("en"), // "en" | "hi"
  questionCount: integer("question_count").notNull().default(0),
  questionsData: jsonb("questions_data").notNull().default([]),
  priceInr: integer("price_inr").notNull().default(0),
  priceInStars: integer("price_in_stars").notNull().default(0),
  timerSeconds: integer("timer_seconds").notNull().default(30),
  positiveMarking: doublePrecision("positive_marking").notNull().default(1),
  negativeMarking: doublePrecision("negative_marking").notNull().default(0),
  status: text("status").notNull().default("processing"), // "processing" | "ready" | "failed"
  shareToken: text("share_token").notNull().unique(),
  failReason: text("fail_reason"),
  isActive: boolean("is_active").notNull().default(true),
  sourceFileName: text("source_file_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertUserCustomSetSchema = createInsertSchema(userCustomSetsTable).omit({ id: true });
export type InsertUserCustomSet = z.infer<typeof insertUserCustomSetSchema>;
export type UserCustomSet = typeof userCustomSetsTable.$inferSelect;
