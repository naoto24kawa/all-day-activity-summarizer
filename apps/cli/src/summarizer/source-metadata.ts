import type {
  ClaudeCodeSession,
  GitHubComment,
  GitHubItem,
  Learning,
  Memo,
  SlackMessage,
  Task,
  TranscriptionSegment,
} from "@repo/db";
import type {
  SourceClaudeSession,
  SourceGitHubComment,
  SourceGitHubItem,
  SourceLearning,
  SourceMemo,
  SourceSegment,
  SourceSlackMessage,
  SourceTask,
  SummarySourceMetadata,
} from "@repo/types";

/**
 * 音声セグメントをソースメタデータ形式に変換
 */
function mapSegments(segments: TranscriptionSegment[]): SourceSegment[] {
  return segments.map((s) => ({
    id: s.id,
    startTime: s.startTime,
    speaker: s.speaker,
    transcription: s.transcription,
  }));
}

/**
 * メモをソースメタデータ形式に変換
 */
function mapMemos(memos: Memo[]): SourceMemo[] {
  return memos.map((m) => ({
    id: m.id,
    content: m.content,
    createdAt: m.createdAt,
  }));
}

/**
 * Slack メッセージをソースメタデータ形式に変換
 */
function mapSlackMessages(messages: SlackMessage[]): SourceSlackMessage[] {
  return messages.map((m) => ({
    id: m.id,
    permalink: m.permalink,
    channelName: m.channelName,
    userName: m.userName,
    text: m.text,
  }));
}

/**
 * Claude Code セッションをソースメタデータ形式に変換
 */
function mapClaudeSessions(sessions: ClaudeCodeSession[]): SourceClaudeSession[] {
  return sessions.map((s) => ({
    id: s.id,
    sessionId: s.sessionId,
    projectName: s.projectName,
    summary: s.summary,
    startTime: s.startTime,
  }));
}

/**
 * タスクをソースメタデータ形式に変換
 */
function mapTasks(tasks: Task[]): SourceTask[] {
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    githubIssueUrl: t.githubIssueUrl,
  }));
}

/**
 * 学びをソースメタデータ形式に変換
 */
function mapLearnings(learnings: Learning[]): SourceLearning[] {
  return learnings.map((l) => ({
    id: l.id,
    content: l.content,
    sourceType: l.sourceType,
  }));
}

/**
 * GitHub Item をソースメタデータ形式に変換
 */
function mapGitHubItems(items: GitHubItem[]): SourceGitHubItem[] {
  return items.map((i) => ({
    id: i.id,
    url: i.url,
    itemType: i.itemType,
    title: i.title,
    repoOwner: i.repoOwner,
    repoName: i.repoName,
    number: i.number,
  }));
}

/**
 * GitHub Comment をソースメタデータ形式に変換
 */
function mapGitHubComments(comments: GitHubComment[]): SourceGitHubComment[] {
  return comments.map((c) => ({
    id: c.id,
    url: c.url,
    commentType: c.commentType,
    body: c.body,
    authorLogin: c.authorLogin,
  }));
}

/**
 * 活動データからソースメタデータを構築
 */
export function buildSourceMetadata(
  segments: TranscriptionSegment[],
  memos: Memo[],
  slackMessages: SlackMessage[],
  claudeSessions: ClaudeCodeSession[],
  tasks: Task[],
  learnings: Learning[],
  githubItems: GitHubItem[],
  githubComments: GitHubComment[],
): SummarySourceMetadata {
  return {
    segments: mapSegments(segments),
    memos: mapMemos(memos),
    slackMessages: mapSlackMessages(slackMessages),
    claudeSessions: mapClaudeSessions(claudeSessions),
    tasks: mapTasks(tasks),
    learnings: mapLearnings(learnings),
    githubItems: mapGitHubItems(githubItems),
    githubComments: mapGitHubComments(githubComments),
  };
}
