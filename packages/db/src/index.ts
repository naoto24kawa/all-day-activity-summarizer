import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.js";

export { schema };
export type {
  EvaluatorLog,
  Memo,
  NewEvaluatorLog,
  NewMemo,
  NewPromptImprovement,
  NewSegmentFeedback,
  NewSummary,
  NewTranscriptionSegment,
  PromptImprovement,
  SegmentFeedback,
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
      summary_type TEXT NOT NULL CHECK(summary_type IN ('pomodoro', 'hourly', 'daily')),
      content TEXT NOT NULL,
      segment_ids TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_segments_date ON transcription_segments(date);
    CREATE INDEX IF NOT EXISTS idx_segments_start_time ON transcription_segments(start_time);
    CREATE INDEX IF NOT EXISTS idx_summaries_date ON summaries(date);
    CREATE INDEX IF NOT EXISTS idx_summaries_type ON summaries(summary_type);

    CREATE TABLE IF NOT EXISTS memos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memos_date ON memos(date);

    CREATE TABLE IF NOT EXISTS evaluator_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      audio_file_path TEXT NOT NULL,
      transcription_text TEXT NOT NULL,
      judgment TEXT NOT NULL CHECK(judgment IN ('hallucination', 'legitimate')),
      confidence REAL NOT NULL,
      reason TEXT NOT NULL,
      suggested_pattern TEXT,
      pattern_applied INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_evaluator_logs_date ON evaluator_logs(date);
  `);

  // Migration: add speaker column if not exists
  try {
    sqlite.exec(`ALTER TABLE transcription_segments ADD COLUMN speaker TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: add interpreted_text column if not exists
  try {
    sqlite.exec(`ALTER TABLE transcription_segments ADD COLUMN interpreted_text TEXT`);
  } catch {
    // Column already exists, ignore
  }

  // Migration: create segment_feedbacks table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS segment_feedbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      segment_id INTEGER NOT NULL,
      rating TEXT NOT NULL CHECK(rating IN ('good', 'bad')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_segment_feedbacks_segment_id ON segment_feedbacks(segment_id);
  `);

  // Migration: add target and reason columns to segment_feedbacks
  try {
    sqlite.exec(
      `ALTER TABLE segment_feedbacks ADD COLUMN target TEXT NOT NULL DEFAULT 'interpret'`,
    );
  } catch {
    // Column already exists
  }
  try {
    sqlite.exec(`ALTER TABLE segment_feedbacks ADD COLUMN reason TEXT`);
  } catch {
    // Column already exists
  }

  // Migration: create prompt_improvements table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS prompt_improvements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target TEXT NOT NULL,
      previous_prompt TEXT NOT NULL,
      new_prompt TEXT NOT NULL,
      feedback_count INTEGER NOT NULL,
      good_count INTEGER NOT NULL,
      bad_count INTEGER NOT NULL,
      improvement_reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_improvements_target ON prompt_improvements(target);
  `);

  // Migration: update CHECK constraint to allow 'pomodoro' summary_type
  // SQLite doesn't support ALTER CHECK, so recreate the table
  try {
    const row = sqlite
      .query<{ sql: string }, []>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='summaries'",
      )
      .get();
    if (row && !row.sql.includes("'pomodoro'")) {
      sqlite.exec(`
        ALTER TABLE summaries RENAME TO summaries_old;
        CREATE TABLE summaries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          period_start TEXT NOT NULL,
          period_end TEXT NOT NULL,
          summary_type TEXT NOT NULL CHECK(summary_type IN ('pomodoro', 'hourly', 'daily')),
          content TEXT NOT NULL,
          segment_ids TEXT NOT NULL,
          model TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO summaries SELECT * FROM summaries_old;
        DROP TABLE summaries_old;
        CREATE INDEX IF NOT EXISTS idx_summaries_date ON summaries(date);
        CREATE INDEX IF NOT EXISTS idx_summaries_type ON summaries(summary_type);
      `);
    }
  } catch {
    // Migration already applied or fresh DB
  }

  return db;
}
