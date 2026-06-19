import { Bot } from "grammy";
import { setApi } from "./api-instance.js";
import { registerStartHandlers } from "./handlers/start.js";
import { registerQuizHandlers } from "./handlers/quiz.js";
import { registerCommandHandlers } from "./handlers/commands.js";
import { registerPaymentHandlers } from "./handlers/payment.js";
import { registerLeaderboardHandlers, updateChannelLeaderboard } from "./handlers/leaderboard.js";
import { registerStatsHandlers } from "./handlers/stats.js";
import { registerChallengeHandlers, setBotUsername } from "./handlers/challenge.js";
import { logger } from "../lib/logger.js";
import { emitTelemetry } from "../lib/telemetry.js";

if (!process.env["TELEGRAM_BOT_TOKEN"]) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

export const bot = new Bot(process.env["TELEGRAM_BOT_TOKEN"]);

setApi(bot.api);

registerStartHandlers(bot);
registerQuizHandlers(bot);
registerCommandHandlers(bot);
registerPaymentHandlers(bot);
registerLeaderboardHandlers(bot);
registerStatsHandlers(bot);
registerChallengeHandlers(bot);

bot.callbackQuery("ad_noop", async (ctx) => {
  await ctx.answerCallbackQuery({ text: "⏳ Please wait for the timer...", show_alert: false });
});

bot.catch((err) => {
  logger.error({ err: err.error, ctx: err.ctx?.update }, "Grammy unhandled error");
});

export function startBot(): void {
  bot.start({
    onStart: (info) => {
      logger.info({ username: info.username }, "Telegram bot started");
      setBotUsername(info.username);
      emitTelemetry(`Bot started: @${info.username}`);

      setInterval(async () => {
        await updateChannelLeaderboard();
      }, 5 * 60 * 1000);
    },
  }).catch((err) => {
    logger.error({ err }, "Bot crashed");
  });
}
