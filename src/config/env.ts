import "dotenv/config";
import { z } from "zod";

const csvHours = z
  .string()
  .transform((raw) =>
    raw
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map(Number),
  )
  .pipe(z.array(z.number().positive()));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  BOT_TOKEN: z.string().min(1, "BOT_TOKEN обязателен"),
  ADMIN_TELEGRAM_ID: z.coerce.bigint(),

  DATABASE_URL: z.string().min(1),

  // Этап 2. На первом этапе календарь ещё не подключён.
  GOOGLE_CALENDAR_ID: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(),

  APP_TIMEZONE: z.string().default("Europe/Kyiv"),
  SLOT_STEP_MINUTES: z.coerce.number().int().positive().default(30),
  BOOKING_HORIZON_DAYS: z.coerce.number().int().positive().default(30),
  MIN_LEAD_TIME_MINUTES: z.coerce.number().int().nonnegative().default(120),
  CANCEL_DEADLINE_HOURS: z.coerce.number().int().nonnegative().default(4),
  RESCHEDULE_DEADLINE_HOURS: z.coerce.number().int().nonnegative().default(4),
  MAX_ACTIVE_APPOINTMENTS: z.coerce.number().int().positive().default(3),

  REMINDER_CLIENT_HOURS: csvHours.default([24, 2]),
  REMINDER_THERAPIST_HOURS: csvHours.default([2]),
  REMINDER_GRACE_MINUTES: z.coerce.number().int().nonnegative().default(30),

  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  CONTACTS_TEXT: z.string().default("Контакты пока не заполнены."),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Валидация конфигурации при старте. Падать здесь лучше, чем через час
 * в обработчике на неочевидном `undefined`.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Некорректная конфигурация окружения:\n${issues}`);
  }

  return parsed.data;
}
