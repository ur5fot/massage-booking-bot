import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  availableSlots,
  slotFits,
  type AvailabilityInput,
  type WorkingHoursRule,
} from "../src/modules/availability/availability.js";

const TZ = "Europe/Kyiv";

/** Локальное время Киева -> инстант. */
function kyiv(iso: string): Date {
  const dt = DateTime.fromISO(iso, { zone: TZ });
  if (!dt.isValid) throw new Error(`Плохая дата в тесте: ${iso}`);
  return dt.toJSDate();
}

function times(slots: { start: Date }[]): string[] {
  return slots.map((slot) => DateTime.fromJSDate(slot.start, { zone: TZ }).toFormat("yyyy-MM-dd HH:mm"));
}

const MON_TO_FRI: WorkingHoursRule[] = [1, 2, 3, 4, 5].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: "10:00",
  endTime: "18:00",
  enabled: true,
}));

function input(overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    from: kyiv("2026-09-07T00:00"),
    to: kyiv("2026-09-08T00:00"),
    now: kyiv("2026-09-06T12:00"),
    timezone: TZ,
    slotStepMinutes: 30,
    minLeadMinutes: 0,
    service: { durationMinutes: 60, bufferMinutes: 15 },
    workingHours: MON_TO_FRI,
    exceptions: [],
    busy: [],
    ...overrides,
  };
}

describe("availableSlots — рабочие часы", () => {
  it("раскладывает день по сетке от начала рабочего окна", () => {
    // Понедельник 2026-09-07, 10:00-18:00, сеанс 60 мин, шаг 30 мин.
    const slots = availableSlots(input());

    expect(times(slots)[0]).toBe("2026-09-07 10:00");
    expect(times(slots).at(-1)).toBe("2026-09-07 17:00");
    expect(slots).toHaveLength(15);
  });

  it("не выдаёт слотов в выходной день недели", () => {
    // Воскресенье 2026-09-06 в MON_TO_FRI отсутствует.
    const slots = availableSlots(
      input({ from: kyiv("2026-09-06T00:00"), to: kyiv("2026-09-07T00:00") }),
    );

    expect(slots).toHaveLength(0);
  });

  it("сеанс обязан помещаться в рабочее окно целиком", () => {
    const slots = availableSlots(
      input({ service: { durationMinutes: 90, bufferMinutes: 15 } }),
    );

    // Последний старт — 16:30, сеанс кончается ровно в 18:00.
    expect(times(slots).at(-1)).toBe("2026-09-07 16:30");
  });

  it("буферу разрешено выходить за конец рабочего дня", () => {
    // 17:00 + 60 мин = 18:00, буфер до 18:15 — слот остаётся.
    const slots = availableSlots(input());
    expect(times(slots)).toContain("2026-09-07 17:00");
  });

  it("поддерживает раздельные смены в один день", () => {
    const slots = availableSlots(
      input({
        workingHours: [
          { dayOfWeek: 1, startTime: "10:00", endTime: "12:00", enabled: true },
          { dayOfWeek: 1, startTime: "15:00", endTime: "18:00", enabled: true },
        ],
      }),
    );

    expect(times(slots)).toEqual([
      "2026-09-07 10:00",
      "2026-09-07 10:30",
      "2026-09-07 11:00",
      "2026-09-07 15:00",
      "2026-09-07 15:30",
      "2026-09-07 16:00",
      "2026-09-07 16:30",
      "2026-09-07 17:00",
    ]);
  });

  it("игнорирует выключенные правила", () => {
    const slots = availableSlots(
      input({ workingHours: MON_TO_FRI.map((rule) => ({ ...rule, enabled: false })) }),
    );

    expect(slots).toHaveLength(0);
  });
});

describe("availableSlots — занятость и буфер", () => {
  it("убирает слоты, пересекающиеся с записью", () => {
    const slots = availableSlots(
      input({
        busy: [{ start: kyiv("2026-09-07T12:00"), end: kyiv("2026-09-07T13:15") }],
      }),
    );

    expect(times(slots)).not.toContain("2026-09-07 12:00");
    expect(times(slots)).not.toContain("2026-09-07 12:30");
    // 11:30 + 60 = 12:30 — сам сеанс залезает в занятое 12:00-13:15.
    expect(times(slots)).not.toContain("2026-09-07 11:30");
    // 11:00 + 60 = 12:00, дальше буфер до 12:15 — мастер остался бы без перерыва.
    expect(times(slots)).not.toContain("2026-09-07 11:00");
    expect(times(slots)).toContain("2026-09-07 10:30");
  });

  it("буфер нового сеанса не должен налезать на чужую занятость", () => {
    // Занято 13:00-14:00. Слот 12:00 кончается в 13:00, но буфер тянется до 13:15.
    const slots = availableSlots(
      input({
        busy: [{ start: kyiv("2026-09-07T13:00"), end: kyiv("2026-09-07T14:00") }],
      }),
    );

    expect(times(slots)).not.toContain("2026-09-07 12:00");
    expect(times(slots)).toContain("2026-09-07 11:30");
  });

  it("сеанс встык после чужого буфера разрешён", () => {
    // Занято 12:00-13:15 (сеанс + буфер). Старт в 13:15 не пересекается.
    const slots = availableSlots(
      input({
        slotStepMinutes: 15,
        busy: [{ start: kyiv("2026-09-07T12:00"), end: kyiv("2026-09-07T13:15") }],
      }),
    );

    expect(times(slots)).toContain("2026-09-07 13:15");
  });

  it("нулевой буфер разрешает записи впритык", () => {
    const slots = availableSlots(
      input({
        service: { durationMinutes: 60, bufferMinutes: 0 },
        busy: [{ start: kyiv("2026-09-07T12:00"), end: kyiv("2026-09-07T13:00") }],
      }),
    );

    expect(times(slots)).toContain("2026-09-07 13:00");
    expect(times(slots)).toContain("2026-09-07 11:00");
  });
});

describe("availableSlots — исключения", () => {
  it("DAY_OFF закрывает весь день", () => {
    const slots = availableSlots(
      input({ exceptions: [{ date: "2026-09-07", type: "DAY_OFF" }] }),
    );

    expect(slots).toHaveLength(0);
  });

  it("CUSTOM_HOURS заменяет обычные часы дня", () => {
    const slots = availableSlots(
      input({
        exceptions: [
          {
            date: "2026-09-07",
            type: "CUSTOM_HOURS",
            startAt: kyiv("2026-09-07T14:00"),
            endAt: kyiv("2026-09-07T17:00"),
          },
        ],
      }),
    );

    expect(times(slots)).toEqual([
      "2026-09-07 14:00",
      "2026-09-07 14:30",
      "2026-09-07 15:00",
      "2026-09-07 15:30",
      "2026-09-07 16:00",
    ]);
  });

  it("BLOCK вырезает интервал внутри рабочего дня", () => {
    const slots = availableSlots(
      input({
        exceptions: [
          {
            date: "2026-09-07",
            type: "BLOCK",
            startAt: kyiv("2026-09-07T15:00"),
            endAt: kyiv("2026-09-07T16:00"),
          },
        ],
      }),
    );

    expect(times(slots)).not.toContain("2026-09-07 15:00");
    expect(times(slots)).not.toContain("2026-09-07 15:30");
    // 14:00 + 60 = 15:00, буфер до 15:15 залезает в блок.
    expect(times(slots)).not.toContain("2026-09-07 14:00");
    expect(times(slots)).toContain("2026-09-07 16:00");
  });

  it("исключение на другую дату не влияет", () => {
    const slots = availableSlots(
      input({ exceptions: [{ date: "2026-09-08", type: "DAY_OFF" }] }),
    );

    expect(slots).toHaveLength(15);
  });
});

describe("availableSlots — время и горизонт", () => {
  it("минимальный запас отсекает ближайшие слоты", () => {
    const slots = availableSlots(
      input({
        now: kyiv("2026-09-07T09:00"),
        minLeadMinutes: 120,
      }),
    );

    // Раньше 11:00 записаться нельзя.
    expect(times(slots)[0]).toBe("2026-09-07 11:00");
  });

  it("не выходит за границы запрошенного окна", () => {
    const slots = availableSlots(
      input({
        from: kyiv("2026-09-07T13:00"),
        to: kyiv("2026-09-07T15:00"),
      }),
    );

    // Границы окна отсекают начало слота, а не его конец: слот 14:30 стартует
    // до 15:00 и потому попадает в выдачу.
    expect(times(slots)).toEqual([
      "2026-09-07 13:00",
      "2026-09-07 13:30",
      "2026-09-07 14:00",
      "2026-09-07 14:30",
    ]);
  });

  it("собирает слоты за несколько дней подряд", () => {
    const slots = availableSlots(
      input({
        from: kyiv("2026-09-07T00:00"),
        to: kyiv("2026-09-09T00:00"),
      }),
    );

    const days = new Set(times(slots).map((value) => value.slice(0, 10)));
    expect([...days]).toEqual(["2026-09-07", "2026-09-08"]);
  });
});

describe("availableSlots — переход на летнее время", () => {
  // Киев переводит часы в последнее воскресенье октября: 2026-10-25, 04:00 -> 03:00.
  it("в день перевода часов рабочее окно не разъезжается", () => {
    const slots = availableSlots(
      input({
        from: kyiv("2026-10-25T00:00"),
        to: kyiv("2026-10-26T00:00"),
        now: kyiv("2026-10-24T00:00"),
        workingHours: [{ dayOfWeek: 7, startTime: "10:00", endTime: "18:00", enabled: true }],
      }),
    );

    expect(times(slots)[0]).toBe("2026-10-25 10:00");
    expect(times(slots).at(-1)).toBe("2026-10-25 17:00");

    // Первый слот — это 08:00 UTC, а не 07:00: зима, смещение +02:00.
    expect(slots[0]?.start.toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });

  it("летом то же локальное время даёт другой UTC-инстант", () => {
    const slots = availableSlots(
      input({
        from: kyiv("2026-07-06T00:00"),
        to: kyiv("2026-07-07T00:00"),
        now: kyiv("2026-07-05T00:00"),
      }),
    );

    // Лето, смещение +03:00.
    expect(slots[0]?.start.toISOString()).toBe("2026-07-06T07:00:00.000Z");
  });

  it("сутки с переводом часов не теряют и не удваивают слоты", () => {
    const workingHours: WorkingHoursRule[] = [
      { dayOfWeek: 7, startTime: "00:00", endTime: "23:30", enabled: true },
    ];

    const shifted = availableSlots(
      input({
        from: kyiv("2026-10-25T00:00"),
        to: kyiv("2026-10-26T00:00"),
        now: kyiv("2026-10-24T00:00"),
        slotStepMinutes: 60,
        service: { durationMinutes: 30, bufferMinutes: 0 },
        workingHours,
      }),
    );

    // Обычное воскресенье для сравнения.
    const normal = availableSlots(
      input({
        from: kyiv("2026-11-01T00:00"),
        to: kyiv("2026-11-02T00:00"),
        now: kyiv("2026-10-31T00:00"),
        slotStepMinutes: 60,
        service: { durationMinutes: 30, bufferMinutes: 0 },
        workingHours,
      }),
    );

    // В день перевода локальный час 03:00 повторяется, поэтому реальных часов больше.
    expect(shifted.length).toBe(normal.length + 1);
    expect(new Set(times(shifted)).size).toBe(normal.length);
  });
});

describe("slotFits — ручная запись вне сетки", () => {
  it("разрешает время, не попадающее на шаг сетки", () => {
    const slot = slotFits(input(), kyiv("2026-09-07T12:07"));

    expect(slot).not.toBeNull();
    expect(slot?.end.toISOString()).toBe(kyiv("2026-09-07T13:07").toISOString());
    expect(slot?.blockedUntil.toISOString()).toBe(kyiv("2026-09-07T13:22").toISOString());
  });

  it("отказывает вне рабочих часов", () => {
    expect(slotFits(input(), kyiv("2026-09-07T20:00"))).toBeNull();
  });

  it("учитывает минимальный запас так же, как availableSlots", () => {
    // Регрессия: slotFits игнорировал now и minLeadMinutes из того же входа,
    // и на одной структуре две функции отвечали по-разному.
    const withLead = input({ now: kyiv("2026-09-07T09:00"), minLeadMinutes: 120 });

    expect(availableSlots(withLead).map((slot) => slot.start.getTime())).not.toContain(
      kyiv("2026-09-07T10:00").getTime(),
    );
    expect(slotFits(withLead, kyiv("2026-09-07T10:00"))).toBeNull();
    expect(slotFits(withLead, kyiv("2026-09-07T11:00"))).not.toBeNull();
  });

  it("не выходит за окно поиска", () => {
    const narrow = input({ from: kyiv("2026-09-07T13:00"), to: kyiv("2026-09-07T15:00") });

    expect(slotFits(narrow, kyiv("2026-09-07T12:00"))).toBeNull();
    expect(slotFits(narrow, kyiv("2026-09-07T16:00"))).toBeNull();
    expect(slotFits(narrow, kyiv("2026-09-07T14:00"))).not.toBeNull();
  });

  it("отказывает при пересечении с занятостью", () => {
    const withBusy = input({
      busy: [{ start: kyiv("2026-09-07T12:00"), end: kyiv("2026-09-07T13:15") }],
    });

    expect(slotFits(withBusy, kyiv("2026-09-07T12:30"))).toBeNull();
  });
});
