import type {
  AdasDatabase,
  ClaudeCodeSession,
  GitHubComment,
  GitHubItem,
  Learning,
  Memo,
  SlackMessage,
  Task,
  TranscriptionSegment,
} from "@repo/db";
import { schema } from "@repo/db";
import { and, between, eq, gte, inArray, lte } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { generateSummary, getModelName } from "./client.js";
import { buildDailySummaryPrompt, buildHourlySummaryPrompt } from "./prompts.js";

// ---------------------------------------------------------------------------
// Time utilities (JST)
// ---------------------------------------------------------------------------

/**
 * Convert Slack messageTs to JST time string (HH:MM, 24-hour format)
 */
function slackTsToJstTime(ts: string): string {
  const [seconds] = ts.split(".");
  const utcMs = Number(seconds) * 1000;
  // JST = UTC + 9 hours
  const jstDate = new Date(utcMs + 9 * 60 * 60 * 1000);
  // Use get*() instead of getUTC*() because jstDate has JST offset applied
  const hours = String(jstDate.getHours()).padStart(2, "0");
  const minutes = String(jstDate.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Convert ISO8601 timestamp to JST time string (HH:MM, 24-hour format)
 */
function isoToJstTime(isoString: string): string {
  const date = new Date(isoString);
  // JST = UTC + 9 hours
  const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  // Use get*() instead of getUTC*() because jstDate has JST offset applied
  const hours = String(jstDate.getHours()).padStart(2, "0");
  const minutes = String(jstDate.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Convert JST time string (YYYY-MM-DDTHH:MM:SS) to UTC ISO8601 string
 * DB stores timestamps in UTC, so we need to convert JST query times to UTC
 */
function jstToUtcIso(jstTimeString: string): string {
  // Parse as JST (add +09:00 timezone)
  const jstDate = new Date(`${jstTimeString}+09:00`);
  return jstDate.toISOString();
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Classification types and helpers
// ---------------------------------------------------------------------------

interface ClassifiedActivities {
  personal: {
    segments: TranscriptionSegment[];
    memos: Memo[];
    claudeSessions: ClaudeCodeSession[];
    tasks: Task[];
    learnings: Learning[];
  };
  team: {
    segments: TranscriptionSegment[];
    slackMessages: SlackMessage[];
    githubItems: GitHubItem[];
    githubComments: GitHubComment[];
  };
}

/**
 * 音声セグメントがミーティングかどうかを判定する。
 * - audioSource = "system" → ミーティング (会議音声)
 * - 同じ期間内に自分以外の発話がある → ミーティング
 */
function classifySegments(segments: TranscriptionSegment[]): {
  personal: TranscriptionSegment[];
  team: TranscriptionSegment[];
} {
  const personal: TranscriptionSegment[] = [];
  const team: TranscriptionSegment[] = [];

  // system オーディオのセグメントは全てチーム活動
  const systemSegments = segments.filter((s) => s.audioSource === "system");
  const micSegments = segments.filter((s) => s.audioSource === "mic");

  // mic セグメントの中で、他者の発話があるかチェック
  const hasOtherSpeakers = micSegments.some(
    (s) => s.speaker && s.speaker !== "Me" && s.speaker !== "自分",
  );

  if (hasOtherSpeakers) {
    // 他者の発話がある場合、mic セグメントも全てチーム活動 (ミーティング)
    team.push(...systemSegments, ...micSegments);
  } else {
    // system セグメントはチーム、mic セグメント (独り言) は個人
    team.push(...systemSegments);
    personal.push(...micSegments);
  }

  return { personal, team };
}

/**
 * 活動データを個人作業とチーム活動に分類する。
 */
function classifyActivities(
  segments: TranscriptionSegment[],
  memos: Memo[],
  slackMessages: SlackMessage[],
  claudeSessions: ClaudeCodeSession[],
  tasks: Task[],
  learnings: Learning[],
  githubItems: GitHubItem[],
  githubComments: GitHubComment[],
): ClassifiedActivities {
  const { personal: personalSegments, team: teamSegments } = classifySegments(segments);

  return {
    personal: {
      segments: personalSegments,
      memos,
      claudeSessions,
      tasks,
      learnings,
    },
    team: {
      segments: teamSegments,
      slackMessages,
      githubItems,
      githubComments,
    },
  };
}

// ---------------------------------------------------------------------------
// Text building helpers
// ---------------------------------------------------------------------------

/**
 * 音声セグメントとメモをテキスト形式に変換
 */
function formatSegmentsAndMemos(segments: TranscriptionSegment[], memos: Memo[]): string {
  const segmentEntries = segments.map((s) => {
    const time = s.startTime.split("T")[1]?.slice(0, 5) || "";
    return {
      time: s.startTime,
      text: s.speaker
        ? `[${time}] ${s.speaker}: ${s.transcription}`
        : `[${time}] ${s.transcription}`,
    };
  });
  const memoEntries = memos.map((m) => {
    const time = isoToJstTime(m.createdAt);
    return {
      time: m.createdAt,
      text: `[メモ] [${time}] ${m.content}`,
    };
  });
  return [...segmentEntries, ...memoEntries]
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((e) => e.text)
    .join("\n\n");
}

/**
 * Claude Code セッションをテキスト形式に変換
 */
function formatClaudeSessions(claudeSessions: ClaudeCodeSession[]): string {
  return claudeSessions
    .map((s) => {
      const time = s.startTime ? isoToJstTime(s.startTime) : "??:??";
      const project = s.projectName || s.projectPath.split("/").pop() || "unknown";
      const summary = s.summary
        ? `: ${s.summary.slice(0, 100)}${s.summary.length > 100 ? "..." : ""}`
        : "";
      return `[${time}] ${project} (user: ${s.userMessageCount}, tool: ${s.toolUseCount})${summary}`;
    })
    .join("\n");
}

/**
 * タスクをテキスト形式に変換
 */
function formatTasks(tasks: Task[]): string {
  const acceptedTasks = tasks.filter((t) => t.status === "accepted" || t.status === "completed");
  return acceptedTasks
    .map((t) => {
      const priorityLabel = t.priority ? `[${t.priority}]` : "";
      const statusLabel = t.status === "completed" ? "[完了]" : "";
      const source =
        t.sourceType === "github" ? "[GitHub]" : t.sourceType === "manual" ? "[手動]" : "";
      return `- ${priorityLabel}${statusLabel}${source} ${t.title}`;
    })
    .join("\n");
}

/**
 * 学びをテキスト形式に変換
 */
function formatLearnings(learnings: Learning[]): string {
  return learnings
    .map((l) => {
      const category = l.category ? `[${l.category}]` : "";
      return `- ${category} ${l.content}`;
    })
    .join("\n");
}

/**
 * Slack メッセージをテキスト形式に変換
 */
function formatSlackMessages(slackMessages: SlackMessage[]): string {
  return slackMessages
    .map((m) => {
      const typeLabel =
        m.messageType === "mention" ? "メンション" : m.messageType === "dm" ? "DM" : "チャネル";
      const channel = m.channelName || m.channelId;
      const time = slackTsToJstTime(m.messageTs);
      return `[${time}] [${typeLabel}] #${channel} ${m.userName || m.userId}: ${m.text}`;
    })
    .join("\n");
}

/**
 * GitHub Items (Issue/PR) をテキスト形式に変換
 */
function formatGitHubItems(items: GitHubItem[]): string {
  return items
    .map((item) => {
      const typeLabel = item.itemType === "issue" ? "Issue" : "PR";
      const stateLabel = item.state === "open" ? "" : `[${item.state}]`;
      const repo = `${item.repoOwner}/${item.repoName}`;
      const time = item.githubUpdatedAt ? isoToJstTime(item.githubUpdatedAt) : "";
      const reviewLabel = item.isReviewRequested ? "[レビュー依頼]" : "";
      return `[${time}] [${typeLabel}]${stateLabel}${reviewLabel} ${repo}#${item.number}: ${item.title}`;
    })
    .join("\n");
}

/**
 * GitHub Comments をテキスト形式に変換
 */
function formatGitHubComments(comments: GitHubComment[]): string {
  return comments
    .map((c) => {
      const typeLabel =
        c.commentType === "review"
          ? "レビュー"
          : c.commentType === "review_comment"
            ? "レビューコメント"
            : "コメント";
      const repo = `${c.repoOwner}/${c.repoName}`;
      const time = c.githubCreatedAt ? isoToJstTime(c.githubCreatedAt) : "";
      const author = c.authorLogin || "unknown";
      const bodyPreview = c.body.slice(0, 80) + (c.body.length > 80 ? "..." : "");
      return `[${time}] [${typeLabel}] ${repo}#${c.itemNumber} ${author}: ${bodyPreview}`;
    })
    .join("\n");
}

/**
 * 活動データ (セグメント、メモ、Slack、Claude Code、タスク、学び、GitHub) を
 * 「個人作業」と「チーム活動」のセクションに分けてプロンプト用のテキストを生成する。
 */
function buildActivityTextWithSections(
  segments: TranscriptionSegment[],
  memos: Memo[],
  slackMessages: SlackMessage[],
  claudeSessions: ClaudeCodeSession[],
  tasks: Task[],
  learnings: Learning[],
  githubItems: GitHubItem[],
  githubComments: GitHubComment[],
): string {
  const classified = classifyActivities(
    segments,
    memos,
    slackMessages,
    claudeSessions,
    tasks,
    learnings,
    githubItems,
    githubComments,
  );

  const sections: string[] = [];

  // ========== 個人作業セクション ==========
  const personalSections: string[] = [];

  // 音声・メモ (個人の独り言)
  const personalTranscription = formatSegmentsAndMemos(
    classified.personal.segments,
    classified.personal.memos,
  );
  if (personalTranscription) {
    personalSections.push(`#### 音声・メモ\n${personalTranscription}`);
  }

  // Claude Code セッション
  if (classified.personal.claudeSessions.length > 0) {
    const claudeText = formatClaudeSessions(classified.personal.claudeSessions);
    personalSections.push(`#### Claude Code\n${claudeText}`);
  }

  // タスク
  const taskText = formatTasks(classified.personal.tasks);
  if (taskText) {
    personalSections.push(`#### タスク\n${taskText}`);
  }

  // 学び
  if (classified.personal.learnings.length > 0) {
    const learningText = formatLearnings(classified.personal.learnings);
    personalSections.push(`#### 学び\n${learningText}`);
  }

  if (personalSections.length > 0) {
    sections.push(`### 個人作業\n${personalSections.join("\n\n")}`);
  }

  // ========== チーム活動セクション ==========
  const teamSections: string[] = [];

  // ミーティング音声
  if (classified.team.segments.length > 0) {
    const meetingText = formatSegmentsAndMemos(classified.team.segments, []);
    teamSections.push(`#### ミーティング\n${meetingText}`);
  }

  // Slack メッセージ
  if (classified.team.slackMessages.length > 0) {
    const slackText = formatSlackMessages(classified.team.slackMessages);
    teamSections.push(`#### Slack\n${slackText}`);
  }

  // GitHub Items
  if (classified.team.githubItems.length > 0) {
    const githubItemsText = formatGitHubItems(classified.team.githubItems);
    teamSections.push(`#### GitHub (Issue/PR)\n${githubItemsText}`);
  }

  // GitHub Comments
  if (classified.team.githubComments.length > 0) {
    const githubCommentsText = formatGitHubComments(classified.team.githubComments);
    teamSections.push(`#### GitHub (コメント/レビュー)\n${githubCommentsText}`);
  }

  if (teamSections.length > 0) {
    sections.push(`### チーム活動\n${teamSections.join("\n\n")}`);
  }

  return sections.join("\n\n");
}

interface ActivityData {
  segments: TranscriptionSegment[];
  memos: Memo[];
  slackMessages: SlackMessage[];
  claudeSessions: ClaudeCodeSession[];
  tasks: Task[];
  learnings: Learning[];
  githubItems: GitHubItem[];
  githubComments: GitHubComment[];
}

/**
 * 指定期間の活動データ (セグメント、メモ、Slack、Claude Code) を取得する。
 * startTime/endTime は JST の時刻文字列 (YYYY-MM-DDTHH:MM:SS)
 * DB は UTC で保存されているため、クエリ時に変換が必要
 */
function fetchActivityData(
  db: AdasDatabase,
  date: string,
  startTime: string,
  endTime: string,
): ActivityData {
  // JST → UTC 変換 (DBはUTCで保存されている)
  const utcStartTime = jstToUtcIso(startTime);
  const utcEndTime = jstToUtcIso(endTime);

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

  // サマリーには自分に関係するメッセージのみ含める
  // - 自分へのメンション (mention)
  // - DM (dm)
  // - 自分が送信したメッセージ (userId が一致)
  const config = loadConfig();
  const myUserId = config.slack.userId;
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

  // GitHub Items (Issue/PR) - 該当期間に更新されたもの
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

  // GitHub Comments - 該当期間に作成されたもの
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
    segments,
    memos,
    slackMessages,
    claudeSessions,
    tasks,
    learnings,
    githubItems,
    githubComments,
  };
}

/** period index (0-47) から startTime/endTime を返す */
export function periodToTimeRange(
  date: string,
  periodIndex: number,
): { startTime: string; endTime: string } {
  const hour = Math.floor(periodIndex / 2);
  const isSecondHalf = periodIndex % 2 === 1;
  const hh = String(hour).padStart(2, "0");

  if (isSecondHalf) {
    return {
      startTime: `${date}T${hh}:30:00`,
      endTime: `${date}T${hh}:59:59`,
    };
  }
  return {
    startTime: `${date}T${hh}:00:00`,
    endTime: `${date}T${hh}:29:59`,
  };
}

// ---------------------------------------------------------------------------
// Pomodoro summary (30-min intervals)
// ---------------------------------------------------------------------------

/**
 * 30分間隔 (ポモドーロ) の要約を生成する。
 *
 * @param db - データベース接続
 * @param date - 対象日 (YYYY-MM-DD形式)
 * @param startTime - 期間開始時刻 (ISO8601形式)
 * @param endTime - 期間終了時刻 (ISO8601形式)
 * @returns 生成された要約テキスト、データがない場合は null
 */
export async function generatePomodoroSummary(
  db: AdasDatabase,
  date: string,
  startTime: string,
  endTime: string,
): Promise<string | null> {
  const {
    segments,
    memos,
    slackMessages,
    claudeSessions,
    tasks,
    learnings,
    githubItems,
    githubComments,
  } = fetchActivityData(db, date, startTime, endTime);

  const hasData =
    segments.length > 0 ||
    memos.length > 0 ||
    slackMessages.length > 0 ||
    claudeSessions.length > 0 ||
    tasks.length > 0 ||
    learnings.length > 0 ||
    githubItems.length > 0 ||
    githubComments.length > 0;

  if (!hasData) {
    return null;
  }

  const activityText = buildActivityTextWithSections(
    segments,
    memos,
    slackMessages,
    claudeSessions,
    tasks,
    learnings,
    githubItems,
    githubComments,
  );
  const prompt = await buildHourlySummaryPrompt(activityText, db);
  const content = await generateSummary(prompt);
  const segmentIds = segments.map((s) => s.id);

  // 同じ期間の既存サマリーを削除してから挿入(上書き)
  db.delete(schema.summaries)
    .where(
      and(
        eq(schema.summaries.date, date),
        eq(schema.summaries.summaryType, "pomodoro"),
        eq(schema.summaries.periodStart, startTime),
        eq(schema.summaries.periodEnd, endTime),
      ),
    )
    .run();

  db.insert(schema.summaries)
    .values({
      date,
      periodStart: startTime,
      periodEnd: endTime,
      summaryType: "pomodoro",
      content,
      segmentIds: JSON.stringify(segmentIds),
      model: getModelName(),
    })
    .run();

  return content;
}

// ---------------------------------------------------------------------------
// Hourly summary (1-hour, aggregates pomodoro summaries)
// ---------------------------------------------------------------------------

/**
 * 1時間単位の要約を生成する。
 * ポモドーロ要約が存在する場合はそれを集約し、
 * 存在しない場合はセグメントから直接生成する。
 *
 * @param db - データベース接続
 * @param date - 対象日 (YYYY-MM-DD形式)
 * @param hour - 対象時間 (0-23)
 * @returns 生成された要約テキスト、データがない場合は null
 */
export async function generateHourlySummary(
  db: AdasDatabase,
  date: string,
  hour: number,
): Promise<string | null> {
  const hh = String(hour).padStart(2, "0");
  const startTime = `${date}T${hh}:00:00`;
  const endTime = `${date}T${hh}:59:59`;

  // Prefer aggregating pomodoro summaries if they exist
  const pomodoroSummaries = db
    .select()
    .from(schema.summaries)
    .where(
      and(
        eq(schema.summaries.date, date),
        eq(schema.summaries.summaryType, "pomodoro"),
        between(schema.summaries.periodStart, startTime, endTime),
      ),
    )
    .all();

  if (pomodoroSummaries.length > 0) {
    const summariesText = pomodoroSummaries
      .map((s) => `### ${s.periodStart} - ${s.periodEnd}\n${s.content}`)
      .join("\n\n");

    const prompt = await buildHourlySummaryPrompt(summariesText, db);
    const content = await generateSummary(prompt);
    const allSegmentIds = pomodoroSummaries.flatMap((s) => JSON.parse(s.segmentIds) as number[]);

    // 同じ期間の既存サマリーを削除してから挿入(上書き)
    db.delete(schema.summaries)
      .where(
        and(
          eq(schema.summaries.date, date),
          eq(schema.summaries.summaryType, "hourly"),
          eq(schema.summaries.periodStart, startTime),
          eq(schema.summaries.periodEnd, endTime),
        ),
      )
      .run();

    db.insert(schema.summaries)
      .values({
        date,
        periodStart: startTime,
        periodEnd: endTime,
        summaryType: "hourly",
        content,
        segmentIds: JSON.stringify(allSegmentIds),
        model: getModelName(),
      })
      .run();

    return content;
  }

  // Fallback: generate directly from activity data
  const {
    segments,
    memos,
    slackMessages,
    claudeSessions,
    tasks,
    learnings,
    githubItems,
    githubComments,
  } = fetchActivityData(db, date, startTime, endTime);

  const hasData =
    segments.length > 0 ||
    memos.length > 0 ||
    slackMessages.length > 0 ||
    claudeSessions.length > 0 ||
    tasks.length > 0 ||
    learnings.length > 0 ||
    githubItems.length > 0 ||
    githubComments.length > 0;

  if (!hasData) {
    return null;
  }

  const activityText = buildActivityTextWithSections(
    segments,
    memos,
    slackMessages,
    claudeSessions,
    tasks,
    learnings,
    githubItems,
    githubComments,
  );
  const prompt = await buildHourlySummaryPrompt(activityText, db);
  const content = await generateSummary(prompt);
  const segmentIds = segments.map((s) => s.id);

  // 同じ期間の既存サマリーを削除してから挿入(上書き)
  db.delete(schema.summaries)
    .where(
      and(
        eq(schema.summaries.date, date),
        eq(schema.summaries.summaryType, "hourly"),
        eq(schema.summaries.periodStart, startTime),
        eq(schema.summaries.periodEnd, endTime),
      ),
    )
    .run();

  db.insert(schema.summaries)
    .values({
      date,
      periodStart: startTime,
      periodEnd: endTime,
      summaryType: "hourly",
      content,
      segmentIds: JSON.stringify(segmentIds),
      model: getModelName(),
    })
    .run();

  return content;
}

// ---------------------------------------------------------------------------
// Daily summary (aggregates hourly summaries)
// ---------------------------------------------------------------------------

/**
 * 日次要約を生成する。
 * 1時間単位の要約を集約して生成する。
 *
 * @param db - データベース接続
 * @param date - 対象日 (YYYY-MM-DD形式)
 * @returns 生成された要約テキスト、データがない場合は null
 */
export async function generateDailySummary(db: AdasDatabase, date: string): Promise<string | null> {
  const hourlySummaries = db
    .select()
    .from(schema.summaries)
    .where(and(eq(schema.summaries.date, date), eq(schema.summaries.summaryType, "hourly")))
    .all();

  if (hourlySummaries.length === 0) {
    return null;
  }

  const summariesText = hourlySummaries
    .map((s) => `### ${s.periodStart} - ${s.periodEnd}\n${s.content}`)
    .join("\n\n");

  const prompt = await buildDailySummaryPrompt(summariesText, db);
  const content = await generateSummary(prompt);
  const allSegmentIds = hourlySummaries.flatMap((s) => JSON.parse(s.segmentIds) as number[]);

  // 同じ日の既存 daily サマリーを削除してから挿入(上書き)
  db.delete(schema.summaries)
    .where(and(eq(schema.summaries.date, date), eq(schema.summaries.summaryType, "daily")))
    .run();

  db.insert(schema.summaries)
    .values({
      date,
      periodStart: `${date}T00:00:00`,
      periodEnd: `${date}T23:59:59`,
      summaryType: "daily",
      content,
      segmentIds: JSON.stringify(allSegmentIds),
      model: getModelName(),
    })
    .run();

  return content;
}
