/**
 * Claude Code Paths API Routes
 *
 * プロジェクトパス単位でのプロジェクト紐づけを管理
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";

export function createClaudeCodePathsRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/claude-code-paths
   *
   * パス一覧を取得
   */
  router.get("/", (c) => {
    const paths = db
      .select()
      .from(schema.claudeCodePaths)
      .orderBy(desc(schema.claudeCodePaths.updatedAt))
      .all();

    return c.json(paths);
  });

  /**
   * PUT /api/claude-code-paths/:projectPath
   *
   * パスの projectId を更新 (upsert)
   * Body: { projectId?: number | null, projectName?: string }
   *
   * projectPath は URL エンコードされた状態で渡される
   */
  router.put("/:projectPath{.+}", async (c) => {
    const projectPath = decodeURIComponent(c.req.param("projectPath"));
    const body = await c.req.json<{ projectId?: number | null; projectName?: string }>();

    const now = new Date().toISOString();

    // パスが存在するか確認
    const existing = db
      .select()
      .from(schema.claudeCodePaths)
      .where(eq(schema.claudeCodePaths.projectPath, projectPath))
      .get();

    if (existing) {
      // 更新
      const updateData: {
        projectId?: number | null;
        projectName?: string;
        updatedAt: string;
      } = {
        updatedAt: now,
      };

      if (body.projectId !== undefined) {
        updateData.projectId = body.projectId;
      }
      if (body.projectName !== undefined) {
        updateData.projectName = body.projectName;
      }

      const result = db
        .update(schema.claudeCodePaths)
        .set(updateData)
        .where(eq(schema.claudeCodePaths.projectPath, projectPath))
        .returning()
        .get();

      return c.json(result);
    }

    // 新規作成
    const result = db
      .insert(schema.claudeCodePaths)
      .values({
        projectPath,
        projectName: body.projectName ?? projectPath.split("/").pop() ?? null,
        projectId: body.projectId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    return c.json(result, 201);
  });

  return router;
}
