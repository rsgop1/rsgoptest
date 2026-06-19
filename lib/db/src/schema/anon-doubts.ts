import { pgTable, serial, bigint, text, integer, timestamp } from "drizzle-orm/pg-core";

export const anonDoubtsTable = pgTable("anon_doubts", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number" }).notNull(),
  doubtText: text("doubt_text").notNull(),
  groupMessageId: integer("group_message_id"),
  groupChatId: bigint("group_chat_id", { mode: "number" }),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AnonDoubt = typeof anonDoubtsTable.$inferSelect;
