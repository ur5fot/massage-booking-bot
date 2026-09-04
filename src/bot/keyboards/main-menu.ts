import { Markup } from "telegraf";

export const MENU = {
  book: "📅 Записаться",
  my: "🗓 Мои записи",
  reschedule: "🔁 Перенести запись",
  cancel: "❌ Отменить запись",
  contacts: "📞 Контакты",
} as const;

export function mainMenuKeyboard() {
  return Markup.keyboard([
    [MENU.book],
    [MENU.my, MENU.contacts],
    [MENU.reschedule, MENU.cancel],
  ]).resize();
}

/**
 * Быстрая подстановка имени из профиля Telegram. Если имени нет или оно
 * не проходит валидацию длины, клавиатура не показывается вовсе.
 */
export function suggestNameKeyboard(telegramFirstName: string | undefined) {
  const suggestion = telegramFirstName?.trim() ?? "";
  if (suggestion.length < 2 || suggestion.length > 64) return Markup.removeKeyboard();

  return Markup.keyboard([[suggestion]]).resize().oneTime();
}

export function requestContactKeyboard() {
  return Markup.keyboard([
    [Markup.button.contactRequest("📱 Отправить мой номер")],
  ])
    .resize()
    .oneTime();
}
