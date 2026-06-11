# DETAILS — TrimTimeBot

Concrete per-command behaviour for the TrimTimeBot bot. Refines
`docs/design.md`; every command/flow here is the contract the Dev tasks
implement and the Tests phase writes specs against.

Conventions used below:
- **State** — the per-chat conversation state, reset to `idle` on `/start`
  or `🏠 Меню`.
- **CB** — inline-button callback data.
- All times rendered in `SHOP_TZ` (env, default `Europe/Moscow`); stored
  UTC. The shop's working week is Mon–Sun, 9:00–18:00, 30-minute slots.
- Every reply that is part of a flow carries `⬅️ Назад` and `🏠 Меню`
  buttons unless stated otherwise.
- Service copy: Стрижка (haircut, 30 min), Борода (beard, 15 min),
  Комплекс (combo, 45 min). Seeded on first start.

## 1. /start — registration & main menu

1. Upsert `users` row by `tg_id`.
2. First contact: ask "Как вас зовут?" → state `reg:name` → any text
   1–64 chars is accepted as the display name; longer → re-ask.
3. Reply "Привет, {name}!" with the main menu inline keyboard:
   `📅 Записаться` (CB `menu:book`) · `📋 Мои записи` (CB `menu:my`) ·
   `❌ Отменить запись` (CB `menu:cancel`).
4. If `tg_id == ADMIN_TG_ID` (env), the menu also includes
   `🗓 Расписание мастера` (CB `menu:sched`).

## 2. /book — client booking flow

Entry: `/book` or CB `menu:book`. State machine, all steps inline-driven:

1. **Service** — inline keyboard with the three services
   `Стрижка · 30 мин` `Борода · 15 мин` `Комплекс · 45 мин`. CB
   `svc:<code>`.
2. **Day** — the next 7 calendar days that have ≥1 free slot for the
   chosen service. Each slot must fit inside the open window
   (e.g. for `Борода` 15 min, all 30-min slots 9:00–17:30 are valid; for
   `Комплекс` 45 min, only slots 9:00–17:15 are valid). Label
   `Чт 12.06`. CB `day:<YYYY-MM-DD>`.
3. **Slot** — bookable start times for that day. A start time T is
   bookable iff `T + service.duration` does not exceed the day's
   `close_time` and the slot row has `is_booked=0`. CB `slot:<id>`.
4. **Confirm** — card: `{service} · {date} {time} · {duration} мин` with
   `✅ Подтвердить` (CB `confirm:<slot_id>`) / `⬅️ Назад` /
   `🏠 Меню`.
5. **On confirm**, in ONE transaction:
   - re-validate the slot is still free
     (`UPDATE slots SET is_booked=1 WHERE id=? AND is_booked=0` →
     zero rows updated ⇒ race lost ⇒ answerCallbackQuery
     "Слот уже занят 😔" and re-render step 3 with fresh slots);
   - insert `appointments` (status `confirmed`);
   - reply receipt: "Записал: {service}, {date} в {time}".
   - The reply has only `🏠 Меню` (no Назад — flow is done).
6. Any `/command` mid-flow resets state to `idle` and runs that command.

## 3. /my — client's appointments

Lists the user's `confirmed` appointments with `starts_at > now`,
ordered ascending, each as `{date} {time} · {service} · {duration} мин`
with an `❌ Отменить` button (CB `cx:<appointment_id>`) linking into §4.
Empty → "У вас нет активных записей — /book".

## 4. /cancel — client cancels

Entry: `/cancel`, CB `menu:cancel`, or the `❌` button from /my.
1. Same list as /my; tap → confirm dialog
   "Отменить {service} {date} {time}?" with
   `Да, отменить` (CB `cx:yes:<id>`) / `Нет` (CB `cx:no`).
2. On yes, in one transaction: appointment `status=cancelled`; its
   slot `is_booked=0` (the slot reappears in §2 step 3 immediately).
3. Only the owning client can cancel; a foreign id → "Запись не найдена".
   Already-started appointments are not listed and not cancellable.

## 5. /help

Static command cheat-sheet for clients. One message, menu button only.
Admin variants (`/admin_schedule`) are not shown to non-admin users.

## 6. /admin_schedule — admin sets the weekly schedule

Entry: `/admin_schedule` (admin only — non-admin: "Команда доступна
только администратору").
1. **Weekday** — inline list Mon–Sun. CB `sched:day:<0-6>`.
2. For the chosen weekday, render the current
   `open_time` / `close_time` and a toggle "Рабочий день: Вкл/Выкл"
   (CB `sched:toggle:<0-6>`). Two time fields follow:
   `Открытие: HH:MM` (CB `sched:open:<0-6>` → text step) and
   `Закрытие: HH:MM` (CB `sched:close:<0-6>` → text step).
   Each time step accepts `HH:MM` (24h); invalid → re-ask.
3. `💾 Сохранить` (CB `sched:save:<0-6>`) → upsert the
   `schedule_days` row; regenerate **future** free slots for that
   weekday (booked slots are never deleted; off slots that have no
   appointment are deleted).
4. Reply "Расписание на {weekday} сохранено: {open}–{close},
   {n} окон".

## 7. /admin_schedule (alternate entry — current day)

`/admin_schedule today` (admin only) jumps straight to step 3 for today's
weekday, showing the current open/close + slot count.

## 8. Daily 10:00 reminder (System)

A scheduler tick runs **every day at 10:00** in `SHOP_TZ`:
- Select all `confirmed` appointments with `starts_at` on the current
  local date, joined to the user.
- For each: send "Сегодня в HH:MM — {service} ({duration} мин). Если
  plans changed — /cancel."
- Idempotent per (appointment, date) via a `reminded_at` stamp on the
  appointment row, so a restart cannot double-send.

## 9. Fallbacks & errors

- Unknown command → "Не понял. /help — список команд" + main menu.
- Stray text with state `idle` → same as unknown command.
- Stray text with a non-idle state and no matching handler → "Я вас
  слушаю — выберите кнопку или /cancel" + the flow's current card.
- Callback for a stale message (slot taken / appointment gone) →
  answerCallbackQuery "Устарело, начните заново" + main menu.
- Any handler error → log, generic
  "Что-то пошло не так, попробуйте ещё раз"; state resets to `idle`.
  The update loop never crashes on a single update.
