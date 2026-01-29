import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.js";

export { schema };
export type {
  ClaudeCodeQueueJob,
  ClaudeCodeSession,
  EvaluatorLog,
  Memo,
  NewClaudeCodeQueueJob,
  NewClaudeCodeSession,
  NewEvaluatorLog,
  NewMemo,
  NewPromptImprovement,
  NewSegmentFeedback,
  NewSlackMessage,
  NewSlackQueueJob,
  NewSummary,
  NewSummaryQueueJob,
  NewTranscriptionSegment,
  PromptImprovement,
  SegmentFeedback,
  SlackMessage,
  SlackQueueJob,
  Summary,
  SummaryQueueJob,
  TranscriptionSegment,
} from "./schema.js";

export type AdasDatabase = ReturnType<typeof createDatabase>;

/**
 * カラムが存在しない場合のみ追加するヘルパー関数。
 * SQLite の ALTER TABLE ADD COLUMN は、既存カラムがあるとエラーになるため、
 * try-catch でエラーを無視する。
 */
function addColumnIfNotExists(
  sqlite: Database,
  table: string,
  column: string,
  definition: string,
): void {
  try {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch {
    // Column already exists, ignore
  }
}

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

  // Migration: add columns to transcription_segments
  addColumnIfNotExists(sqlite, "transcription_segments", "speaker", "TEXT");
  addColumnIfNotExists(sqlite, "transcription_segments", "interpreted_text", "TEXT");

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

  // Migration: add columns to segment_feedbacks
  addColumnIfNotExists(sqlite, "segment_feedbacks", "target", "TEXT NOT NULL DEFAULT 'interpret'");
  addColumnIfNotExists(sqlite, "segment_feedbacks", "reason", "TEXT");

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

  // Migration: create summary_queue table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS summary_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL CHECK(job_type IN ('pomodoro', 'hourly', 'daily')),
      date TEXT NOT NULL,
      period_param INTEGER,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      error_message TEXT,
      locked_at TEXT,
      run_after TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_summary_queue_status ON summary_queue(status);
    CREATE INDEX IF NOT EXISTS idx_summary_queue_run_after ON summary_queue(run_after);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_summary_queue_unique_job
      ON summary_queue(job_type, date, period_param)
      WHERE status IN ('pending', 'processing');

    -- Slack messages table
    CREATE TABLE IF NOT EXISTS slack_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      message_ts TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      channel_name TEXT,
      user_id TEXT NOT NULL,
      user_name TEXT,
      message_type TEXT NOT NULL CHECK(message_type IN ('mention', 'channel', 'dm')),
      text TEXT NOT NULL,
      thread_ts TEXT,
      permalink TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_slack_messages_date ON slack_messages(date);
    CREATE INDEX IF NOT EXISTS idx_slack_messages_channel ON slack_messages(channel_id);
    CREATE INDEX IF NOT EXISTS idx_slack_messages_type ON slack_messages(message_type);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_messages_unique ON slack_messages(channel_id, message_ts);

    -- Slack queue table
    CREATE TABLE IF NOT EXISTS slack_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL CHECK(job_type IN ('fetch_mentions', 'fetch_channel', 'fetch_dm', 'fetch_keywords')),
      channel_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      error_message TEXT,
      locked_at TEXT,
      run_after TEXT NOT NULL,
      last_fetched_ts TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_slack_queue_status ON slack_queue(status);
    CREATE INDEX IF NOT EXISTS idx_slack_queue_run_after ON slack_queue(run_after);

    -- Claude Code sessions table
    CREATE TABLE IF NOT EXISTS claude_code_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      session_id TEXT NOT NULL UNIQUE,
      project_path TEXT NOT NULL,
      project_name TEXT,
      start_time TEXT,
      end_time TEXT,
      user_message_count INTEGER NOT NULL DEFAULT 0,
      assistant_message_count INTEGER NOT NULL DEFAULT 0,
      tool_use_count INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_claude_code_sessions_date ON claude_code_sessions(date);
    CREATE INDEX IF NOT EXISTS idx_claude_code_sessions_project ON claude_code_sessions(project_path);

    -- Claude Code queue table
    CREATE TABLE IF NOT EXISTS claude_code_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL CHECK(job_type IN ('fetch_sessions')),
      project_path TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      error_message TEXT,
      locked_at TEXT,
      run_after TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_claude_code_queue_status ON claude_code_queue(status);
    CREATE INDEX IF NOT EXISTS idx_claude_code_queue_run_after ON claude_code_queue(run_after);
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
