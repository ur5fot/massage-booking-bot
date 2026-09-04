import type { Context } from "telegraf";

/**
 * Ключ сессии. Совпадает с форматом Telegraf по умолчанию и используется
 * одновременно хранилищем сессий и сериализацией апдейтов — они обязаны
 * считать «одним пользователем» одно и то же.
 */
export function sessionKey(ctx: Context): string | undefined {
  const fromId = ctx.from?.id;
  const chatId = ctx.chat?.id;

  if (fromId === undefined || chatId === undefined) return undefined;

  return `${fromId}:${chatId}`;
}
