import type { MiddlewareFn } from "telegraf";
import type { BotContext } from "../context.js";
import { UserFacingError } from "../../utils/errors.js";

const GENERIC = "Что-то пошло не так. Попробуйте ещё раз.";

/**
 * Пользователь не должен видеть stack trace. Ожидаемые ошибки показываются
 * текстом, неожиданные — логируются и уходят администратору.
 */
export function errorHandler(adminTelegramId: bigint): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      if (error instanceof UserFacingError) {
        // answerCbQuery бросает синхронно, если апдейт не callback_query,
        // и тогда сам обработчик ошибок падает, не сказав пользователю ни слова.
        if (ctx.callbackQuery !== undefined) {
          await ctx.answerCbQuery().catch(() => undefined);
        }
        await ctx.reply(error.message).catch(() => undefined);
        return;
      }

      ctx.logger.error("Необработанная ошибка обработчика", {
        err: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        updateType: ctx.updateType,
        telegramId: ctx.from?.id,
      });

      await ctx.reply(GENERIC).catch(() => undefined);

      await ctx.telegram
        .sendMessage(
          adminTelegramId.toString(),
          `Ошибка в боте: ${error instanceof Error ? error.message : String(error)}`,
        )
        .catch(() => undefined);
    }
  };
}
