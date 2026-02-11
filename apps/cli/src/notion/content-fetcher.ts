/**
 * Notion Content Fetcher
 *
 * Notion Blocks API を使ってページ本文を取得し Markdown に変換して保存
 */

import type { AdasDatabase } from "@repo/db";
import { notionItems } from "@repo/db/schema";
import consola from "consola";
import { eq } from "drizzle-orm";
import { blocksToMarkdown } from "./blocks-to-markdown.js";
import type { NotionClient } from "./client.js";

const MAX_DEPTH = 3;
const RATE_LIMIT_DELAY_MS = 350; // ~3 req/sec

// Notion API Block 型 (SDK の型が不完全なため簡易定義)
interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  [key: string]: unknown;
}

interface ListBlockChildrenResponse {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
}

/**
 * API コール間のスリープ
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 再帰的にブロックを取得 (ページネーション対応)
 */
async function fetchAllBlocks(
  client: NotionClient,
  blockId: string,
  depth = 0,
): Promise<NotionBlock[]> {
  if (depth >= MAX_DEPTH) {
    return [];
  }

  const allBlocks: NotionBlock[] = [];
  let cursor: string | undefined;

  do {
    await sleep(RATE_LIMIT_DELAY_MS);

    const response = (await client.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    })) as unknown as ListBlockChildrenResponse;

    for (const block of response.results) {
      allBlocks.push(block);

      // children がある場合は再帰的に取得
      if (block.has_children) {
        const children = await fetchAllBlocks(client, block.id, depth + 1);
        (block as NotionBlock & { children: NotionBlock[] }).children = children;
      }
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor);

  return allBlocks;
}

/**
 * ページコンテンツを取得して DB に保存
 */
export async function fetchAndSavePageContent(
  db: AdasDatabase,
  client: NotionClient,
  pageId: string,
): Promise<{ saved: boolean; contentLength: number }> {
  // ページが DB に存在するか確認
  const item = db
    .select({ id: notionItems.id })
    .from(notionItems)
    .where(eq(notionItems.pageId, pageId))
    .get();

  if (!item) {
    consola.warn(`[Notion] Page ${pageId} not found in DB, skipping content fetch`);
    return { saved: false, contentLength: 0 };
  }

  // ブロックを再帰的に取得
  const blocks = await fetchAllBlocks(client, pageId);

  // Markdown に変換
  const markdown = blocksToMarkdown(blocks);

  if (!markdown) {
    consola.debug(`[Notion] Page ${pageId} has no content blocks`);
    return { saved: false, contentLength: 0 };
  }

  // DB に保存
  const now = new Date().toISOString();
  db.update(notionItems)
    .set({
      content: markdown,
      contentSyncedAt: now,
    })
    .where(eq(notionItems.pageId, pageId))
    .run();

  consola.debug(`[Notion] Saved content for page ${pageId} (${markdown.length} chars)`);
  return { saved: true, contentLength: markdown.length };
}
