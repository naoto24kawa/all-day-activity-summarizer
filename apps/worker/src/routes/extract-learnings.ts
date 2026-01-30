import { runClaude } from "@repo/core";
import type { LearningCategory, LearningSourceType } from "@repo/types";
import consola from "consola";
import { Hono } from "hono";

const EXTRACT_MODEL = "sonnet";

interface UserProfileContext {
  experienceYears?: number;
  specialties?: string[];
  knownTechnologies?: string[];
  learningGoals?: string[];
}

interface ExtractLearningsRequestBody {
  messages: Array<{
    role: string;
    content: string;
  }>;
  sourceType?: LearningSourceType;
  projectName?: string;
  contextInfo?: string;
  userProfile?: UserProfileContext;
}

export interface ExtractedLearning {
  content: string;
  category: LearningCategory;
  tags: string[];
  confidence: number;
}

interface ExtractLearningsResponse {
  learnings: ExtractedLearning[];
}

export function createExtractLearningsRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<ExtractLearningsRequestBody>();

      if (!body.messages || body.messages.length === 0) {
        return c.json({ error: "messages is required" }, 400);
      }

      const result = await extractLearningsWithClaude(
        body.messages,
        body.sourceType || "claude-code",
        body.projectName,
        body.contextInfo,
        body.userProfile,
      );
      return c.json(result);
    } catch (err) {
      consola.error("[worker/extract-learnings] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}

function buildPrompt(
  sourceType: LearningSourceType,
  conversation: string,
  projectName?: string,
  contextInfo?: string,
  userProfile?: UserProfileContext,
): string {
  const projectInfo = projectName ? `プロジェクト: ${projectName}\n\n` : "";
  const contextSection = contextInfo ? `コンテキスト: ${contextInfo}\n\n` : "";

  // ユーザープロフィール情報セクション
  let profileSection = "";
  if (userProfile) {
    const parts: string[] = [];
    if (userProfile.experienceYears !== undefined) {
      parts.push(`経験年数: ${userProfile.experienceYears}年`);
    }
    if (userProfile.specialties && userProfile.specialties.length > 0) {
      parts.push(`専門分野: ${userProfile.specialties.join(", ")}`);
    }
    if (userProfile.knownTechnologies && userProfile.knownTechnologies.length > 0) {
      parts.push(`既知技術: ${userProfile.knownTechnologies.join(", ")}`);
    }
    if (userProfile.learningGoals && userProfile.learningGoals.length > 0) {
      parts.push(`学習目標: ${userProfile.learningGoals.join(", ")}`);
    }
    if (parts.length > 0) {
      profileSection = `ユーザープロフィール:
${parts.map((p) => `- ${p}`).join("\n")}

注意: 既知技術の基礎的な内容は除外し、学習目標に関連する内容を優先してください。

`;
    }
  }

  const categoryList = `"typescript" | "react" | "architecture" | "testing" | "devops" | "database" | "api" | "security" | "performance" | "communication" | "other"`;

  const jsonFormat = `{
  "learnings": [
    {
      "content": "学びの内容",
      "category": ${categoryList},
      "tags": ["関連タグ1", "関連タグ2"],
      "confidence": 0.0-1.0
    }
  ]
}`;

  switch (sourceType) {
    case "claude-code":
      return `以下の Claude Code セッションの会話から、ユーザーが学んだと思われる技術的な知見を抽出してください。

${profileSection}${projectInfo}${contextSection}会話:
${conversation}

ルール:
- ユーザーにとって新しい発見や、役立つ技術的知見のみを抽出する
- 一般的すぎる内容や、単なる操作説明は除外する
- 各学びは簡潔に1-2文でまとめる
- 学びがない場合は空の配列を返す
- 最大5つまで抽出する

JSON形式で出力:
${jsonFormat}`;

    case "transcription":
      return `以下の音声文字起こしから、会話中で共有された技術的な知見やノウハウを抽出してください。

${profileSection}${projectInfo}${contextSection}会話:
${conversation}

ルール:
- 会議やディスカッションで共有された技術的な知見を抽出する
- 単なる進捗報告や挨拶は除外する
- 具体的なノウハウ、ベストプラクティス、注意点を優先する
- 各学びは簡潔に1-2文でまとめる
- 学びがない場合は空の配列を返す
- 最大5つまで抽出する

JSON形式で出力:
${jsonFormat}`;

    case "github-comment":
      return `以下の GitHub PR レビューコメントから、コードレビューで指摘された技術的な知見を抽出してください。

${profileSection}${projectInfo}${contextSection}コメント:
${conversation}

ルール:
- コードレビューで指摘された改善点、ベストプラクティスを抽出する
- 単純な typo 修正や軽微な指摘は除外する
- 設計パターン、セキュリティ、パフォーマンスに関する指摘を優先する
- 各学びは簡潔に1-2文でまとめる
- 学びがない場合は空の配列を返す
- 最大5つまで抽出する

JSON形式で出力:
${jsonFormat}`;

    case "slack-message":
      return `以下の Slack メッセージから、チームで共有された技術的な知見やノウハウを抽出してください。

${profileSection}${projectInfo}${contextSection}メッセージ:
${conversation}

ルール:
- 技術的な質問と回答から学びを抽出する
- 単なる業務連絡や挨拶は除外する
- トラブルシューティングの解決策、Tips を優先する
- 各学びは簡潔に1-2文でまとめる
- 学びがない場合は空の配列を返す
- 最大5つまで抽出する

JSON形式で出力:
${jsonFormat}`;

    default:
      return `以下の内容から技術的な知見を抽出してください。

${profileSection}${projectInfo}${contextSection}内容:
${conversation}

JSON形式で出力:
${jsonFormat}`;
  }
}

async function extractLearningsWithClaude(
  messages: Array<{ role: string; content: string }>,
  sourceType: LearningSourceType,
  projectName?: string,
  contextInfo?: string,
  userProfile?: UserProfileContext,
): Promise<ExtractLearningsResponse> {
  // メッセージを会話形式に整形
  const conversation = messages.map((m) => `[${m.role}]: ${m.content}`).join("\n\n");

  const prompt = buildPrompt(sourceType, conversation, projectName, contextInfo, userProfile);

  consola.info(
    `[worker/extract-learnings] Extracting from ${messages.length} messages (source: ${sourceType})...`,
  );

  const result = await runClaude(prompt, {
    model: EXTRACT_MODEL,
    disableTools: true,
  });

  if (!result) {
    return { learnings: [] };
  }

  try {
    // JSON部分を抽出
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      consola.warn("[worker/extract-learnings] No JSON found in response");
      return { learnings: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]) as ExtractLearningsResponse;
    consola.info(`[worker/extract-learnings] Extracted ${parsed.learnings.length} learnings`);
    return parsed;
  } catch (parseErr) {
    consola.error("[worker/extract-learnings] Failed to parse response:", parseErr);
    return { learnings: [] };
  }
}
