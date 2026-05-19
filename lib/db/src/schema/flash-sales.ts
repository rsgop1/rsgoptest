import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const flashSalesTable = pgTable("flash_sales", {
  id: serial("id").primaryKey(),
  testId: text("test_id").notNull(),
  discountInr: integer("discount_inr").notNull(),
  discountStars: integer("discount_stars").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertFlashSaleSchema = createInsertSchema(flashSalesTable).omit({ id: true });
export type InsertFlashSale = z.infer<typeof insertFlashSaleSchema>;
export type FlashSale = typeof flashSalesTable.$inferSelect;
