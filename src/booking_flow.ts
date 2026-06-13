import type { Bot } from "grammy";
import type Database from "better-sqlite3";
import {
  slotFitsService,
  is30MinuteGrid,
  SLOT_DURATION_MIN,
  type ServiceRow,
  type SlotRow,
  type ScheduleDayRow,
} from "./db/schema.js";

const WEEKDAY_LABELS = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

export function registerBookingFlow(bot: Bot, db: Database.Database): void {
  bot.command("book", async (ctx) => {
    const services = db
      .prepare("SELECT code, title, duration_min FROM services")
      .all() as ServiceRow[];

    if (services.length === 0) {
      await ctx.reply("Нет доступных услуг.");
      return;
    }

    await ctx.reply("Выберите услугу:", {
      reply_markup: {
        inline_keyboard: services.map((s) => [
          {
            text: `${s.title} (${s.duration_min} мин)`,
            callback_data: `book:svc:${s.code}`,
          },
        ]),
      },
    });
  });

  bot.callbackQuery(/^book:svc:(.+)$/, async (ctx) => {
    const serviceCode = ctx.match[1];
    const service = db
      .prepare("SELECT * FROM services WHERE code = ?")
      .get(serviceCode) as ServiceRow | undefined;

    if (!service) {
      await ctx.answerCallbackQuery({ text: "Услуга не найдена." });
      return;
    }

    const weekDays = getCurrentWeekDates();
    const scheduleRows = db
      .prepare("SELECT * FROM schedule_days")
      .all() as ScheduleDayRow[];

    const buttons = weekDays.map((d) => {
      const sched = scheduleRows.find((r) => r.weekday === d.weekday);
      const label = `${WEEKDAY_LABELS[d.weekday]} ${d.dateStr}`;

      if (sched && sched.is_working) {
        return [
          {
            text: label,
            callback_data: `book:day:${serviceCode}:${d.dateStr}`,
          },
        ];
      }
      return [
        {
          text: `${label} (выходной)`,
          callback_data: "book:nop",
        },
      ];
    });

    await ctx.editMessageText(
      `Услуга: <b>${service.title}</b> (${service.duration_min} мин)\n\nВыберите день (текущая неделя):`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: buttons } }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("book:nop", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "В этот день запись недоступна." });
  });

  bot.callbackQuery(/^book:day:(.+):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    const serviceCode = ctx.match[1];
    const dateStr = ctx.match[2];

    const service = db
      .prepare("SELECT * FROM services WHERE code = ?")
      .get(serviceCode) as ServiceRow | undefined;

    if (!service) {
      await ctx.answerCallbackQuery({ text: "Услуга не найдена." });
      return;
    }

    if (!isWithinCurrentWeek(dateStr)) {
      await ctx.answerCallbackQuery({ text: "Запись только на текущую неделю." });
      return;
    }

    const dayOfWeek = new Date(dateStr + "T00:00:00").getDay();
    const scheduleDay = db
      .prepare("SELECT * FROM schedule_days WHERE weekday = ?")
      .get(dayOfWeek) as ScheduleDayRow | undefined;

    if (!scheduleDay || !scheduleDay.is_working) {
      await ctx.answerCallbackQuery({ text: "Этот день нерабочий." });
      return;
    }

    const slots = db
      .prepare(
        `SELECT * FROM slots
         WHERE starts_at >= ? AND starts_at < date(?, '+1 day')
           AND is_booked = 0
         ORDER BY starts_at`
      )
      .all(dateStr, dateStr) as SlotRow[];

    const available = slots.filter((slot) => {
      const time = slot.starts_at.slice(11, 16);
      return slotFitsService(time, service.duration_min, scheduleDay.close_time);
    });

    if (available.length === 0) {
      await ctx.editMessageText(
        `Услуга: <b>${service.title}</b> (${service.duration_min} мин)\nДень: <b>${dateStr}</b>\n\nНет свободных слотов на этот день.`,
        { parse_mode: "HTML" }
      );
      await ctx.answerCallbackQuery();
      return;
    }

    const timeButtons = buildSlotButtons(
      available,
      serviceCode,
      dateStr
    );

    await ctx.editMessageText(
      `Услуга: <b>${service.title}</b> (${service.duration_min} мин)\nДень: <b>${dateStr}</b>\n\nВыберите время:`,
      { parse_mode: "HTML", reply_markup: { inline_keyboard: timeButtons } }
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(
    /^book:slot:(.+):(\d{4}-\d{2}-\d{2}):(\d{2}):(\d{2})$/,
    async (ctx) => {
      const serviceCode = ctx.match[1];
      const dateStr = ctx.match[2];
      const slotHour = ctx.match[3];
      const slotMin = ctx.match[4];
      const slotTime = `${slotHour}:${slotMin}`;

      const user = ctx.from;
      if (!user) {
        await ctx.answerCallbackQuery({ text: "Не удалось определить пользователя." });
        return;
      }

      const result = bookAppointment(
        db,
        user.id,
        user.first_name || "Unknown",
        serviceCode,
        dateStr,
        slotTime
      );

      if (!result.success) {
        await ctx.answerCallbackQuery({ text: result.message });
        return;
      }

      await ctx.editMessageText(
        `Запись подтверждена!\n\n${result.message}`,
        { parse_mode: "HTML" }
      );
      await ctx.answerCallbackQuery({ text: "Готово!" });
    }
  );
}

interface WeekDate {
  weekday: number;
  dateStr: string;
}

function getCurrentWeekDates(): WeekDate[] {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const days: WeekDate[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const weekday = d.getDay();
    days.push({
      weekday,
      dateStr: d.toISOString().slice(0, 10),
    });
  }
  return days;
}

function getCurrentWeekRange(): { start: string; end: string } {
  const days = getCurrentWeekDates();
  return { start: days[0].dateStr, end: days[6].dateStr };
}

function isWithinCurrentWeek(dateStr: string): boolean {
  const { start, end } = getCurrentWeekRange();
  return dateStr >= start && dateStr <= end;
}

function buildSlotButtons(
  slots: SlotRow[],
  serviceCode: string,
  dateStr: string
): { text: string; callback_data: string }[][] {
  const rows: { text: string; callback_data: string }[][] = [];
  const rowSize = 4;
  for (let i = 0; i < slots.length; i += rowSize) {
    rows.push(
      slots.slice(i, i + rowSize).map((slot) => {
        const time = slot.starts_at.slice(11, 16);
        return {
          text: time,
          callback_data: `book:slot:${serviceCode}:${dateStr}:${time}`,
        };
      })
    );
  }
  return rows;
}

function bookAppointment(
  db: Database.Database,
  userId: number,
  userName: string,
  serviceCode: string,
  dateStr: string,
  slotTime: string
): { success: boolean; message: string } {
  const service = db
    .prepare("SELECT * FROM services WHERE code = ?")
    .get(serviceCode) as ServiceRow | undefined;

  if (!service) {
    return { success: false, message: "Услуга не найдена." };
  }

  if (!is30MinuteGrid(slotTime)) {
    return { success: false, message: "Время должно быть на 30-минутной сетке." };
  }

  if (!isWithinCurrentWeek(dateStr)) {
    return { success: false, message: "Запись только на текущую неделю (Пн–Вс)." };
  }

  const dayOfWeek = new Date(dateStr + "T00:00:00").getDay();
  const scheduleDay = db
    .prepare("SELECT * FROM schedule_days WHERE weekday = ?")
    .get(dayOfWeek) as ScheduleDayRow | undefined;

  if (!scheduleDay || !scheduleDay.is_working) {
    return { success: false, message: "Этот день нерабочий." };
  }

  if (!slotFitsService(slotTime, service.duration_min, scheduleDay.close_time)) {
    return {
      success: false,
      message: `Услуга не умещается в рабочий день (закрытие в ${scheduleDay.close_time}).`,
    };
  }

  const slotsNeeded = Math.ceil(service.duration_min / SLOT_DURATION_MIN);

  const bookTx = db.transaction((): { success: boolean; message: string } => {
    const neededStarts: string[] = [];
    let [h, m] = slotTime.split(":").map(Number);
    for (let i = 0; i < slotsNeeded; i++) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      neededStarts.push(`${dateStr}T${hh}:${mm}:00`);
      const total = h * 60 + m + SLOT_DURATION_MIN;
      h = Math.floor(total / 60);
      m = total % 60;
    }

    const slotRows: SlotRow[] = [];
    for (const startsAt of neededStarts) {
      const slot = db
        .prepare("SELECT * FROM slots WHERE starts_at = ?")
        .get(startsAt) as SlotRow | undefined;

      if (!slot) {
        return { success: false, message: "Слот не найден. Возможно, расписание изменилось." };
      }
      if (slot.is_booked) {
        return {
          success: false,
          message: `Слот ${slot.starts_at.slice(11, 16)} уже занят. Выберите другое время.`,
        };
      }
      slotRows.push(slot);
    }

    db.prepare("INSERT OR IGNORE INTO users (tg_id, name) VALUES (?, ?)").run(
      userId,
      userName
    );

    for (const slot of slotRows) {
      db.prepare("UPDATE slots SET is_booked = 1 WHERE id = ?").run(slot.id);
    }

    db.prepare(
      `INSERT INTO appointments (user_tg_id, service_code, slot_id, status)
       VALUES (?, ?, ?, 'confirmed')`
    ).run(userId, serviceCode, slotRows[0].id);

    const timeLabel = slotRows.length === 1
      ? slotTime
      : `${slotTime}–${slotRows[slotRows.length - 1].starts_at.slice(11, 16)}`;

    return {
      success: true,
      message: `${service.title} записан на ${dateStr} в ${timeLabel}.`,
    };
  });

  return bookTx();
}
