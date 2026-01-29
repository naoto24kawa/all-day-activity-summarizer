import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const transcriptionSegments = sqliteTable("transcription_segments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD
  startTime: text("start_time").notNull(), // ISO8601
  endTime: text("end_time").notNull(), // ISO8601
  audioSource: text("audio_source").notNull(),
  audioFilePath: text("audio_file_path").notNull(),
  transcription: text("transcription").notNull(),
  language: text("language").notNull().default("ja"),
  confidence: real("confidence"),
  speaker: text("speaker"),
  interpretedText: text("interpreted_text"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const summaries = sqliteTable("summaries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD
  periodStart: text("period_start").notNull(), // ISO8601
  periodEnd: text("period_end").notNull(), // ISO8601
  summaryType: text("summary_type", { enum: ["pomodoro", "hourly", "daily"] }).notNull(),
  content: text("content").notNull(),
  segmentIds: text("segment_ids").notNull(), // JSON array of segment IDs
  model: text("model").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const memos = sqliteTable("memos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD
  content: text("content").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type TranscriptionSegment = typeof transcriptionSegments.$inferSelect;
export type NewTranscriptionSegment = typeof transcriptionSegments.$inferInsert;
export type Summary = typeof summaries.$inferSelect;
export type NewSummary = typeof summaries.$inferInsert;
export type Memo = typeof memos.$inferSelect;
export type NewMemo = typeof memos.$inferInsert;

export const segmentFeedbacks = sqliteTable("segment_feedbacks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  segmentId: integer("segment_id").notNull(),
  rating: text("rating", { enum: ["good", "bad"] }).notNull(),
  target: text("target", {
    enum: ["interpret", "evaluate", "summarize-hourly", "summarize-daily"],
  })
    .notNull()
    .default("interpret"),
  reason: text("reason"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type SegmentFeedback = typeof segmentFeedbacks.$inferSelect;
export type NewSegmentFeedback = typeof segmentFeedbacks.$inferInsert;

export const promptImprovements = sqliteTable("prompt_improvements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  target: text("target", {
    enum: ["interpret", "evaluate", "summarize-hourly", "summarize-daily"],
  }).notNull(),
  previousPrompt: text("previous_prompt").notNull(),
  newPrompt: text("new_prompt").notNull(),
  feedbackCount: integer("feedback_count").notNull(),
  goodCount: integer("good_count").notNull(),
  badCount: integer("bad_count").notNull(),
  improvementReason: text("improvement_reason"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type PromptImprovement = typeof promptImprovements.$inferSelect;
export type NewPromptImprovement = typeof promptImprovements.$inferInsert;

export const evaluatorLogs = sqliteTable("evaluator_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD
  audioFilePath: text("audio_file_path").notNull(),
  transcriptionText: text("transcription_text").notNull(),
  judgment: text("judgment", { enum: ["hallucination", "legitimate", "mixed"] }).notNull(),
  confidence: real("confidence").notNull(),
  reason: text("reason").notNull(),
  suggestedPattern: text("suggested_pattern"),
  patternApplied: integer("pattern_applied", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type EvaluatorLog = typeof evaluatorLogs.$inferSelect;
export type NewEvaluatorLog = typeof evaluatorLogs.$inferInsert;

export const summaryQueue = sqliteTable("summary_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobType: text("job_type", { enum: ["pomodoro", "hourly", "daily"] }).notNull(),
  date: text("date").notNull(),
  periodParam: integer("period_param"), // pomodoro: 0-47, hourly: 0-23
  status: text("status", { enum: ["pending", "processing", "completed", "failed"] })
    .notNull()
    .default("pending"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  errorMessage: text("error_message"),
  lockedAt: text("locked_at"),
  runAfter: text("run_after").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type SummaryQueueJob = typeof summaryQueue.$inferSelect;
export type NewSummaryQueueJob = typeof summaryQueue.$inferInsert;

// ---------------------------------------------------------------------------
// Slack Messages
// ---------------------------------------------------------------------------

export const slackMessages = sqliteTable("slack_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD
  messageTs: text("message_ts").notNull(), // Slack message timestamp (unique per channel)
  channelId: text("channel_id").notNull(),
  channelName: text("channel_name"),
  userId: text("user_id").notNull(),
  userName: text("user_name"),
  messageType: text("message_type", {
    enum: ["mention", "channel", "dm", "keyword"],
  }).notNull(),
  text: text("text").notNull(),
  threadTs: text("thread_ts"), // Parent message ts if in thread
  permalink: text("permalink"),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type SlackMessage = typeof slackMessages.$inferSelect;
export type NewSlackMessage = typeof slackMessages.$inferInsert;

// ---------------------------------------------------------------------------
// Slack Queue
// ---------------------------------------------------------------------------

export const slackQueue = sqliteTable("slack_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobType: text("job_type", {
    enum: ["fetch_mentions", "fetch_channel", "fetch_dm", "fetch_keywords"],
  }).notNull(),
  channelId: text("channel_id"), // null for mentions search
  status: text("status", { enum: ["pending", "processing", "completed", "failed"] })
    .notNull()
    .default("pending"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  errorMessage: text("error_message"),
  lockedAt: text("locked_at"),
  runAfter: text("run_after").notNull(),
  lastFetchedTs: text("last_fetched_ts"), // Last message ts fetched (for pagination)
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type SlackQueueJob = typeof slackQueue.$inferSelect;
export type NewSlackQueueJob = typeof slackQueue.$inferInsert;

// ---------------------------------------------------------------------------
// Claude Code Sessions
// ---------------------------------------------------------------------------

export const claudeCodeSessions = sqliteTable("claude_code_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD
  sessionId: text("session_id").notNull().unique(), // UUID
  projectPath: text("project_path").notNull(),
  projectName: text("project_name"), // パスの最後の部分
  startTime: text("start_time"), // ISO8601
  endTime: text("end_time"),
  userMessageCount: integer("user_message_count").notNull().default(0),
  assistantMessageCount: integer("assistant_message_count").notNull().default(0),
  toolUseCount: integer("tool_use_count").notNull().default(0),
  summary: text("summary"), // 最初のユーザーメッセージ
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type ClaudeCodeSession = typeof claudeCodeSessions.$inferSelect;
export type NewClaudeCodeSession = typeof claudeCodeSessions.$inferInsert;

// ---------------------------------------------------------------------------
// Claude Code Queue
// ---------------------------------------------------------------------------

export const claudeCodeQueue = sqliteTable("claude_code_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobType: text("job_type", { enum: ["fetch_sessions"] }).notNull(),
  projectPath: text("project_path"),
  status: text("status", { enum: ["pending", "processing", "completed", "failed"] })
    .notNull()
    .default("pending"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  errorMessage: text("error_message"),
  lockedAt: text("locked_at"),
  runAfter: text("run_after").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type ClaudeCodeQueueJob = typeof claudeCodeQueue.$inferSelect;
export type NewClaudeCodeQueueJob = typeof claudeCodeQueue.$inferInsert;
