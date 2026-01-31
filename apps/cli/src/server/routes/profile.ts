/**
 * Profile API Routes
 *
 * ユーザープロフィール管理とプロフィール提案のフィードバックループ
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { ProfileSuggestion, UpdateProfileRequest, UserProfile } from "@repo/types";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { enqueueJob } from "../../ai-job/queue.js";
import type { AdasConfig } from "../../config.js";

export function createProfileRouter(db: AdasDatabase, _config?: AdasConfig) {
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
   * 活動データからプロフィール提案を生成 (非同期キュー)
   * Body: { daysBack?: number }
   */
  router.post("/suggestions/generate", async (c) => {
    const body = await c.req.json<{ daysBack?: number }>().catch(() => ({ daysBack: 7 }));
    const daysBack = body.daysBack ?? 7;

    const jobId = enqueueJob(db, "profile-analyze", { daysBack });

    return c.json({
      success: true,
      jobId,
      message: "プロフィール分析ジョブをキューに追加しました",
    });
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
