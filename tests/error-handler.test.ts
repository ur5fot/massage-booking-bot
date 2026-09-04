import { describe, expect, it, vi } from "vitest";
import { Context } from "telegraf";
import type { Update } from "telegraf/types";
import { errorHandler } from "../src/bot/middleware/error-handler.js";
import type { BotContext } from "../src/bot/context.js";
import { ValidationError } from "../src/utils/errors.js";

const ADMIN_ID = 123n;

function makeContext(update: Update) {
  const replies: string[] = [];
  const adminMessages: string[] = [];

  const telegram = {
    sendMessage: async (_chatId: unknown, text: string) => {
      adminMessages.push(text);
      return {};
    },
  };

  const ctx = new Context(update, telegram as never, {} as never) as unknown as BotContext;

  ctx.logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  } as never;

  ctx.reply = (async (text: string) => {
    replies.push(text);
    return {};
  }) as never;

  return { ctx, replies, adminMessages };
}

const textUpdate: Update = {
  update_id: 1,
  message: {
    message_id: 1,
    date: 0,
    chat: { id: 42, type: "private", first_name: "Тест" },
    from: { id: 42, is_bot: false, first_name: "Тест" },
    text: "привет",
  },
} as Update;

const callbackUpdate: Update = {
  update_id: 2,
  callback_query: {
    id: "cbq-1",
    from: { id: 42, is_bot: false, first_name: "Тест" },
    chat_instance: "1",
    data: "bk:p:0",
  },
} as Update;

describe("errorHandler", () => {
  it("показывает понятную ошибку на текстовом апдейте", async () => {
    // Регрессия: answerCbQuery бросает синхронно вне callback_query, и раньше
    // обработчик ошибок падал сам, не сказав пользователю ничего.
    const { ctx, replies } = makeContext(textUpdate);

    await errorHandler(ADMIN_ID)(ctx, async () => {
      throw new ValidationError("Так нельзя.");
    });

    expect(replies).toEqual(["Так нельзя."]);
  });

  it("показывает понятную ошибку на callback-апдейте", async () => {
    const { ctx, replies } = makeContext(callbackUpdate);
    ctx.answerCbQuery = (async () => true) as never;

    await errorHandler(ADMIN_ID)(ctx, async () => {
      throw new ValidationError("Так нельзя.");
    });

    expect(replies).toEqual(["Так нельзя."]);
  });

  it("прячет неожиданную ошибку и сообщает администратору", async () => {
    const { ctx, replies, adminMessages } = makeContext(textUpdate);

    await errorHandler(ADMIN_ID)(ctx, async () => {
      throw new Error("развалилось соединение с базой");
    });

    expect(replies).toEqual(["Что-то пошло не так. Попробуйте ещё раз."]);
    // Пользователь не должен видеть внутренности, администратор — должен.
    expect(replies[0]).not.toContain("соединение");
    expect(adminMessages[0]).toContain("развалилось соединение с базой");
  });
});
