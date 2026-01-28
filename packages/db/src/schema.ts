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

export const evaluatorLogs = sqliteTable("evaluator_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD
  audioFilePath: text("audio_file_path").notNull(),
  transcriptionText: text("transcription_text").notNull(),
  judgment: text("judgment", { enum: ["hallucination", "legitimate"] }).notNull(),
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
