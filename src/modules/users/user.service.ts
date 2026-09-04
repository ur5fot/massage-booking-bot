import type { Db } from "../../db/client.js";
import type { User } from "../../generated/prisma/client.js";

export class UserService {
  constructor(private readonly db: Db) {}

  /**
   * Пользователь заводится при первом касании бота, до всякой записи.
   *
   * Имя сюда намеренно не подставляется из профиля Telegram: в профиле обычно
   * ник или имя со смайликами, а массажисту нужно то имя, под которым человек
   * пришёл. Имя спрашивается в диалоге записи.
   */
  async ensure(telegramId: bigint): Promise<User> {
    return this.db.user.upsert({
      where: { telegramId },
      create: { telegramId },
      update: {},
    });
  }

  async byTelegramId(telegramId: bigint): Promise<User | null> {
    return this.db.user.findUnique({ where: { telegramId } });
  }

  async updateContacts(id: string, data: { name?: string; phone?: string }): Promise<User> {
    return this.db.user.update({ where: { id }, data });
  }
}
