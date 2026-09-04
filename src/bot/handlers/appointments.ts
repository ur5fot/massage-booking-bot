import type { Telegraf } from "telegraf";
import { Markup } from "telegraf";
import type { BotContext } from "../context.js";
import { cb, parseCallback } from "../callback-data.js";
import { cancelConfirmKeyboard } from "../keyboards/booking.js";
import { MENU, mainMenuKeyboard } from "../keyboards/main-menu.js";
import { formatDateTimeForUser, formatTimeForUser } from "../../utils/time.js";
import { ValidationError } from "../../utils/errors.js";

async function listAppointments(ctx: BotContext): Promise<void> {
  const timezone = ctx.container.config.timezone;
  const appointments = await ctx.container.appointments.activeForUser(ctx.currentUser.id);

  if (appointments.length === 0) {
    await ctx.reply("У вас пока нет активных записей.", mainMenuKeyboard());
    return;
  }

  const lines = appointments.map(
    (appointment) =>
      `• ${formatDateTimeForUser(appointment.startAt, timezone)}` +
      `–${formatTimeForUser(appointment.endAt, timezone)} — ${appointment.service.name}`,
  );

  await ctx.reply(["Ваши записи:", "", ...lines].join("\n"), mainMenuKeyboard());
}

async function chooseCancelTarget(ctx: BotContext): Promise<void> {
  const timezone = ctx.container.config.timezone;
  const appointments = await ctx.container.appointments.activeForUser(ctx.currentUser.id);

  if (appointments.length === 0) {
    await ctx.reply("Отменять нечего — активных записей нет.", mainMenuKeyboard());
    return;
  }

  await ctx.reply(
    "Какую запись отменить?",
    Markup.inlineKeyboard(
      appointments.map((appointment) => [
        Markup.button.callback(
          `${formatDateTimeForUser(appointment.startAt, timezone)} — ${appointment.service.name}`,
          cb.apptCancel(appointment.id),
        ),
      ]),
    ),
  );
}

async function confirmCancel(ctx: BotContext, id: string): Promise<void> {
  const appointment = await ctx.container.appointments.byIdForUser(id, ctx.currentUser.id);

  if (appointment === null) {
    await ctx.reply("Запись не найдена.");
    return;
  }

  await ctx.reply(
    `Отменить запись ${formatDateTimeForUser(appointment.startAt, ctx.container.config.timezone)}?`,
    cancelConfirmKeyboard(appointment.id),
  );
}

async function doCancel(ctx: BotContext, id: string): Promise<void> {
  try {
    const appointment = await ctx.container.appointments.cancelByUser(id, ctx.currentUser.id);

    ctx.logger.info("Запись отменена клиентом", {
      appointmentId: appointment.id,
      userId: ctx.currentUser.id,
    });

    await ctx.reply(
      `Запись ${formatDateTimeForUser(appointment.startAt, ctx.container.config.timezone)} отменена.`,
      mainMenuKeyboard(),
    );

    await ctx.telegram
      .sendMessage(
        ctx.container.config.adminTelegramId.toString(),
        [
          "❌ Клиент отменил запись",
          "",
          formatDateTimeForUser(appointment.startAt, ctx.container.config.timezone),
          appointment.service.name,
          `${ctx.currentUser.name ?? "—"}, ${ctx.currentUser.phone ?? "—"}`,
        ].join("\n"),
      )
      .catch(() => undefined);
  } catch (error) {
    if (error instanceof ValidationError) {
      await ctx.reply(error.message, mainMenuKeyboard());
      return;
    }
    throw error;
  }
}

export function registerAppointmentHandlers(bot: Telegraf<BotContext>): void {
  bot.hears(MENU.my, listAppointments);
  bot.hears(MENU.cancel, chooseCancelTarget);

  bot.hears(MENU.reschedule, async (ctx) => {
    await ctx.reply(
      "Перенос записи появится на следующем этапе.\n\n" +
        "Пока отмените запись и создайте новую — или напишите массажисту напрямую.",
      mainMenuKeyboard(),
    );
  });

  bot.on("callback_query", async (ctx, next) => {
    const raw = "data" in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    const parsed = raw === undefined ? null : parseCallback(raw);

    if (parsed === null) return next();

    if (parsed.kind === "apptCancel") {
      await ctx.answerCbQuery().catch(() => undefined);
      await confirmCancel(ctx, parsed.id);
      return;
    }

    if (parsed.kind === "apptCancelConfirm") {
      await ctx.answerCbQuery().catch(() => undefined);
      await doCancel(ctx, parsed.id);
      return;
    }

    return next();
  });
}
