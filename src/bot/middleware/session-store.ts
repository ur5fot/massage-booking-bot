import type { Prisma } from "../../generated/prisma/client.js";
import type { Db } from "../../db/client.js";
import type { SessionData } from "../context.js";

/**
 * Хранилище сессий Telegraf в Postgres.
 *
 * Дефолтное хранилище — Map в памяти: после перезапуска пользователь,
 * застрявший на «введите телефон», получает сломанный диалог.
 */
export function createSessionStore(db: Db) {
  return {
    async get(key: string): Promise<SessionData | undefined> {
      const row = await db.botSession.findUnique({ where: { key } });
      return row === null ? undefined : (row.data as SessionData);
    },

    async set(key: string, value: SessionData): Promise<void> {
      const data = value as unknown as Prisma.InputJsonValue;
      await db.botSession.upsert({
        where: { key },
        create: { key, data },
        update: { data },
      });
    },

    async delete(key: string): Promise<void> {
      await db.botSession.deleteMany({ where: { key } });
    },
  };
}
