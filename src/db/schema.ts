import type Database from "better-sqlite3";

export const SLOT_DURATION_MIN = 30;
export const DAY_OPEN_HOUR = 9;
export const DAY_CLOSE_HOUR = 18;

export const SERVICE_CODES = ["haircut", "beard", "combo"] as const;
export type ServiceCode = (typeof SERVICE_CODES)[number];

export const SERVICE_DEFAULTS: { code: ServiceCode; title: string; duration_min: number }[] = [
  { code: "haircut", title: "Стрижка", duration_min: 30 },
  { code: "beard", title: "Борода", duration_min: 15 },
  { code: "combo", title: "Комплекс", duration_min: 45 },
];

export const APPOINTMENT_STATUSES = ["confirmed", "cancelled"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export interface UserRow {
  tg_id: number;
  name: string;
  registered_at: string;
}

export interface ServiceRow {
  code: ServiceCode;
  title: string;
  duration_min: number;
}

export interface SlotRow {
  id: number;
  starts_at: string;
  is_booked: number;
}

export interface AppointmentRow {
  id: number;
  user_tg_id: number;
  service_code: ServiceCode;
  slot_id: number;
  status: AppointmentStatus;
  created_at: string;
}

export interface ScheduleDayRow {
  weekday: number;
  is_working: number;
  open_time: string;
  close_time: string;
  created_at: string;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  tg_id        INTEGER PRIMARY KEY,
  name         TEXT    NOT NULL,
  registered_at TEXT   NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS services (
  code         TEXT PRIMARY KEY,
  title        TEXT    NOT NULL,
  duration_min INTEGER NOT NULL CHECK(duration_min > 0)
);

CREATE TABLE IF NOT EXISTS slots (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  starts_at TEXT    NOT NULL,
  is_booked INTEGER NOT NULL DEFAULT 0 CHECK(is_booked IN (0, 1))
);

CREATE TABLE IF NOT EXISTS appointments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_tg_id   INTEGER NOT NULL REFERENCES users(tg_id),
  service_code TEXT    NOT NULL REFERENCES services(code),
  slot_id      INTEGER NOT NULL REFERENCES slots(id),
  status       TEXT    NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'cancelled')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schedule_days (
  weekday    INTEGER PRIMARY KEY CHECK(weekday >= 0 AND weekday <= 6),
  is_working INTEGER NOT NULL DEFAULT 1 CHECK(is_working IN (0, 1)),
  open_time  TEXT    NOT NULL DEFAULT '09:00',
  close_time TEXT    NOT NULL DEFAULT '18:00',
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_slots_starts_at ON slots(starts_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_slots_starts_at ON slots(starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments(user_tg_id);
CREATE INDEX IF NOT EXISTS idx_appointments_slot ON appointments(slot_id);
`;

export function migrate(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
}

export function seedServices(db: Database.Database): void {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO services (code, title, duration_min) VALUES (?, ?, ?)"
  );
  for (const s of SERVICE_DEFAULTS) {
    insert.run(s.code, s.title, s.duration_min);
  }
}

export function seedSchedule(db: Database.Database): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO schedule_days (weekday, is_working, open_time, close_time)
     VALUES (?, 1, '09:00', '18:00')`
  );
  for (let d = 0; d <= 6; d++) {
    insert.run(d);
  }
}

export function is30MinuteGrid(time: string): boolean {
  const [h, m] = time.split(":").map(Number);
  return m % SLOT_DURATION_MIN === 0;
}

export function slotStartTimes(openTime: string, closeTime: string): string[] {
  const [openH, openM] = openTime.split(":").map(Number);
  const [closeH, closeM] = closeTime.split(":").map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;
  const times: string[] = [];
  for (let m = openMinutes; m < closeMinutes; m += SLOT_DURATION_MIN) {
    const hh = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    times.push(`${hh}:${mm}`);
  }
  return times;
}

export function slotFitsService(slotTime: string, durationMin: number, closeTime: string): boolean {
  const [slotH, slotM] = slotTime.split(":").map(Number);
  const [closeH, closeM] = closeTime.split(":").map(Number);
  const slotMinutes = slotH * 60 + slotM;
  const closeMinutes = closeH * 60 + closeM;
  return slotMinutes + durationMin <= closeMinutes;
}
