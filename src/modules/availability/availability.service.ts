import type { Service } from "../../generated/prisma/client.js";
import type { Db } from "../../db/client.js";
import type { AppConfig } from "../../config/index.js";
import type { ScheduleService } from "../schedule/schedule.service.js";
import { localDateKey, localDayBounds, toZoned } from "../../utils/time.js";
import { availableSlots, slotFits, type Slot, type TimeRange } from "./availability.js";

/**
 * Внешний источник занятости. На Этапе 2 сюда подключается Google Calendar,
 * не трогая ни расчёт слотов, ни обработчики бота.
 */
export type BusySource = {
  name: string;
  busy(from: Date, to: Date): Promise<TimeRange[]>;
};

export type DayWithSlots = {
  /** локальная дата "yyyy-MM-dd" */
  date: string;
  /** первый слот дня — по нему сортируется список */
  firstStart: Date;
  slots: Slot[];
};

export class AvailabilityService {
  private readonly busySources: BusySource[] = [];

  constructor(
    private readonly db: Db,
    private readonly schedule: ScheduleService,
    private readonly config: AppConfig,
  ) {}

  /** Регистрация внешнего календаря. Этап 1 работает и без неё. */
  registerBusySource(source: BusySource): void {
    this.busySources.push(source);
  }

  /** Активные записи в интервале — занятость считается по blockedUntil. */
  private async busyFromDb(from: Date, to: Date): Promise<TimeRange[]> {
    const rows = await this.db.appointment.findMany({
      where: {
        status: { in: ["PENDING", "CONFIRMED"] },
        startAt: { lt: to },
        blockedUntil: { gt: from },
      },
      select: { startAt: true, blockedUntil: true },
    });

    return rows.map((row) => ({ start: row.startAt, end: row.blockedUntil }));
  }

  private async collectBusy(from: Date, to: Date): Promise<TimeRange[]> {
    const external = await Promise.all(this.busySources.map((source) => source.busy(from, to)));
    return [...(await this.busyFromDb(from, to)), ...external.flat()];
  }

  private async buildInput(from: Date, to: Date, service: Service, now: Date) {
    const [workingHours, exceptions, busy] = await Promise.all([
      this.schedule.workingHours(),
      this.schedule.exceptions(from, to),
      this.collectBusy(from, to),
    ]);

    return {
      from,
      to,
      now,
      timezone: this.config.timezone,
      slotStepMinutes: this.config.booking.slotStepMinutes,
      minLeadMinutes: this.config.booking.minLeadMinutes,
      service: {
        durationMinutes: service.durationMinutes,
        bufferMinutes: service.bufferMinutes,
      },
      workingHours,
      exceptions,
      busy,
    };
  }

  /** Горизонт бронирования: от «сейчас» на BOOKING_HORIZON_DAYS вперёд. */
  horizon(now: Date = new Date()): { from: Date; to: Date } {
    const zoned = toZoned(now, this.config.timezone);
    return {
      from: now,
      to: zoned.plus({ days: this.config.booking.horizonDays }).endOf("day").toJSDate(),
    };
  }

  async slotsInRange(
    from: Date,
    to: Date,
    service: Service,
    now: Date = new Date(),
  ): Promise<Slot[]> {
    return availableSlots(await this.buildInput(from, to, service, now));
  }

  /** Слоты, сгруппированные по локальным дням — так их показывает бот. */
  async daysWithSlots(service: Service, now: Date = new Date()): Promise<DayWithSlots[]> {
    const { from, to } = this.horizon(now);
    const slots = await this.slotsInRange(from, to, service, now);

    const byDay = new Map<string, Slot[]>();
    for (const slot of slots) {
      const key = localDateKey(slot.start, this.config.timezone);
      const list = byDay.get(key) ?? [];
      list.push(slot);
      byDay.set(key, list);
    }

    return [...byDay.entries()]
      .map(([date, daySlots]) => ({
        date,
        firstStart: daySlots[0]!.start,
        slots: daySlots,
      }))
      .sort((a, b) => a.firstStart.getTime() - b.firstStart.getTime());
  }

  /**
   * Слоты одного дня. Считает только запрошенные сутки: раньше здесь
   * пересчитывался весь горизонт ради одного дня, то есть тридцатикратная
   * лишняя работа на каждое нажатие кнопки с датой.
   */
  async slotsForDay(date: string, service: Service, now: Date = new Date()): Promise<Slot[]> {
    const bounds = localDayBounds(date, this.config.timezone);
    if (bounds === null) return [];

    // Пересечение суток с горизонтом: за его пределами слотов не существует.
    const horizon = this.horizon(now);
    const from = new Date(Math.max(bounds.start.getTime(), horizon.from.getTime()));
    const to = new Date(Math.min(bounds.end.getTime(), horizon.to.getTime()));

    if (from.getTime() >= to.getTime()) return [];

    return this.slotsInRange(from, to, service, now);
  }

  /**
   * Точная проверка конкретного старта — вызывается перед созданием записи.
   * Гонку она не закрывает, это делает exclusion constraint; здесь важно
   * показать человеку понятный отказ вместо ошибки БД.
   */
  async checkExactStart(
    start: Date,
    service: Service,
    now: Date = new Date(),
  ): Promise<Slot | null> {
    // Горизонт обязателен и здесь: callback_data приходит от клиента, и без этой
    // проверки подделанная кнопка позволяла записаться на любой год вперёд.
    if (start.getTime() >= this.horizon(now).to.getTime()) return null;

    const zoned = toZoned(start, this.config.timezone);
    const input = await this.buildInput(
      zoned.startOf("day").toJSDate(),
      zoned.endOf("day").toJSDate(),
      service,
      now,
    );

    // Запас времени проверяет уже сам slotFits — он читает now и minLeadMinutes.
    return slotFits(input, start);
  }

  /**
   * Слот из фактически предложенной выдачи.
   *
   * Нужен там, где момент пришёл от клиента: `checkExactStart` разрешает любое
   * подходящее время, в том числе мимо шага сетки, а подделанная callback_data
   * не должна давать клиенту больше, чем показанные ему кнопки.
   */
  async findOfferedSlot(
    start: Date,
    service: Service,
    now: Date = new Date(),
  ): Promise<Slot | null> {
    const slots = await this.slotsForDay(
      localDateKey(start, this.config.timezone),
      service,
      now,
    );

    return slots.find((slot) => slot.start.getTime() === start.getTime()) ?? null;
  }
}
