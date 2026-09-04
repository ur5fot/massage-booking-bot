import { Markup } from "telegraf";
import type { InlineKeyboardButton } from "telegraf/types";
import { cb } from "../callback-data.js";
import type { DayWithSlots } from "../../modules/availability/availability.service.js";
import type { Slot } from "../../modules/availability/availability.js";
import { formatDateForUser, formatTimeForUser } from "../../utils/time.js";

export const DAYS_PER_PAGE = 8;
const DAY_COLUMNS = 2;
const TIME_COLUMNS = 4;

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

export function datesKeyboard(days: DayWithSlots[], page: number, timezone: string) {
  const pageCount = Math.max(1, Math.ceil(days.length / DAYS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  const visible = days.slice(safePage * DAYS_PER_PAGE, (safePage + 1) * DAYS_PER_PAGE);

  const rows: InlineKeyboardButton[][] = chunk(
    visible.map((day) =>
      Markup.button.callback(
        `${formatDateForUser(day.firstStart, timezone)} · ${day.slots.length}`,
        cb.bookDate(day.date),
      ),
    ),
    DAY_COLUMNS,
  );

  if (pageCount > 1) {
    rows.push([
      safePage > 0
        ? Markup.button.callback("‹ Раньше", cb.bookDays(safePage - 1))
        : Markup.button.callback(" ", cb.noop()),
      Markup.button.callback(`${safePage + 1}/${pageCount}`, cb.noop()),
      safePage < pageCount - 1
        ? Markup.button.callback("Позже ›", cb.bookDays(safePage + 1))
        : Markup.button.callback(" ", cb.noop()),
    ]);
  }

  rows.push([Markup.button.callback("Отмена", cb.bookAbort())]);

  return Markup.inlineKeyboard(rows);
}

export function timesKeyboard(slots: Slot[], timezone: string) {
  const rows: InlineKeyboardButton[][] = chunk(
    slots.map((slot) =>
      Markup.button.callback(
        formatTimeForUser(slot.start, timezone),
        cb.bookTime(slot.start.getTime()),
      ),
    ),
    TIME_COLUMNS,
  );

  rows.push([
    Markup.button.callback("‹ К датам", cb.bookDays(0)),
    Markup.button.callback("Отмена", cb.bookAbort()),
  ]);

  return Markup.inlineKeyboard(rows);
}

export function confirmKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✅ Подтвердить", cb.bookConfirm())],
    [Markup.button.callback("‹ К датам", cb.bookDays(0)), Markup.button.callback("Отмена", cb.bookAbort())],
  ]);
}

export function cancelConfirmKeyboard(appointmentId: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("Да, отменить", cb.apptCancelConfirm(appointmentId))],
    [Markup.button.callback("Оставить запись", cb.noop())],
  ]);
}
