import type { Telegraf } from "telegraf";
import { buildConfig, type AppConfig } from "./config/index.js";
import { createDb, type Db } from "./db/client.js";
import { createLogger } from "./utils/logger.js";
import { createBot } from "./bot/index.js";
import type { BotContext, Container } from "./bot/context.js";
import { UserService } from "./modules/users/user.service.js";
import { ServiceCatalog } from "./modules/services/service.service.js";
import { ScheduleService } from "./modules/schedule/schedule.service.js";
import { AvailabilityService } from "./modules/availability/availability.service.js";
import { AppointmentService } from "./modules/appointments/appointment.service.js";
import { startSessionCleanup } from "./jobs/session-cleanup.js";

export type App = {
  config: AppConfig;
  db: Db;
  container: Container;
  bot: Telegraf<BotContext>;
  start(): Promise<void>;
  stop(signal: string): Promise<void>;
};

export function buildContainer(config: AppConfig, db: Db): Container {
  const logger = createLogger(config.env.LOG_LEVEL);
  const schedule = new ScheduleService(db, config.timezone);
  const availability = new AvailabilityService(db, schedule, config);

  return {
    db,
    config,
    logger,
    users: new UserService(db),
    services: new ServiceCatalog(db),
    schedule,
    availability,
    appointments: new AppointmentService(db, availability, config),
  };
}

export function createApp(config: AppConfig = buildConfig()): App {
  const db = createDb(config.env.DATABASE_URL);
  const container = buildContainer(config, db);
  const bot = createBot(container);

  let stopSessionCleanup: (() => void) | undefined;

  return {
    config,
    db,
    container,
    bot,

    async start() {
      // Услуга нужна для любой записи — лучше упасть на старте, чем в диалоге.
      const service = await container.services.default();

      container.logger.info("Бот запускается", {
        timezone: config.timezone,
        service: service.name,
        horizonDays: config.booking.horizonDays,
      });

      stopSessionCleanup = startSessionCleanup(db, container.logger, {
        maxAgeDays: config.sessionTtlDays,
        intervalMs: 6 * 3_600_000,
      });

      // Long polling: для MVP этого достаточно и не нужен публичный HTTPS.
      await bot.launch({ dropPendingUpdates: true });
    },

    async stop(signal: string) {
      container.logger.info("Остановка бота", { signal });
      stopSessionCleanup?.();
      bot.stop(signal);
      await db.$disconnect();
    },
  };
}
