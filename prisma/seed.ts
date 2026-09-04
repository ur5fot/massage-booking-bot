import "dotenv/config";
import { createDb } from "../src/db/client.js";

/**
 * Базовые данные: одна услуга и расписание из AGENTS.md.
 * Расписание живёт в БД, а не в коде, — сид только задаёт стартовое состояние.
 */
const WORKING_HOURS = [
  { dayOfWeek: 1, startTime: "10:00", endTime: "18:00", enabled: true },
  { dayOfWeek: 2, startTime: "10:00", endTime: "18:00", enabled: true },
  { dayOfWeek: 3, startTime: "10:00", endTime: "18:00", enabled: false },
  { dayOfWeek: 4, startTime: "12:00", endTime: "20:00", enabled: true },
  { dayOfWeek: 5, startTime: "10:00", endTime: "18:00", enabled: true },
  { dayOfWeek: 6, startTime: "10:00", endTime: "15:00", enabled: true },
  { dayOfWeek: 7, startTime: "10:00", endTime: "18:00", enabled: false },
];

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) throw new Error("DATABASE_URL не задан");

  const db = createDb(databaseUrl);

  try {
    const existing = await db.service.findFirst({ where: { name: "Массаж спины" } });
    const service =
      existing ??
      (await db.service.create({
        data: {
          name: "Массаж спины",
          durationMinutes: 60,
          bufferMinutes: 15,
          price: 80_000,
          enabled: true,
          sortOrder: 0,
        },
      }));

    for (const rule of WORKING_HOURS) {
      await db.workingHours.upsert({
        where: { dayOfWeek_startTime: { dayOfWeek: rule.dayOfWeek, startTime: rule.startTime } },
        create: rule,
        update: { endTime: rule.endTime, enabled: rule.enabled },
      });
    }

    console.log(
      JSON.stringify({
        msg: "Сид выполнен",
        service: service.name,
        durationMinutes: service.durationMinutes,
        bufferMinutes: service.bufferMinutes,
        workingHoursRows: WORKING_HOURS.length,
      }),
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
