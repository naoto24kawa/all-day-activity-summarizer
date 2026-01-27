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
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const summaries = sqliteTable("summaries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(), // YYYY-MM-DD
  periodStart: text("period_start").notNull(), // ISO8601
  periodEnd: text("period_end").notNull(), // ISO8601
  summaryType: text("summary_type", { enum: ["hourly", "daily"] }).notNull(),
  content: text("content").notNull(),
  segmentIds: text("segment_ids").notNull(), // JSON array of segment IDs
  model: text("model").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type TranscriptionSegment = typeof transcriptionSegments.$inferSelect;
export type NewTranscriptionSegment = typeof transcriptionSegments.$inferInsert;
export type Summary = typeof summaries.$inferSelect;
export type NewSummary = typeof summaries.$inferInsert;
