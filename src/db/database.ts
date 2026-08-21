import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

const CURRENT_SCHEMA_VERSION = 4;

export function createDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  if (path !== ":memory:") sqlite.exec("PRAGMA journal_mode = WAL;");

  const row = sqlite.query("PRAGMA user_version").get() as { user_version: number };
  if (row.user_version > CURRENT_SCHEMA_VERSION) {
    sqlite.close();
    throw new Error(
      `Database schema ${row.user_version} is newer than supported ${CURRENT_SCHEMA_VERSION}`,
    );
  }

  if (row.user_version < 1) {
    const migrate = sqlite.transaction(() => {
      sqlite.exec(`
        CREATE TABLE reminders (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          scheduled_at_ms INTEGER NOT NULL,
          next_attempt_at_ms INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          source_key TEXT,
          delivery_attempts INTEGER NOT NULL DEFAULT 0,
          claimed_at_ms INTEGER,
          sent_at_ms INTEGER,
          created_at_ms INTEGER NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX reminders_source_key_unique ON reminders(source_key);
        CREATE INDEX reminders_due_idx ON reminders(status, next_attempt_at_ms);

        CREATE TABLE audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          event_type TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT,
          details_json TEXT NOT NULL DEFAULT '{}',
          created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX audit_log_created_idx ON audit_log(created_at_ms);

        PRAGMA user_version = 1;
      `);
    });
    migrate();
  }

  const afterV1 = sqlite.query("PRAGMA user_version").get() as { user_version: number };
  if (afterV1.user_version < 2) {
    const migrate = sqlite.transaction(() => {
      sqlite.exec(`
        CREATE TABLE conversation_context (
          owner_key TEXT PRIMARY KEY NOT NULL,
          pending_tool TEXT,
          pending_arguments_json TEXT,
          missing_information_json TEXT,
          pending_expires_at_ms INTEGER,
          last_entity_type TEXT,
          last_entity_id TEXT,
          last_action TEXT,
          last_entity_json TEXT,
          last_entity_expires_at_ms INTEGER,
          updated_at_ms INTEGER NOT NULL
        );
        PRAGMA user_version = 2;
      `);
    });
    migrate();
  }

  const afterV2 = sqlite.query("PRAGMA user_version").get() as { user_version: number };
  if (afterV2.user_version < 3) {
    const migrate = sqlite.transaction(() => {
      sqlite.exec(`
        ALTER TABLE reminders ADD COLUMN event_at_ms INTEGER;
        ALTER TABLE reminders ADD COLUMN lead_minutes INTEGER;
        PRAGMA user_version = 3;
      `);
    });
    migrate();
  }

  const afterV3 = sqlite.query("PRAGMA user_version").get() as { user_version: number };
  if (afterV3.user_version < 4) {
    const migrate = sqlite.transaction(() => {
      sqlite.exec(`
        CREATE TABLE conversation_turns (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          owner_key TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at_ms INTEGER NOT NULL
        );
        CREATE INDEX conversation_turns_owner_created_idx
          ON conversation_turns(owner_key, created_at_ms);
        PRAGMA user_version = 4;
      `);
    });
    migrate();
  }

  const db = drizzle(sqlite, { schema });
  return {
    sqlite,
    db,
    close: () => sqlite.close(),
  };
}

export type AppDatabase = ReturnType<typeof createDatabase>;
