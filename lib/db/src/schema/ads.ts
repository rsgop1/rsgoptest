import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const adsTable = pgTable("ads", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  mediaType: text("media_type").notNull().default("image"),
  telegramFileId: text("telegram_file_id"),
  adText: text("ad_text"),
  buttonText: text("button_text"),
  buttonUrl: text("button_url"),
  isActive: boolean("is_active").notNull().default(true),
  frequencyEvery: integer("frequency_every").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Ad = typeof adsTable.$inferSelect;
