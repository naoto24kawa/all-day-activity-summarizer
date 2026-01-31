/**
 * Project Lookup Utilities
 *
 * プロジェクト検索ユーティリティ (循環参照を避けるため独立)
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { and, eq, isNotNull } from "drizzle-orm";

/**
 * プロジェクトを検索または作成 (GitHub 用)
 * excludedAt が設定されている場合は新規作成しない
 */
export function findOrCreateProjectByGitHub(
  db: AdasDatabase,
  repoOwner: string,
  repoName: string,
): number | null {
  // 既存プロジェクトを検索
  const existing = db
    .select()
    .from(schema.projects)
    .where(
      and(eq(schema.projects.githubOwner, repoOwner), eq(schema.projects.githubRepo, repoName)),
    )
    .get();

  if (existing) {
    // excludedAt が設定されている場合は null を返す (作成しない)
    if (existing.excludedAt) {
      return null;
    }
    return existing.id;
  }

  // 存在しなければ作成
  const now = new Date().toISOString();
  const project = db
    .insert(schema.projects)
    .values({
      name: repoName,
      path: null,
      githubOwner: repoOwner,
      githubRepo: repoName,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return project.id;
}

/**
 * プロジェクトを検索 (path 用 - 完全一致)
 */
export function findProjectByPath(db: AdasDatabase, path: string): number | null {
  const project = db.select().from(schema.projects).where(eq(schema.projects.path, path)).get();

  return project?.id ?? null;
}

/**
 * プロジェクトを検索 (path 用 - 部分一致対応)
 * projectPath からプロジェクトを検索。完全一致 → 部分一致の順で検索。
 */
export function findProjectByPathFuzzy(db: AdasDatabase, projectPath: string): number | null {
  // Get all projects with path
  const projects = db.select().from(schema.projects).where(isNotNull(schema.projects.path)).all();

  // Exact match first
  const exactMatch = projects.find((p) => p.path === projectPath);
  if (exactMatch) {
    return exactMatch.id;
  }

  // Partial match (projectPath ends with project.path or project.path ends with projectPath)
  const partialMatch = projects.find(
    (p) => p.path && (projectPath.endsWith(p.path) || p.path.endsWith(projectPath)),
  );
  if (partialMatch) {
    return partialMatch.id;
  }

  return null;
}

/**
 * プロジェクトを検索 (名前から - 部分一致)
 * プロジェクト名またはチャンネル名からプロジェクトを推測。
 */
export function findProjectByName(db: AdasDatabase, name: string): number | null {
  const projects = db.select().from(schema.projects).all();
  const normalizedName = name.toLowerCase().replace(/[-_]/g, "");

  // Exact name match
  const exactMatch = projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (exactMatch) {
    return exactMatch.id;
  }

  // GitHub repo name match
  const repoMatch = projects.find(
    (p) => p.githubRepo && p.githubRepo.toLowerCase() === name.toLowerCase(),
  );
  if (repoMatch) {
    return repoMatch.id;
  }

  // Normalized match (ignore - and _)
  const normalizedMatch = projects.find((p) => {
    const normalizedProjectName = p.name.toLowerCase().replace(/[-_]/g, "");
    return normalizedProjectName === normalizedName;
  });
  if (normalizedMatch) {
    return normalizedMatch.id;
  }

  // Partial match (name contains project name)
  const partialMatch = projects.find((p) => {
    const normalizedProjectName = p.name.toLowerCase().replace(/[-_]/g, "");
    return normalizedName.includes(normalizedProjectName) && normalizedProjectName.length >= 3;
  });
  if (partialMatch) {
    return partialMatch.id;
  }

  return null;
}

/**
 * コンテンツからプロジェクトを推測
 * コンテンツ内のプロジェクト名を検索して紐付け。
 */
export function findProjectFromContent(db: AdasDatabase, content: string): number | null {
  const projects = db.select().from(schema.projects).all();

  // プロジェクト名が長い順にソート (部分一致の誤検知を防ぐ)
  const sortedProjects = [...projects].sort((a, b) => b.name.length - a.name.length);

  for (const project of sortedProjects) {
    const projectName = project.name.toLowerCase();
    const contentLower = content.toLowerCase();

    // プロジェクト名が含まれているか (3文字以上の場合のみ)
    if (projectName.length >= 3 && contentLower.includes(projectName)) {
      return project.id;
    }

    // GitHub リポジトリ名が含まれているか
    if (project.githubRepo) {
      const repoName = project.githubRepo.toLowerCase();
      if (repoName.length >= 3 && contentLower.includes(repoName)) {
        return project.id;
      }
    }
  }

  return null;
}
