/**
 * Profile API Routes
 *
 * ユーザープロフィール管理とプロフィール提案のフィードバックループ
 */

import type { AdasDatabase, NewProfileSuggestion } from "@repo/db";
import { schema } from "@repo/db";
import type {
  GenerateProfileSuggestionsResponse,
  ProfileSuggestion,
  ProfileSuggestionSourceType,
  ProfileSuggestionType,
  UpdateProfileRequest,
  UserProfile,
} from "@repo/types";
import consola from "consola";
import { and, desc, eq, gte } from "drizzle-orm";
import { Hono } from "hono";
import type { AdasConfig } from "../../config.js";
import { getDateString, getTodayDateString } from "../../utils/date.js";

interface AnalyzeProfileResponse {
  suggestions: Array<{
    suggestionType: ProfileSuggestionType;
    field: string;
    value: string;
    reason: string;
    confidence: number;
  }>;
}

const SUGGESTION_TYPE_LABELS: Record<ProfileSuggestionType, string> = {
  add_technology: "技術追加",
  add_specialty: "専門分野追加",
  add_goal: "学習目標追加",
  update_experience: "経験年数更新",
};

const FIELD_LABELS: Record<string, string> = {
  specialties: "専門分野",
  knownTechnologies: "技術",
  learningGoals: "学習目標",
  experienceYears: "経験年数",
};

export function createProfileRouter(db: AdasDatabase, config?: AdasConfig) {
  const router = new Hono();

  /**
   * GET /api/profile
   *
   * 現在のプロフィールを取得 (なければ空のプロフィールを作成)
   */
  router.get("/", (c) => {
    let profile = db.select().from(schema.userProfile).where(eq(schema.userProfile.id, 1)).get();

    if (!profile) {
      // 初回アクセス時にプロフィールを作成
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
    }

    return c.json(profile as UserProfile);
  });

  /**
   * PUT /api/profile
   *
   * プロフィールを更新
   */
  router.put("/", async (c) => {
    const body = await c.req.json<UpdateProfileRequest>();

    const updateData: Partial<{
      experienceYears: number | null;
      specialties: string | null;
      knownTechnologies: string | null;
      learningGoals: string | null;
      updatedAt: string;
    }> = {
      updatedAt: new Date().toISOString(),
    };

    if (body.experienceYears !== undefined) {
      updateData.experienceYears = body.experienceYears;
    }

    if (body.specialties !== undefined) {
      updateData.specialties = JSON.stringify(body.specialties);
    }

    if (body.knownTechnologies !== undefined) {
      updateData.knownTechnologies = JSON.stringify(body.knownTechnologies);
    }

    if (body.learningGoals !== undefined) {
      updateData.learningGoals = JSON.stringify(body.learningGoals);
    }

    // プロフィールが存在しない場合は作成
    const existing = db.select().from(schema.userProfile).where(eq(schema.userProfile.id, 1)).get();

    if (!existing) {
      db.insert(schema.userProfile)
        .values({
          id: 1,
          experienceYears: updateData.experienceYears ?? null,
          specialties: updateData.specialties ?? null,
          knownTechnologies: updateData.knownTechnologies ?? null,
          learningGoals: updateData.learningGoals ?? null,
          updatedAt: updateData.updatedAt ?? new Date().toISOString(),
        })
        .run();
    } else {
      db.update(schema.userProfile).set(updateData).where(eq(schema.userProfile.id, 1)).run();
    }

    const profile = db.select().from(schema.userProfile).where(eq(schema.userProfile.id, 1)).get();

    return c.json(profile as UserProfile);
  });

  /**
   * GET /api/profile/suggestions
   *
   * プロフィール提案一覧を取得
   * Query params:
   * - status: "pending" | "accepted" | "rejected" (optional)
   * - limit: number (optional, defaults to 50)
   */
  router.get("/suggestions", (c) => {
    const status = c.req.query("status") as "pending" | "accepted" | "rejected" | undefined;
    const limitStr = c.req.query("limit");
    const limit = limitStr ? Number.parseInt(limitStr, 10) : 50;

    const conditions = [];

    if (status) {
      conditions.push(eq(schema.profileSuggestions.status, status));
    }

    let query = db
      .select()
      .from(schema.profileSuggestions)
      .orderBy(desc(schema.profileSuggestions.createdAt))
      .limit(limit);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const suggestions = query.all();

    return c.json(suggestions as ProfileSuggestion[]);
  });

  /**
   * POST /api/profile/suggestions/:id/accept
   *
   * 提案を承認し、プロフィールに反映
   */
  router.post("/suggestions/:id/accept", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);

    const suggestion = db
      .select()
      .from(schema.profileSuggestions)
      .where(eq(schema.profileSuggestions.id, id))
      .get();

    if (!suggestion) {
      return c.json({ error: "Suggestion not found" }, 404);
    }

    if (suggestion.status !== "pending") {
      return c.json({ error: "Suggestion already processed" }, 400);
    }

    // 提案をプロフィールに反映
    const profile = db.select().from(schema.userProfile).where(eq(schema.userProfile.id, 1)).get();

    if (!profile) {
      return c.json({ error: "Profile not found" }, 404);
    }

    const now = new Date().toISOString();

    if (suggestion.field === "experienceYears") {
      db.update(schema.userProfile)
        .set({
          experienceYears: Number.parseInt(suggestion.value, 10),
          updatedAt: now,
        })
        .where(eq(schema.userProfile.id, 1))
        .run();
    } else {
      // JSON配列フィールド (specialties, knownTechnologies, learningGoals)
      const fieldMap: Record<string, keyof typeof profile> = {
        specialties: "specialties",
        knownTechnologies: "knownTechnologies",
        learningGoals: "learningGoals",
      };

      const fieldKey = fieldMap[suggestion.field];
      if (fieldKey) {
        const currentValue = profile[fieldKey] as string | null;
        const currentArray: string[] = currentValue ? JSON.parse(currentValue) : [];

        // 重複チェック
        if (!currentArray.includes(suggestion.value)) {
          currentArray.push(suggestion.value);

          const updateObj: Record<string, string> = {
            [suggestion.field]: JSON.stringify(currentArray),
            updatedAt: now,
          };

          db.update(schema.userProfile).set(updateObj).where(eq(schema.userProfile.id, 1)).run();
        }
      }
    }

    // 提案ステータスを更新
    db.update(schema.profileSuggestions)
      .set({
        status: "accepted",
        acceptedAt: now,
      })
      .where(eq(schema.profileSuggestions.id, id))
      .run();

    const updated = db
      .select()
      .from(schema.profileSuggestions)
      .where(eq(schema.profileSuggestions.id, id))
      .get();

    return c.json(updated as ProfileSuggestion);
  });

  /**
   * POST /api/profile/suggestions/:id/reject
   *
   * 提案を却下
   */
  router.post("/suggestions/:id/reject", async (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);

    const suggestion = db
      .select()
      .from(schema.profileSuggestions)
      .where(eq(schema.profileSuggestions.id, id))
      .get();

    if (!suggestion) {
      return c.json({ error: "Suggestion not found" }, 404);
    }

    if (suggestion.status !== "pending") {
      return c.json({ error: "Suggestion already processed" }, 400);
    }

    db.update(schema.profileSuggestions)
      .set({
        status: "rejected",
        rejectedAt: new Date().toISOString(),
      })
      .where(eq(schema.profileSuggestions.id, id))
      .run();

    const updated = db
      .select()
      .from(schema.profileSuggestions)
      .where(eq(schema.profileSuggestions.id, id))
      .get();

    return c.json(updated as ProfileSuggestion);
  });

  /**
   * POST /api/profile/suggestions/generate
   *
   * 活動データからプロフィール提案を生成
   * Body: { daysBack?: number }
   */
  router.post("/suggestions/generate", async (c) => {
    if (!config) {
      return c.json({ error: "Config not available" }, 500);
    }

    const body = await c.req.json<{ daysBack?: number }>().catch(() => ({ daysBack: 7 }));
    const daysBack = body.daysBack ?? 7;

    // 対象期間の日付を計算
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const startDateStr = getDateString(startDate);

    // 現在のプロフィールを取得
    let profile = db.select().from(schema.userProfile).where(eq(schema.userProfile.id, 1)).get();

    if (!profile) {
      // プロフィールがない場合は作成
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
      const insertedProfile = db
        .select()
        .from(schema.userProfile)
        .where(eq(schema.userProfile.id, 1))
        .get();
      if (!insertedProfile) {
        return c.json({ error: "Failed to create profile" }, 500);
      }
      profile = insertedProfile;
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
    const savedSuggestions: ProfileSuggestion[] = [];
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

      const newSuggestion: NewProfileSuggestion = {
        suggestionType: suggestion.suggestionType,
        field: suggestion.field,
        value: suggestion.value,
        reason: suggestion.reason,
        sourceType: suggestion.sourceType,
        sourceId: suggestion.sourceId ?? null,
        confidence: suggestion.confidence,
        status: "pending",
      };

      try {
        db.insert(schema.profileSuggestions).values(newSuggestion).run();

        const inserted = db
          .select()
          .from(schema.profileSuggestions)
          .orderBy(desc(schema.profileSuggestions.id))
          .limit(1)
          .get();

        if (inserted) {
          savedSuggestions.push(inserted as ProfileSuggestion);

          // タスクとしても登録
          const fieldLabel = FIELD_LABELS[suggestion.field] || suggestion.field;
          const typeLabel =
            SUGGESTION_TYPE_LABELS[suggestion.suggestionType] || suggestion.suggestionType;

          db.insert(schema.tasks)
            .values({
              date: today,
              profileSuggestionId: inserted.id,
              sourceType: "profile-suggestion",
              title: `[プロフィール] ${typeLabel}: ${suggestion.value}`,
              description: `${fieldLabel}に「${suggestion.value}」を追加\n\n理由: ${suggestion.reason || "なし"}`,
              status: "pending",
              confidence: suggestion.confidence,
              extractedAt: now,
            })
            .run();
        }
      } catch (err) {
        consola.warn("[profile] Failed to save suggestion:", err);
      }
    }

    const response: GenerateProfileSuggestionsResponse = {
      generated: savedSuggestions.length,
      suggestions: savedSuggestions,
    };

    return c.json(response);
  });

  /**
   * DELETE /api/profile/suggestions/:id
   *
   * 提案を削除
   */
  router.delete("/suggestions/:id", (c) => {
    const id = Number.parseInt(c.req.param("id"), 10);

    const suggestion = db
      .select()
      .from(schema.profileSuggestions)
      .where(eq(schema.profileSuggestions.id, id))
      .get();

    if (!suggestion) {
      return c.json({ error: "Suggestion not found" }, 404);
    }

    db.delete(schema.profileSuggestions).where(eq(schema.profileSuggestions.id, id)).run();

    return c.json({ success: true });
  });

  return router;
}

/**
 * 活動データを収集
 */
function collectActivityData(
  db: AdasDatabase,
  startDateStr: string,
): {
  claudeCodeSessions: Array<{ projectName: string | null; summary: string | null }>;
  learnings: Array<{ category: string | null; tags: string | null; content: string }>;
  githubItems: Array<{ repoName: string; labels: string | null }>;
} {
  // Claude Code セッション
  const claudeCodeSessions = db
    .select({
      projectName: schema.claudeCodeSessions.projectName,
      summary: schema.claudeCodeSessions.summary,
    })
    .from(schema.claudeCodeSessions)
    .where(gte(schema.claudeCodeSessions.date, startDateStr))
    .all();

  // 学び
  const learnings = db
    .select({
      category: schema.learnings.category,
      tags: schema.learnings.tags,
      content: schema.learnings.content,
    })
    .from(schema.learnings)
    .where(gte(schema.learnings.date, startDateStr))
    .all();

  // GitHub アイテム
  const githubItems = db
    .select({
      repoName: schema.githubItems.repoName,
      labels: schema.githubItems.labels,
    })
    .from(schema.githubItems)
    .where(gte(schema.githubItems.date, startDateStr))
    .all();

  return { claudeCodeSessions, learnings, githubItems };
}

/**
 * Worker でプロフィール解析
 */
async function analyzeProfileWithWorker(
  config: AdasConfig,
  profile: {
    experienceYears: number | null;
    specialties: string | null;
    knownTechnologies: string | null;
    learningGoals: string | null;
  },
  activityData: {
    claudeCodeSessions: Array<{ projectName: string | null; summary: string | null }>;
    learnings: Array<{ category: string | null; tags: string | null; content: string }>;
    githubItems: Array<{ repoName: string; labels: string | null }>;
  },
): Promise<
  Array<{
    suggestionType: ProfileSuggestionType;
    field: string;
    value: string;
    reason: string;
    sourceType: ProfileSuggestionSourceType;
    sourceId?: string;
    confidence: number;
  }>
> {
  const { url, timeout } = config.worker;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${url}/rpc/analyze-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentProfile: {
          experienceYears: profile.experienceYears,
          specialties: profile.specialties ? JSON.parse(profile.specialties) : [],
          knownTechnologies: profile.knownTechnologies ? JSON.parse(profile.knownTechnologies) : [],
          learningGoals: profile.learningGoals ? JSON.parse(profile.learningGoals) : [],
        },
        activityData,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      consola.warn(`[profile] Worker returned ${response.status}`);
      return [];
    }

    const result = (await response.json()) as AnalyzeProfileResponse;

    return result.suggestions.map((s) => ({
      suggestionType: s.suggestionType,
      field: s.field,
      value: s.value,
      reason: s.reason,
      sourceType: "learning" as ProfileSuggestionSourceType,
      confidence: s.confidence,
    }));
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      consola.warn("[profile] Worker timeout");
    } else {
      consola.warn("[profile] Failed to analyze profile:", err);
    }
    return [];
  }
}

/**
 * 値がプロフィールに既に含まれているかチェック
 */
function isValueInProfile(
  profile: {
    experienceYears: number | null;
    specialties: string | null;
    knownTechnologies: string | null;
    learningGoals: string | null;
  },
  field: string,
  value: string,
): boolean {
  if (field === "experienceYears") {
    return profile.experienceYears === Number.parseInt(value, 10);
  }

  const fieldMap: Record<string, string | null> = {
    specialties: profile.specialties,
    knownTechnologies: profile.knownTechnologies,
    learningGoals: profile.learningGoals,
  };

  const jsonStr = fieldMap[field];
  if (!jsonStr) return false;

  try {
    const array: string[] = JSON.parse(jsonStr);
    return array.includes(value);
  } catch {
    return false;
  }
}

/**
 * プロフィール情報を取得するヘルパー関数 (他モジュールから使用)
 */
export function getUserProfile(db: AdasDatabase): {
  experienceYears?: number;
  specialties?: string[];
  knownTechnologies?: string[];
  learningGoals?: string[];
} | null {
  const profile = db.select().from(schema.userProfile).where(eq(schema.userProfile.id, 1)).get();

  if (!profile) {
    return null;
  }

  return {
    experienceYears: profile.experienceYears ?? undefined,
    specialties: profile.specialties ? JSON.parse(profile.specialties) : undefined,
    knownTechnologies: profile.knownTechnologies
      ? JSON.parse(profile.knownTechnologies)
      : undefined,
    learningGoals: profile.learningGoals ? JSON.parse(profile.learningGoals) : undefined,
  };
}
