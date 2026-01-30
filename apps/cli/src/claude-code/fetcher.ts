/**
 * Claude Code Session Fetcher
 *
 * Handles fetching and storing sessions from Claude Code MCP server
 */

import { basename } from "node:path";
import type {
  AdasDatabase,
  ClaudeCodeQueueJob,
  NewClaudeCodeMessage,
  NewClaudeCodeSession,
} from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { eq } from "drizzle-orm";
import type { AdasConfig } from "../config.js";
import { getTodayDateString } from "../utils/date.js";
import type { ClaudeCodeClient } from "./client.js";
import { extractAndSaveLearnings } from "./extractor.js";

/**
 * Extract date string from ISO8601 timestamp
 */
function extractDateString(timestamp: string | null): string {
  if (!timestamp) {
    return getTodayDateString();
  }
  const datePart = timestamp.split("T")[0];
  return datePart ?? getTodayDateString();
}

/**
 * Get the first user message as summary
 */
function extractSummary(messages: Array<{ role: string; text: string }>): string | null {
  // Find first non-empty user message
  const firstUserMessage = messages.find(
    (m) => m.role === "user" && m.text && m.text.trim().length > 0,
  );
  if (!firstUserMessage) {
    return null;
  }
  // Truncate to 200 chars
  const text = firstUserMessage.text;
  if (text.length > 200) {
    return `${text.slice(0, 197)}...`;
  }
  return text;
}

/**
 * Save messages for a session
 * Deletes existing messages and inserts new ones
 */
function saveMessages(
  db: AdasDatabase,
  sessionId: string,
  date: string,
  messages: Array<{ role: string; text: string; timestamp?: string }>,
): void {
  // Delete existing messages for this session
  db.delete(schema.claudeCodeMessages)
    .where(eq(schema.claudeCodeMessages.sessionId, sessionId))
    .run();

  // Insert new messages
  for (const msg of messages) {
    if (msg.role !== "user" && msg.role !== "assistant") {
      continue;
    }
    const newMessage: NewClaudeCodeMessage = {
      sessionId,
      date,
      role: msg.role,
      content: msg.text,
      timestamp: msg.timestamp ?? null,
    };
    db.insert(schema.claudeCodeMessages).values(newMessage).run();
  }
}

/**
 * Insert or update session
 */
function upsertSession(db: AdasDatabase, session: NewClaudeCodeSession): boolean {
  // Check if already exists
  const existing = db
    .select()
    .from(schema.claudeCodeSessions)
    .where(eq(schema.claudeCodeSessions.sessionId, session.sessionId))
    .get();

  if (existing) {
    // Update if changed
    db.update(schema.claudeCodeSessions)
      .set({
        startTime: session.startTime,
        endTime: session.endTime,
        userMessageCount: session.userMessageCount,
        assistantMessageCount: session.assistantMessageCount,
        toolUseCount: session.toolUseCount,
        summary: session.summary,
      })
      .where(eq(schema.claudeCodeSessions.sessionId, session.sessionId))
      .run();
    return false; // Updated, not inserted
  }

  try {
    db.insert(schema.claudeCodeSessions).values(session).run();
    return true;
  } catch (error) {
    // Unique constraint violation - already exists
    if (String(error).includes("UNIQUE constraint failed")) {
      return false;
    }
    throw error;
  }
}

/**
 * Fetch sessions for a specific project
 */
export async function fetchProjectSessions(
  db: AdasDatabase,
  client: ClaudeCodeClient,
  projectPath: string,
  config?: AdasConfig,
): Promise<{ fetched: number; stored: number; learnings: number }> {
  let fetched = 0;
  let stored = 0;
  let totalLearnings = 0;

  const projectName = basename(projectPath);
  const sessions = await client.listSessions(projectPath);

  for (const sessionInfo of sessions) {
    try {
      const detail = await client.getSessionDetail(projectPath, sessionInfo.id);
      fetched++;

      const date = extractDateString(detail.summary.startTime);
      const summary = extractSummary(detail.messages);

      const inserted = upsertSession(db, {
        date,
        sessionId: sessionInfo.id,
        projectPath,
        projectName,
        startTime: detail.summary.startTime,
        endTime: detail.summary.endTime,
        userMessageCount: detail.summary.userMessageCount,
        assistantMessageCount: detail.summary.assistantMessageCount,
        toolUseCount: detail.summary.toolUseCount,
        summary,
      });

      // Save messages for this session
      saveMessages(db, sessionInfo.id, date, detail.messages);

      // Extract learnings from messages (if config is provided)
      if (config) {
        const savedMessages = db
          .select()
          .from(schema.claudeCodeMessages)
          .where(eq(schema.claudeCodeMessages.sessionId, sessionInfo.id))
          .all();

        const learningResult = await extractAndSaveLearnings(
          db,
          config,
          sessionInfo.id,
          date,
          savedMessages,
          projectName,
          undefined, // userProfile
          projectPath, // projectPath for project linking
        );
        totalLearnings += learningResult.saved;
      }

      if (inserted) {
        stored++;
      }
    } catch (error) {
      consola.error(`[ClaudeCode] Failed to fetch session ${sessionInfo.id}:`, error);
    }
  }

  return { fetched, stored, learnings: totalLearnings };
}

/**
 * Fetch sessions from all projects
 */
export async function fetchAllSessions(
  db: AdasDatabase,
  client: ClaudeCodeClient,
  filterProjects?: string[],
  config?: AdasConfig,
): Promise<{ fetched: number; stored: number; learnings: number }> {
  let totalFetched = 0;
  let totalStored = 0;
  let totalLearnings = 0;

  const projects = await client.listProjects();

  for (const project of projects) {
    // Apply filter if specified
    if (filterProjects && filterProjects.length > 0) {
      if (!filterProjects.some((p) => project.path.includes(p))) {
        continue;
      }
    }

    try {
      const result = await fetchProjectSessions(db, client, project.path, config);
      totalFetched += result.fetched;
      totalStored += result.stored;
      totalLearnings += result.learnings;
      consola.debug(
        `[ClaudeCode] Project ${project.path}: fetched ${result.fetched}, stored ${result.stored}, learnings ${result.learnings}`,
      );
    } catch (error) {
      consola.error(`[ClaudeCode] Failed to fetch project ${project.path}:`, error);
    }
  }

  return { fetched: totalFetched, stored: totalStored, learnings: totalLearnings };
}

/**
 * Process a Claude Code job
 */
export async function processClaudeCodeJob(
  db: AdasDatabase,
  client: ClaudeCodeClient,
  job: ClaudeCodeQueueJob,
  filterProjects?: string[],
  config?: AdasConfig,
): Promise<void> {
  switch (job.jobType) {
    case "fetch_sessions": {
      if (job.projectPath) {
        // Fetch specific project
        await fetchProjectSessions(db, client, job.projectPath, config);
      } else {
        // Fetch all projects
        await fetchAllSessions(db, client, filterProjects, config);
      }
      break;
    }
    default:
      throw new Error(`Unknown job type: ${job.jobType}`);
  }
}
