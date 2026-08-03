import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fallbackManual = "Series TestPro is a Telegram mock-test bot. Use live database context and never invent user metrics.";

export function loadBotManual(): string {
  const candidates = [
    resolve(process.cwd(), "artifacts/api-server/BOT_FUNCTIONS_MANUAL.md"),
    resolve(process.cwd(), "BOT_FUNCTIONS_MANUAL.md"),
  ];
  for (const file of candidates) {
    try {
      return readFileSync(file, "utf8");
    } catch {
      // Try the next workspace-relative location.
    }
  }
  return fallbackManual;
}

export const BOT_FUNCTIONS_MANUAL = loadBotManual();