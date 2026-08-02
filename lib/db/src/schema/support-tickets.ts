import { pgTable, serial, bigint, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const supportTicketsTable = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  category: text("category").notNull().default("other"), // "payment" | "bug" | "question" | "feedback" | "other"
  message: text("message").notNull(),
  status: text("status").notNull().default("open"), // "open" | "in_progress" | "resolved" | "closed"
  priority: text("priority").notNull().default("normal"), // "low" | "normal" | "high" | "urgent"
  adminNote: text("admin_note"),
  resolvedBy: bigint("resolved_by", { mode: "number" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertSupportTicketSchema = createInsertSchema(supportTicketsTable).omit({ id: true });
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTicketsTable.$inferSelect;
