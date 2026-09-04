import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { cb, parseCallback } from "../src/bot/callback-data.js";
import { availableSlots, type WorkingHoursRule } from "../src/modules/availability/availability.js";

const TZ = "Europe/Kyiv";

function kyiv(iso: string): Date {
  return DateTime.fromISO(iso, { zone: TZ }).toJSDate();
}

describe("callback_data — разбор", () => {
  it("принимает свои же значения", () => {
    expect(parseCallback(cb.bookDays(2))).toEqual({ kind: "bookDays", page: 2 });
    expect(parseCallback(cb.bookDate("2026-09-07"))).toEqual({
      kind: "bookDate",
      date: "2026-09-07",
    });
    expect(parseCallback(cb.bookConfirm())).toEqual({ kind: "bookConfirm" });
  });

  it("отбрасывает мусор и подделки", () => {
    expect(parseCallback("bk:d:not-a-date")).toBeNull();
    expect(parseCallback("bk:t:2026-09-07T12:00")).toBeNull();
    expect(parseCallback("bk:t:-1")).toBeNull();
    expect(parseCallback("ap:c:not-a-uuid")).toBeNull();
    expect(parseCallback("../../etc/passwd")).toBeNull();
  });

  it("умещается в лимит Telegram в 64 байта", () => {
    const longest = cb.apptCancelConfirm("123e4567-e89b-12d3-a456-426614174000");
    expect(Buffer.byteLength(longest, "utf8")).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(cb.bookTime(Date.now()), "utf8")).toBeLessThanOrEqual(64);
  });
});

describe("callback_data — перевод часов", () => {
  // Киев переводит часы назад 2026-10-25: локальные 03:00 и 03:30 наступают дважды.
  const workingHours: WorkingHoursRule[] = [
    { dayOfWeek: 7, startTime: "00:00", endTime: "23:30", enabled: true },
  ];

  const slots = availableSlots({
    from: kyiv("2026-10-25T00:00"),
    to: kyiv("2026-10-26T00:00"),
    now: kyiv("2026-10-24T00:00"),
    timezone: TZ,
    slotStepMinutes: 30,
    minLeadMinutes: 0,
    service: { durationMinutes: 30, bufferMinutes: 0 },
    workingHours,
    exceptions: [],
    busy: [],
  });

  it("два разных слота с одинаковым локальным временем различимы", () => {
    const ambiguous = slots.filter(
      (slot) => DateTime.fromJSDate(slot.start, { zone: TZ }).toFormat("HH:mm") === "03:00",
    );

    // Убеждаемся, что неоднозначность вообще есть — иначе тест ничего не проверяет.
    expect(ambiguous).toHaveLength(2);
    expect(ambiguous[0]!.start.getTime()).not.toBe(ambiguous[1]!.start.getTime());

    const first = cb.bookTime(ambiguous[0]!.start.getTime());
    const second = cb.bookTime(ambiguous[1]!.start.getTime());

    // Регрессия: раньше в кнопку писалось локальное "2026-10-25T03:00", и обе
    // кнопки получали одинаковую callback_data — второй слот был недоступен.
    expect(first).not.toBe(second);
  });

  it("каждая кнопка возвращает ровно свой момент", () => {
    for (const slot of slots) {
      const parsed = parseCallback(cb.bookTime(slot.start.getTime()));
      expect(parsed).toEqual({ kind: "bookTime", startAtMs: slot.start.getTime() });
    }
  });

  it("несуществующее весной локальное время не превращается в другой слот", () => {
    // 2026-03-29 в Киеве 03:30 не существует: часы прыгают с 03:00 на 04:00.
    // Старый формат Luxon молча превращал его в 04:30 — теперь такой ввод не парсится.
    expect(parseCallback("bk:t:2026-03-29T03:30")).toBeNull();
  });
});
