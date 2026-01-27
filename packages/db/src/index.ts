import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.js";

export { schema };
export type {
  NewSummary,
  NewTranscriptionSegment,
  Summary,
  TranscriptionSegment,
} from "./schema.js";

export type AdasDatabase = ReturnType<typeof createDatabase>;

export function createDatabase(dbPath: string) {
  const sqlite = new Database(dbPath, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  // Auto-create tables if not exists
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS transcription_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      audio_source TEXT NOT NULL,
      audio_file_path TEXT NOT NULL,
      transcription TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ja',
      confidence REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      summary_type TEXT NOT NULL CHECK(summary_type IN ('hourly', 'daily')),
      content TEXT NOT NULL,
      segment_ids TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_segments_date ON transcription_segments(date);
    CREATE INDEX IF NOT EXISTS idx_segments_start_time ON transcription_segments(start_time);
    CREATE INDEX IF NOT EXISTS idx_summaries_date ON summaries(date);
    CREATE INDEX IF NOT EXISTS idx_summaries_type ON summaries(summary_type);
  `);

  return db;
}
