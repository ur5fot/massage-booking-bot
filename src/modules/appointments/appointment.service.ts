import type { AppConfig } from "../../config/index.js";
import type { Db } from "../../db/client.js";
import type {
  Appointment,
  AppointmentStatus,
  Service,
  User,
} from "../../generated/prisma/client.js";
import { isExclusionViolation, SlotTakenError, ValidationError } from "../../utils/errors.js";
import type { AvailabilityService } from "../availability/availability.service.js";

export const ACTIVE_STATUSES: AppointmentStatus[] = ["PENDING", "CONFIRMED"];

export type AppointmentWithService = Appointment & { service: Service };

export type CreateAppointmentInput = {
  user: User;
  service: Service;
  start: Date;
  comment?: string | undefined;
};

export class AppointmentService {
  constructor(
    private readonly db: Db,
    private readonly availability: AvailabilityService,
    private readonly config: AppConfig,
  ) {}

  async activeForUser(userId: string, now: Date = new Date()): Promise<AppointmentWithService[]> {
    return this.db.appointment.findMany({
      where: { userId, status: { in: ACTIVE_STATUSES }, startAt: { gte: now } },
      orderBy: { startAt: "asc" },
      include: { service: true },
    });
  }

  async byIdForUser(id: string, userId: string): Promise<AppointmentWithService | null> {
    // Принадлежность проверяется запросом, а не после выборки: callback_data
    // приходит от клиента и доверять ей нельзя.
    return this.db.appointment.findFirst({
      where: { id, userId },
      include: { service: true },
    });
  }

  /**
   * Создание записи.
   *
   * Проверка доступности здесь — ради понятного сообщения пользователю.
   * Настоящая гарантия непересечения — exclusion constraint appointment_no_overlap,
   * поэтому ошибка 23P01 обрабатывается как штатный сценарий, а не как сбой.
   */
  async create(input: CreateAppointmentInput, now: Date = new Date()): Promise<AppointmentWithService> {
    const slot = await this.availability.checkExactStart(input.start, input.service, now);
    if (slot === null) throw new SlotTakenError();

    try {
      return await this.db.$transaction(async (tx) => {
        // Блокировка по пользователю на время транзакции: без неё две
        // параллельные записи считали лимит по одному и тому же состоянию
        // и обе проходили, давая на одну активную запись больше максимума.
        // Лочим только этого клиента, чужие брони не ждут.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.user.id}, 0))`;

        const activeCount = await tx.appointment.count({
          where: { userId: input.user.id, status: { in: ACTIVE_STATUSES }, startAt: { gte: now } },
        });

        if (activeCount >= this.config.booking.maxActiveAppointments) {
          throw new ValidationError(
            `У вас уже ${activeCount} активных записей — это максимум.\n\n` +
              "Отмените одну из них, чтобы записаться снова.",
          );
        }

        return tx.appointment.create({
          data: {
            userId: input.user.id,
            serviceId: input.service.id,
            startAt: slot.start,
            endAt: slot.end,
            blockedUntil: slot.blockedUntil,
            status: "CONFIRMED",
            comment: input.comment ?? null,
          },
          include: { service: true },
        });
      });
    } catch (error) {
      if (isExclusionViolation(error)) throw new SlotTakenError();
      throw error;
    }
  }

  /** Отмена клиентом: с проверкой владельца и дедлайна. */
  async cancelByUser(
    id: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<AppointmentWithService> {
    const appointment = await this.byIdForUser(id, userId);

    if (appointment === null || !ACTIVE_STATUSES.includes(appointment.status)) {
      throw new ValidationError("Запись не найдена или уже отменена.");
    }

    const deadlineMs = this.config.booking.cancelDeadlineHours * 3_600_000;
    if (appointment.startAt.getTime() - now.getTime() < deadlineMs) {
      throw new ValidationError(
        `Отменить самостоятельно можно не позже чем за ${this.config.booking.cancelDeadlineHours} ч ` +
          "до сеанса.\n\nНапишите массажисту напрямую — контакты есть в меню.",
      );
    }

    return this.db.appointment.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: { service: true },
    });
  }
}
