# DESIGN — TrimTimeBot

Architecture, command set and conversation flows satisfying every entity and
feature in `docs/general.md`.

## 1. Architecture

```
Telegram ⇄ grammY bot (long polling)
              │
              ├─ command router  (/start /book /my /cancel /help)
              ├─ callback router (svc:* day:* slot:* confirm:* cancel:*)
              ├─ session store   (per-chat finite-state machine)
              ├─ service layer   (booking rules, conflict prevention)
              ├─ reminder job    (daily 10:00 tick)
              └─ SQLite persistence (users, appointments, slots, schedule)
```

- **Runtime**: single Node.js process, grammY, long polling (no inbound ports).
- **State machine** per chat: `idle → choosing_service → choosing_day →
  choosing_slot → confirming → idle`. Any `/command` resets to its flow root.
- **Persistence**: SQLite file on a volume. All reads/writes go through a
  repository layer so booking rules live in one place.

## 2. Data model (implements General "Core Entities")

| Entity | Table | Fields |
| --- | --- | --- |
| **User** | `users` | `tg_id` PK, `name`, `registered_at` (registered status = row exists) |
| **Service** | `services` | `code` PK (`haircut`\|`beard`\|`combo`), `title`, `duration_min` (30/15/45) |
| **TimeSlot** | `slots` | `id` PK, `starts_at` (date+time, 30-min grid 9:00–18:00), `is_booked` |
| **Appointment** | `appointments` | `id` PK, `user_tg_id` FK→users, `service_code` FK→services, `slot_id` FK→slots, `status` (`confirmed`\|`cancelled`), `created_at` |
| **Schedule** | `schedule_days` | `weekday` PK (0–6), `is_working`, `open_time`, `close_time` — the weekly calendar that slots are generated from, grouped by day |

Relationships preserved exactly as General states: user 1—N appointments;
appointment N—1 service and N—1 slot; slot N—1 schedule day; services
enumerate the appointment options.

## 3. Command set

| Command | Purpose |
| --- | --- |
| `/start` | register the user (insert into `users`), short onboarding + main menu |
| `/book` | start the booking flow (service → day → slot → confirm) |
| `/my` | list the user's confirmed appointments with service + time |
| `/cancel` | cancellation flow: pick one of your appointments → confirm → slot freed |
| `/help` | command reference |

Admin (not user-facing, restricted to `ADMIN_TG_ID`):

| Command | Purpose |
| --- | --- |
| `/admin_schedule` | set the weekly schedule: working days, open/close hours; regenerates future free slots |

## 4. Conversation flows

### 4.1 Booking (`/book`) — features: service selection menu, weekly schedule display, slot booking confirmation
1. Bot sends **inline keyboard** with the three services: Стрижка (haircut),
   Борода (beard), Комплекс (combo) — callback `svc:<code>`.
2. Bot shows the current week as inline buttons (Mon–Sun, only days with free
   slots) — callback `day:<date>`.
3. Bot lists free 30-minute slots 9:00–18:00 for that day (grid from
   `schedule_days`, minus `is_booked`) — callback `slot:<id>`.
4. Confirmation card (service, date, time) with ✅/❌ — callback
   `confirm:<slot_id>` / `cancel:flow`.
5. On confirm: **transactionally** `UPDATE slots SET is_booked=1 WHERE id=? AND
   is_booked=0`; zero rows updated ⇒ somebody won the race ⇒ "slot taken"
   message + back to step 3. This is the **conflict prevention for double
   bookings**. On success insert the `confirmed` appointment and update the
   calendar view (the booked slot disappears from listings).

### 4.2 View appointments (`/my`) — feature: view active appointments
Lists the user's `confirmed` appointments: service title, weekday, date, time,
duration. Each row carries an inline "Отменить" button (`cancel:<appt_id>`)
linking into 4.3. Empty state: "У вас нет активных записей — /book".

### 4.3 Cancellation (`/cancel` or button) — feature: appointment cancellation with slot reactivation
1. Pick the appointment (inline list, same data as `/my`).
2. Confirm ✅/❌.
3. On confirm: appointment `status=cancelled`, its slot `is_booked=0`
   (**slot reactivation** — it reappears in 4.1 step 3 immediately).

### 4.4 Daily reminder — feature: daily 10:00 reminder
A scheduler tick runs **every day at 10:00** (bot-local timezone): select all
`confirmed` appointments with `starts_at` on the current date, send each user
"Сегодня в HH:MM — <service>". Idempotent per (appointment, date) via a
`reminded_at` stamp, so a restart cannot double-send.

### 4.5 Admin schedule (`/admin_schedule`) — feature: admin panel for the weekly schedule
Restricted to the configured admin Telegram ID; hidden from `/help`. Inline
flow: pick weekday → toggle working/day off → set open/close hours. Saving
regenerates **future** free slots for that weekday (booked slots are never
deleted). This is the admin-facing half of the **Schedule** entity.

## 5. External dependencies (mirrors General)

- **Telegram Bot API** via grammY: inline keyboards (service/day/slot
  selection), callback queries (every `svc/day/slot/confirm/cancel` button),
  and bot-initiated scheduled messages (the 10:00 reminder).
- **Persistence**: SQLite (users, appointments, services, slots, schedule);
  key fields per General — user ID, appointment timestamps, slot availability.
- **No third-party APIs.**

## 6. Non-goals (unchanged from General)

No payments/pricing, no multi-barber or staff scheduling, no notifications to
other users, no external calendar integration, no ratings/reviews.

## 7. Feature → design traceability

| General feature | Design section |
| --- | --- |
| Service selection menu (inline) | 4.1 step 1 |
| Weekly schedule display (9:00–18:00, 30 min) | 4.1 steps 2–3 |
| Slot booking confirmation + calendar update | 4.1 steps 4–5 |
| View active appointments | 4.2 |
| Cancellation + slot reactivation | 4.3 |
| Daily 10:00 reminder | 4.4 |
| Admin weekly schedule panel | 4.5 |
| Double-booking conflict prevention | 4.1 step 5 |
