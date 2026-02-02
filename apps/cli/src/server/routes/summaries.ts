import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { SummarySourceMetadata, SummarySourcesResponse } from "@repo/types";
import { and, between, eq, gte, inArray, lte } from "drizzle-orm";
import { Hono } from "hono";
import { enqueueJob } from "../../ai-job/queue.js";
import { loadConfig } from "../../config.js";
import { getTodayDateString } from "../../utils/date.js";

/** 時間範囲の最大値 (12時間) */
const MAX_TIME_RANGE_HOURS = 12;

export function createSummariesRouter(db: AdasDatabase) {
  const config = loadConfig();
  const router = new Hono();

  router.get("/", (c) => {
    const date = c.req.query("date");
    const type = c.req.query("type") as "times" | "daily" | undefined;

    const query = db.select().from(schema.summaries);

    if (date && type) {
      return c.json(
        query
          .where(and(eq(schema.summaries.date, date), eq(schema.summaries.summaryType, type)))
          .all(),
      );
    }
    if (date) {
      return c.json(query.where(eq(schema.summaries.date, date)).all());
    }
    if (type) {
      return c.json(query.where(eq(schema.summaries.summaryType, type)).all());
    }

    return c.json(query.all());
  });

  router.post("/generate", async (c) => {
    const body = await c.req.json<{
      date?: string;
      type?: "times" | "daily";
      startHour?: number;
      endHour?: number;
    }>();
    const date = body.date ?? getTodayDateString();

    // Daily のみの場合
    if (body.type === "daily") {
      const jobId = enqueueJob(db, "summarize-daily", { date });
      return c.json({ success: true, jobId, message: "日次サマリ生成をキューに追加しました" });
    }

    // Times (時間範囲指定)
    if (body.startHour !== undefined && body.endHour !== undefined) {
      const { startHour, endHour } = body;

      // バリデーション
      if (startHour < 0 || startHour > 23 || endHour < 0 || endHour > 23) {
        return c.json({ success: false, error: "時間は 0-23 の範囲で指定してください" }, 400);
      }
      if (startHour > endHour) {
        return c.json({ success: false, error: "開始時間は終了時間以前にしてください" }, 400);
      }
      const timeRange = endHour - startHour + 1;
      if (timeRange > MAX_TIME_RANGE_HOURS) {
        return c.json(
          { success: false, error: `時間範囲は最大 ${MAX_TIME_RANGE_HOURS} 時間までです` },
          400,
        );
      }

      // Times サマリ生成をキューに追加
      const timesJobId = enqueueJob(db, "summarize-times", { date, startHour, endHour });

      // Daily サマリも自動的に再生成
      const dailyJobId = enqueueJob(db, "summarize-daily", { date });

      return c.json({
        success: true,
        jobIds: [timesJobId, dailyJobId],
        message: `${startHour}時〜${endHour}時のサマリ生成と日次サマリの再生成をキューに追加しました`,
      });
    }

    // デフォルト: Daily と (自動インターバル設定があれば) Times を一括生成
    const dailyJobId = enqueueJob(db, "summarize-daily", { date });
    const jobIds: number[] = [dailyJobId];

    const timesIntervalMinutes = config.summarizer.timesIntervalMinutes;
    if (timesIntervalMinutes > 0) {
      const hoursPerInterval = Math.max(1, Math.ceil(timesIntervalMinutes / 60));

      // 今日の場合は現在時刻まで、過去の日付は23時まで
      const today = getTodayDateString();
      const maxEndHour = date === today ? new Date().getHours() : 23;

      // 0時から maxEndHour まで、指定間隔で区切って複数の times サマリを生成
      const timeRanges: { startHour: number; endHour: number }[] = [];
      for (let hour = 0; hour <= maxEndHour; hour += hoursPerInterval) {
        const startHour = hour;
        const endHour = Math.min(hour + hoursPerInterval - 1, maxEndHour);
        timeRanges.push({ startHour, endHour });
      }

      // 各時間範囲のジョブをキューに追加
      for (const { startHour, endHour } of timeRanges) {
        const timesJobId = enqueueJob(db, "summarize-times", { date, startHour, endHour });
        jobIds.push(timesJobId);
      }

      const rangeDesc = timeRanges.map((r) => `${r.startHour}時〜${r.endHour}時`).join(", ");

      return c.json({
        success: true,
        jobIds,
        message: `日次サマリと ${timeRanges.length} 件の Times サマリ生成をキューに追加しました (${rangeDesc})`,
      });
    }

    return c.json({ success: true, jobIds, message: "日次サマリ生成をキューに追加しました" });
  });

  // ---------------------------------------------------------------------------
  // GET /api/summaries/:id/sources - ソースメタデータを取得
  // ---------------------------------------------------------------------------
  router.get("/:id/sources", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid summary ID" }, 400);
    }

    const summary = db.select().from(schema.summaries).where(eq(schema.summaries.id, id)).get();

    if (!summary) {
      return c.json({ error: "Summary not found" }, 404);
    }

    // sourceMetadata があればそれを返す
    if (summary.sourceMetadata) {
      try {
        const sources = JSON.parse(summary.sourceMetadata) as SummarySourceMetadata;
        const response: SummarySourcesResponse = {
          summaryId: id,
          sources,
        };
        return c.json(response);
      } catch {
        // パースに失敗した場合はフォールバック
      }
    }

    // フォールバック: periodStart/periodEnd から再取得
    const sources = await fetchSourcesFromPeriod(
      db,
      summary.date,
      summary.periodStart,
      summary.periodEnd,
    );

    const response: SummarySourcesResponse = {
      summaryId: id,
      sources,
    };
    return c.json(response);
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helper: JST → UTC 変換
// ---------------------------------------------------------------------------
function jstToUtcIso(jstTimeString: string): string {
  // JST フォーマット: "YYYY-MM-DDTHH:MM:SS"
  // +09:00 を追加して UTC に変換
  const jstDate = new Date(`${jstTimeString}+09:00`);
  return jstDate.toISOString();
}

// ---------------------------------------------------------------------------
// Helper: 期間からソースを取得 (既存サマリの sourceMetadata がない場合のフォールバック)
// ---------------------------------------------------------------------------
async function fetchSourcesFromPeriod(
  db: AdasDatabase,
  date: string,
  periodStart: string,
  periodEnd: string,
): Promise<SummarySourceMetadata> {
  const config = loadConfig();
  const myUserId = config.slack.userId;

  // JST → UTC 変換 (DB は UTC で保存されている)
  const utcStartTime = jstToUtcIso(periodStart);
  const utcEndTime = jstToUtcIso(periodEnd);

  // 音声セグメント
  const segments = db
    .select()
    .from(schema.transcriptionSegments)
    .where(
      and(
        eq(schema.transcriptionSegments.date, date),
        between(schema.transcriptionSegments.startTime, utcStartTime, utcEndTime),
      ),
    )
    .all();

  // メモ
  const memos = db
    .select()
    .from(schema.memos)
    .where(
      and(
        eq(schema.memos.date, date),
        gte(schema.memos.createdAt, utcStartTime),
        lte(schema.memos.createdAt, utcEndTime),
      ),
    )
    .all();

  // Slack メッセージ (自分に関係するもののみ)
  const slackMessages = db
    .select()
    .from(schema.slackMessages)
    .where(
      and(
        eq(schema.slackMessages.date, date),
        gte(schema.slackMessages.createdAt, utcStartTime),
        lte(schema.slackMessages.createdAt, utcEndTime),
      ),
    )
    .all()
    .filter(
      (m) =>
        m.messageType === "mention" ||
        m.messageType === "dm" ||
        (myUserId && m.userId === myUserId),
    );

  // Claude Code セッション
  const claudeSessions = db
    .select()
    .from(schema.claudeCodeSessions)
    .where(
      and(
        eq(schema.claudeCodeSessions.date, date),
        gte(schema.claudeCodeSessions.startTime, utcStartTime),
        lte(schema.claudeCodeSessions.startTime, utcEndTime),
      ),
    )
    .all();

  // タスク (承認済み・完了のみ)
  const tasks = db
    .select()
    .from(schema.tasks)
    .where(
      and(eq(schema.tasks.date, date), inArray(schema.tasks.status, ["accepted", "completed"])),
    )
    .all();

  // 学び (該当期間の Claude Code セッションから)
  const sessionIds = claudeSessions.map((s) => s.sessionId).filter((id) => id);
  const learnings =
    sessionIds.length > 0
      ? db
          .select()
          .from(schema.learnings)
          .where(inArray(schema.learnings.sourceId, sessionIds))
          .all()
      : [];

  // GitHub Items
  const githubItems = db
    .select()
    .from(schema.githubItems)
    .where(
      and(
        eq(schema.githubItems.date, date),
        gte(schema.githubItems.syncedAt, utcStartTime),
        lte(schema.githubItems.syncedAt, utcEndTime),
      ),
    )
    .all();

  // GitHub Comments
  const githubComments = db
    .select()
    .from(schema.githubComments)
    .where(
      and(
        eq(schema.githubComments.date, date),
        gte(schema.githubComments.syncedAt, utcStartTime),
        lte(schema.githubComments.syncedAt, utcEndTime),
      ),
    )
    .all();

  return {
    segments: segments.map((s) => ({
      id: s.id,
      startTime: s.startTime,
      speaker: s.speaker,
      transcription: s.transcription,
    })),
    memos: memos.map((m) => ({
      id: m.id,
      content: m.content,
      createdAt: m.createdAt,
    })),
    slackMessages: slackMessages.map((m) => ({
      id: m.id,
      permalink: m.permalink,
      channelName: m.channelName,
      userName: m.userName,
      text: m.text,
    })),
    claudeSessions: claudeSessions.map((s) => ({
      id: s.id,
      sessionId: s.sessionId,
      projectName: s.projectName,
      summary: s.summary,
      startTime: s.startTime,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      githubIssueUrl: t.githubIssueUrl,
    })),
    learnings: learnings.map((l) => ({
      id: l.id,
      content: l.content,
      sourceType: l.sourceType,
    })),
    githubItems: githubItems.map((i) => ({
      id: i.id,
      url: i.url,
      itemType: i.itemType,
      title: i.title,
      repoOwner: i.repoOwner,
      repoName: i.repoName,
      number: i.number,
    })),
    githubComments: githubComments.map((c) => ({
      id: c.id,
      url: c.url,
      commentType: c.commentType,
      body: c.body,
      authorLogin: c.authorLogin,
    })),
  };
}
