import type { Db } from "../../db/client.js";
import { dateOnlyToKey, keyToDateOnly, localDateKey } from "../../utils/time.js";
import type {
  ScheduleExceptionRule,
  WorkingHoursRule,
} from "../availability/availability.js";

export class ScheduleService {
  constructor(
    private readonly db: Db,
    private readonly timezone: string,
  ) {}

  async workingHours(): Promise<WorkingHoursRule[]> {
    const rows = await this.db.workingHours.findMany({
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    });

    return rows.map((row) => ({
      dayOfWeek: row.dayOfWeek,
      startTime: row.startTime,
      endTime: row.endTime,
      enabled: row.enabled,
    }));
  }

  /** Исключения, попадающие в интервал. Границы берутся по локальным датам. */
  async exceptions(from: Date, to: Date): Promise<ScheduleExceptionRule[]> {
    const rows = await this.db.scheduleException.findMany({
      where: {
        date: {
          gte: keyToDateOnly(localDateKey(from, this.timezone)),
          lte: keyToDateOnly(localDateKey(to, this.timezone)),
        },
      },
    });

    return rows.map((row) => ({
      date: dateOnlyToKey(row.date),
      type: row.type,
      ...(row.startAt !== null ? { startAt: row.startAt } : {}),
      ...(row.endAt !== null ? { endAt: row.endAt } : {}),
    }));
  }
}
