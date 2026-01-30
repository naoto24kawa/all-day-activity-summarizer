/**
 * Slack Channels API Routes
 *
 * チャンネル単位でのプロジェクト紐づけを管理
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";

export function createSlackChannelsRouter(db: AdasDatabase) {
  const router = new Hono();

  /**
   * GET /api/slack-channels
   *
   * チャンネル一覧を取得
   */
  router.get("/", (c) => {
    const channels = db
      .select()
      .from(schema.slackChannels)
      .orderBy(desc(schema.slackChannels.updatedAt))
      .all();

    return c.json(channels);
  });

  /**
   * GET /api/slack-channels/:channelId
   *
   * 特定チャンネルを取得
   */
  router.get("/:channelId", (c) => {
    const channelId = c.req.param("channelId");

    const channel = db
      .select()
      .from(schema.slackChannels)
      .where(eq(schema.slackChannels.channelId, channelId))
      .get();

    if (!channel) {
      return c.json({ error: "Channel not found" }, 404);
    }

    return c.json(channel);
  });

  /**
   * PUT /api/slack-channels/:channelId
   *
   * チャンネルの projectId を更新
   * Body: { projectId?: number | null }
   */
  router.put("/:channelId", async (c) => {
    const channelId = c.req.param("channelId");
    const body = await c.req.json<{ projectId?: number | null }>();

    // チャンネルが存在するか確認
    const existing = db
      .select()
      .from(schema.slackChannels)
      .where(eq(schema.slackChannels.channelId, channelId))
      .get();

    if (!existing) {
      return c.json({ error: "Channel not found" }, 404);
    }

    // projectId のみ更新
    const updateData: { projectId?: number | null; updatedAt: string } = {
      updatedAt: new Date().toISOString(),
    };

    if (body.projectId !== undefined) {
      updateData.projectId = body.projectId;
    }

    const result = db
      .update(schema.slackChannels)
      .set(updateData)
      .where(eq(schema.slackChannels.channelId, channelId))
      .returning()
      .get();

    return c.json(result);
  });

  return router;
}
