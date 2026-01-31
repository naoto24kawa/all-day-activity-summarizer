/**
 * Projects API Routes
 *
 * プロジェクト管理 API
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { CreateProjectRequest, GitRepoScanResult, UpdateProjectRequest } from "@repo/types";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { loadConfig } from "../../config.js";
import { scanGitRepositories } from "../../utils/git-scanner.js";

export function createProjectsRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/projects
   *
   * Query params:
   * - active: boolean (optional, filters by isActive)
   * - excluded: boolean (optional, filters by excludedAt)
   */
  router.get("/", (c) => {
    const activeOnly = c.req.query("active") === "true";
    const excludedOnly = c.req.query("excluded") === "true";

    let query = db.select().from(schema.projects).orderBy(desc(schema.projects.updatedAt));

    if (excludedOnly) {
      // 除外済みプロジェクトのみ
      query = query.where(isNotNull(schema.projects.excludedAt)) as typeof query;
    } else if (activeOnly) {
      // アクティブかつ除外されていないプロジェクト
      query = query.where(
        and(eq(schema.projects.isActive, true), isNull(schema.projects.excludedAt)),
      ) as typeof query;
    } else {
      // デフォルト: 除外されていないプロジェクト
      query = query.where(isNull(schema.projects.excludedAt)) as typeof query;
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

    const updates: {
      updatedAt: string;
      name?: string;
      path?: string | null;
      githubOwner?: string | null;
      githubRepo?: string | null;
      isActive?: boolean;
    } = {
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
   * POST /api/projects/scan
   *
   * 設定されたパスから Git リポジトリをスキャンしてプロジェクト登録
   */
  router.post("/scan", async (c) => {
    const config = loadConfig();
    const scanPaths = config.projects?.gitScanPaths ?? [];
    const excludePatterns = config.projects?.excludePatterns ?? [];

    if (scanPaths.length === 0) {
      return c.json(
        {
          error: "gitScanPaths が設定されていません",
          message: "設定画面で探索対象ディレクトリを追加してください",
        },
        400,
      );
    }

    // Git リポジトリをスキャン
    const repos = scanGitRepositories(scanPaths, excludePatterns, 3);

    const now = new Date().toISOString();
    let created = 0;
    let skipped = 0;

    for (const repo of repos) {
      // 既存プロジェクトを検索 (パスまたは GitHub owner/repo で)
      let existing = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.path, repo.path))
        .get();

      if (!existing && repo.githubOwner && repo.githubRepo) {
        existing = db
          .select()
          .from(schema.projects)
          .where(
            and(
              eq(schema.projects.githubOwner, repo.githubOwner),
              eq(schema.projects.githubRepo, repo.githubRepo),
            ),
          )
          .get();
      }

      if (existing) {
        // excludedAt が設定されている場合はスキップ (復活させない)
        if (existing.excludedAt) {
          skipped++;
          continue;
        }

        // パスまたは GitHub 情報を更新
        const updates: {
          updatedAt: string;
          path?: string;
          githubOwner?: string;
          githubRepo?: string;
        } = { updatedAt: now };
        let hasUpdates = false;

        if (!existing.path && repo.path) {
          updates.path = repo.path;
          hasUpdates = true;
        }
        if (!existing.githubOwner && repo.githubOwner) {
          updates.githubOwner = repo.githubOwner;
          hasUpdates = true;
        }
        if (!existing.githubRepo && repo.githubRepo) {
          updates.githubRepo = repo.githubRepo;
          hasUpdates = true;
        }

        if (hasUpdates) {
          db.update(schema.projects).set(updates).where(eq(schema.projects.id, existing.id)).run();
        }
        continue;
      }

      // 新規作成
      db.insert(schema.projects)
        .values({
          name: repo.name,
          path: repo.path,
          githubOwner: repo.githubOwner,
          githubRepo: repo.githubRepo,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      created++;
    }

    return c.json({
      scanned: repos.length,
      created,
      skipped,
      repos: repos as GitRepoScanResult[],
    });
  });

  /**
   * POST /api/projects/:id/exclude
   *
   * プロジェクトを除外 (ソフトデリート)
   */
  router.post("/:id/exclude", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const existing = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();

    if (!existing) {
      return c.json({ error: "Project not found" }, 404);
    }

    const now = new Date().toISOString();
    const result = db
      .update(schema.projects)
      .set({
        excludedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.projects.id, id))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * POST /api/projects/:id/restore
   *
   * 除外済みプロジェクトを復活
   */
  router.post("/:id/restore", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const existing = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();

    if (!existing) {
      return c.json({ error: "Project not found" }, 404);
    }

    const now = new Date().toISOString();
    const result = db
      .update(schema.projects)
      .set({
        excludedAt: null,
        updatedAt: now,
      })
      .where(eq(schema.projects.id, id))
      .returning()
      .get();

    return c.json(result);
  });

  /**
   * GET /api/projects/excluded
   *
   * 除外済みプロジェクト一覧
   */
  router.get("/excluded", (c) => {
    const projects = db
      .select()
      .from(schema.projects)
      .where(isNotNull(schema.projects.excludedAt))
      .orderBy(desc(schema.projects.excludedAt))
      .all();

    return c.json(projects);
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
