import Database from 'better-sqlite3';
import path from 'path';

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'proclean.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      name       TEXT NOT NULL,
      phone      TEXT UNIQUE,
      address    TEXT,
      service_type TEXT,
      notes      TEXT,
      last_contacted_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_phone TEXT NOT NULL,
      direction      TEXT NOT NULL CHECK(direction IN ('in','out')),
      body           TEXT NOT NULL,
      template_name  TEXT,
      sent_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reminder_log (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      calendar_event_id TEXT NOT NULL,
      customer_phone   TEXT NOT NULL,
      reminder_type    TEXT NOT NULL CHECK(reminder_type IN ('appointment','reengagement')),
      sent_at          TEXT DEFAULT (datetime('now')),
      UNIQUE(calendar_event_id, reminder_type)
    );

    CREATE TABLE IF NOT EXISTS conversation_states (
      customer_phone TEXT PRIMARY KEY,
      mode           TEXT DEFAULT 'bot' CHECK(mode IN ('bot','human')),
      updated_at     TEXT DEFAULT (datetime('now'))
    );
  `);
  console.log('Database initialised:', dbPath);
}

export default db;
