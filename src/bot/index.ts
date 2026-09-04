import { Telegraf, session } from "telegraf";
import type { Container } from "./context.js";
import { emptySession, type BotContext, type SessionData } from "./context.js";
import { createSessionStore } from "./middleware/session-store.js";
import { errorHandler } from "./middleware/error-handler.js";
import { serializeUpdates } from "./middleware/serialize-updates.js";
import { sessionKey } from "./session-key.js";
import { registerFallbackHandlers, registerStartHandlers } from "./handlers/start.js";
import { registerAppointmentHandlers } from "./handlers/appointments.js";
import { registerBookingCallbacks } from "./scenes/booking.js";

export function createBot(container: Container): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(container.config.env.BOT_TOKEN);

  bot.use((ctx, next) => {
    ctx.container = container;
    ctx.logger = container.logger.child({ telegramId: ctx.from?.id });
    return next();
  });

  bot.use(errorHandler(container.config.adminTelegramId));

  // Строго перед session: очередь должна накрывать чтение состояния,
  // работу обработчика и запись — иначе два быстрых нажатия наложатся.
  bot.use(serializeUpdates<BotContext>());

  bot.use(
    session<SessionData, BotContext>({
      store: createSessionStore(container.db),
      defaultSession: emptySession,
      getSessionKey: (ctx) => sessionKey(ctx),
    }),
  );

  // Пользователь должен существовать до любого обработчика: на него ссылаются записи.
  bot.use(async (ctx, next) => {
    if (ctx.from === undefined || ctx.from.is_bot) return;

    ctx.currentUser = await container.users.ensure(BigInt(ctx.from.id));

    return next();
  });

  // Порядок важен: кнопки меню приходят обычным текстом, поэтому перехватчик
  // свободного ввода регистрируется последним.
  registerStartHandlers(bot);
  registerAppointmentHandlers(bot);
  registerBookingCallbacks(bot);
  registerFallbackHandlers(bot);

  return bot;
}
