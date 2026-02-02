/**
 * Profile Analyze Handler
 *
 * 活動データからプロフィール提案を生成
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { desc, eq, gte } from "drizzle-orm";
import type { AdasConfig } from "../../config.js";
import { getDateString, getTodayDateString } from "../../utils/date.js";
import type { JobResult } from "../worker.js";

// フィールドラベル
const FIELD_LABELS: Record<string, string> = {
  experienceYears: "経験年数",
  specialties: "専門分野",
  knownTechnologies: "既知の技術",
  learningGoals: "学習目標",
};

interface ProfileSuggestionFromWorker {
  suggestionType: string;
  field: string;
  value: string;
  reason: string;
  sourceType: string;
  sourceId?: string;
  confidence: number;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex data processing logic
export async function handleProfileAnalyze(
  db: AdasDatabase,
  config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const daysBack = (params.daysBack as number) ?? 7;

  // 対象期間の日付を計算
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);
  const startDateStr = getDateString(startDate);

  // 現在のプロフィールを取得または作成
  let profile = db.select().from(schema.userProfile).where(eq(schema.userProfile.id, 1)).get();

  if (!profile) {
    db.insert(schema.userProfile)
      .values({
        id: 1,
        experienceYears: null,
        specialties: null,
        knownTechnologies: null,
        learningGoals: null,
        updatedAt: new Date().toISOString(),
      })
      .run();
    profile = db.select().from(schema.userProfile).where(eq(schema.userProfile.id, 1)).get();

    if (!profile) {
      return {
        success: false,
        resultSummary: "プロフィールの作成に失敗しました",
      };
    }
  }

  // 活動データを収集
  const activityData = collectActivityData(db, startDateStr);

  // Worker に解析を依頼
  const suggestions = await analyzeProfileWithWorker(config, profile, activityData);

  // 既存の pending 提案と重複チェック
  const existingPending = db
    .select()
    .from(schema.profileSuggestions)
    .where(eq(schema.profileSuggestions.status, "pending"))
    .all();

  const existingValues = new Set(existingPending.map((s) => `${s.field}:${s.value}`));

  // 新しい提案を保存
  const savedSuggestions: (typeof schema.profileSuggestions.$inferSelect)[] = [];
  const today = getTodayDateString();
  const now = new Date().toISOString();

  for (const suggestion of suggestions) {
    const key = `${suggestion.field}:${suggestion.value}`;
    if (existingValues.has(key)) {
      continue;
    }

    // プロフィールに既に含まれているかチェック
    if (isValueInProfile(profile, suggestion.field, suggestion.value)) {
      continue;
    }

    try {
      db.insert(schema.profileSuggestions)
        .values({
          suggestionType: suggestion.suggestionType as
            | "add_technology"
            | "add_specialty"
            | "add_goal"
            | "update_experience",
          field: suggestion.field,
          value: suggestion.value,
          reason: suggestion.reason,
          sourceType: suggestion.sourceType as
            | "claude-code"
            | "github"
            | "slack"
            | "transcription"
            | "learning",
          sourceId: suggestion.sourceId ?? null,
          confidence: suggestion.confidence,
          status: "pending",
        })
        .run();

      const inserted = db
        .select()
        .from(schema.profileSuggestions)
        .orderBy(desc(schema.profileSuggestions.id))
        .limit(1)
        .get();

      if (inserted) {
        savedSuggestions.push(inserted);

        // タスクとしても登録
        const fieldLabel = FIELD_LABELS[suggestion.field] || suggestion.field;

        db.insert(schema.tasks)
          .values({
            date: today,
            profileSuggestionId: inserted.id,
            sourceType: "profile-suggestion",
            title: `${suggestion.value} を追加`,
            description: `${fieldLabel}に「${suggestion.value}」を追加\n\n理由: ${suggestion.reason || "なし"}`,
            status: "pending",
            confidence: suggestion.confidence,
            extractedAt: now,
          })
          .run();
      }
    } catch (err) {
      console.error("[profile] Failed to save suggestion:", err);
    }
  }

  return {
    success: true,
    resultSummary:
      savedSuggestions.length > 0
        ? `${savedSuggestions.length}件のプロフィール提案を生成しました`
        : "新しいプロフィール提案はありませんでした",
    data: { generated: savedSuggestions.length, suggestions: savedSuggestions },
  };
}

// ========== ヘルパー関数 ==========

interface ActivityData {
  claudeCodeSessions: Array<{ projectName: string | null; summary: string | null }>;
  learnings: Array<{ content: string; category: string | null; tags: string | null }>;
  githubItems: Array<{ repoName: string; labels: string | null }>;
}

function collectActivityData(db: AdasDatabase, startDateStr: string): ActivityData {
  const sessions = db
    .select({
      projectName: schema.claudeCodeSessions.projectName,
      summary: schema.claudeCodeSessions.summary,
    })
    .from(schema.claudeCodeSessions)
    .where(gte(schema.claudeCodeSessions.date, startDateStr))
    .all();

  const learnings = db
    .select({
      content: schema.learnings.content,
      category: schema.learnings.category,
      tags: schema.learnings.tags,
    })
    .from(schema.learnings)
    .where(gte(schema.learnings.date, startDateStr))
    .all();

  const githubItems = db
    .select({
      repoName: schema.githubItems.repoName,
      labels: schema.githubItems.labels,
    })
    .from(schema.githubItems)
    .where(gte(schema.githubItems.date, startDateStr))
    .all();

  return { claudeCodeSessions: sessions, learnings, githubItems };
}

async function analyzeProfileWithWorker(
  config: AdasConfig,
  profile: typeof schema.userProfile.$inferSelect,
  activityData: ActivityData,
): Promise<ProfileSuggestionFromWorker[]> {
  const { url, timeout } = config.worker;

  const requestBody = {
    currentProfile: {
      experienceYears: profile.experienceYears,
      specialties: profile.specialties ? JSON.parse(profile.specialties) : [],
      knownTechnologies: profile.knownTechnologies ? JSON.parse(profile.knownTechnologies) : [],
      learningGoals: profile.learningGoals ? JSON.parse(profile.learningGoals) : [],
    },
    activityData: activityData,
  };

  try {
    const response = await fetch(`${url}/rpc/analyze-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      console.error(`[profile] Worker returned status ${response.status}`);
      return [];
    }

    const result = (await response.json()) as { suggestions: ProfileSuggestionFromWorker[] };
    return result.suggestions ?? [];
  } catch (err) {
    console.error("[profile] Failed to analyze profile:", err);
    return [];
  }
}

function isValueInProfile(
  profile: typeof schema.userProfile.$inferSelect,
  field: string,
  value: string,
): boolean {
  if (field === "experienceYears") {
    return profile.experienceYears === Number.parseInt(value, 10);
  }

  const fieldMap: Record<string, keyof typeof profile> = {
    specialties: "specialties",
    knownTechnologies: "knownTechnologies",
    learningGoals: "learningGoals",
  };

  const fieldKey = fieldMap[field];
  if (!fieldKey) return false;

  const currentValue = profile[fieldKey] as string | null;
  if (!currentValue) return false;

  try {
    const currentArray: string[] = JSON.parse(currentValue);
    return currentArray.includes(value);
  } catch {
    return false;
  }
}
