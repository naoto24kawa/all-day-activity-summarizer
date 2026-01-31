/**
 * Git Repository Scanner
 *
 * ローカルの git リポジトリを探索し、プロジェクト情報を収集
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { GitRepoScanResult } from "@repo/types";

/**
 * チルダをホームディレクトリに展開
 */
export function expandTilde(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

/**
 * GitHub URL から owner/repo を抽出
 * 対応形式:
 * - https://github.com/owner/repo.git
 * - git@github.com:owner/repo.git
 * - https://github.com/owner/repo
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // HTTPS 形式
  const httpsMatch = url.match(/https?:\/\/github\.com\/([^/]+)\/([^/\s.]+)(?:\.git)?/);
  if (httpsMatch) {
    const owner = httpsMatch[1];
    const repo = httpsMatch[2];
    if (owner && repo) {
      return { owner, repo };
    }
  }

  // SSH 形式
  const sshMatch = url.match(/git@github\.com:([^/]+)\/([^/\s.]+)(?:\.git)?/);
  if (sshMatch) {
    const owner = sshMatch[1];
    const repo = sshMatch[2];
    if (owner && repo) {
      return { owner, repo };
    }
  }

  return null;
}

/**
 * .git/config から remote origin URL を取得
 */
export function getRemoteOriginUrl(gitDir: string): string | null {
  const configPath = join(gitDir, "config");
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    // [remote "origin"] セクションの url を探す
    const remoteOriginMatch = content.match(/\[remote\s+"origin"\]\s*[\s\S]*?url\s*=\s*(.+)/);
    if (remoteOriginMatch) {
      return remoteOriginMatch[1].trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Git リポジトリをスキャン
 *
 * @param scanPaths - 探索対象のディレクトリパス (~ は展開される)
 * @param excludePatterns - スキップするディレクトリ名のパターン
 * @param maxDepth - 探索の最大深度 (デフォルト: 3)
 */
export function scanGitRepositories(
  scanPaths: string[],
  excludePatterns: string[],
  maxDepth = 3,
): GitRepoScanResult[] {
  const results: GitRepoScanResult[] = [];
  const visited = new Set<string>();

  const excludeSet = new Set(excludePatterns.map((p) => p.toLowerCase()));

  function shouldExclude(name: string): boolean {
    return excludeSet.has(name.toLowerCase());
  }

  function scanDirectory(dirPath: string, depth: number): void {
    if (depth > maxDepth) return;

    // 既に訪問済みなら終了
    if (visited.has(dirPath)) return;
    visited.add(dirPath);

    let entries: string[];
    try {
      entries = readdirSync(dirPath);
    } catch {
      return; // アクセスできないディレクトリはスキップ
    }

    // .git フォルダがあれば Git リポジトリとして記録
    if (entries.includes(".git")) {
      const gitDir = join(dirPath, ".git");
      try {
        const stat = statSync(gitDir);
        if (stat.isDirectory()) {
          const remoteUrl = getRemoteOriginUrl(gitDir);
          const github = remoteUrl ? parseGitHubUrl(remoteUrl) : null;

          results.push({
            path: dirPath,
            name: basename(dirPath),
            remoteUrl,
            githubOwner: github?.owner ?? null,
            githubRepo: github?.repo ?? null,
          });
          return; // サブディレクトリは探索しない (ネストされた git リポジトリは無視)
        }
      } catch {
        // .git が読めない場合はスキップ
      }
    }

    // サブディレクトリを再帰的に探索
    for (const entry of entries) {
      // 除外パターンにマッチする場合はスキップ
      if (shouldExclude(entry)) continue;
      // 隠しフォルダはスキップ (ただし .git は上で処理済み)
      if (entry.startsWith(".")) continue;

      const entryPath = join(dirPath, entry);
      try {
        const stat = statSync(entryPath);
        if (stat.isDirectory()) {
          scanDirectory(entryPath, depth + 1);
        }
      } catch {
        // アクセスできないエントリはスキップ
      }
    }
  }

  for (const scanPath of scanPaths) {
    const expandedPath = expandTilde(scanPath);
    if (existsSync(expandedPath)) {
      scanDirectory(expandedPath, 0);
    }
  }

  return results;
}
