import { readFileSync, writeFileSync } from "node:fs";
import { getPromptFilePath, runClaude } from "@repo/core";
import type { AdasDatabase } from "@repo/db";
import { schema } from "@repo/db";
import type { PromptTarget } from "@repo/types";
import consola from "consola";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";

export async function improvePrompt(
  target: PromptTarget,
  db: AdasDatabase,
  options?: { dryRun?: boolean },
): Promise<void> {
  // 1. 最終改善日時を取得
  const lastImprovement = db
    .select()
    .from(schema.promptImprovements)
    .where(eq(schema.promptImprovements.target, target))
    .orderBy(desc(schema.promptImprovements.createdAt))
    .limit(1)
    .get();

  const sinceDate = lastImprovement?.createdAt ?? "1970-01-01T00:00:00.000Z";

  // 2. それ以降のフィードバックを取得 (セグメント情報も JOIN)
  const feedbacks = db
    .select({
      id: schema.segmentFeedbacks.id,
      segmentId: schema.segmentFeedbacks.segmentId,
      rating: schema.segmentFeedbacks.rating,
      target: schema.segmentFeedbacks.target,
      reason: schema.segmentFeedbacks.reason,
      createdAt: schema.segmentFeedbacks.createdAt,
      transcription: schema.transcriptionSegments.transcription,
      interpretedText: schema.transcriptionSegments.interpretedText,
    })
    .from(schema.segmentFeedbacks)
    .innerJoin(
      schema.transcriptionSegments,
      eq(schema.segmentFeedbacks.segmentId, schema.transcriptionSegments.id),
    )
    .where(
      and(
        eq(schema.segmentFeedbacks.target, target),
        gte(schema.segmentFeedbacks.createdAt, sinceDate),
      ),
    )
    .all();

  if (feedbacks.length === 0) {
    consola.info(`No new feedbacks for target "${target}" since last improvement.`);
    return;
  }

  const goodFeedbacks = feedbacks.filter((f) => f.rating === "good");
  const badFeedbacks = feedbacks.filter((f) => f.rating === "bad");

  consola.info(
    `Found ${feedbacks.length} feedbacks (good: ${goodFeedbacks.length}, bad: ${badFeedbacks.length})`,
  );

  // 3. 現在のプロンプトファイルを読み込み
  const promptPath = getPromptFilePath(target);
  const currentPrompt = readFileSync(promptPath, "utf-8");

  // 4. メタプロンプト構築
  const badExamples = badFeedbacks
    .map((f) => {
      const lines = [`- Rating: bad`];
      if (f.reason) lines.push(`  Reason: ${f.reason}`);
      lines.push(`  Input: ${f.transcription}`);
      if (f.interpretedText) lines.push(`  Output: ${f.interpretedText}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const goodExamples = goodFeedbacks
    .map((f) => {
      const lines = [`- Rating: good`];
      if (f.reason) lines.push(`  Reason: ${f.reason}`);
      lines.push(`  Input: ${f.transcription}`);
      if (f.interpretedText) lines.push(`  Output: ${f.interpretedText}`);
      return lines.join("\n");
    })
    .join("\n\n");

  const metaPrompt = `You are a prompt engineer. Your task is to improve the following system prompt based on user feedback.

## Current Prompt
\`\`\`
${currentPrompt}
\`\`\`

## Feedback Statistics
- Total feedbacks: ${feedbacks.length}
- Good: ${goodFeedbacks.length}
- Bad: ${badFeedbacks.length}

## Bad Feedback (issues to fix)
${badExamples || "(none)"}

## Good Feedback (patterns to maintain)
${goodExamples || "(none)"}

## Instructions
- Analyze the bad feedback to identify recurring issues
- Preserve the qualities praised in good feedback
- Output ONLY the improved prompt text, nothing else
- Keep the same overall structure and format
- Do not add markdown code blocks around the output
- The improved prompt should be in the same language as the current prompt`;

  // 5. Claude で改善案を生成
  consola.start("Generating improved prompt...");
  const newPrompt = await runClaude(metaPrompt, {
    model: "sonnet",
    disableTools: true,
  });

  if (!newPrompt.trim()) {
    consola.error("Failed to generate improved prompt (empty response).");
    return;
  }

  if (options?.dryRun) {
    consola.box(`[Dry Run] Improved prompt for "${target}":\n\n${newPrompt}`);
    return;
  }

  // 6. ファイルに上書き
  writeFileSync(promptPath, newPrompt);
  consola.success(`Updated prompt file: ${promptPath}`);

  // 7. 履歴を記録
  db.insert(schema.promptImprovements)
    .values({
      target,
      previousPrompt: currentPrompt,
      newPrompt,
      feedbackCount: feedbacks.length,
      goodCount: goodFeedbacks.length,
      badCount: badFeedbacks.length,
      improvementReason: `Auto-improved based on ${feedbacks.length} feedbacks`,
    })
    .run();

  consola.success(`Recorded improvement history (${feedbacks.length} feedbacks processed)`);
}

/**
 * task-extract プロンプトの改善 (tasks テーブルの accepted/rejected を使用)
 */
export async function improveTaskExtractPrompt(
  db: AdasDatabase,
  options?: { dryRun?: boolean },
): Promise<void> {
  const target = "task-extract";

  // 1. 最終改善日時を取得
  const lastImprovement = db
    .select()
    .from(schema.promptImprovements)
    .where(eq(schema.promptImprovements.target, target))
    .orderBy(desc(schema.promptImprovements.createdAt))
    .limit(1)
    .get();

  const sinceDate = lastImprovement?.createdAt ?? "1970-01-01T00:00:00.000Z";

  // 2. それ以降の承認/却下されたタスクを取得 (元の Slack メッセージも含む)
  const acceptedTasks = db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      slackMessageId: schema.tasks.slackMessageId,
      acceptedAt: schema.tasks.acceptedAt,
    })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.status, "accepted"),
        isNotNull(schema.tasks.acceptedAt),
        gte(schema.tasks.acceptedAt, sinceDate),
        isNotNull(schema.tasks.slackMessageId),
      ),
    )
    .all();

  const rejectedTasks = db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      slackMessageId: schema.tasks.slackMessageId,
      rejectReason: schema.tasks.rejectReason,
      rejectedAt: schema.tasks.rejectedAt,
    })
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.status, "rejected"),
        isNotNull(schema.tasks.rejectedAt),
        gte(schema.tasks.rejectedAt, sinceDate),
        isNotNull(schema.tasks.slackMessageId),
      ),
    )
    .all();

  const totalFeedbacks = acceptedTasks.length + rejectedTasks.length;

  if (totalFeedbacks === 0) {
    consola.info(`No new task feedbacks since last improvement.`);
    return;
  }

  consola.info(
    `Found ${totalFeedbacks} task feedbacks (accepted: ${acceptedTasks.length}, rejected: ${rejectedTasks.length})`,
  );

  // 3. Slack メッセージを取得
  const slackMessageIds = [
    ...acceptedTasks.map((t) => t.slackMessageId),
    ...rejectedTasks.map((t) => t.slackMessageId),
  ].filter((id): id is number => id !== null);

  const slackMessages =
    slackMessageIds.length > 0
      ? db
          .select({ id: schema.slackMessages.id, text: schema.slackMessages.text })
          .from(schema.slackMessages)
          .where(inArray(schema.slackMessages.id, slackMessageIds))
          .all()
      : [];

  const messageMap = new Map(slackMessages.map((m) => [m.id, m.text]));

  // 4. 現在のプロンプトファイルを読み込み
  const promptPath = getPromptFilePath(target);
  const currentPrompt = readFileSync(promptPath, "utf-8");

  // 5. メタプロンプト構築
  const acceptedExamples = acceptedTasks
    .map((t) => {
      const message = t.slackMessageId ? messageMap.get(t.slackMessageId) : null;
      if (!message) return null;
      return `- Message: "${message.slice(0, 200)}"\n  Extracted Task: "${t.title}"\n  Result: ACCEPTED (correct extraction)`;
    })
    .filter(Boolean)
    .join("\n\n");

  const rejectedExamples = rejectedTasks
    .map((t) => {
      const message = t.slackMessageId ? messageMap.get(t.slackMessageId) : null;
      if (!message) return null;
      const reason = t.rejectReason ? `\n  User Reason: ${t.rejectReason}` : "";
      return `- Message: "${message.slice(0, 200)}"\n  Extracted Task: "${t.title}"${reason}\n  Result: REJECTED (incorrect extraction)`;
    })
    .filter(Boolean)
    .join("\n\n");

  const metaPrompt = `You are a prompt engineer. Your task is to improve a task extraction prompt based on user feedback.

## Current Prompt
\`\`\`
${currentPrompt}
\`\`\`

## Feedback Statistics
- Total feedbacks: ${totalFeedbacks}
- Accepted (correct extractions): ${acceptedTasks.length}
- Rejected (incorrect extractions): ${rejectedTasks.length}

## Rejected Extractions (issues to fix)
These tasks were extracted but the user rejected them as incorrect:
${rejectedExamples || "(none)"}

## Accepted Extractions (patterns to maintain)
These tasks were correctly extracted and accepted by the user:
${acceptedExamples || "(none)"}

## Instructions
- Analyze the rejected extractions to identify what went wrong
- Look for patterns in rejection reasons
- Preserve the extraction patterns that led to accepted tasks
- Improve the criteria for what should/shouldn't be extracted as a task
- Output ONLY the improved prompt text, nothing else
- Keep the same overall structure and format
- Do not add markdown code blocks around the output
- The improved prompt should be in Japanese`;

  // 6. Claude で改善案を生成
  consola.start("Generating improved task extraction prompt...");
  const newPrompt = await runClaude(metaPrompt, {
    model: "sonnet",
    disableTools: true,
  });

  if (!newPrompt.trim()) {
    consola.error("Failed to generate improved prompt (empty response).");
    return;
  }

  if (options?.dryRun) {
    consola.box(`[Dry Run] Improved prompt for "${target}":\n\n${newPrompt}`);
    return;
  }

  // 7. ファイルに上書き
  writeFileSync(promptPath, newPrompt);
  consola.success(`Updated prompt file: ${promptPath}`);

  // 8. 履歴を記録
  db.insert(schema.promptImprovements)
    .values({
      target,
      previousPrompt: currentPrompt,
      newPrompt,
      feedbackCount: totalFeedbacks,
      goodCount: acceptedTasks.length,
      badCount: rejectedTasks.length,
      improvementReason: `Auto-improved based on ${totalFeedbacks} task feedbacks`,
    })
    .run();

  consola.success(`Recorded improvement history (${totalFeedbacks} feedbacks processed)`);
}
