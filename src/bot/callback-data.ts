import { z } from "zod";

/**
 * Лимит Telegram на callback_data — 64 байта, поэтому формат короткий.
 * Разбор всегда через схему: данные приходят от клиента, доверять им нельзя.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EPOCH_MS = /^\d{10,15}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const cb = {
  bookDays: (page: number) => `bk:p:${page}`,
  bookDate: (date: string) => `bk:d:${date}`,
  /**
   * Время передаётся моментом в UTC, а не локальной строкой.
   *
   * В ночь перевода часов назад локальные «03:00» бывают дважды: два разных
   * слота получали одинаковую callback_data, и второй становился недоступен.
   * А несуществующее локальное время весной (03:30 в день перевода вперёд)
   * Luxon молча превращает в 04:30, то есть подделанная кнопка уводила запись
   * на другой реальный момент. Число миллисекунд обеих проблем лишено.
   */
  bookTime: (startAtMs: number) => `bk:t:${startAtMs}`,
  bookConfirm: () => "bk:ok",
  bookAbort: () => "bk:x",
  apptCancel: (id: string) => `ap:c:${id}`,
  apptCancelConfirm: (id: string) => `ap:cc:${id}`,
  noop: () => "noop",
} as const;

export type ParsedCallback =
  | { kind: "bookDays"; page: number }
  | { kind: "bookDate"; date: string }
  | { kind: "bookTime"; startAtMs: number }
  | { kind: "bookConfirm" }
  | { kind: "bookAbort" }
  | { kind: "apptCancel"; id: string }
  | { kind: "apptCancelConfirm"; id: string }
  | { kind: "noop" };

const parsers: { prefix: string; parse: (rest: string) => ParsedCallback | null }[] = [
  {
    prefix: "bk:p:",
    parse: (rest) => {
      const page = Number(rest);
      return Number.isInteger(page) && page >= 0 ? { kind: "bookDays", page } : null;
    },
  },
  {
    prefix: "bk:d:",
    parse: (rest) => (DATE.test(rest) ? { kind: "bookDate", date: rest } : null),
  },
  {
    prefix: "bk:t:",
    parse: (rest) => {
      if (!EPOCH_MS.test(rest)) return null;
      const startAtMs = Number(rest);
      return Number.isSafeInteger(startAtMs) ? { kind: "bookTime", startAtMs } : null;
    },
  },
  {
    prefix: "ap:cc:",
    parse: (rest) => (UUID.test(rest) ? { kind: "apptCancelConfirm", id: rest } : null),
  },
  {
    prefix: "ap:c:",
    parse: (rest) => (UUID.test(rest) ? { kind: "apptCancel", id: rest } : null),
  },
];

export function parseCallback(raw: string): ParsedCallback | null {
  if (raw === "bk:ok") return { kind: "bookConfirm" };
  if (raw === "bk:x") return { kind: "bookAbort" };
  if (raw === "noop") return { kind: "noop" };

  for (const { prefix, parse } of parsers) {
    if (raw.startsWith(prefix)) return parse(raw.slice(prefix.length));
  }

  return null;
}

export const phoneSchema = z
  .string()
  .trim()
  .transform((raw) => raw.replace(/[^\d+]/g, ""))
  .refine((value) => /^\+?\d{9,15}$/.test(value), {
    message: "Не похоже на телефон. Пример: +380671234567",
  });

export const nameSchema = z
  .string()
  .trim()
  .min(2, "Имя слишком короткое.")
  .max(64, "Имя слишком длинное.");
