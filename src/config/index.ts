import { loadEnv, type Env } from "./env.js";

export type AppConfig = {
  env: Env;
  timezone: string;
  booking: {
    slotStepMinutes: number;
    horizonDays: number;
    minLeadMinutes: number;
    cancelDeadlineHours: number;
    rescheduleDeadlineHours: number;
    maxActiveAppointments: number;
  };
  reminders: {
    clientHoursBefore: number[];
    therapistHoursBefore: number[];
    graceMinutes: number;
  };
  sessionTtlDays: number;
  adminTelegramId: bigint;
  contactsText: string;
};

export function buildConfig(env: Env = loadEnv()): AppConfig {
  return {
    env,
    timezone: env.APP_TIMEZONE,
    booking: {
      slotStepMinutes: env.SLOT_STEP_MINUTES,
      horizonDays: env.BOOKING_HORIZON_DAYS,
      minLeadMinutes: env.MIN_LEAD_TIME_MINUTES,
      cancelDeadlineHours: env.CANCEL_DEADLINE_HOURS,
      rescheduleDeadlineHours: env.RESCHEDULE_DEADLINE_HOURS,
      maxActiveAppointments: env.MAX_ACTIVE_APPOINTMENTS,
    },
    reminders: {
      clientHoursBefore: env.REMINDER_CLIENT_HOURS,
      therapistHoursBefore: env.REMINDER_THERAPIST_HOURS,
      graceMinutes: env.REMINDER_GRACE_MINUTES,
    },
    sessionTtlDays: env.SESSION_TTL_DAYS,
    adminTelegramId: env.ADMIN_TELEGRAM_ID,
    contactsText: env.CONTACTS_TEXT.replaceAll("\\n", "\n"),
  };
}

export type { Env };
