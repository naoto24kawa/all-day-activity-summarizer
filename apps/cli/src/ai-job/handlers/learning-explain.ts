/**
 * Learning Explain Handler
 *
 * 学びの詳細説明を非同期で生成
 * - ai-worker の /rpc/explain-learning を呼び出し
 * - 結果は pending_explanation に JSON で保存
 */

import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { LearningExplanationResult } from "@repo/types";
import consola from "consola";
import { eq } from "drizzle-orm";
import type { AdasConfig } from "../../config.js";
import { getVocabularyTerms } from "../../utils/vocabulary.js";
import type { JobResult } from "../worker.js";

/** ハンドラーパラメータ */
interface LearningExplainParams {
  learningId: number;
}

/**
 * 学び詳細説明ハンドラー
 */
export async function handleLearningExplain(
  db: AdasDatabase,
  config: AdasConfig,
  params: Record<string, unknown>,
): Promise<JobResult> {
  const { learningId } = params as unknown as LearningExplainParams;

  if (!learningId) {
    return {
      success: false,
      resultSummary: "学びIDが指定されていません",
    };
  }

  // 学びを取得
  const learning = db
    .select()
    .from(schema.learnings)
    .where(eq(schema.learnings.id, learningId))
    .get();

  if (!learning) {
    return {
      success: false,
      resultSummary: `学びが見つかりません: ${learningId}`,
    };
  }

  // ステータスを pending に設定
  db.update(schema.learnings)
    .set({
      explanationStatus: "pending",
    })
    .where(eq(schema.learnings.id, learningId))
    .run();

  try {
    const { url, timeout } = config.worker;

    // 用語辞書を取得
    const vocabulary = getVocabularyTerms(db);

    // ユーザープロフィールを取得
    const profile = db.select().from(schema.userProfile).where(eq(schema.userProfile.id, 1)).get();
    let userProfile:
      | {
          specialties?: string[];
          knownTechnologies?: string[];
          learningGoals?: string[];
        }
      | undefined;

    if (profile) {
      userProfile = {
        specialties: profile.specialties ? JSON.parse(profile.specialties) : undefined,
        knownTechnologies: profile.knownTechnologies
          ? JSON.parse(profile.knownTechnologies)
          : undefined,
        learningGoals: profile.learningGoals ? JSON.parse(profile.learningGoals) : undefined,
      };
    }

    // プロジェクト名を取得
    let projectName: string | undefined;
    if (learning.projectId) {
      const project = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, learning.projectId))
        .get();
      projectName = project?.name;
    }

    consola.info(`[learning-explain] Starting explanation for learning ${learningId}`);

    // ai-worker を呼び出し
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${url}/rpc/explain-learning`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: learning.content,
        category: learning.category,
        tags: learning.tags,
        projectName,
        userProfile,
        vocabulary,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Worker error: ${errorText}`);
    }

    const result = (await response.json()) as LearningExplanationResult;

    // 結果を保存
    db.update(schema.learnings)
      .set({
        explanationStatus: "completed",
        pendingExplanation: JSON.stringify(result),
      })
      .where(eq(schema.learnings.id, learningId))
      .run();

    consola.success(
      `[learning-explain] Done (${result.keyPoints.length} key points, ${result.relatedTopics.length} related topics)`,
    );

    return {
      success: true,
      resultSummary: `詳細説明完了: ${result.keyPoints.length} 件のキーポイント`,
      data: {
        learningId,
        keyPointsCount: result.keyPoints.length,
        relatedTopicsCount: result.relatedTopics.length,
      },
    };
  } catch (error) {
    consola.error(`[learning-explain] Failed:`, error);

    // エラー時もステータスを更新
    db.update(schema.learnings)
      .set({
        explanationStatus: "failed",
      })
      .where(eq(schema.learnings.id, learningId))
      .run();

    return {
      success: false,
      resultSummary: error instanceof Error ? error.message : "詳細説明の生成に失敗しました",
    };
  }
}
