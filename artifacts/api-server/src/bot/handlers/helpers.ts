import { db } from "@workspace/db";
import { globalConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const configCache = new Map<string, { value: string; expiry: number }>();
const CACHE_TTL = 30_000;

export async function getConfig(key: string): Promise<string | null> {
  const now = Date.now();
  const cached = configCache.get(key);
  if (cached && cached.expiry > now) return cached.value;

  const [row] = await db
    .select()
    .from(globalConfigTable)
    .where(eq(globalConfigTable.key, key))
    .limit(1);

  if (!row) return null;
  configCache.set(key, { value: row.value, expiry: now + CACHE_TTL });
  return row.value;
}

export async function setConfig(key: string, value: string): Promise<void> {
  configCache.delete(key);
  await db
    .insert(globalConfigTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: globalConfigTable.key, set: { value, updatedAt: new Date() } });
}
