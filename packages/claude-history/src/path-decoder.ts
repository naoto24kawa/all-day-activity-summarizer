/**
 * Path Decoder
 *
 * Claude Code のエンコードされたパスを実際のファイルシステムパスにデコード
 *
 * Claude Code は `/` を `-` に置換してディレクトリ名をエンコードするため、
 * 元のパスに `-` が含まれている場合、単純な置換では正しくデコードできない。
 * ファイルシステムを参照して実際に存在するパスを探索する。
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * エンコードされたパスを実際のファイルシステムパスにデコード
 *
 * @param encodedPath エンコードされたパス (例: "-Users-nishikawa-projects-my-app")
 * @returns 実際のパス (例: "/Users/nishikawa/projects/my-app")
 */
export function decodeProjectPath(encodedPath: string): string {
  // エンコードされていない場合はそのまま返す
  if (!encodedPath.startsWith("-")) {
    return encodedPath;
  }

  // 先頭の `-` を除去して `/` で始まるようにし、セグメントに分割
  const withoutLeading = encodedPath.slice(1);
  const segments = withoutLeading.split("-");

  // 空のセグメントを除去 (連続した `-` の場合)
  const filteredSegments = segments.filter((s) => s.length > 0);

  if (filteredSegments.length === 0) {
    return "/";
  }

  // DFS でパスを探索
  const result = findValidPath("/", filteredSegments, 0);

  if (result) {
    return result;
  }

  // フォールバック: 単純な置換 (ファイルシステムで見つからない場合)
  return "/" + filteredSegments.join("/");
}

/**
 * 再帰的に有効なパスを探索
 */
function findValidPath(currentPath: string, segments: string[], startIndex: number): string | null {
  // 全てのセグメントを処理した
  if (startIndex >= segments.length) {
    return currentPath;
  }

  // 現在のセグメントから始めて、できるだけ多くのセグメントを結合して試す
  for (let endIndex = startIndex; endIndex < segments.length; endIndex++) {
    // startIndex から endIndex までのセグメントを `-` で結合
    const combinedSegment = segments.slice(startIndex, endIndex + 1).join("-");
    const candidatePath = path.join(currentPath, combinedSegment);

    // このパスが存在するか確認
    if (pathExists(candidatePath)) {
      // 残りのセグメントで再帰
      const result = findValidPath(candidatePath, segments, endIndex + 1);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

/**
 * パスが存在するかチェック (同期)
 */
function pathExists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * パスをエンコード (/ を - に変換)
 */
export function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/\//g, "-");
}
