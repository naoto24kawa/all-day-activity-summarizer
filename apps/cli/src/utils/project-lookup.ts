/**
 * Project Lookup Utilities
 *
 * プロジェクト検索ユーティリティ (循環参照を避けるため独立)
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { and, eq } from "drizzle-orm";

/**
 * プロジェクトを検索または作成 (GitHub 用)
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
 * プロジェクトを検索 (path 用)
 */
export function findProjectByPath(db: AdasDatabase, path: string): number | null {
  const project = db.select().from(schema.projects).where(eq(schema.projects.path, path)).get();

  return project?.id ?? null;
}
