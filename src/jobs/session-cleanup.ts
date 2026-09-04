import type { Db } from "../db/client.js";
import type { Logger } from "../utils/logger.js";

export type SessionCleanupOptions = {
  maxAgeDays: number;
  intervalMs: number;
};

/**
 * Чистка брошенных диалогов.
 *
 * Строки BotSession живут ровно столько, сколько живёт диалог, но никто их
 * не удаляет: человек начал запись, бросил на полпути и больше не вернулся.
 * Само по себе это ничего не ломает, просто таблица растёт без конца.
 *
 * Отдельного планировщика в проекте пока нет (он появится вместе с
 * напоминаниями), поэтому здесь обычный интервал без новых зависимостей.
 */
export function startSessionCleanup(
  db: Db,
  logger: Logger,
  options: SessionCleanupOptions,
): () => void {
  const sweep = async (): Promise<void> => {
    const threshold = new Date(Date.now() - options.maxAgeDays * 24 * 3_600_000);

    try {
      const { count } = await db.botSession.deleteMany({
        where: { updatedAt: { lt: threshold } },
      });

      if (count > 0) {
        logger.info("Удалены неактивные диалоги", { count, olderThanDays: options.maxAgeDays });
      }
    } catch (error) {
      // Уборка не должна ронять бота: записи важнее чистоты таблицы сессий.
      logger.error("Не удалось почистить сессии", {
        err: error instanceof Error ? error.message : String(error),
      });
    }
  };

  void sweep();

  const timer = setInterval(() => void sweep(), options.intervalMs);
  // Незавершённый таймер не должен держать процесс при остановке.
  timer.unref();

  return () => clearInterval(timer);
}
