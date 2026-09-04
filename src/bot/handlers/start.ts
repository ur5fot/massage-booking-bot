import type { Telegraf } from "telegraf";
import type { BotContext } from "../context.js";
import { MENU, mainMenuKeyboard } from "../keyboards/main-menu.js";
import { handleBookingContact, handleBookingText, showDates } from "../scenes/booking.js";

const GREETING = [
  "Здравствуйте! Это бот записи на массаж.",
  "",
  "Через него можно посмотреть свободное время, записаться и управлять своими записями.",
].join("\n");

/** Команды и кнопки главного меню. Регистрируются до перехватчика текста. */
export function registerStartHandlers(bot: Telegraf<BotContext>): void {
  bot.start(async (ctx) => {
    ctx.session.booking = { step: "idle" };
    await ctx.reply(GREETING, mainMenuKeyboard());
  });

  bot.command("menu", async (ctx) => {
    ctx.session.booking = { step: "idle" };
    await ctx.reply("Главное меню:", mainMenuKeyboard());
  });

  bot.hears(MENU.book, async (ctx) => {
    await showDates(ctx, 0);
  });

  bot.hears(MENU.contacts, async (ctx) => {
    await ctx.reply(ctx.container.config.contactsText, mainMenuKeyboard());
  });
}

/**
 * Перехватчик свободного ввода. Регистрируется последним, иначе он съел бы
 * нажатия кнопок меню: они приходят обычным текстом.
 */
export function registerFallbackHandlers(bot: Telegraf<BotContext>): void {
  // Контакт приходит отдельным типом апдейта, а не текстом.
  bot.on("contact", async (ctx) => {
    const contact = ctx.message.contact;

    // Чужой контакт брать нельзя: это телефон другого человека.
    if (contact.user_id !== ctx.from.id) {
      await ctx.reply("Пришлите, пожалуйста, свой номер — кнопкой ниже.");
      return;
    }

    const handled = await handleBookingContact(ctx, contact.phone_number);
    if (handled) return;

    await ctx.container.users.updateContacts(ctx.currentUser.id, {
      phone: contact.phone_number,
    });
    await ctx.reply("Спасибо, номер сохранён.", mainMenuKeyboard());
  });

  bot.on("text", async (ctx) => {
    const handled = await handleBookingText(ctx, ctx.message.text);
    if (handled) return;
    if (ctx.message.text.startsWith("/")) return;

    await ctx.reply("Выберите действие в меню ниже.", mainMenuKeyboard());
  });
}
