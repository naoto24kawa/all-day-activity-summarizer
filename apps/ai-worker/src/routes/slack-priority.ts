/**
 * Slack Priority Route
 *
 * Uses Haiku to determine the priority of Slack messages.
 */

import { readFileSync } from "node:fs";
import { getPromptFilePath } from "@repo/core";
import type {
  RpcSlackPriorityRequest,
  RpcSlackPriorityResponse,
  SlackMessagePriority,
} from "@repo/types";
import consola from "consola";
import { Hono } from "hono";
import { getLLMProviderForProcess, getProviderInfo } from "../utils/llm-config.js";
import { withProcessingLog } from "../utils/log-processing.js";

const SLACK_PRIORITY_MODEL = "haiku";

export function createSlackPriorityRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<RpcSlackPriorityRequest>();

      if (!body.text || typeof body.text !== "string") {
        return c.json({ error: "text is required" }, 400);
      }

      if (body.messageId === undefined) {
        return c.json({ error: "messageId is required" }, 400);
      }

      const result = await withProcessingLog(
        "slack-priority",
        SLACK_PRIORITY_MODEL,
        () => determinePriorityWithLLM(body),
        (res) => ({
          inputSize: body.text.length,
          metadata: {
            messageId: body.messageId,
            priority: res.priority,
            reason: res.reason,
          },
        }),
      );
      return c.json(result);
    } catch (err) {
      consola.error("[worker/slack-priority] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}

/**
 * ユーザープロフィールをテキスト形式に変換
 */
function formatUserProfile(request: RpcSlackPriorityRequest): string {
  const profile = request.userProfile;
  if (!profile) {
    return "(プロフィール未設定)";
  }

  const lines: string[] = [];

  if (profile.displayName) {
    lines.push(`- 名前: ${profile.displayName}`);
  }

  if (profile.slackUserId) {
    lines.push(`- Slack ID: ${profile.slackUserId}`);
  }

  if (profile.githubUsername) {
    lines.push(`- GitHub: ${profile.githubUsername}`);
  }

  if (profile.responsibilities && profile.responsibilities.length > 0) {
    lines.push(`- 担当領域: ${profile.responsibilities.join(", ")}`);
  }

  if (profile.specialties && profile.specialties.length > 0) {
    lines.push(`- 専門分野: ${profile.specialties.join(", ")}`);
  }

  return lines.length > 0 ? lines.join("\n") : "(プロフィール未設定)";
}

async function determinePriorityWithLLM(
  request: RpcSlackPriorityRequest,
): Promise<RpcSlackPriorityResponse> {
  // プロンプトを読み込み
  const promptPath = getPromptFilePath("slack-priority");
  let basePrompt = readFileSync(promptPath, "utf-8");

  // ユーザープロフィールを挿入
  const userProfileText = formatUserProfile(request);
  basePrompt = basePrompt.replace("{{USER_PROFILE}}", userProfileText);

  const prompt = `${basePrompt}

## 対象メッセージ

- メッセージタイプ: ${request.messageType}
- チャンネル: ${request.channelName || "(不明)"}
- 送信者: ${request.userName || "(不明)"}
- 内容:
${request.text}

## 判定結果 (JSON のみ)`;

  // LLM Provider を取得
  const provider = getLLMProviderForProcess("slackPriority", SLACK_PRIORITY_MODEL);
  const providerInfo = getProviderInfo("slackPriority");

  consola.info(
    `[worker/slack-priority] Determining priority for message ${request.messageId} (${request.text.length} chars, provider: ${providerInfo.provider})`,
  );

  const result = await provider.generate(prompt, {
    model: SLACK_PRIORITY_MODEL,
    disableTools: true,
    temperature: 0.3,
  });

  if (!result) {
    throw new Error("No response from priority analyzer");
  }

  // JSON 部分を抽出
  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    consola.warn(`[worker/slack-priority] Failed to parse response: ${result}`);
    return { priority: "medium", reason: "解析失敗のためデフォルト値" };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { priority: string; reason: string };

    // priority の検証
    const validPriorities: SlackMessagePriority[] = ["high", "medium", "low"];
    const priority = validPriorities.includes(parsed.priority as SlackMessagePriority)
      ? (parsed.priority as SlackMessagePriority)
      : "medium";

    consola.info(
      `[worker/slack-priority] Message ${request.messageId}: ${priority} - ${parsed.reason}`,
    );

    return {
      priority,
      reason: parsed.reason || "理由なし",
    };
  } catch (parseError) {
    consola.warn(`[worker/slack-priority] JSON parse error: ${parseError}`);
    return { priority: "medium", reason: "解析失敗のためデフォルト値" };
  }
}
