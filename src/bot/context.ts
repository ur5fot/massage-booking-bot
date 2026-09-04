import type { Context } from "telegraf";
import type { AppConfig } from "../config/index.js";
import type { Db } from "../db/client.js";
import type { Logger } from "../utils/logger.js";
import type { User } from "../generated/prisma/client.js";
import type { UserService } from "../modules/users/user.service.js";
import type { ServiceCatalog } from "../modules/services/service.service.js";
import type { ScheduleService } from "../modules/schedule/schedule.service.js";
import type { AvailabilityService } from "../modules/availability/availability.service.js";
import type { AppointmentService } from "../modules/appointments/appointment.service.js";

export type Container = {
  db: Db;
  config: AppConfig;
  logger: Logger;
  users: UserService;
  services: ServiceCatalog;
  schedule: ScheduleService;
  availability: AvailabilityService;
  appointments: AppointmentService;
};

/** Шаг диалога записи. Хранится в БД, чтобы переживать перезапуск процесса. */
export type BookingStep = "idle" | "askName" | "askPhone" | "confirm";

export type BookingState = {
  step: BookingStep;
  serviceId?: string;
  /** момент начала в миллисекундах UTC; локальную строку хранить нельзя из-за DST */
  startAtMs?: number;
  name?: string;
  phone?: string;
  /** момент только что созданной записи — чтобы узнать повторное подтверждение */
  bookedAtMs?: number;
};

export type SessionData = {
  booking: BookingState;
};

export function emptySession(): SessionData {
  return { booking: { step: "idle" } };
}

export type BotContext = Context & {
  session: SessionData;
  container: Container;
  logger: Logger;
  /** Текущий пользователь. Проставляется middleware до всех обработчиков. */
  currentUser: User;
};
