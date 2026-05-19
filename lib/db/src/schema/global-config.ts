import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const globalConfigTable = pgTable("global_config", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertGlobalConfigSchema = createInsertSchema(globalConfigTable).omit({ id: true });
export type InsertGlobalConfig = z.infer<typeof insertGlobalConfigSchema>;
export type GlobalConfig = typeof globalConfigTable.$inferSelect;
