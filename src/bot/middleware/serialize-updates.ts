import type { Context, MiddlewareFn } from "telegraf";
import { sessionKey } from "../session-key.js";

/**
 * Обрабатывает апдейты одного пользователя строго по очереди.
 *
 * Telegraf держит конкурентным апдейтам общий объект сессии, так что запись
 * в хранилище не теряется. Но обработчики читают состояние до `await` и пишут
 * после, поэтому два быстрых нажатия успевают наложиться: оба видят один и тот
 * же шаг диалога и оба принимают решение по устаревшему снимку.
 *
 * Очередь на процесс, а не на кластер. Для long polling этого достаточно:
 * Telegram отдаёт апдейты одному потребителю, и второй экземпляр бота с тем же
 * токеном всё равно работать не может.
 */
export function serializeUpdates<C extends Context>(): MiddlewareFn<C> {
  const running = new Map<string, Promise<unknown>>();

  return async (ctx, next) => {
    const key = sessionKey(ctx);
    if (key === undefined) return next();

    const previous = running.get(key) ?? Promise.resolve();
    // Падение предыдущего апдейта не должно ронять следующий в очереди.
    const current = previous.catch(() => undefined).then(() => next());

    running.set(key, current);

    try {
      await current;
    } finally {
      // Очищаем, только если за нами никто не встал: иначе затрём чужой хвост.
      if (running.get(key) === current) running.delete(key);
    }
  };
}
