import type { Telegraf } from "telegraf";
import type { Service } from "../../generated/prisma/client.js";
import type { BotContext } from "../context.js";
import { cb, nameSchema, parseCallback, phoneSchema } from "../callback-data.js";
import { confirmKeyboard, datesKeyboard, timesKeyboard } from "../keyboards/booking.js";
import {
  mainMenuKeyboard,
  requestContactKeyboard,
  suggestNameKeyboard,
} from "../keyboards/main-menu.js";
import {
  formatDateForUser,
  formatDateTimeForUser,
  formatTimeForUser,
} from "../../utils/time.js";
import { SlotTakenError, ValidationError } from "../../utils/errors.js";

const NO_SLOTS =
  "Сейчас свободных слотов нет.\n\nНапишите массажисту напрямую — контакты есть в меню.";

async function replaceMessage(ctx: BotContext, text: string, markup?: unknown): Promise<void> {
  const extra = markup === undefined ? undefined : (markup as { reply_markup: unknown });

  if (ctx.callbackQuery !== undefined) {
    try {
      await ctx.editMessageText(text, extra as never);
      return;
    } catch {
      // Сообщение могло устареть или не измениться — тогда просто шлём новое.
    }
  }

  await ctx.reply(text, extra as never);
}

export async function showDates(ctx: BotContext, page = 0): Promise<void> {
  const service = await ctx.container.services.default();
  const days = await ctx.container.availability.daysWithSlots(service);

  if (days.length === 0) {
    await replaceMessage(ctx, NO_SLOTS);
    return;
  }

  // Имя и телефон переживают возврат к списку дат: иначе клиент, нажавший
  // «‹ К датам» после ввода телефона, вводил бы его заново.
  const { name, phone } = ctx.session.booking;
  ctx.session.booking = {
    step: "idle",
    serviceId: service.id,
    ...(name !== undefined ? { name } : {}),
    ...(phone !== undefined ? { phone } : {}),
  };

  await replaceMessage(
    ctx,
    `${service.name}, ${service.durationMinutes} мин.\n\nВыберите день:`,
    datesKeyboard(days, page, ctx.container.config.timezone),
  );
}

async function showTimes(ctx: BotContext, date: string): Promise<void> {
  const service = await ctx.container.services.default();
  const timezone = ctx.container.config.timezone;
  const slots = await ctx.container.availability.slotsForDay(date, service);

  if (slots.length === 0) {
    await replaceMessage(ctx, "На этот день слотов уже нет. Выберите другой день.");
    await showDates(ctx, 0);
    return;
  }

  const title = formatDateForUser(slots[0]!.start, timezone);

  await replaceMessage(
    ctx,
    `${title}\n\nВыберите время:`,
    timesKeyboard(slots, timezone),
  );
}

function confirmationText(ctx: BotContext, service: Service, start: Date): string {
  const timezone = ctx.container.config.timezone;
  const booking = ctx.session.booking;
  const end = new Date(start.getTime() + service.durationMinutes * 60_000);

  return [
    "Проверьте запись:",
    "",
    `Услуга: ${service.name}`,
    `Когда: ${formatDateTimeForUser(start, timezone)}–${formatTimeForUser(end, timezone)}`,
    `Имя: ${booking.name ?? "—"}`,
    `Телефон: ${booking.phone ?? "—"}`,
  ].join("\n");
}

/**
 * Контакты сохраняются сразу, как только клиент их назвал, а не в момент
 * подтверждения: иначе выход из диалога на полпути терял уже введённые данные,
 * и в следующий раз бот спрашивал их заново.
 */
async function rememberContacts(
  ctx: BotContext,
  data: { name?: string; phone?: string },
): Promise<void> {
  ctx.currentUser = await ctx.container.users.updateContacts(ctx.currentUser.id, data);
}

async function advance(ctx: BotContext): Promise<void> {
  const booking = ctx.session.booking;

  if (booking.startAtMs === undefined || booking.serviceId === undefined) {
    await showDates(ctx, 0);
    return;
  }

  if (booking.name === undefined) {
    ctx.session.booking = { ...booking, step: "askName" };
    // Имя из профиля Telegram предлагается кнопкой, но не подставляется молча:
    // там часто ник, а массажисту нужно настоящее имя.
    await ctx.reply("Как вас записать? Напишите имя.", suggestNameKeyboard(ctx.from?.first_name));
    return;
  }

  if (booking.phone === undefined) {
    ctx.session.booking = { ...booking, step: "askPhone" };
    await ctx.reply(
      "Оставьте номер телефона — массажист свяжется с вами, если что-то изменится.",
      requestContactKeyboard(),
    );
    return;
  }

  const service = await ctx.container.services.byId(booking.serviceId);

  if (service === null) {
    ctx.session.booking = { step: "idle" };
    await showDates(ctx, 0);
    return;
  }

  ctx.session.booking = { ...booking, step: "confirm" };
  await replaceMessage(
    ctx,
    confirmationText(ctx, service, new Date(booking.startAtMs)),
    confirmKeyboard(),
  );
}

async function onTimePicked(ctx: BotContext, startAtMs: number): Promise<void> {
  const service = await ctx.container.services.default();

  // Именно findOfferedSlot, а не checkExactStart: клиенту доступно ровно то,
  // что бот показал кнопками, без времён мимо шага сетки.
  const slot = await ctx.container.availability.findOfferedSlot(new Date(startAtMs), service);

  if (slot === null) {
    await replaceMessage(ctx, new SlotTakenError().message);
    await showDates(ctx, 0);
    return;
  }

  ctx.session.booking = {
    step: "confirm",
    serviceId: service.id,
    startAtMs: slot.start.getTime(),
    ...(ctx.currentUser.name !== null ? { name: ctx.currentUser.name } : {}),
    ...(ctx.currentUser.phone !== null ? { phone: ctx.currentUser.phone } : {}),
  };

  await advance(ctx);
}

async function notifyTherapist(
  ctx: BotContext,
  appointment: { startAt: Date; endAt: Date; service: Service },
): Promise<void> {
  const timezone = ctx.container.config.timezone;
  const booking = ctx.session.booking;
  const username = ctx.from?.username === undefined ? "" : `\n@${ctx.from.username}`;

  const text = [
    "🆕 Новая запись",
    "",
    `${formatDateTimeForUser(appointment.startAt, timezone)}–${formatTimeForUser(appointment.endAt, timezone)}`,
    appointment.service.name,
    `${booking.name ?? "—"}, ${booking.phone ?? "—"}${username}`,
  ].join("\n");

  try {
    await ctx.telegram.sendMessage(ctx.container.config.adminTelegramId.toString(), text);
  } catch (error) {
    // Клиент уже записан — падать из-за недоставленного уведомления нельзя.
    ctx.logger.error("Не удалось уведомить массажиста о новой записи", {
      err: error instanceof Error ? error.message : String(error),
    });
  }
}

async function onConfirm(ctx: BotContext): Promise<void> {
  const booking = ctx.session.booking;

  if (booking.step !== "confirm" || booking.startAtMs === undefined) {
    // Повторное нажатие «Подтвердить»: апдейты одного человека идут по очереди,
    // поэтому второй видит уже сброшенный шаг. Показывать ему список дат —
    // сбивать с толку человека, который только что записался.
    if (booking.bookedAtMs !== undefined) {
      await replaceMessage(
        ctx,
        `Эта запись уже создана: ${formatDateTimeForUser(
          new Date(booking.bookedAtMs),
          ctx.container.config.timezone,
        )}.`,
      );
      await ctx.reply("Главное меню:", mainMenuKeyboard());
      return;
    }

    await showDates(ctx, 0);
    return;
  }

  if (booking.serviceId === undefined) {
    await showDates(ctx, 0);
    return;
  }

  const start = new Date(booking.startAtMs);
  const service = await ctx.container.services.byId(booking.serviceId);

  if (service === null) {
    ctx.session.booking = { step: "idle" };
    await showDates(ctx, 0);
    return;
  }

  if (booking.name === undefined || booking.phone === undefined) {
    await advance(ctx);
    return;
  }

  try {
    const appointment = await ctx.container.appointments.create({
      user: ctx.currentUser,
      service,
      start,
    });

    ctx.logger.info("Запись создана", {
      appointmentId: appointment.id,
      userId: ctx.currentUser.id,
      startAt: appointment.startAt.toISOString(),
    });

    await replaceMessage(
      ctx,
      [
        "✅ Записал вас.",
        "",
        `${service.name}, ${service.durationMinutes} мин`,
        formatDateTimeForUser(appointment.startAt, ctx.container.config.timezone),
        "",
        "Напоминание придёт заранее.",
      ].join("\n"),
    );

    await notifyTherapist(ctx, appointment);
    await ctx.reply("Главное меню:", mainMenuKeyboard());
  } catch (error) {
    ctx.session.booking = { step: "idle" };

    if (error instanceof SlotTakenError || error instanceof ValidationError) {
      await replaceMessage(ctx, error.message);
      if (error instanceof SlotTakenError) await showDates(ctx, 0);
      return;
    }

    throw error;
  } finally {
    if (ctx.session.booking.step === "confirm") {
      ctx.session.booking = { step: "idle", bookedAtMs: booking.startAtMs };
    }
  }
}

/** Текстовый ввод имеет смысл только внутри шагов askName / askPhone. */
export async function handleBookingText(ctx: BotContext, text: string): Promise<boolean> {
  const booking = ctx.session.booking;

  if (booking.step === "askName") {
    const parsed = nameSchema.safeParse(text);
    if (!parsed.success) {
      await ctx.reply(parsed.error.issues[0]?.message ?? "Некорректное имя.");
      return true;
    }

    ctx.session.booking = { ...booking, name: parsed.data };
    await rememberContacts(ctx, { name: parsed.data });
    await advance(ctx);
    return true;
  }

  if (booking.step === "askPhone") {
    const parsed = phoneSchema.safeParse(text);
    if (!parsed.success) {
      await ctx.reply(parsed.error.issues[0]?.message ?? "Некорректный телефон.");
      return true;
    }

    ctx.session.booking = { ...booking, phone: parsed.data };
    await rememberContacts(ctx, { phone: parsed.data });
    await advance(ctx);
    return true;
  }

  return false;
}

export async function handleBookingContact(ctx: BotContext, phone: string): Promise<boolean> {
  if (ctx.session.booking.step !== "askPhone") return false;

  const parsed = phoneSchema.safeParse(phone);
  const value = parsed.success ? parsed.data : phone;

  ctx.session.booking = { ...ctx.session.booking, phone: value };
  await rememberContacts(ctx, { phone: value });
  await advance(ctx);
  return true;
}

export function registerBookingCallbacks(bot: Telegraf<BotContext>): void {
  bot.on("callback_query", async (ctx, next) => {
    const raw = "data" in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    const parsed = raw === undefined ? null : parseCallback(raw);

    if (parsed === null) {
      await ctx.answerCbQuery().catch(() => undefined);
      return next();
    }

    await ctx.answerCbQuery().catch(() => undefined);

    switch (parsed.kind) {
      case "bookDays":
        await showDates(ctx, parsed.page);
        return;
      case "bookDate":
        await showTimes(ctx, parsed.date);
        return;
      case "bookTime":
        await onTimePicked(ctx, parsed.startAtMs);
        return;
      case "bookConfirm":
        await onConfirm(ctx);
        return;
      case "bookAbort":
        ctx.session.booking = { step: "idle" };
        await replaceMessage(ctx, "Запись отменена.");
        await ctx.reply("Главное меню:", mainMenuKeyboard());
        return;
      case "noop":
        return;
      default:
        return next();
    }
  });
}

export { cb };
