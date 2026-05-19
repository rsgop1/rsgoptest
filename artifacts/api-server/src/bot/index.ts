import { Bot } from "grammy";
import { setApi } from "./api-instance.js";
import { registerStartHandlers } from "./handlers/start.js";
import { registerQuizHandlers } from "./handlers/quiz.js";
import { registerCommandHandlers } from "./handlers/commands.js";
import { registerPaymentHandlers } from "./handlers/payment.js";
import { logger } from "../lib/logger.js";

if (!process.env["TELEGRAM_BOT_TOKEN"]) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

export const bot = new Bot(process.env["TELEGRAM_BOT_TOKEN"]);

setApi(bot.api);

registerStartHandlers(bot);
registerQuizHandlers(bot);
registerCommandHandlers(bot);
registerPaymentHandlers(bot);

bot.catch((err) => {
  logger.error({ err: err.error, ctx: err.ctx?.update }, "Grammy unhandled error");
});

export function startBot(): void {
  bot.start({
    onStart: (info) => {
      logger.info({ username: info.username }, "Telegram bot started");
    },
  }).catch((err) => {
    logger.error({ err }, "Bot crashed");
  });
}
