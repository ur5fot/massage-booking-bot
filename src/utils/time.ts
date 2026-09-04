import { DateTime } from "luxon";

export const TIME_FORMAT = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type HourMinute = { hour: number; minute: number };

/** Разбирает "HH:mm" из WorkingHours. Формат проверяется, а не угадывается. */
export function parseHourMinute(value: string): HourMinute {
  const match = TIME_FORMAT.exec(value);
  if (match === null) {
    throw new Error(`Некорректное время "${value}", ожидается формат HH:mm`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function toZoned(instant: Date, timezone: string): DateTime {
  return DateTime.fromJSDate(instant, { zone: timezone });
}

/** Локальная календарная дата в виде "yyyy-MM-dd". */
export function localDateKey(instant: Date, timezone: string): string {
  return toZoned(instant, timezone).toFormat("yyyy-MM-dd");
}

/** Границы локальных суток по ключу "yyyy-MM-dd". */
export function localDayBounds(
  dateKey: string,
  timezone: string,
): { start: Date; end: Date } | null {
  const day = DateTime.fromFormat(dateKey, "yyyy-MM-dd", { zone: timezone });
  if (!day.isValid) return null;

  return { start: day.startOf("day").toJSDate(), end: day.endOf("day").toJSDate() };
}

/**
 * Список локальных дат, которые попадают в интервал. Границы включаются,
 * потому что день может задеть окно частично.
 */
export function localDatesBetween(from: Date, to: Date, timezone: string): DateTime[] {
  const first = toZoned(from, timezone).startOf("day");
  const last = toZoned(to, timezone).startOf("day");

  const dates: DateTime[] = [];
  for (let day = first; day <= last; day = day.plus({ days: 1 })) {
    dates.push(day);
  }
  return dates;
}

/**
 * Колонка типа DATE приезжает из Prisma как полночь UTC. Ключ надо брать в UTC,
 * иначе Europe/Kyiv сдвинет дату на сутки назад.
 */
export function dateOnlyToKey(value: Date): string {
  return DateTime.fromJSDate(value, { zone: "utc" }).toFormat("yyyy-MM-dd");
}

/** Обратное преобразование: "yyyy-MM-dd" -> полночь UTC для колонки DATE. */
export function keyToDateOnly(key: string): Date {
  const parsed = DateTime.fromFormat(key, "yyyy-MM-dd", { zone: "utc" });
  if (!parsed.isValid) throw new Error(`Некорректная дата "${key}", ожидается yyyy-MM-dd`);
  return parsed.toJSDate();
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

const WEEKDAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function formatDateForUser(instant: Date, timezone: string): string {
  const zoned = toZoned(instant, timezone);
  const weekday = WEEKDAY_NAMES[zoned.weekday - 1] ?? "";
  return `${zoned.toFormat("dd.MM")} (${weekday})`;
}

export function formatTimeForUser(instant: Date, timezone: string): string {
  return toZoned(instant, timezone).toFormat("HH:mm");
}

export function formatDateTimeForUser(instant: Date, timezone: string): string {
  return `${formatDateForUser(instant, timezone)} в ${formatTimeForUser(instant, timezone)}`;
}
