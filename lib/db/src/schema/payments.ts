import { pgTable, serial, bigint, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  paymentId: text("payment_id").notNull().unique(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  method: text("method").notNull(),
  amount: integer("amount").notNull(),
  testId: text("test_id"),
  screenshotFileId: text("screenshot_file_id"),
  status: text("status").notNull().default("Pending"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
