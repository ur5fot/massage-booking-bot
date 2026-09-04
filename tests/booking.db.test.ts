import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildConfig } from "../src/config/index.js";
import { loadEnv } from "../src/config/env.js";
import { createDb, type Db } from "../src/db/client.js";
import { buildContainer } from "../src/app.js";
import type { Container } from "../src/bot/context.js";
import type { Service, User } from "../src/generated/prisma/client.js";
import { isExclusionViolation, SlotTakenError, ValidationError } from "../src/utils/errors.js";
import { startSessionCleanup } from "../src/jobs/session-cleanup.js";
import type { Logger } from "../src/utils/logger.js";

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

/**
 * Тесты против настоящей базы: exclusion constraint нельзя проверить в памяти.
 * Запуск: RUN_DB_TESTS=1 npm run test:db
 */
const enabled = process.env.RUN_DB_TESTS === "1";
const TEST_TELEGRAM_ID = 999_000_111_222n;

describe.skipIf(!enabled)("бронирование против настоящей БД", () => {
  let db: Db;
  let container: Container;
  let user: User;
  let service: Service;
  let start: Date;
  const now = new Date();

  beforeAll(async () => {
    // Тестам бот не нужен, но конфигурация валидируется целиком.
    const botToken =
      process.env.BOT_TOKEN === undefined || process.env.BOT_TOKEN === ""
        ? "test-token"
        : process.env.BOT_TOKEN;

    const config = buildConfig(loadEnv({ ...process.env, BOT_TOKEN: botToken }));
    db = createDb(config.env.DATABASE_URL);
    container = buildContainer(config, db);

    await db.user.deleteMany({ where: { telegramId: TEST_TELEGRAM_ID } });
    user = await db.user.create({
      data: { telegramId: TEST_TELEGRAM_ID, name: "Тест", phone: "+380000000000" },
    });

    service = await container.services.default();

    const days = await container.availability.daysWithSlots(service, now);
    const firstSlot = days[0]?.slots[0];
    if (firstSlot === undefined) throw new Error("Нет свободных слотов — проверьте сид расписания");
    start = firstSlot.start;
  });

  afterAll(async () => {
    if (db === undefined) return;
    await db.user.deleteMany({ where: { telegramId: TEST_TELEGRAM_ID } });
    await db.$disconnect();
  });

  it("создаёт запись и считает границы по услуге", async () => {
    const appointment = await container.appointments.create({ user, service, start }, now);

    expect(appointment.startAt.getTime()).toBe(start.getTime());
    expect(appointment.endAt.getTime()).toBe(start.getTime() + service.durationMinutes * 60_000);
    expect(appointment.blockedUntil.getTime()).toBe(
      appointment.endAt.getTime() + service.bufferMinutes * 60_000,
    );

    await db.appointment.delete({ where: { id: appointment.id } });
  });

  it("занятый слот исчезает из выдачи вместе с буфером", async () => {
    const appointment = await container.appointments.create({ user, service, start }, now);

    const slots = await container.availability.slotsInRange(
      new Date(start.getTime() - 3_600_000),
      new Date(start.getTime() + 3 * 3_600_000),
      service,
      now,
    );
    const starts = slots.map((slot) => slot.start.getTime());

    expect(starts).not.toContain(start.getTime());
    expect(await container.availability.checkExactStart(start, service, now)).toBeNull();

    await db.appointment.delete({ where: { id: appointment.id } });
  });

  it("параллельные попытки на один слот дают ровно одну запись", async () => {
    // Ключевой тест: проверка доступности в коде обе попытки проходит,
    // ловит их exclusion constraint на уровне БД.
    const results = await Promise.allSettled([
      container.appointments.create({ user, service, start }, now),
      container.appointments.create({ user, service, start }, now),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.status === "rejected" && rejected[0].reason).toBeInstanceOf(SlotTakenError);

    const stored = await db.appointment.count({
      where: { userId: user.id, startAt: start, status: { in: ["PENDING", "CONFIRMED"] } },
    });
    expect(stored).toBe(1);

    await db.appointment.deleteMany({ where: { userId: user.id } });
  });

  it("БД сама отклоняет пересечение в обход прикладной проверки", async () => {
    // Пишем напрямую, минуя AppointmentService: так проверяется именно
    // constraint appointment_no_overlap и разбор кода ошибки 23P01.
    const first = await db.appointment.create({
      data: {
        userId: user.id,
        serviceId: service.id,
        startAt: start,
        endAt: new Date(start.getTime() + 60 * 60_000),
        blockedUntil: new Date(start.getTime() + 75 * 60_000),
        status: "CONFIRMED",
      },
    });

    const overlapping = db.appointment.create({
      data: {
        userId: user.id,
        serviceId: service.id,
        // Начинается на 30 минут позже — середина занятого интервала.
        startAt: new Date(start.getTime() + 30 * 60_000),
        endAt: new Date(start.getTime() + 90 * 60_000),
        blockedUntil: new Date(start.getTime() + 105 * 60_000),
        status: "CONFIRMED",
      },
    });

    await expect(overlapping).rejects.toSatisfy(isExclusionViolation);

    // Отменённая запись перестаёт мешать: constraint частичный.
    await db.appointment.update({ where: { id: first.id }, data: { status: "CANCELLED" } });
    const afterCancel = await db.appointment.create({
      data: {
        userId: user.id,
        serviceId: service.id,
        startAt: start,
        endAt: new Date(start.getTime() + 60 * 60_000),
        blockedUntil: new Date(start.getTime() + 75 * 60_000),
        status: "CONFIRMED",
      },
    });

    expect(afterCancel.id).not.toBe(first.id);
    await db.appointment.deleteMany({ where: { userId: user.id } });
  });

  it("после отмены слот снова свободен", async () => {
    const appointment = await container.appointments.create({ user, service, start }, now);
    expect(await container.availability.checkExactStart(start, service, now)).toBeNull();

    // Дедлайн отмены считается от «сейчас», поэтому для проверки берём момент заведомо раньше.
    const wayBefore = new Date(start.getTime() - 30 * 24 * 3_600_000);
    await container.appointments.cancelByUser(appointment.id, user.id, wayBefore);

    expect(await container.availability.checkExactStart(start, service, now)).not.toBeNull();
  });

  it("не пускает за горизонт бронирования", async () => {
    // Регрессия: checkExactStart проверял только рабочие часы и запас времени,
    // поэтому подделанная callback_data позволяла записаться на любой год вперёд.
    const days = await container.availability.daysWithSlots(service, now);
    const lastOffered = days.at(-1)?.date;
    expect(lastOffered).toBeDefined();

    const farFuture = new Date(start.getTime() + 200 * 24 * 3_600_000);
    const sameWeekdayHour = new Date(farFuture);

    expect(await container.availability.checkExactStart(sameWeekdayHour, service, now)).toBeNull();
  });

  it("слоты одного дня совпадают с общей выдачей по этому дню", async () => {
    // Расчёт одного дня оптимизирован отдельно от полного горизонта —
    // результат обязан остаться тем же.
    const days = await container.availability.daysWithSlots(service, now);
    const target = days[1] ?? days[0];
    expect(target).toBeDefined();

    const direct = await container.availability.slotsForDay(target!.date, service, now);

    expect(direct.map((slot) => slot.start.toISOString())).toEqual(
      target!.slots.map((slot) => slot.start.toISOString()),
    );
  });

  it("не отдаёт клиенту время мимо шага сетки", async () => {
    // checkExactStart разрешает любое подходящее время — это нужно для ручной
    // записи массажистом. Клиентский путь обязан отдавать только показанное,
    // иначе подделанная callback_data даёт больше, чем нарисованные кнопки.
    const offGrid = new Date(start.getTime() + 7 * 60_000);

    expect(await container.availability.checkExactStart(offGrid, service, now)).not.toBeNull();
    expect(await container.availability.findOfferedSlot(offGrid, service, now)).toBeNull();
    expect(await container.availability.findOfferedSlot(start, service, now)).not.toBeNull();
  });

  it("держит лимит активных записей под параллельной нагрузкой", async () => {
    // Регрессия: count и insert шли вне транзакции, поэтому две одновременные
    // записи считали лимит по одному состоянию и обе проходили.
    const limit = container.config.booking.maxActiveAppointments;
    const days = await container.availability.daysWithSlots(service, now);
    // По одному слоту на день: соседние слоты одного дня перекрываются
    // буфером, и занять их все подряд невозможно by design.
    const starts = days.slice(0, limit * 3).map((day) => day.slots[0]!.start);

    expect(starts.length).toBeGreaterThan(limit);

    // Все претенденты стартуют одновременно с нуля: так окно между подсчётом
    // лимита и вставкой реально перекрывается у нескольких транзакций.
    const results = await Promise.allSettled(
      starts.map((at) => container.appointments.create({ user, service, start: at }, now)),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(limit);
    for (const result of results.filter((r) => r.status === "rejected")) {
      expect(result.status === "rejected" && result.reason).toBeInstanceOf(ValidationError);
    }

    const active = await db.appointment.count({
      where: { userId: user.id, status: { in: ["PENDING", "CONFIRMED"] }, startAt: { gte: now } },
    });
    expect(active).toBe(limit);

    await db.appointment.deleteMany({ where: { userId: user.id } });
  });

  it("чистка сессий убирает только просроченные", async () => {
    const fresh = `test-fresh-${Date.now()}`;
    const stale = `test-stale-${Date.now()}`;

    await db.botSession.create({ data: { key: fresh, data: {} } });
    await db.botSession.create({ data: { key: stale, data: {} } });
    // updatedAt проставляется автоматически, поэтому состариваем строку явно.
    await db.$executeRaw`UPDATE "BotSession" SET "updatedAt" = now() - interval '90 days' WHERE key = ${stale}`;

    const stop = startSessionCleanup(db, silentLogger, { maxAgeDays: 30, intervalMs: 3_600_000 });
    await vi.waitFor(async () => {
      expect(await db.botSession.findUnique({ where: { key: stale } })).toBeNull();
    });
    stop();

    expect(await db.botSession.findUnique({ where: { key: fresh } })).not.toBeNull();
    await db.botSession.deleteMany({ where: { key: { in: [fresh, stale] } } });
  });

  it("не даёт отменить чужую запись", async () => {
    const appointment = await container.appointments.create({ user, service, start }, now);
    const wayBefore = new Date(start.getTime() - 30 * 24 * 3_600_000);

    await expect(
      container.appointments.cancelByUser(appointment.id, "00000000-0000-0000-0000-000000000000", wayBefore),
    ).rejects.toBeInstanceOf(ValidationError);

    await db.appointment.deleteMany({ where: { userId: user.id } });
  });
});
