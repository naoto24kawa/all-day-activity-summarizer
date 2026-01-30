/**
 * Analyze Profile Router
 *
 * 活動データからプロフィール提案を生成する
 */

import { runClaude } from "@repo/core";
import type { ProfileSuggestionType } from "@repo/types";
import consola from "consola";
import { Hono } from "hono";

const ANALYZE_MODEL = "haiku";

interface UserProfileInput {
  experienceYears?: number;
  specialties: string[];
  knownTechnologies: string[];
  learningGoals: string[];
}

interface ActivityData {
  claudeCodeSessions: Array<{
    projectName: string | null;
    summary: string | null;
  }>;
  learnings: Array<{
    category: string | null;
    tags: string | null;
    content: string;
  }>;
  githubItems: Array<{
    repoName: string;
    labels: string | null;
  }>;
}

interface AnalyzeProfileRequestBody {
  currentProfile: UserProfileInput;
  activityData: ActivityData;
}

interface ProfileSuggestionOutput {
  suggestionType: ProfileSuggestionType;
  field: string;
  value: string;
  reason: string;
  confidence: number;
}

interface AnalyzeProfileResponse {
  suggestions: ProfileSuggestionOutput[];
}

export function createAnalyzeProfileRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    try {
      const body = await c.req.json<AnalyzeProfileRequestBody>();

      if (!body.currentProfile || !body.activityData) {
        return c.json({ error: "currentProfile and activityData are required" }, 400);
      }

      const result = await analyzeProfileWithClaude(body.currentProfile, body.activityData);
      return c.json(result);
    } catch (err) {
      consola.error("[worker/analyze-profile] Error:", err);
      return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
    }
  });

  return router;
}

function buildPrompt(profile: UserProfileInput, activityData: ActivityData): string {
  // 現在のプロフィールをフォーマット
  const profileSection = `
現在のプロフィール:
- 経験年数: ${profile.experienceYears ?? "未設定"}年
- 専門分野: ${profile.specialties.length > 0 ? profile.specialties.join(", ") : "未設定"}
- 既知技術: ${profile.knownTechnologies.length > 0 ? profile.knownTechnologies.join(", ") : "未設定"}
- 学習目標: ${profile.learningGoals.length > 0 ? profile.learningGoals.join(", ") : "未設定"}
`;

  // 活動データをフォーマット
  const sessionsInfo =
    activityData.claudeCodeSessions.length > 0
      ? activityData.claudeCodeSessions
          .filter((s) => s.projectName || s.summary)
          .slice(0, 20)
          .map((s) => `- ${s.projectName || "不明"}: ${s.summary || "詳細なし"}`)
          .join("\n")
      : "なし";

  const learningsInfo =
    activityData.learnings.length > 0
      ? activityData.learnings
          .slice(0, 30)
          .map((l) => {
            const tags = l.tags ? JSON.parse(l.tags).join(", ") : "";
            return `- [${l.category || "other"}] ${l.content}${tags ? ` (${tags})` : ""}`;
          })
          .join("\n")
      : "なし";

  const githubInfo =
    activityData.githubItems.length > 0
      ? activityData.githubItems
          .slice(0, 20)
          .map((g) => {
            const labels = g.labels ? JSON.parse(g.labels).join(", ") : "";
            return `- ${g.repoName}${labels ? ` [${labels}]` : ""}`;
          })
          .join("\n")
      : "なし";

  const activitySection = `
最近の活動データ:

【Claude Code セッション】
${sessionsInfo}

【抽出された学び】
${learningsInfo}

【GitHub 活動】
${githubInfo}
`;

  const jsonFormat = `{
  "suggestions": [
    {
      "suggestionType": "add_technology" | "add_specialty" | "add_goal" | "update_experience",
      "field": "knownTechnologies" | "specialties" | "learningGoals" | "experienceYears",
      "value": "提案する値",
      "reason": "この提案の理由",
      "confidence": 0.0-1.0
    }
  ]
}`;

  return `以下のユーザーの活動データを分析し、プロフィールへの追加を提案してください。

${profileSection}
${activitySection}

分析ルール:
1. **既知技術 (knownTechnologies)**:
   - 活動データから実際に使用している技術を特定する
   - 現在のプロフィールにない技術のみを提案する
   - 1回だけの言及は除外し、複数回使用されている技術を優先する

2. **専門分野 (specialties)**:
   - 学びのカテゴリ分布から専門性を推定する
   - 「frontend」「backend」「infrastructure」「data」などの大きな分野で提案する
   - 現在のプロフィールにない分野のみを提案する

3. **学習目標 (learningGoals)**:
   - 活動から「学習中」と思われる新しい技術を特定する
   - 既知技術にはなく、活発に学習している兆候がある技術
   - 現在の学習目標と重複しないもの

4. **経験年数 (experienceYears)**:
   - 通常は提案しない (ユーザーが手動で設定すべき)
   - 活動内容から明らかに設定値と矛盾する場合のみ提案

出力ルール:
- 最大5つまで提案する
- 確信度 (confidence) は 0.7 以上のもののみ出力する
- 提案がない場合は空の配列を返す
- 理由は日本語で簡潔に記述する

JSON形式で出力:
${jsonFormat}`;
}

async function analyzeProfileWithClaude(
  profile: UserProfileInput,
  activityData: ActivityData,
): Promise<AnalyzeProfileResponse> {
  // 活動データが少なすぎる場合はスキップ
  const totalItems =
    activityData.claudeCodeSessions.length +
    activityData.learnings.length +
    activityData.githubItems.length;

  if (totalItems === 0) {
    consola.info("[worker/analyze-profile] No activity data to analyze");
    return { suggestions: [] };
  }

  const prompt = buildPrompt(profile, activityData);

  consola.info(`[worker/analyze-profile] Analyzing profile with ${totalItems} activity items...`);

  const result = await runClaude(prompt, {
    model: ANALYZE_MODEL,
    disableTools: true,
  });

  if (!result) {
    return { suggestions: [] };
  }

  try {
    // JSON部分を抽出
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      consola.warn("[worker/analyze-profile] No JSON found in response");
      return { suggestions: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]) as AnalyzeProfileResponse;

    // confidence が 0.7 以上のもののみフィルタリング
    const filteredSuggestions = parsed.suggestions.filter((s) => s.confidence >= 0.7);

    consola.info(
      `[worker/analyze-profile] Generated ${filteredSuggestions.length} suggestions (filtered from ${parsed.suggestions.length})`,
    );

    return { suggestions: filteredSuggestions };
  } catch (parseErr) {
    consola.error("[worker/analyze-profile] Failed to parse response:", parseErr);
    return { suggestions: [] };
  }
}
