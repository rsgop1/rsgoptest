import { pgTable, serial, bigint, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const purchasedTestsTable = pgTable("purchased_tests", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  testId: text("test_id").notNull(),
  purchasedAt: timestamp("purchased_at").notNull().defaultNow(),
});

export const insertPurchasedTestSchema = createInsertSchema(purchasedTestsTable).omit({ id: true });
export type InsertPurchasedTest = z.infer<typeof insertPurchasedTestSchema>;
export type PurchasedTest = typeof purchasedTestsTable.$inferSelect;
