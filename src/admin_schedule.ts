import type { Bot, Context } from "grammy";
import type Database from "better-sqlite3";
import { slotStartTimes, type ScheduleDayRow } from "./db/schema.js";

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function registerAdminSchedule(bot: Bot, db: Database.Database): void {
  const adminId = process.env.ADMIN_TG_ID ? Number(process.env.ADMIN_TG_ID) : null;

  function requireAdmin(ctx: Context): boolean {
    if (!adminId || ctx.from?.id !== adminId) {
      ctx.reply("Команда доступна только администратору").catch(() => {});
      if (ctx.callbackQuery) {
        ctx.answerCallbackQuery().catch(() => {});
      }
      return false;
    }
    return true;
  }

  function getScheduleDay(weekday: number): ScheduleDayRow | undefined {
    return db.prepare("SELECT * FROM schedule_days WHERE weekday = ?").get(weekday) as ScheduleDayRow | undefined;
  }

  function renderDayView(weekday: number): string {
    const row = getScheduleDay(weekday);
    if (!row) return "День не найден.";
    const workingLabel = row.is_working ? "Вкл" : "Выкл";
    return [
      `🗓 <b>${WEEKDAY_LABELS[weekday]}</b>`,
      ``,
      `Рабочий день: <b>${workingLabel}</b>`,
      `Открытие: <b>${row.open_time}</b>`,
      `Закрытие: <b>${row.close_time}</b>`,
    ].join("\n");
  }

  function buildDayKeyboard(weekday: number, row: ScheduleDayRow) {
    const toggleLabel = row.is_working ? "🔴 Рабочий день: Выкл" : "🟢 Рабочий день: Вкл";
    return {
      inline_keyboard: [
        [{ text: toggleLabel, callback_data: `sched:toggle:${weekday}` }],
        [
          { text: "🕐 Открытие", callback_data: `sched:setopen:${weekday}` },
          { text: "🕐 Закрытие", callback_data: `sched:setclose:${weekday}` },
        ],
        [{ text: "💾 Сохранить", callback_data: `sched:save:${weekday}` }],
        [{ text: "⬅️ Назад", callback_data: "sched:back" }],
      ],
    };
  }

  function buildWeekdayKeyboard() {
    const buttons = WEEKDAY_LABELS.map((label, i) => ({
      text: label,
      callback_data: `sched:day:${i}`,
    }));
    return {
      inline_keyboard: [
        buttons.slice(0, 4),
        buttons.slice(4, 7),
        [{ text: "❌ Закрыть", callback_data: "sched:close" }],
      ],
    };
  }

  function buildTimePicker(weekday: number, kind: "open" | "close") {
    const times = slotStartTimes("09:00", "18:00");
    const cbPrefix = kind === "open" ? "sched:opentime" : "sched:closetime";
    const rows: { text: string; callback_data: string }[][] = [];
    for (let i = 0; i < times.length; i += 3) {
      rows.push(
        times.slice(i, i + 3).map((t) => ({
          text: t,
          callback_data: `${cbPrefix}:${weekday}:${t}`,
        }))
      );
    }
    rows.push([{ text: "⬅️ Назад", callback_data: `sched:day:${weekday}` }]);
    return { inline_keyboard: rows };
  }

  function regenerateSlots(weekday: number, openTime: string, closeTime: string): number {
    const insertSlot = db.prepare(
      "INSERT OR IGNORE INTO slots (starts_at, is_booked) VALUES (?, 0)"
    );
    const slotTimes = slotStartTimes(openTime, closeTime);

    const today = new Date();
    let created = 0;
    const maxDays = 60;

    const transaction = db.transaction(() => {
      for (let offset = 0; offset < maxDays; offset++) {
        const date = new Date(today);
        date.setDate(date.getDate() + offset);
        if (date.getDay() !== weekday) continue;

        const dateStr = date.toISOString().slice(0, 10);
        for (const slotTime of slotTimes) {
          const result = insertSlot.run(`${dateStr}T${slotTime}:00`);
          if (result.changes > 0) created++;
        }
      }
    });

    transaction();
    return created;
  }

  bot.command("admin_schedule", async (ctx) => {
    if (!requireAdmin(ctx)) return;

    await ctx.reply("🗓 <b>Расписание мастера</b>\n\nВыберите день недели:", {
      parse_mode: "HTML",
      reply_markup: buildWeekdayKeyboard(),
    });
  });

  bot.callbackQuery(/^sched:day:(\d)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const weekday = Number(ctx.match[1]);
    const row = getScheduleDay(weekday);
    if (!row) {
      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.editMessageText(renderDayView(weekday), {
      parse_mode: "HTML",
      reply_markup: buildDayKeyboard(weekday, row),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^sched:back$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.editMessageText("🗓 <b>Расписание мастера</b>\n\nВыберите день недели:", {
      parse_mode: "HTML",
      reply_markup: buildWeekdayKeyboard(),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^sched:close$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    await ctx.deleteMessage().catch(() => {});
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^sched:toggle:(\d)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const weekday = Number(ctx.match[1]);

    db.prepare(
      "UPDATE schedule_days SET is_working = CASE WHEN is_working = 1 THEN 0 ELSE 1 END WHERE weekday = ?"
    ).run(weekday);

    const row = getScheduleDay(weekday);
    if (!row) {
      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.editMessageText(renderDayView(weekday), {
      parse_mode: "HTML",
      reply_markup: buildDayKeyboard(weekday, row),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^sched:setopen:(\d)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const weekday = Number(ctx.match[1]);

    await ctx.editMessageText(
      `🗓 <b>${WEEKDAY_LABELS[weekday]}</b>\n\nВыберите время открытия:`,
      {
        parse_mode: "HTML",
        reply_markup: buildTimePicker(weekday, "open"),
      }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^sched:setclose:(\d)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const weekday = Number(ctx.match[1]);

    await ctx.editMessageText(
      `🗓 <b>${WEEKDAY_LABELS[weekday]}</b>\n\nВыберите время закрытия:`,
      {
        parse_mode: "HTML",
        reply_markup: buildTimePicker(weekday, "close"),
      }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^sched:opentime:(\d):(\d{2}):(\d{2})$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const weekday = Number(ctx.match[1]);
    const time = `${ctx.match[2]}:${ctx.match[3]}`;

    db.prepare("UPDATE schedule_days SET open_time = ? WHERE weekday = ?").run(
      time,
      weekday
    );

    const row = getScheduleDay(weekday);
    if (!row) {
      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.editMessageText(renderDayView(weekday), {
      parse_mode: "HTML",
      reply_markup: buildDayKeyboard(weekday, row),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^sched:closetime:(\d):(\d{2}):(\d{2})$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const weekday = Number(ctx.match[1]);
    const time = `${ctx.match[2]}:${ctx.match[3]}`;

    const row = getScheduleDay(weekday);
    if (!row) {
      await ctx.answerCallbackQuery();
      return;
    }

    if (time <= row.open_time) {
      await ctx.answerCallbackQuery({ text: "Время закрытия должно быть позже времени открытия." });
      return;
    }

    db.prepare("UPDATE schedule_days SET close_time = ? WHERE weekday = ?").run(
      time,
      weekday
    );

    const updated = getScheduleDay(weekday);
    if (!updated) {
      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.editMessageText(renderDayView(weekday), {
      parse_mode: "HTML",
      reply_markup: buildDayKeyboard(weekday, updated),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^sched:save:(\d)$/, async (ctx) => {
    if (!requireAdmin(ctx)) return;
    const weekday = Number(ctx.match[1]);
    const row = getScheduleDay(weekday);
    if (!row) {
      await ctx.answerCallbackQuery();
      return;
    }

    let created = 0;
    if (row.is_working) {
      created = regenerateSlots(weekday, row.open_time, row.close_time);
    }

    await ctx.answerCallbackQuery({ text: `Сохранено. Создано слотов: ${created}` });
    await ctx.editMessageText(
      [renderDayView(weekday), "", `✅ Сохранено. Новых слотов: <b>${created}</b>`].join("\n"),
      {
        parse_mode: "HTML",
        reply_markup: buildDayKeyboard(weekday, row),
      }
    );
  });
}
