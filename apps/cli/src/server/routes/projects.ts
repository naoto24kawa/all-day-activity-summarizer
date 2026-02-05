/**
 * Projects API Routes
 *
 * プロジェクト管理 API
 */

import type { AdasDatabase, ProjectRepository } from "@repo/db";
import { schema } from "@repo/db";
import type {
  CreateProjectRequest,
  GitRepoScanResult,
  Project,
  UpdateProjectRequest,
} from "@repo/types";
import consola from "consola";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { loadConfig } from "../../config.js";
import { getTodayDateString } from "../../utils/date.js";
import { hasExtractionLog, recordExtractionLog } from "../../utils/extraction-log.js";
import { scanGitRepositories } from "../../utils/git-scanner.js";

/**
 * プロジェクトに紐づくリポジトリを取得するヘルパー関数
 */
function getProjectRepositories(db: AdasDatabase, projectId: number): ProjectRepository[] {
  return db
    .select()
    .from(schema.projectRepositories)
    .where(eq(schema.projectRepositories.projectId, projectId))
    .all();
}

/**
 * プロジェクトをリポジトリ付きで返すヘルパー関数
 */
function enrichProjectWithRepositories(
  db: AdasDatabase,
  project: typeof schema.projects.$inferSelect,
): Project {
  const repositories = getProjectRepositories(db, project.id);
  return {
    ...project,
    repositories,
  };
}

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

    // 各プロジェクトにリポジトリ情報を付与
    const enrichedProjects = projects.map((p) => enrichProjectWithRepositories(db, p));

    return c.json(enrichedProjects);
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

    return c.json(enrichProjectWithRepositories(db, project));
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

    // 後方互換性: githubOwner/githubRepo が指定されている場合は repositories に変換
    const repositories: Array<{ githubOwner: string; githubRepo: string; localPath?: string }> =
      body.repositories ?? [];
    if (body.githubOwner && body.githubRepo && repositories.length === 0) {
      repositories.push({
        githubOwner: body.githubOwner,
        githubRepo: body.githubRepo,
        localPath: body.path ?? undefined,
      });
    }

    const project = db
      .insert(schema.projects)
      .values({
        name: body.name,
        // 後方互換性のため、最初のリポジトリのローカルパスを保存
        path: repositories[0]?.localPath ?? body.path ?? null,
        // 後方互換性のため、最初のリポジトリを保存
        githubOwner: repositories[0]?.githubOwner ?? null,
        githubRepo: repositories[0]?.githubRepo ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    // リポジトリを追加
    for (const repo of repositories) {
      db.insert(schema.projectRepositories)
        .values({
          projectId: project.id,
          githubOwner: repo.githubOwner,
          githubRepo: repo.githubRepo,
          localPath: repo.localPath ?? null,
          createdAt: now,
        })
        .run();
    }

    return c.json(enrichProjectWithRepositories(db, project), 201);
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

    const now = new Date().toISOString();
    const updates: {
      updatedAt: string;
      name?: string;
      path?: string | null;
      githubOwner?: string | null;
      githubRepo?: string | null;
      isActive?: boolean;
    } = {
      updatedAt: now,
    };

    if (body.name !== undefined) {
      updates.name = body.name;
    }
    if (body.path !== undefined) {
      updates.path = body.path;
    }
    // 後方互換性: githubOwner/githubRepo が指定された場合
    if (body.githubOwner !== undefined) {
      updates.githubOwner = body.githubOwner;
    }
    if (body.githubRepo !== undefined) {
      updates.githubRepo = body.githubRepo;
    }
    if (body.isActive !== undefined) {
      updates.isActive = body.isActive;
    }

    // repositories が指定された場合、既存のリポジトリを置き換え
    if (body.repositories !== undefined) {
      // 既存のリポジトリを削除
      db.delete(schema.projectRepositories)
        .where(eq(schema.projectRepositories.projectId, id))
        .run();

      // 新しいリポジトリを追加
      for (const repo of body.repositories) {
        db.insert(schema.projectRepositories)
          .values({
            projectId: id,
            githubOwner: repo.githubOwner,
            githubRepo: repo.githubRepo,
            localPath: repo.localPath ?? null,
            createdAt: now,
          })
          .run();
      }

      // 後方互換性のため、最初のリポジトリを projects テーブルにも保存
      updates.githubOwner = body.repositories[0]?.githubOwner ?? null;
      updates.githubRepo = body.repositories[0]?.githubRepo ?? null;
      updates.path = body.repositories[0]?.localPath ?? null;
    }

    const result = db
      .update(schema.projects)
      .set(updates)
      .where(eq(schema.projects.id, id))
      .returning()
      .get();

    return c.json(enrichProjectWithRepositories(db, result));
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

    // 関連するリポジトリも削除
    db.delete(schema.projectRepositories).where(eq(schema.projectRepositories.projectId, id)).run();

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

    return c.json(enrichProjectWithRepositories(db, project));
  });

  /**
   * GET /api/projects/by-github/:owner/:repo
   *
   * GitHub owner/repo からプロジェクトを検索
   * project_repositories テーブルを使用して検索
   */
  router.get("/by-github/:owner/:repo", (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");

    // まず project_repositories から検索
    const projectRepo = db
      .select()
      .from(schema.projectRepositories)
      .where(
        and(
          eq(schema.projectRepositories.githubOwner, owner),
          eq(schema.projectRepositories.githubRepo, repo),
        ),
      )
      .get();

    if (projectRepo) {
      const project = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, projectRepo.projectId))
        .get();

      if (project) {
        return c.json(enrichProjectWithRepositories(db, project));
      }
    }

    // 後方互換性: projects テーブルの githubOwner/githubRepo からも検索
    const legacyProject = db
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.githubOwner, owner), eq(schema.projects.githubRepo, repo)))
      .get();

    if (legacyProject) {
      return c.json(enrichProjectWithRepositories(db, legacyProject));
    }

    return c.json({ error: "Project not found" }, 404);
  });

  /**
   * GET /api/projects/stats
   *
   * プロジェクト統計
   */
  router.get("/stats", (c) => {
    const allProjects = db.select().from(schema.projects).all();

    // リポジトリを持つプロジェクト数をカウント
    const projectsWithRepos = db
      .selectDistinct({ projectId: schema.projectRepositories.projectId })
      .from(schema.projectRepositories)
      .all();

    const withPath = allProjects.filter((p) => p.path !== null).length;
    const withGitHub = projectsWithRepos.length;
    const active = allProjects.filter((p) => p.isActive).length;

    return c.json({
      total: allProjects.length,
      active,
      withPath,
      withGitHub,
    });
  });

  /**
   * GET /api/projects/:id/repositories
   *
   * プロジェクトに紐づくリポジトリ一覧
   */
  router.get("/:id/repositories", (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const project = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    const repositories = getProjectRepositories(db, id);
    return c.json(repositories);
  });

  /**
   * POST /api/projects/:id/repositories
   *
   * プロジェクトにリポジトリを追加
   */
  router.post("/:id/repositories", async (c) => {
    const id = Number(c.req.param("id"));
    if (Number.isNaN(id)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const body = await c.req.json<{
      githubOwner: string;
      githubRepo: string;
      localPath?: string;
    }>();

    if (!body.githubOwner || !body.githubRepo) {
      return c.json({ error: "githubOwner and githubRepo are required" }, 400);
    }

    const project = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();

    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    // 重複チェック
    const existing = db
      .select()
      .from(schema.projectRepositories)
      .where(
        and(
          eq(schema.projectRepositories.projectId, id),
          eq(schema.projectRepositories.githubOwner, body.githubOwner),
          eq(schema.projectRepositories.githubRepo, body.githubRepo),
        ),
      )
      .get();

    if (existing) {
      return c.json({ error: "Repository already linked to this project" }, 409);
    }

    const now = new Date().toISOString();
    const repository = db
      .insert(schema.projectRepositories)
      .values({
        projectId: id,
        githubOwner: body.githubOwner,
        githubRepo: body.githubRepo,
        localPath: body.localPath ?? null,
        createdAt: now,
      })
      .returning()
      .get();

    // projects テーブルの updatedAt を更新
    db.update(schema.projects).set({ updatedAt: now }).where(eq(schema.projects.id, id)).run();

    return c.json(repository, 201);
  });

  /**
   * DELETE /api/projects/:id/repositories/:repoId
   *
   * プロジェクトからリポジトリを削除
   */
  router.delete("/:id/repositories/:repoId", (c) => {
    const id = Number(c.req.param("id"));
    const repoId = Number(c.req.param("repoId"));

    if (Number.isNaN(id) || Number.isNaN(repoId)) {
      return c.json({ error: "Invalid id" }, 400);
    }

    const repository = db
      .select()
      .from(schema.projectRepositories)
      .where(
        and(
          eq(schema.projectRepositories.id, repoId),
          eq(schema.projectRepositories.projectId, id),
        ),
      )
      .get();

    if (!repository) {
      return c.json({ error: "Repository not found" }, 404);
    }

    db.delete(schema.projectRepositories).where(eq(schema.projectRepositories.id, repoId)).run();

    // projects テーブルの updatedAt を更新
    const now = new Date().toISOString();
    db.update(schema.projects).set({ updatedAt: now }).where(eq(schema.projects.id, id)).run();

    return c.json({ deleted: true });
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
