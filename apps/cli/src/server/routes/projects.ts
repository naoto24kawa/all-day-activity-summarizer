/**
 * Projects API Routes
 *
 * プロジェクト管理 API
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { CreateProjectRequest, UpdateProjectRequest } from "@repo/types";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

export function createProjectsRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/projects
   *
   * Query params:
   * - active: boolean (optional, filters by isActive)
   */
  router.get("/", (c) => {
    const activeOnly = c.req.query("active") === "true";

    let query = db.select().from(schema.projects).orderBy(desc(schema.projects.updatedAt));

    if (activeOnly) {
      query = query.where(eq(schema.projects.isActive, true)) as typeof query;
    }

    const projects = query.all();

    return c.json(projects);
  });

  /**
   * GET /api/projects/:id
   */
  router.get("/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const project = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    return c.json(project);
  });

  /**
   * POST /api/projects
   *
   * プロジェクト作成
   */
  router.post("/", async (c) => {
    const body = await c.req.json<CreateProjectRequest>();

    if (!body.name) {
      return c.json({ error: "name is required" }, 400);
    }

    const now = new Date().toISOString();

    const project = db
      .insert(schema.projects)
      .values({
        name: body.name,
        path: body.path ?? null,
        githubOwner: body.githubOwner ?? null,
        githubRepo: body.githubRepo ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    return c.json(project, 201);
  });

  /**
   * PATCH /api/projects/:id
   *
   * プロジェクト更新
   */
  router.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const body = await c.req.json<UpdateProjectRequest>();

    const existing = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();

    if (!existing) {
      return c.json({ error: "Project not found" }, 404);
    }

    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (body.name !== undefined) {
      updates.name = body.name;
    }
    if (body.path !== undefined) {
      updates.path = body.path;
    }
    if (body.githubOwner !== undefined) {
      updates.githubOwner = body.githubOwner;
    }
    if (body.githubRepo !== undefined) {
      updates.githubRepo = body.githubRepo;
    }
    if (body.isActive !== undefined) {
      updates.isActive = body.isActive;
    }

    const result = db
      .update(schema.projects)
      .set(updates)
      .where(eq(schema.projects.id, id))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * DELETE /api/projects/:id
   */
  router.delete("/:id", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const existing = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();

    if (!existing) {
      return c.json({ error: "Project not found" }, 404);
    }

    db.delete(schema.projects).where(eq(schema.projects.id, id)).run();

    return c.json({ deleted: true });
  });

  /**
   * POST /api/projects/auto-detect
   *
   * 既存データから自動検出してプロジェクト登録
   */
  router.post("/auto-detect", (c) => {
    const now = new Date().toISOString();
    const createdProjects: Array<{
      id: number;
      name: string;
      path: string | null;
      githubOwner: string | null;
      githubRepo: string | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }> = [];

    // 1. Claude Code セッションから projectPath を収集
    const sessions = db
      .selectDistinct({
        projectPath: schema.claudeCodeSessions.projectPath,
        projectName: schema.claudeCodeSessions.projectName,
      })
      .from(schema.claudeCodeSessions)
      .all();

    for (const session of sessions) {
      // 既に同じ path のプロジェクトが存在するかチェック
      const existing = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.path, session.projectPath))
        .get();

      if (!existing) {
        const name = session.projectName ?? session.projectPath.split("/").pop() ?? "Unknown";
        const project = db
          .insert(schema.projects)
          .values({
            name,
            path: session.projectPath,
            githubOwner: null,
            githubRepo: null,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        createdProjects.push(project);
      }
    }

    // 2. GitHub Items から repoOwner/repoName を収集
    const repos = db
      .selectDistinct({
        repoOwner: schema.githubItems.repoOwner,
        repoName: schema.githubItems.repoName,
      })
      .from(schema.githubItems)
      .all();

    for (const repo of repos) {
      // 既に同じ GitHub リポジトリのプロジェクトが存在するかチェック
      const existing = db
        .select()
        .from(schema.projects)
        .where(
          and(
            eq(schema.projects.githubOwner, repo.repoOwner),
            eq(schema.projects.githubRepo, repo.repoName),
          ),
        )
        .get();

      if (!existing) {
        const project = db
          .insert(schema.projects)
          .values({
            name: repo.repoName,
            path: null,
            githubOwner: repo.repoOwner,
            githubRepo: repo.repoName,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        createdProjects.push(project);
      }
    }

    // 全プロジェクト一覧を取得
    const allProjects = db
      .select()
      .from(schema.projects)
      .orderBy(desc(schema.projects.updatedAt))
      .all();

    return c.json({
      detected: sessions.length + repos.length,
      created: createdProjects.length,
      projects: allProjects,
    });
  });

  /**
   * GET /api/projects/by-path/:path
   *
   * パスからプロジェクトを検索
   */
  router.get("/by-path/*", (c) => {
    const path = `/${c.req.param("*")}`;

    const project = db.select().from(schema.projects).where(eq(schema.projects.path, path)).get();

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    return c.json(project);
  });

  /**
   * GET /api/projects/by-github/:owner/:repo
   *
   * GitHub owner/repo からプロジェクトを検索
   */
  router.get("/by-github/:owner/:repo", (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");

    const project = db
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.githubOwner, owner), eq(schema.projects.githubRepo, repo)))
      .get();

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    return c.json(project);
  });

  /**
   * GET /api/projects/stats
   *
   * プロジェクト統計
   */
  router.get("/stats", (c) => {
    const allProjects = db.select().from(schema.projects).all();

    const withPath = allProjects.filter((p) => p.path !== null).length;
    const withGitHub = allProjects.filter((p) => p.githubOwner !== null).length;
    const active = allProjects.filter((p) => p.isActive).length;

    return c.json({
      total: allProjects.length,
      active,
      withPath,
      withGitHub,
    });
  });

  /**
   * GET /api/projects/:id/stats
   *
   * プロジェクト別統計 (タスク数、学び数)
   */
  router.get("/:id/stats", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const project = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    // タスク数をカウント
    const tasksResult = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, id))
      .get();

    // 学び数をカウント
    const learningsResult = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.learnings)
      .where(eq(schema.learnings.projectId, id))
      .get();

    return c.json({
      tasksCount: tasksResult?.count ?? 0,
      learningsCount: learningsResult?.count ?? 0,
    });
  });

  return router;
}
