import type {
  AdasDatabase,
  ClaudeCodeSession,
  GitHubComment,
  GitHubItem,
  Learning,
  Memo,
  Project,
  SlackMessage,
  Task,
  TranscriptionSegment,
} from "@repo/db";
import { schema } from "@repo/db";
import { and, between, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { getChildTasks } from "../utils/task-hierarchy.js";
import { generateSummary, getModelName } from "./client.js";
import { buildDailySummaryPrompt, buildTimesSummaryPrompt } from "./prompts.js";

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
// Project helpers
// ---------------------------------------------------------------------------

/**
 * アクティブなプロジェクト一覧を取得
 */
function fetchActiveProjects(db: AdasDatabase): Project[] {
  return db.select().from(schema.projects).where(eq(schema.projects.isActive, true)).all();
}

/**
 * プロジェクトIDからプロジェクト名を取得するマップを作成
 */
function buildProjectNameMap(projects: Project[]): Map<number | null, string> {
  const map = new Map<number | null, string>();
  for (const project of projects) {
    map.set(project.id, project.name);
  }
  map.set(null, "その他");
  return map;
}

interface ProjectGroupedItems<T> {
  projectId: number | null;
  projectName: string;
  items: T[];
}

/**
 * アイテムをprojectIdでグループ化する汎用関数
 */
function groupItemsByProject<T extends { projectId: number | null }>(
  items: T[],
  projectNameMap: Map<number | null, string>,
): ProjectGroupedItems<T>[] {
  const groups = new Map<number | null, T[]>();

  for (const item of items) {
    const projectId = item.projectId;
    if (!groups.has(projectId)) {
      groups.set(projectId, []);
    }
    groups.get(projectId)?.push(item);
  }

  // プロジェクトIDでソート (nullは最後)
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });

  return sortedKeys.map((projectId) => ({
    projectId,
    projectName: projectNameMap.get(projectId) ?? "その他",
    items: groups.get(projectId) ?? [],
  }));
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

interface ActionableTask {
  task: Task;
  isBlocked: boolean;
  blockedBy: { id: number; title: string; status: string }[];
}

interface ActionableTasksResult {
  tasks: ActionableTask[];
  totalCount: number;
}

/**
 * 着手すべきタスク (承認済み・進行中) を優先度順・ブロック状態付きで取得
 * 親タスクのみ取得 (子タスクは親と一緒に表示される)
 */
function fetchActionableTasks(db: AdasDatabase, limit = 5): ActionableTasksResult {
  // 親タスクのみを対象 (accepted + in_progress, parentId is null)
  const allTasks = db
    .select()
    .from(schema.tasks)
    .where(
      and(inArray(schema.tasks.status, ["accepted", "in_progress"]), isNull(schema.tasks.parentId)),
    )
    .orderBy(desc(schema.tasks.priority), desc(schema.tasks.acceptedAt))
    .all();

  const totalCount = allTasks.length;
  const tasks = allTasks.slice(0, limit);

  const result: ActionableTask[] = [];

  for (const task of tasks) {
    const blockedByDeps = db
      .select()
      .from(schema.taskDependencies)
      .where(
        and(
          eq(schema.taskDependencies.taskId, task.id),
          eq(schema.taskDependencies.dependencyType, "blocks"),
        ),
      )
      .all();

    const blockers: { id: number; title: string; status: string }[] = [];
    for (const dep of blockedByDeps) {
      const blockerTask = db
        .select({ id: schema.tasks.id, title: schema.tasks.title, status: schema.tasks.status })
        .from(schema.tasks)
        .where(eq(schema.tasks.id, dep.dependsOnTaskId))
        .get();

      if (blockerTask && blockerTask.status !== "completed") {
        blockers.push(blockerTask);
      }
    }

    result.push({
      task,
      isBlocked: blockers.length > 0,
      blockedBy: blockers,
    });
  }

  // ブロックされていないタスクを先に、次に優先度順
  const sortedTasks = result.sort((a, b) => {
    if (a.isBlocked !== b.isBlocked) {
      return a.isBlocked ? 1 : -1;
    }
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const aPriority = priorityOrder[a.task.priority as keyof typeof priorityOrder] ?? 1;
    const bPriority = priorityOrder[b.task.priority as keyof typeof priorityOrder] ?? 1;
    return aPriority - bPriority;
  });

  return { tasks: sortedTasks, totalCount };
}

/**
 * 着手すべきタスクをテキスト形式に変換 (プロジェクト毎にグループ化、子タスク含む)
 */
function formatActionableTasks(
  result: ActionableTasksResult,
  projectNameMap: Map<number | null, string>,
  db?: AdasDatabase,
): string {
  const { tasks: actionableTasks, totalCount } = result;

  if (actionableTasks.length === 0) {
    return "";
  }

  const lines: string[] = [];
  const displayCount = actionableTasks.length;

  // 5件以上の場合は全体件数も表示
  if (totalCount > displayCount) {
    lines.push(`全${totalCount}件中${displayCount}件を表示`);
    lines.push("");
  }

  // プロジェクト毎にグループ化
  const tasksByProject = new Map<number | null, ActionableTask[]>();
  for (const actionableTask of actionableTasks) {
    const projectId = actionableTask.task.projectId;
    if (!tasksByProject.has(projectId)) {
      tasksByProject.set(projectId, []);
    }
    tasksByProject.get(projectId)?.push(actionableTask);
  }

  // プロジェクトIDでソート (nullは最後)
  const sortedProjectIds = Array.from(tasksByProject.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });

  for (const projectId of sortedProjectIds) {
    const projectTasks = tasksByProject.get(projectId) ?? [];
    const projectName = projectNameMap.get(projectId) ?? "その他";
    lines.push(`### ${projectName}`);

    for (const { task, isBlocked, blockedBy } of projectTasks) {
      const blockedStatus = isBlocked ? " [BLOCKED]" : "";
      const statusLabel = task.status === "in_progress" ? "[進行中]" : "";
      const priorityLabel = task.priority ? `[${task.priority}]` : "";
      lines.push(`- ${priorityLabel}${statusLabel}${blockedStatus} ${task.title}`);
      if (isBlocked && blockedBy.length > 0) {
        lines.push(`  ブロッカー: ${blockedBy.map((b) => `#${b.id} ${b.title}`).join(", ")}`);
      }

      // 子タスクを表示 (db が渡されている場合)
      if (db) {
        const childTasks = getChildTasks(db, task.id);
        for (const child of childTasks) {
          const childStatusLabel = child.status === "completed" ? "[完了]" : `[${child.status}]`;
          lines.push(`  - Step ${child.stepNumber}: ${child.title} ${childStatusLabel}`);
        }
      }
    }
  }

  return lines.join("\n");
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
 * 活動データをプロジェクト別にグループ化してテキストを生成する。
 * 「個人作業 / チーム活動」分類の中で、プロジェクト別にサブセクションを作成。
 *
 * 出力例:
 * ### 個人作業
 * #### メモ [プロジェクト名]
 * ...
 * #### Claude Code [プロジェクト名]
 * ...
 * #### タスク [プロジェクト名]
 * ...
 * ### チーム活動
 * #### ミーティング
 * ...
 */
function buildActivityTextWithProjectSections(
  segments: TranscriptionSegment[],
  memos: Memo[],
  slackMessages: SlackMessage[],
  claudeSessions: ClaudeCodeSession[],
  tasks: Task[],
  learnings: Learning[],
  githubItems: GitHubItem[],
  githubComments: GitHubComment[],
  projectNameMap: Map<number | null, string>,
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

  // ========== 個人作業セクション (プロジェクト別) ==========
  const personalSections: string[] = [];

  // 音声は projectId がないので、そのまま出力
  if (classified.personal.segments.length > 0) {
    const segmentText = formatSegmentsAndMemos(classified.personal.segments, []);
    personalSections.push(`#### 音声 (独り言)\n${segmentText}`);
  }

  // メモをプロジェクト別にグループ化
  const memoGroups = groupItemsByProject(classified.personal.memos, projectNameMap);
  for (const group of memoGroups) {
    if (group.items.length > 0) {
      const memoEntries = group.items.map((m) => {
        const time = isoToJstTime(m.createdAt);
        return `[${time}] ${m.content}`;
      });
      const projectLabel =
        group.projectId !== null ? `#### メモ [${group.projectName}]` : "#### メモ (その他)";
      personalSections.push(`${projectLabel}\n${memoEntries.join("\n")}`);
    }
  }

  // Claude Code セッションをプロジェクト別にグループ化
  const claudeGroups = groupItemsByProject(classified.personal.claudeSessions, projectNameMap);
  for (const group of claudeGroups) {
    if (group.items.length > 0) {
      const claudeText = formatClaudeSessions(group.items);
      const projectLabel =
        group.projectId !== null
          ? `#### Claude Code [${group.projectName}]`
          : "#### Claude Code (その他)";
      personalSections.push(`${projectLabel}\n${claudeText}`);
    }
  }

  // タスクをプロジェクト別にグループ化 (親タスクのみ、子タスクは除外)
  const acceptedTasks = classified.personal.tasks.filter(
    (t) => (t.status === "accepted" || t.status === "completed") && t.parentId === null,
  );
  const taskGroups = groupItemsByProject(acceptedTasks, projectNameMap);
  for (const group of taskGroups) {
    if (group.items.length > 0) {
      const taskLines: string[] = [];
      for (const t of group.items) {
        const priorityLabel = t.priority ? `[${t.priority}]` : "";
        const statusLabel = t.status === "completed" ? "[完了]" : "";
        const source =
          t.sourceType === "github" ? "[GitHub]" : t.sourceType === "manual" ? "[手動]" : "";
        taskLines.push(`- ${priorityLabel}${statusLabel}${source} ${t.title}`);

        // 子タスクを取得して表示
        const childTasks = classified.personal.tasks.filter((c) => c.parentId === t.id);
        if (childTasks.length > 0) {
          for (const child of childTasks.sort(
            (a, b) => (a.stepNumber ?? 0) - (b.stepNumber ?? 0),
          )) {
            const childStatusLabel = child.status === "completed" ? "[完了]" : `[${child.status}]`;
            taskLines.push(`  - Step ${child.stepNumber}: ${child.title} ${childStatusLabel}`);
          }
        }
      }
      const projectLabel =
        group.projectId !== null ? `#### タスク [${group.projectName}]` : "#### タスク (その他)";
      personalSections.push(`${projectLabel}\n${taskLines.join("\n")}`);
    }
  }

  // 学びをプロジェクト別にグループ化
  const learningGroups = groupItemsByProject(classified.personal.learnings, projectNameMap);
  for (const group of learningGroups) {
    if (group.items.length > 0) {
      const learningText = formatLearnings(group.items);
      const projectLabel =
        group.projectId !== null ? `#### 学び [${group.projectName}]` : "#### 学び (その他)";
      personalSections.push(`${projectLabel}\n${learningText}`);
    }
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

  // Slack メッセージ (プロジェクト情報なし)
  if (classified.team.slackMessages.length > 0) {
    const slackText = formatSlackMessages(classified.team.slackMessages);
    teamSections.push(`#### Slack\n${slackText}`);
  }

  // GitHub Items (リポジトリ名からプロジェクトを推測可能だが、直接的なprojectIdはない)
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
  projectNameMap: Map<number | null, string>;
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

  // アクティブなプロジェクト一覧を取得
  const projects = fetchActiveProjects(db);
  const projectNameMap = buildProjectNameMap(projects);

  return {
    segments,
    memos,
    slackMessages,
    claudeSessions,
    tasks,
    learnings,
    githubItems,
    githubComments,
    projectNameMap,
  };
}

/**
 * 開始時間と終了時間から startTime/endTime を返す。
 * @param date - 対象日 (YYYY-MM-DD形式)
 * @param startHour - 開始時間 (0-23)
 * @param endHour - 終了時間 (0-23)
 */
export function hoursToTimeRange(
  date: string,
  startHour: number,
  endHour: number,
): { startTime: string; endTime: string } {
  const startHH = String(startHour).padStart(2, "0");
  const endHH = String(endHour).padStart(2, "0");
  return {
    startTime: `${date}T${startHH}:00:00`,
    endTime: `${date}T${endHH}:59:59`,
  };
}

// ---------------------------------------------------------------------------
// Times summary (user-specified time range, max 12 hours)
// ---------------------------------------------------------------------------

export interface SummaryGenerateOptions {
  /**
   * 既存のサマリを上書きするかどうか。
   * - true (デフォルト): 既存サマリを削除して上書き
   * - false: 既存サマリがあればスキップ
   */
  overwrite?: boolean;
}

/**
 * ユーザー指定の時間範囲の要約を生成する。
 *
 * @param db - データベース接続
 * @param date - 対象日 (YYYY-MM-DD形式)
 * @param startHour - 開始時間 (0-23)
 * @param endHour - 終了時間 (0-23)
 * @param options - 生成オプション
 * @returns 生成された要約テキスト、データがない場合またはスキップ時は null
 */
export async function generateTimesSummary(
  db: AdasDatabase,
  date: string,
  startHour: number,
  endHour: number,
  options?: SummaryGenerateOptions,
): Promise<string | null> {
  const { overwrite = true } = options ?? {};
  const { startTime, endTime } = hoursToTimeRange(date, startHour, endHour);

  // 上書きしない場合、既存サマリがあればスキップ
  if (!overwrite) {
    const existing = db
      .select({ id: schema.summaries.id })
      .from(schema.summaries)
      .where(
        and(
          eq(schema.summaries.date, date),
          eq(schema.summaries.summaryType, "times"),
          eq(schema.summaries.periodStart, startTime),
          eq(schema.summaries.periodEnd, endTime),
        ),
      )
      .get();
    if (existing) {
      return null;
    }
  }

  const {
    segments,
    memos,
    slackMessages,
    claudeSessions,
    tasks,
    learnings,
    githubItems,
    githubComments,
    projectNameMap,
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

  // プロジェクト別にグループ化した活動テキストを生成
  const activityText = buildActivityTextWithProjectSections(
    segments,
    memos,
    slackMessages,
    claudeSessions,
    tasks,
    learnings,
    githubItems,
    githubComments,
    projectNameMap,
  );

  // 着手すべきタスクを取得してプロンプトに追加
  const actionableTasks = fetchActionableTasks(db, 5);
  const actionableTasksText = formatActionableTasks(actionableTasks, projectNameMap, db);

  const prompt = await buildTimesSummaryPrompt(activityText, db, actionableTasksText || undefined);
  const content = await generateSummary(prompt);
  const segmentIds = segments.map((s) => s.id);

  // 同じ期間の既存サマリーを削除してから挿入(上書き)
  db.delete(schema.summaries)
    .where(
      and(
        eq(schema.summaries.date, date),
        eq(schema.summaries.summaryType, "times"),
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
      summaryType: "times",
      content,
      segmentIds: JSON.stringify(segmentIds),
      model: getModelName(),
    })
    .run();

  return content;
}

// ---------------------------------------------------------------------------
// Daily summary (aggregates times summaries)
// ---------------------------------------------------------------------------

/**
 * 日次要約を生成する。
 * times サマリーを集約して生成する。times がない場合は直接活動データから生成。
 *
 * @param db - データベース接続
 * @param date - 対象日 (YYYY-MM-DD形式)
 * @param options - 生成オプション
 * @returns 生成された要約テキスト、データがない場合またはスキップ時は null
 */
export async function generateDailySummary(
  db: AdasDatabase,
  date: string,
  options?: SummaryGenerateOptions,
): Promise<string | null> {
  const { overwrite = true } = options ?? {};

  // 上書きしない場合、既存サマリがあればスキップ
  if (!overwrite) {
    const existing = db
      .select({ id: schema.summaries.id })
      .from(schema.summaries)
      .where(and(eq(schema.summaries.date, date), eq(schema.summaries.summaryType, "daily")))
      .get();
    if (existing) {
      return null;
    }
  }
  // プロジェクト名マップを取得
  const projects = fetchActiveProjects(db);
  const projectNameMap = buildProjectNameMap(projects);

  // times サマリーを集約
  const timesSummaries = db
    .select()
    .from(schema.summaries)
    .where(and(eq(schema.summaries.date, date), eq(schema.summaries.summaryType, "times")))
    .all();

  let summariesText: string;
  let allSegmentIds: number[];

  if (timesSummaries.length > 0) {
    summariesText = timesSummaries
      .map((s) => `### ${s.periodStart} - ${s.periodEnd}\n${s.content}`)
      .join("\n\n");
    allSegmentIds = timesSummaries.flatMap((s) => JSON.parse(s.segmentIds) as number[]);
  } else {
    // times サマリーがない場合、1日分の活動データから直接生成
    const startTime = `${date}T00:00:00`;
    const endTime = `${date}T23:59:59`;
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

    summariesText = buildActivityTextWithProjectSections(
      segments,
      memos,
      slackMessages,
      claudeSessions,
      tasks,
      learnings,
      githubItems,
      githubComments,
      projectNameMap,
    );
    allSegmentIds = segments.map((s) => s.id);
  }

  // 着手すべきタスクを取得してプロンプトに追加
  const actionableTasks = fetchActionableTasks(db, 5);
  const actionableTasksText = formatActionableTasks(actionableTasks, projectNameMap, db);

  const prompt = await buildDailySummaryPrompt(summariesText, db, actionableTasksText || undefined);
  const content = await generateSummary(prompt);

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
