import Database from "better-sqlite3";
import { migrate, seedServices, seedSchedule } from "./schema.js";

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(process.env.DB_PATH ?? "trimtimebot.db");
    _db.pragma("journal_mode = WAL");
    _db.pragma("foreign_keys = ON");
    migrate(_db);
    seedServices(_db);
    seedSchedule(_db);
  }
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
