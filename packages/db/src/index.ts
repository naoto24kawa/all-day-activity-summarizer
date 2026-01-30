import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.js";

export { schema };
export type {
  ClaudeCodeMessage,
  ClaudeCodeQueueJob,
  ClaudeCodeSession,
  EvaluatorLog,
  Feedback,
  GitHubComment,
  GitHubItem,
  GitHubQueueJob,
  Learning,
  Memo,
  NewClaudeCodeMessage,
  NewClaudeCodeQueueJob,
  NewClaudeCodeSession,
  NewEvaluatorLog,
  NewFeedback,
  NewGitHubComment,
  NewGitHubItem,
  NewGitHubQueueJob,
  NewLearning,
  NewMemo,
  NewProfileSuggestion,
  NewProject,
  NewPromptImprovement,
  NewSegmentFeedback,
  NewSlackMessage,
  NewSlackQueueJob,
  NewSummary,
  NewSummaryQueueJob,
  NewTask,
  NewTranscriptionSegment,
  NewUserProfile,
  ProfileSuggestion,
  Project,
  PromptImprovement,
  SegmentFeedback,
  SlackMessage,
  SlackQueueJob,
  Summary,
  SummaryQueueJob,
  Task,
  TranscriptionSegment,
  UserProfile,
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
      judgment TEXT NOT NULL CHECK(judgment IN ('hallucination', 'legitimate', 'mixed')),
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
  addColumnIfNotExists(sqlite, "segment_feedbacks", "issues", "TEXT");
  addColumnIfNotExists(sqlite, "segment_feedbacks", "corrected_text", "TEXT");

  // Migration: create feedbacks table (for summary and evaluator_log feedback)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS feedbacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN ('summary', 'evaluator_log')),
      target_id INTEGER NOT NULL,
      rating TEXT NOT NULL CHECK(rating IN ('good', 'neutral', 'bad')),
      issues TEXT,
      reason TEXT,
      corrected_text TEXT,
      correct_judgment TEXT CHECK(correct_judgment IN ('hallucination', 'legitimate', 'mixed')),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_feedbacks_target ON feedbacks(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_feedbacks_rating ON feedbacks(rating);
  `);

  // Migration: add speaker_names column to slack_users
  addColumnIfNotExists(sqlite, "slack_users", "speaker_names", "TEXT");

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
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      approved_at TEXT,
      rejected_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_improvements_target ON prompt_improvements(target);
  `);

  // Migration: add status columns to prompt_improvements (for existing tables without these columns)
  addColumnIfNotExists(sqlite, "prompt_improvements", "status", "TEXT DEFAULT 'pending'");
  addColumnIfNotExists(sqlite, "prompt_improvements", "approved_at", "TEXT");
  addColumnIfNotExists(sqlite, "prompt_improvements", "rejected_at", "TEXT");

  // Create status index after ensuring column exists
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_prompt_improvements_status ON prompt_improvements(status);
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
      message_type TEXT NOT NULL CHECK(message_type IN ('mention', 'channel', 'dm', 'keyword')),
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

    -- Slack users table (for display name mapping)
    CREATE TABLE IF NOT EXISTS slack_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      slack_name TEXT,
      display_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_users_user_id ON slack_users(user_id);

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

    -- Claude Code messages table
    CREATE TABLE IF NOT EXISTS claude_code_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      date TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      timestamp TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_claude_code_messages_session ON claude_code_messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_claude_code_messages_date ON claude_code_messages(date);

    -- GitHub Items table (Issues & PRs)
    CREATE TABLE IF NOT EXISTS github_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      item_type TEXT NOT NULL CHECK(item_type IN ('issue', 'pull_request')),
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      number INTEGER NOT NULL,
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      url TEXT NOT NULL,
      author_login TEXT,
      assignee_login TEXT,
      labels TEXT,
      body TEXT,
      github_created_at TEXT,
      github_updated_at TEXT,
      closed_at TEXT,
      merged_at TEXT,
      is_draft INTEGER,
      review_decision TEXT,
      is_review_requested INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      is_read INTEGER DEFAULT 0,
      synced_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_github_items_date ON github_items(date);
    CREATE INDEX IF NOT EXISTS idx_github_items_type ON github_items(item_type);
    CREATE INDEX IF NOT EXISTS idx_github_items_state ON github_items(state);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_github_items_unique ON github_items(repo_owner, repo_name, number);

    -- GitHub Comments table
    CREATE TABLE IF NOT EXISTS github_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      comment_type TEXT NOT NULL CHECK(comment_type IN ('issue_comment', 'review_comment', 'review')),
      repo_owner TEXT NOT NULL,
      repo_name TEXT NOT NULL,
      item_number INTEGER NOT NULL,
      comment_id TEXT NOT NULL,
      author_login TEXT,
      body TEXT NOT NULL,
      url TEXT NOT NULL,
      review_state TEXT,
      github_created_at TEXT,
      is_read INTEGER DEFAULT 0,
      synced_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_github_comments_date ON github_comments(date);
    CREATE INDEX IF NOT EXISTS idx_github_comments_type ON github_comments(comment_type);
    CREATE INDEX IF NOT EXISTS idx_github_comments_item ON github_comments(repo_owner, repo_name, item_number);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_github_comments_unique ON github_comments(repo_owner, repo_name, comment_id);

    -- GitHub Queue table
    CREATE TABLE IF NOT EXISTS github_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL CHECK(job_type IN ('fetch_issues', 'fetch_prs', 'fetch_review_requests')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      error_message TEXT,
      locked_at TEXT,
      run_after TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_github_queue_status ON github_queue(status);
    CREATE INDEX IF NOT EXISTS idx_github_queue_run_after ON github_queue(run_after);

    -- Vocabulary table (用語辞書)
    CREATE TABLE IF NOT EXISTS vocabulary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term TEXT NOT NULL UNIQUE,
      reading TEXT,
      category TEXT,
      source TEXT NOT NULL CHECK(source IN ('manual', 'transcribe', 'feedback')),
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_vocabulary_term ON vocabulary(term);
    CREATE INDEX IF NOT EXISTS idx_vocabulary_source ON vocabulary(source);

    -- Tasks table (Slack メッセージから抽出したタスク)
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      slack_message_id INTEGER,
      source_type TEXT NOT NULL DEFAULT 'slack' CHECK(source_type IN ('slack', 'github', 'github-comment', 'memo', 'manual')),
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'completed')),
      priority TEXT CHECK(priority IN ('high', 'medium', 'low')),
      confidence REAL,
      due_date TEXT,
      extracted_at TEXT NOT NULL,
      accepted_at TEXT,
      rejected_at TEXT,
      completed_at TEXT,
      reject_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_slack_message ON tasks(slack_message_id);

    -- Learnings table (各種ソースから抽出した学び)
    CREATE TABLE IF NOT EXISTS learnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL DEFAULT 'claude-code' CHECK(source_type IN ('claude-code', 'transcription', 'github-comment', 'slack-message')),
      source_id TEXT NOT NULL,
      date TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT,
      tags TEXT,
      confidence REAL,
      repetition_count INTEGER NOT NULL DEFAULT 0,
      ease_factor REAL NOT NULL DEFAULT 2.5,
      interval INTEGER NOT NULL DEFAULT 0,
      next_review_at TEXT,
      last_reviewed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_learnings_source ON learnings(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_learnings_date ON learnings(date);
    CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category);
    CREATE INDEX IF NOT EXISTS idx_learnings_next_review ON learnings(next_review_at);
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

  // Migration: update evaluator_logs CHECK constraint to allow 'mixed' judgment
  try {
    const row = sqlite
      .query<{ sql: string }, []>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='evaluator_logs'",
      )
      .get();
    if (row && !row.sql.includes("'mixed'")) {
      sqlite.exec(`
        ALTER TABLE evaluator_logs RENAME TO evaluator_logs_old;
        CREATE TABLE evaluator_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          audio_file_path TEXT NOT NULL,
          transcription_text TEXT NOT NULL,
          judgment TEXT NOT NULL CHECK(judgment IN ('hallucination', 'legitimate', 'mixed')),
          confidence REAL NOT NULL,
          reason TEXT NOT NULL,
          suggested_pattern TEXT,
          pattern_applied INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        INSERT INTO evaluator_logs SELECT * FROM evaluator_logs_old;
        DROP TABLE evaluator_logs_old;
        CREATE INDEX IF NOT EXISTS idx_evaluator_logs_date ON evaluator_logs(date);
      `);
    }
  } catch {
    // Migration already applied or fresh DB
  }

  // Migration: update slack_messages CHECK constraint to allow 'keyword' message_type
  try {
    const row = sqlite
      .query<{ sql: string }, []>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='slack_messages'",
      )
      .get();
    if (row && !row.sql.includes("'keyword'")) {
      sqlite.exec(`
        ALTER TABLE slack_messages RENAME TO slack_messages_old;
        CREATE TABLE slack_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          message_ts TEXT NOT NULL,
          channel_id TEXT NOT NULL,
          channel_name TEXT,
          user_id TEXT NOT NULL,
          user_name TEXT,
          message_type TEXT NOT NULL CHECK(message_type IN ('mention', 'channel', 'dm', 'keyword')),
          text TEXT NOT NULL,
          thread_ts TEXT,
          permalink TEXT,
          is_read INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        INSERT INTO slack_messages SELECT * FROM slack_messages_old;
        DROP TABLE slack_messages_old;
        CREATE INDEX IF NOT EXISTS idx_slack_messages_date ON slack_messages(date);
        CREATE INDEX IF NOT EXISTS idx_slack_messages_channel ON slack_messages(channel_id);
        CREATE INDEX IF NOT EXISTS idx_slack_messages_type ON slack_messages(message_type);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_messages_unique ON slack_messages(channel_id, message_ts);
      `);
    }
  } catch {
    // Migration already applied or fresh DB
  }

  // Migration: update learnings table to add source_type and rename session_id to source_id
  try {
    const row = sqlite
      .query<{ sql: string }, []>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='learnings'",
      )
      .get();
    if (row?.sql.includes("session_id") && !row.sql.includes("source_type")) {
      sqlite.exec(`
        ALTER TABLE learnings RENAME TO learnings_old;
        CREATE TABLE learnings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source_type TEXT NOT NULL DEFAULT 'claude-code' CHECK(source_type IN ('claude-code', 'transcription', 'github-comment', 'slack-message')),
          source_id TEXT NOT NULL,
          date TEXT NOT NULL,
          content TEXT NOT NULL,
          category TEXT,
          tags TEXT,
          confidence REAL,
          repetition_count INTEGER NOT NULL DEFAULT 0,
          ease_factor REAL NOT NULL DEFAULT 2.5,
          interval INTEGER NOT NULL DEFAULT 0,
          next_review_at TEXT,
          last_reviewed_at TEXT,
          created_at TEXT NOT NULL
        );
        INSERT INTO learnings (id, source_type, source_id, date, content, category, tags, confidence, repetition_count, ease_factor, interval, next_review_at, last_reviewed_at, created_at)
          SELECT id, 'claude-code', session_id, date, content, category, tags, confidence, repetition_count, ease_factor, interval, next_review_at, last_reviewed_at, created_at FROM learnings_old;
        DROP TABLE learnings_old;
        CREATE INDEX IF NOT EXISTS idx_learnings_source ON learnings(source_type, source_id);
        CREATE INDEX IF NOT EXISTS idx_learnings_date ON learnings(date);
        CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category);
        CREATE INDEX IF NOT EXISTS idx_learnings_next_review ON learnings(next_review_at);
      `);
    }
  } catch {
    // Migration already applied or fresh DB
  }

  // Migration: add prompt_improvement_id to tasks and update CHECK constraint
  addColumnIfNotExists(sqlite, "tasks", "prompt_improvement_id", "INTEGER");
  try {
    const row = sqlite
      .query<{ sql: string }, []>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'",
      )
      .get();
    if (row && !row.sql.includes("'prompt-improvement'")) {
      sqlite.exec(`
        ALTER TABLE tasks RENAME TO tasks_old;
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          slack_message_id INTEGER,
          prompt_improvement_id INTEGER,
          source_type TEXT NOT NULL DEFAULT 'slack' CHECK(source_type IN ('slack', 'github', 'github-comment', 'memo', 'manual', 'prompt-improvement')),
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'completed')),
          priority TEXT CHECK(priority IN ('high', 'medium', 'low')),
          confidence REAL,
          due_date TEXT,
          extracted_at TEXT NOT NULL,
          accepted_at TEXT,
          rejected_at TEXT,
          completed_at TEXT,
          reject_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO tasks (id, date, slack_message_id, prompt_improvement_id, source_type, title, description, status, priority, confidence, due_date, extracted_at, accepted_at, rejected_at, completed_at, reject_reason, created_at, updated_at)
          SELECT id, date, slack_message_id, NULL, source_type, title, description, status, priority, confidence, due_date, extracted_at, accepted_at, rejected_at, completed_at, reject_reason, created_at, updated_at FROM tasks_old;
        DROP TABLE tasks_old;
        CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(date);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_slack_message ON tasks(slack_message_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_prompt_improvement ON tasks(prompt_improvement_id);
      `);
    }
  } catch {
    // Migration already applied or fresh DB
  }

  // Migration: add tags column to memos
  addColumnIfNotExists(sqlite, "memos", "tags", "TEXT");

  // Migration: create user_profile table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      experience_years INTEGER,
      specialties TEXT,
      known_technologies TEXT,
      learning_goals TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  // Migration: create profile_suggestions table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS profile_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      suggestion_type TEXT NOT NULL CHECK(suggestion_type IN ('add_technology', 'add_specialty', 'add_goal', 'update_experience')),
      field TEXT NOT NULL,
      value TEXT NOT NULL,
      reason TEXT,
      source_type TEXT NOT NULL CHECK(source_type IN ('claude-code', 'github', 'slack', 'transcription', 'learning')),
      source_id TEXT,
      confidence REAL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
      accepted_at TEXT,
      rejected_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_profile_suggestions_status ON profile_suggestions(status);
    CREATE INDEX IF NOT EXISTS idx_profile_suggestions_source ON profile_suggestions(source_type);
  `);

  // Migration: create projects table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT,
      github_owner TEXT,
      github_repo TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(path) WHERE path IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_github ON projects(github_owner, github_repo) WHERE github_owner IS NOT NULL AND github_repo IS NOT NULL;
  `);

  // Migration: add project_id to tasks and learnings
  addColumnIfNotExists(sqlite, "tasks", "project_id", "INTEGER");
  addColumnIfNotExists(sqlite, "learnings", "project_id", "INTEGER");

  // Create indexes for project_id
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_learnings_project ON learnings(project_id);
  `);

  // Migration: add original_title and original_description to tasks (for corrected approval)
  addColumnIfNotExists(sqlite, "tasks", "original_title", "TEXT");
  addColumnIfNotExists(sqlite, "tasks", "original_description", "TEXT");

  // Migration: add github_comment_id and memo_id to tasks (for duplicate prevention)
  addColumnIfNotExists(sqlite, "tasks", "github_comment_id", "INTEGER");
  addColumnIfNotExists(sqlite, "tasks", "memo_id", "INTEGER");

  // Create indexes for new columns
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_github_comment ON tasks(github_comment_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_memo ON tasks(memo_id);
  `);

  return db;
}
