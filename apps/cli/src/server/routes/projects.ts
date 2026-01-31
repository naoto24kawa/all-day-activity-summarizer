/**
 * Projects API Routes
 *
 * プロジェクト管理 API
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { CreateProjectRequest, GitRepoScanResult, UpdateProjectRequest } from "@repo/types";
import consola from "consola";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { loadConfig } from "../../config.js";
import { getTodayDateString } from "../../utils/date.js";
import { hasExtractionLog, recordExtractionLog } from "../../utils/extraction-log.js";
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
   * 設定されたパスから Git リポジトリをスキャンしてプロジェクト提案を作成
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
    const today = getTodayDateString();
    let created = 0;
    let skipped = 0;

    for (const repo of repos) {
      // extraction_logs で処理済みチェック
      if (hasExtractionLog(db, "project", "git-scan", repo.path)) {
        skipped++;
        continue;
      }

      // 既存プロジェクトを検索 (パスまたは GitHub owner/repo で)
      let existingProject = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.path, repo.path))
        .get();

      if (!existingProject && repo.githubOwner && repo.githubRepo) {
        existingProject = db
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

      // 既存プロジェクトがある場合 (除外済み含む) はスキップ
      if (existingProject) {
        recordExtractionLog(db, "project", "git-scan", repo.path, 0);
        skipped++;
        continue;
      }

      // pending の提案がないかチェック
      const existingSuggestion = db
        .select()
        .from(schema.projectSuggestions)
        .where(
          and(
            eq(schema.projectSuggestions.path, repo.path),
            eq(schema.projectSuggestions.status, "pending"),
          ),
        )
        .get();

      if (existingSuggestion) {
        recordExtractionLog(db, "project", "git-scan", repo.path, 0);
        skipped++;
        continue;
      }

      // project_suggestions に追加
      const suggestion = db
        .insert(schema.projectSuggestions)
        .values({
          name: repo.name,
          path: repo.path,
          githubOwner: repo.githubOwner,
          githubRepo: repo.githubRepo,
          reason: `Git リポジトリ: ${repo.path}`,
          sourceType: "git-scan",
          sourceId: repo.path,
          confidence: 1.0,
          status: "pending",
          createdAt: now,
        })
        .returning()
        .get();

      // tasks に追加
      const taskTitle =
        repo.githubOwner && repo.githubRepo
          ? `プロジェクト追加: ${repo.name} (${repo.githubOwner}/${repo.githubRepo})`
          : `プロジェクト追加: ${repo.name}`;

      db.insert(schema.tasks)
        .values({
          date: today,
          sourceType: "project-suggestion",
          projectSuggestionId: suggestion.id,
          title: taskTitle,
          description: `パス: ${repo.path}${repo.remoteUrl ? `\nリモート: ${repo.remoteUrl}` : ""}`,
          status: "pending",
          confidence: 1.0,
          extractedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      // extraction_logs に記録
      recordExtractionLog(db, "project", "git-scan", repo.path, 1);
      created++;

      consola.debug(`[projects] Created suggestion: ${repo.name}`);
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
   * 既存データから自動検出してプロジェクト提案を作成
   */
  router.post("/auto-detect", (c) => {
    const now = new Date().toISOString();
    const today = getTodayDateString();
    let created = 0;
    let detected = 0;

    // 1. Claude Code セッションから projectPath を収集
    const sessions = db
      .selectDistinct({
        projectPath: schema.claudeCodeSessions.projectPath,
        projectName: schema.claudeCodeSessions.projectName,
      })
      .from(schema.claudeCodeSessions)
      .all();

    for (const session of sessions) {
      detected++;
      const sourceId = session.projectPath;

      // extraction_logs で処理済みチェック
      if (hasExtractionLog(db, "project", "claude-code", sourceId)) {
        continue;
      }

      // 既存プロジェクトチェック
      const existingProject = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.path, session.projectPath))
        .get();

      if (existingProject) {
        recordExtractionLog(db, "project", "claude-code", sourceId, 0);
        continue;
      }

      // pending の提案チェック
      const existingSuggestion = db
        .select()
        .from(schema.projectSuggestions)
        .where(
          and(
            eq(schema.projectSuggestions.path, session.projectPath),
            eq(schema.projectSuggestions.status, "pending"),
          ),
        )
        .get();

      if (existingSuggestion) {
        recordExtractionLog(db, "project", "claude-code", sourceId, 0);
        continue;
      }

      const name = session.projectName ?? session.projectPath.split("/").pop() ?? "Unknown";

      // project_suggestions に追加
      const suggestion = db
        .insert(schema.projectSuggestions)
        .values({
          name,
          path: session.projectPath,
          githubOwner: null,
          githubRepo: null,
          reason: `Claude Code セッションから検出: ${session.projectPath}`,
          sourceType: "claude-code",
          sourceId,
          confidence: 1.0,
          status: "pending",
          createdAt: now,
        })
        .returning()
        .get();

      // tasks に追加
      db.insert(schema.tasks)
        .values({
          date: today,
          sourceType: "project-suggestion",
          projectSuggestionId: suggestion.id,
          title: `プロジェクト追加: ${name}`,
          description: `パス: ${session.projectPath}`,
          status: "pending",
          confidence: 1.0,
          extractedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      recordExtractionLog(db, "project", "claude-code", sourceId, 1);
      created++;
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
      detected++;
      const sourceId = `${repo.repoOwner}/${repo.repoName}`;

      // extraction_logs で処理済みチェック
      if (hasExtractionLog(db, "project", "github", sourceId)) {
        continue;
      }

      // 既存プロジェクトチェック
      const existingProject = db
        .select()
        .from(schema.projects)
        .where(
          and(
            eq(schema.projects.githubOwner, repo.repoOwner),
            eq(schema.projects.githubRepo, repo.repoName),
          ),
        )
        .get();

      if (existingProject) {
        recordExtractionLog(db, "project", "github", sourceId, 0);
        continue;
      }

      // pending の提案チェック
      const existingSuggestion = db
        .select()
        .from(schema.projectSuggestions)
        .where(
          and(
            eq(schema.projectSuggestions.githubOwner, repo.repoOwner),
            eq(schema.projectSuggestions.githubRepo, repo.repoName),
            eq(schema.projectSuggestions.status, "pending"),
          ),
        )
        .get();

      if (existingSuggestion) {
        recordExtractionLog(db, "project", "github", sourceId, 0);
        continue;
      }

      // project_suggestions に追加
      const suggestion = db
        .insert(schema.projectSuggestions)
        .values({
          name: repo.repoName,
          path: null,
          githubOwner: repo.repoOwner,
          githubRepo: repo.repoName,
          reason: `GitHub リポジトリから検出: ${repo.repoOwner}/${repo.repoName}`,
          sourceType: "github",
          sourceId,
          confidence: 1.0,
          status: "pending",
          createdAt: now,
        })
        .returning()
        .get();

      // tasks に追加
      db.insert(schema.tasks)
        .values({
          date: today,
          sourceType: "project-suggestion",
          projectSuggestionId: suggestion.id,
          title: `プロジェクト追加: ${repo.repoName} (${repo.repoOwner}/${repo.repoName})`,
          description: `GitHub リポジトリ: ${repo.repoOwner}/${repo.repoName}`,
          status: "pending",
          confidence: 1.0,
          extractedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      recordExtractionLog(db, "project", "github", sourceId, 1);
      created++;
    }

    // 全プロジェクト一覧を取得
    const allProjects = db
      .select()
      .from(schema.projects)
      .orderBy(desc(schema.projects.updatedAt))
      .all();

    return c.json({
      detected,
      created,
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
