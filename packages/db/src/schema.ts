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
  tags: text("tags"), // JSON array: ["TODO", "重要"]
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
    enum: ["interpret", "evaluate", "summarize-hourly", "summarize-daily", "task-extract"],
  })
    .notNull()
    .default("interpret"),
  reason: text("reason"),
  issues: text("issues"), // JSON array of issue types
  correctedText: text("corrected_text"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type SegmentFeedback = typeof segmentFeedbacks.$inferSelect;
export type NewSegmentFeedback = typeof segmentFeedbacks.$inferInsert;

// ---------------------------------------------------------------------------
// Feedbacks (汎用フィードバック: summary, evaluator_log 用)
// ---------------------------------------------------------------------------

export const feedbacks = sqliteTable("feedbacks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  targetType: text("target_type", {
    enum: ["summary", "evaluator_log"],
  }).notNull(),
  targetId: integer("target_id").notNull(),
  rating: text("rating", {
    enum: ["good", "neutral", "bad"],
  }).notNull(),
  issues: text("issues"), // JSON array of issue types
  reason: text("reason"),
  correctedText: text("corrected_text"),
  correctJudgment: text("correct_judgment", {
    enum: ["hallucination", "legitimate", "mixed"],
  }),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type Feedback = typeof feedbacks.$inferSelect;
export type NewFeedback = typeof feedbacks.$inferInsert;

export const promptImprovements = sqliteTable("prompt_improvements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  target: text("target", {
    enum: ["interpret", "evaluate", "summarize-hourly", "summarize-daily", "task-extract"],
  }).notNull(),
  previousPrompt: text("previous_prompt").notNull(),
  newPrompt: text("new_prompt").notNull(),
  feedbackCount: integer("feedback_count").notNull(),
  goodCount: integer("good_count").notNull(),
  badCount: integer("bad_count").notNull(),
  improvementReason: text("improvement_reason"),
  status: text("status", {
    enum: ["pending", "approved", "rejected"],
  })
    .notNull()
    .default("pending"),
  approvedAt: text("approved_at"),
  rejectedAt: text("rejected_at"),
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
// Slack Users (display name mapping)
// ---------------------------------------------------------------------------

export const slackUsers = sqliteTable("slack_users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().unique(),
  slackName: text("slack_name"), // Original name from Slack API
  displayName: text("display_name"), // User-defined display name
  speakerNames: text("speaker_names"), // JSON array: ["SPEAKER_00", "SPEAKER_01"]
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type SlackUser = typeof slackUsers.$inferSelect;
export type NewSlackUser = typeof slackUsers.$inferInsert;

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

// ---------------------------------------------------------------------------
// Claude Code Messages
// ---------------------------------------------------------------------------

export const claudeCodeMessages = sqliteTable("claude_code_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  date: text("date").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  timestamp: text("timestamp"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type ClaudeCodeMessage = typeof claudeCodeMessages.$inferSelect;
export type NewClaudeCodeMessage = typeof claudeCodeMessages.$inferInsert;

// ---------------------------------------------------------------------------
// GitHub Items (Issues & PRs)
// ---------------------------------------------------------------------------

export const githubItems = sqliteTable("github_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD (JST)
  itemType: text("item_type", { enum: ["issue", "pull_request"] }).notNull(),
  repoOwner: text("repo_owner").notNull(),
  repoName: text("repo_name").notNull(),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  state: text("state").notNull(), // "open" | "closed" | "merged"
  url: text("url").notNull(),
  authorLogin: text("author_login"),
  assigneeLogin: text("assignee_login"),
  labels: text("labels"), // JSON array
  body: text("body"),
  githubCreatedAt: text("github_created_at"),
  githubUpdatedAt: text("github_updated_at"),
  closedAt: text("closed_at"),
  mergedAt: text("merged_at"),
  isDraft: integer("is_draft", { mode: "boolean" }),
  reviewDecision: text("review_decision"), // "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED"
  isReviewRequested: integer("is_review_requested", { mode: "boolean" }).default(false),
  commentCount: integer("comment_count").default(0),
  isRead: integer("is_read", { mode: "boolean" }).default(false),
  syncedAt: text("synced_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type GitHubItem = typeof githubItems.$inferSelect;
export type NewGitHubItem = typeof githubItems.$inferInsert;

// ---------------------------------------------------------------------------
// GitHub Comments (Issue comments, PR comments, Reviews)
// ---------------------------------------------------------------------------

export const githubComments = sqliteTable("github_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD (JST)
  commentType: text("comment_type", {
    enum: ["issue_comment", "review_comment", "review"],
  }).notNull(),
  repoOwner: text("repo_owner").notNull(),
  repoName: text("repo_name").notNull(),
  itemNumber: integer("item_number").notNull(),
  commentId: text("comment_id").notNull(), // GitHub's comment ID
  authorLogin: text("author_login"),
  body: text("body").notNull(),
  url: text("url").notNull(),
  reviewState: text("review_state"), // "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED"
  githubCreatedAt: text("github_created_at"),
  isRead: integer("is_read", { mode: "boolean" }).default(false),
  syncedAt: text("synced_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type GitHubComment = typeof githubComments.$inferSelect;
export type NewGitHubComment = typeof githubComments.$inferInsert;

// ---------------------------------------------------------------------------
// GitHub Queue
// ---------------------------------------------------------------------------

export const githubQueue = sqliteTable("github_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobType: text("job_type", {
    enum: ["fetch_issues", "fetch_prs", "fetch_review_requests"],
  }).notNull(),
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

export type GitHubQueueJob = typeof githubQueue.$inferSelect;
export type NewGitHubQueueJob = typeof githubQueue.$inferInsert;

// ---------------------------------------------------------------------------
// Vocabulary (用語辞書 - initial_prompt 用)
// ---------------------------------------------------------------------------

export const vocabulary = sqliteTable("vocabulary", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  term: text("term").notNull().unique(), // 用語
  reading: text("reading"), // 読み仮名(任意)
  category: text("category"), // カテゴリ(任意)
  source: text("source", { enum: ["manual", "transcribe", "feedback"] }).notNull(), // 登録元
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type Vocabulary = typeof vocabulary.$inferSelect;
export type NewVocabulary = typeof vocabulary.$inferInsert;

// ---------------------------------------------------------------------------
// Tasks (Slack メッセージから抽出したタスク)
// ---------------------------------------------------------------------------

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD
  slackMessageId: integer("slack_message_id"), // FK to slack_messages (nullable for manual tasks)
  githubCommentId: integer("github_comment_id"), // FK to github_comments
  memoId: integer("memo_id"), // FK to memos
  promptImprovementId: integer("prompt_improvement_id"), // FK to prompt_improvements (for prompt-improvement type)
  profileSuggestionId: integer("profile_suggestion_id"), // FK to profile_suggestions (for profile-suggestion type)
  projectId: integer("project_id"), // FK to projects (nullable for Slack/Memo tasks)
  sourceType: text("source_type", {
    enum: [
      "slack",
      "github",
      "github-comment",
      "memo",
      "manual",
      "prompt-improvement",
      "profile-suggestion",
    ],
  })
    .notNull()
    .default("slack"),
  title: text("title").notNull(), // AI が生成したタスク文
  description: text("description"), // 詳細説明
  status: text("status", {
    enum: ["pending", "accepted", "rejected", "in_progress", "paused", "completed"],
  })
    .notNull()
    .default("pending"),
  priority: text("priority", {
    enum: ["high", "medium", "low"],
  }),
  confidence: real("confidence"), // AI の確信度 (0-1)
  dueDate: text("due_date"), // 期限 (YYYY-MM-DD)
  extractedAt: text("extracted_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  acceptedAt: text("accepted_at"),
  rejectedAt: text("rejected_at"),
  startedAt: text("started_at"), // 実行開始日時
  pausedAt: text("paused_at"), // 中断日時
  completedAt: text("completed_at"),
  rejectReason: text("reject_reason"), // 却下理由
  pauseReason: text("pause_reason"), // 中断理由
  originalTitle: text("original_title"), // 修正前のタイトル (修正して承認した場合のみ)
  originalDescription: text("original_description"), // 修正前の説明 (修正して承認した場合のみ)
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

// ---------------------------------------------------------------------------
// Learnings (各種ソースから抽出した学び)
// ---------------------------------------------------------------------------

export const learnings = sqliteTable("learnings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceType: text("source_type", {
    enum: ["claude-code", "transcription", "github-comment", "slack-message"],
  })
    .notNull()
    .default("claude-code"),
  sourceId: text("source_id").notNull(), // 各ソースの ID (session_id, segment_id, comment_id, message_id)
  projectId: integer("project_id"), // FK to projects (nullable)
  date: text("date").notNull(), // YYYY-MM-DD
  content: text("content").notNull(), // 学びの内容
  category: text("category"), // "typescript" | "react" | "architecture" など
  tags: text("tags"), // JSON array
  confidence: real("confidence"), // AI の確信度 (0-1)

  // 間隔反復学習用 (SM-2 アルゴリズム)
  repetitionCount: integer("repetition_count").notNull().default(0),
  easeFactor: real("ease_factor").notNull().default(2.5),
  interval: integer("interval").notNull().default(0), // 次回までの間隔 (日)
  nextReviewAt: text("next_review_at"), // 次回復習日
  lastReviewedAt: text("last_reviewed_at"), // 最終復習日

  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type Learning = typeof learnings.$inferSelect;
export type NewLearning = typeof learnings.$inferInsert;

// ---------------------------------------------------------------------------
// User Profile (ユーザープロフィール - 単一レコード)
// ---------------------------------------------------------------------------

export const userProfile = sqliteTable("user_profile", {
  id: integer("id").primaryKey().default(1),
  experienceYears: integer("experience_years"),
  specialties: text("specialties"), // JSON: ["frontend", "typescript"]
  knownTechnologies: text("known_technologies"), // JSON: ["React", "Hono", ...]
  learningGoals: text("learning_goals"), // JSON: ["Rust", "DDD"]
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type UserProfile = typeof userProfile.$inferSelect;
export type NewUserProfile = typeof userProfile.$inferInsert;

// ---------------------------------------------------------------------------
// Profile Suggestions (プロフィール提案 - 承認待ち)
// ---------------------------------------------------------------------------

export const profileSuggestions = sqliteTable("profile_suggestions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  suggestionType: text("suggestion_type", {
    enum: ["add_technology", "add_specialty", "add_goal", "update_experience"],
  }).notNull(),
  field: text("field").notNull(), // "knownTechnologies" | "specialties" | ...
  value: text("value").notNull(), // 提案する値
  reason: text("reason"), // 提案理由
  sourceType: text("source_type", {
    enum: ["claude-code", "github", "slack", "transcription", "learning"],
  }).notNull(),
  sourceId: text("source_id"), // 根拠となるソースのID
  confidence: real("confidence"), // AI確信度
  status: text("status", {
    enum: ["pending", "accepted", "rejected"],
  })
    .notNull()
    .default("pending"),
  acceptedAt: text("accepted_at"),
  rejectedAt: text("rejected_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type ProfileSuggestion = typeof profileSuggestions.$inferSelect;
export type NewProfileSuggestion = typeof profileSuggestions.$inferInsert;

// ---------------------------------------------------------------------------
// Projects (プロジェクト管理)
// ---------------------------------------------------------------------------

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  path: text("path"), // Claude Code の projectPath
  githubOwner: text("github_owner"), // GitHub owner
  githubRepo: text("github_repo"), // GitHub repo name
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
