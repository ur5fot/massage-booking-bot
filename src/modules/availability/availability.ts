import type { DateTime } from "luxon";
import { DateTime as LuxonDateTime } from "luxon";
import { localDatesBetween, overlaps, parseHourMinute } from "../../utils/time.js";

/**
 * Ключевая функция проекта. Чистая: никакой БД, никакого Google, никакого
 * системного времени — всё приходит аргументами, поэтому её можно нормально
 * покрыть тестами, включая переход на летнее время.
 */

export type TimeRange = { start: Date; end: Date };

export type WorkingHoursRule = {
  /** ISO-нумерация: 1 = понедельник ... 7 = воскресенье */
  dayOfWeek: number;
  /** локальное время в формате "HH:mm" */
  startTime: string;
  endTime: string;
  enabled: boolean;
};

export type ScheduleExceptionType = "DAY_OFF" | "CUSTOM_HOURS" | "BLOCK";

export type ScheduleExceptionRule = {
  /** локальная календарная дата "yyyy-MM-dd" */
  date: string;
  type: ScheduleExceptionType;
  /** для CUSTOM_HOURS — границы дня, для BLOCK — заблокированный интервал */
  startAt?: Date;
  endAt?: Date;
};

export type ServiceShape = {
  durationMinutes: number;
  bufferMinutes: number;
};

export type AvailabilityInput = {
  /** начало окна поиска */
  from: Date;
  /** конец окна поиска */
  to: Date;
  /** текущий момент; передаётся явно, чтобы тесты не зависели от часов машины */
  now: Date;
  timezone: string;
  slotStepMinutes: number;
  minLeadMinutes: number;
  service: ServiceShape;
  workingHours: WorkingHoursRule[];
  exceptions: ScheduleExceptionRule[];
  /**
   * Занятое время: записи из БД (startAt..blockedUntil) и события Google Calendar.
   * Блокировки из exceptions добавляются сюда автоматически.
   */
  busy: TimeRange[];
};

export type Slot = {
  start: Date;
  /** конец сеанса — то, что видит клиент */
  end: Date;
  /** конец занятости — конец сеанса плюс буфер */
  blockedUntil: Date;
};

function windowsForDay(
  day: DateTime,
  workingHours: WorkingHoursRule[],
  exceptionsByDate: Map<string, ScheduleExceptionRule[]>,
): TimeRange[] {
  const key = day.toFormat("yyyy-MM-dd");
  const dayExceptions = exceptionsByDate.get(key) ?? [];

  if (dayExceptions.some((exception) => exception.type === "DAY_OFF")) {
    return [];
  }

  const customHours = dayExceptions.filter((exception) => exception.type === "CUSTOM_HOURS");
  if (customHours.length > 0) {
    return customHours
      .filter(
        (exception): exception is ScheduleExceptionRule & { startAt: Date; endAt: Date } =>
          exception.startAt !== undefined && exception.endAt !== undefined,
      )
      .map((exception) => ({ start: exception.startAt, end: exception.endAt }))
      .filter((range) => range.start.getTime() < range.end.getTime());
  }

  return workingHours
    .filter((rule) => rule.enabled && rule.dayOfWeek === day.weekday)
    .map((rule) => {
      const start = parseHourMinute(rule.startTime);
      const end = parseHourMinute(rule.endTime);
      return {
        start: day.set(start).toJSDate(),
        end: day.set(end).toJSDate(),
      };
    })
    .filter((range) => range.start.getTime() < range.end.getTime());
}

function collectBusy(input: AvailabilityInput): TimeRange[] {
  const blocks = input.exceptions
    .filter(
      (exception): exception is ScheduleExceptionRule & { startAt: Date; endAt: Date } =>
        exception.type === "BLOCK" && exception.startAt !== undefined && exception.endAt !== undefined,
    )
    .map((exception) => ({ start: exception.startAt, end: exception.endAt }));

  return [...input.busy, ...blocks];
}

function isFree(slot: Slot, busy: TimeRange[]): boolean {
  // Пересечение проверяется по blockedUntil: буфер после сеанса — тоже занятое время.
  return !busy.some((range) => overlaps(slot.start, slot.blockedUntil, range.start, range.end));
}

function buildSlot(start: DateTime, service: ServiceShape): Slot {
  const end = start.plus({ minutes: service.durationMinutes });
  return {
    start: start.toJSDate(),
    end: end.toJSDate(),
    blockedUntil: end.plus({ minutes: service.bufferMinutes }).toJSDate(),
  };
}

/**
 * Свободные слоты в интервале [from, to).
 *
 * Сеанс обязан целиком помещаться в рабочее окно, а буфер после него — нет:
 * буфер это перерыв мастера, из-за него последний слот дня не должен пропадать.
 * При этом буфер обязан не пересекаться с чужой занятостью.
 */
export function availableSlots(input: AvailabilityInput): Slot[] {
  const busy = collectBusy(input);
  const exceptionsByDate = new Map<string, ScheduleExceptionRule[]>();
  for (const exception of input.exceptions) {
    const list = exceptionsByDate.get(exception.date) ?? [];
    list.push(exception);
    exceptionsByDate.set(exception.date, list);
  }

  const earliestStart = new Date(input.now.getTime() + input.minLeadMinutes * 60_000);
  const step = input.slotStepMinutes;
  const seen = new Set<number>();
  const slots: Slot[] = [];

  for (const day of localDatesBetween(input.from, input.to, input.timezone)) {
    for (const window of windowsForDay(day, input.workingHours, exceptionsByDate)) {
      let cursor = LuxonDateTime.fromJSDate(window.start, { zone: input.timezone });

      for (;;) {
        const slot = buildSlot(cursor, input.service);
        if (slot.end.getTime() > window.end.getTime()) break;

        const startMs = slot.start.getTime();
        const withinRequestedRange =
          startMs >= input.from.getTime() && startMs < input.to.getTime();

        if (
          withinRequestedRange &&
          startMs >= earliestStart.getTime() &&
          !seen.has(startMs) &&
          isFree(slot, busy)
        ) {
          seen.add(startMs);
          slots.push(slot);
        }

        cursor = cursor.plus({ minutes: step });
      }
    }
  }

  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Проверка конкретного времени без привязки к шагу сетки — для ручной записи
 * массажистом, когда время не совпадает с шагом.
 *
 * Все остальные ограничения из `AvailabilityInput` применяются так же, как в
 * `availableSlots`: окно поиска, «сейчас» и минимальный запас. Иначе одна и та
 * же структура на входе давала бы у двух функций разный ответ, и вызывающий код
 * незаметно терял проверки. Для ручной записи без запаса передавайте
 * `minLeadMinutes: 0` явно.
 */
export function slotFits(input: AvailabilityInput, start: Date): Slot | null {
  const startMs = start.getTime();

  if (startMs < input.from.getTime() || startMs >= input.to.getTime()) return null;
  if (startMs < input.now.getTime() + input.minLeadMinutes * 60_000) return null;

  const busy = collectBusy(input);
  const exceptionsByDate = new Map<string, ScheduleExceptionRule[]>();
  for (const exception of input.exceptions) {
    const list = exceptionsByDate.get(exception.date) ?? [];
    list.push(exception);
    exceptionsByDate.set(exception.date, list);
  }

  const day = localDatesBetween(start, start, input.timezone)[0];
  if (day === undefined) return null;

  const endMs = start.getTime() + input.service.durationMinutes * 60_000;
  const slot: Slot = {
    start,
    end: new Date(endMs),
    blockedUntil: new Date(endMs + input.service.bufferMinutes * 60_000),
  };

  const insideWorkingHours = windowsForDay(day, input.workingHours, exceptionsByDate).some(
    (window) =>
      slot.start.getTime() >= window.start.getTime() &&
      slot.end.getTime() <= window.end.getTime(),
  );

  if (!insideWorkingHours) return null;
  if (!isFree(slot, busy)) return null;

  return slot;
}
