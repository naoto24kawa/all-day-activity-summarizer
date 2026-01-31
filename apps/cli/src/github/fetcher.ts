/**
 * GitHub Data Fetcher
 *
 * Handles fetching and storing GitHub issues, PRs, and comments
 */

import type { AdasDatabase, GitHubQueueJob, NewGitHubComment, NewGitHubItem } from "@repo/db";
import { schema } from "@repo/db";
import consola from "consola";
import { and, eq, isNotNull } from "drizzle-orm";
import type { GitHubItemData, GitHubPRData } from "./client.js";
import { getAssignedIssues, getAssignedPRs, getReviewRequestedPRs } from "./client.js";

/**
 * Convert ISO8601 timestamp to JST Date string (YYYY-MM-DD)
 */
function toJstDateString(isoString: string): string {
  const utcMs = new Date(isoString).getTime();
  // JST = UTC + 9 hours
  const jstDate = new Date(utcMs + 9 * 60 * 60 * 1000);
  const year = jstDate.getFullYear();
  const month = String(jstDate.getMonth() + 1).padStart(2, "0");
  const day = String(jstDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Find projectId by repoOwner/repoName match
 */
function findProjectIdByRepo(db: AdasDatabase, repoOwner: string, repoName: string): number | null {
  const project = db
    .select()
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.githubOwner, repoOwner),
        eq(schema.projects.githubRepo, repoName),
        isNotNull(schema.projects.githubOwner),
        isNotNull(schema.projects.githubRepo),
      ),
    )
    .get();
  return project?.id ?? null;
}

/**
 * Upsert a GitHub item (issue or PR)
 */
function upsertGitHubItem(db: AdasDatabase, item: NewGitHubItem): boolean {
  // Check if already exists
  const existing = db
    .select()
    .from(schema.githubItems)
    .where(
      and(
        eq(schema.githubItems.repoOwner, item.repoOwner),
        eq(schema.githubItems.repoName, item.repoName),
        eq(schema.githubItems.number, item.number),
      ),
    )
    .get();

  if (existing) {
    // Update existing
    db.update(schema.githubItems)
      .set({
        ...item,
        isRead: existing.isRead, // Preserve read status
        syncedAt: new Date().toISOString(),
      })
      .where(eq(schema.githubItems.id, existing.id))
      .run();
    return false; // Not a new insert
  }

  try {
    db.insert(schema.githubItems).values(item).run();
    return true;
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      return false;
    }
    throw error;
  }
}

/**
 * Upsert a GitHub comment
 */
function upsertGitHubComment(db: AdasDatabase, comment: NewGitHubComment): boolean {
  // Check if already exists
  const existing = db
    .select()
    .from(schema.githubComments)
    .where(
      and(
        eq(schema.githubComments.repoOwner, comment.repoOwner),
        eq(schema.githubComments.repoName, comment.repoName),
        eq(schema.githubComments.commentId, comment.commentId),
      ),
    )
    .get();

  if (existing) {
    // Update existing
    db.update(schema.githubComments)
      .set({
        ...comment,
        isRead: existing.isRead, // Preserve read status
        syncedAt: new Date().toISOString(),
      })
      .where(eq(schema.githubComments.id, existing.id))
      .run();
    return false;
  }

  try {
    db.insert(schema.githubComments).values(comment).run();
    return true;
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      return false;
    }
    throw error;
  }
}

/**
 * Process issue data and store to DB
 */
function processIssue(
  db: AdasDatabase,
  issue: GitHubItemData,
): { items: number; comments: number } {
  let itemsStored = 0;
  let commentsStored = 0;

  const repoOwner = issue.repository.owner.login;
  const repoName = issue.repository.name;
  const projectId = findProjectIdByRepo(db, repoOwner, repoName);

  // Store the issue
  const dateStr = toJstDateString(issue.updatedAt);
  const inserted = upsertGitHubItem(db, {
    date: dateStr,
    itemType: "issue",
    repoOwner,
    repoName,
    number: issue.number,
    title: issue.title,
    state: issue.state.toLowerCase(),
    url: issue.url,
    authorLogin: issue.author?.login ?? null,
    assigneeLogin: issue.assignees.nodes[0]?.login ?? null,
    labels: JSON.stringify(issue.labels.nodes.map((l) => l.name)),
    body: issue.body,
    githubCreatedAt: issue.createdAt,
    githubUpdatedAt: issue.updatedAt,
    closedAt: issue.closedAt,
    commentCount: issue.comments.totalCount,
    projectId,
  });

  if (inserted) {
    itemsStored++;
  }

  // Store comments
  for (const comment of issue.comments.nodes) {
    const commentDateStr = toJstDateString(comment.createdAt);
    const commentInserted = upsertGitHubComment(db, {
      date: commentDateStr,
      commentType: "issue_comment",
      repoOwner,
      repoName,
      itemNumber: issue.number,
      commentId: comment.id,
      authorLogin: comment.author?.login ?? null,
      body: comment.body,
      url: comment.url,
      githubCreatedAt: comment.createdAt,
    });

    if (commentInserted) {
      commentsStored++;
    }
  }

  return { items: itemsStored, comments: commentsStored };
}

/**
 * Process PR data and store to DB
 */
function processPR(
  db: AdasDatabase,
  pr: GitHubPRData,
  isReviewRequested = false,
): { items: number; comments: number } {
  let itemsStored = 0;
  let commentsStored = 0;

  const repoOwner = pr.repository.owner.login;
  const repoName = pr.repository.name;
  const projectId = findProjectIdByRepo(db, repoOwner, repoName);

  // Determine state
  let state = pr.state.toLowerCase();
  if (pr.mergedAt) {
    state = "merged";
  }

  // Store the PR
  const dateStr = toJstDateString(pr.updatedAt);
  const inserted = upsertGitHubItem(db, {
    date: dateStr,
    itemType: "pull_request",
    repoOwner,
    repoName,
    number: pr.number,
    title: pr.title,
    state,
    url: pr.url,
    authorLogin: pr.author?.login ?? null,
    assigneeLogin: pr.assignees.nodes[0]?.login ?? null,
    labels: JSON.stringify(pr.labels.nodes.map((l) => l.name)),
    body: pr.body,
    githubCreatedAt: pr.createdAt,
    githubUpdatedAt: pr.updatedAt,
    closedAt: pr.closedAt,
    mergedAt: pr.mergedAt,
    isDraft: pr.isDraft,
    reviewDecision: pr.reviewDecision,
    isReviewRequested,
    commentCount: pr.comments.totalCount,
    projectId,
  });

  if (inserted) {
    itemsStored++;
  }

  // Store comments
  for (const comment of pr.comments.nodes) {
    const commentDateStr = toJstDateString(comment.createdAt);
    const commentInserted = upsertGitHubComment(db, {
      date: commentDateStr,
      commentType: "issue_comment",
      repoOwner,
      repoName,
      itemNumber: pr.number,
      commentId: comment.id,
      authorLogin: comment.author?.login ?? null,
      body: comment.body,
      url: comment.url,
      githubCreatedAt: comment.createdAt,
    });

    if (commentInserted) {
      commentsStored++;
    }
  }

  // Store reviews
  for (const review of pr.reviews.nodes) {
    const reviewDateStr = toJstDateString(review.submittedAt);
    const reviewInserted = upsertGitHubComment(db, {
      date: reviewDateStr,
      commentType: "review",
      repoOwner,
      repoName,
      itemNumber: pr.number,
      commentId: review.id,
      authorLogin: review.author?.login ?? null,
      body: review.body || "",
      url: review.url,
      reviewState: review.state,
      githubCreatedAt: review.submittedAt,
    });

    if (reviewInserted) {
      commentsStored++;
    }
  }

  return { items: itemsStored, comments: commentsStored };
}

/**
 * Fetch and store assigned issues
 */
export async function fetchAssignedIssues(
  db: AdasDatabase,
): Promise<{ fetched: number; itemsStored: number; commentsStored: number }> {
  try {
    const issues = await getAssignedIssues();

    let itemsStored = 0;
    let commentsStored = 0;

    for (const issue of issues) {
      const result = processIssue(db, issue);
      itemsStored += result.items;
      commentsStored += result.comments;
    }

    consola.debug(
      `[GitHub] Issues: fetched ${issues.length}, stored ${itemsStored} items, ${commentsStored} comments`,
    );

    return { fetched: issues.length, itemsStored, commentsStored };
  } catch (error) {
    consola.error("[GitHub] Failed to fetch assigned issues:", error);
    throw error;
  }
}

/**
 * Fetch and store assigned PRs
 */
export async function fetchAssignedPRs(
  db: AdasDatabase,
): Promise<{ fetched: number; itemsStored: number; commentsStored: number }> {
  try {
    const prs = await getAssignedPRs();

    let itemsStored = 0;
    let commentsStored = 0;

    for (const pr of prs) {
      const result = processPR(db, pr, false);
      itemsStored += result.items;
      commentsStored += result.comments;
    }

    consola.debug(
      `[GitHub] PRs: fetched ${prs.length}, stored ${itemsStored} items, ${commentsStored} comments`,
    );

    return { fetched: prs.length, itemsStored, commentsStored };
  } catch (error) {
    consola.error("[GitHub] Failed to fetch assigned PRs:", error);
    throw error;
  }
}

/**
 * Fetch and store review-requested PRs
 */
export async function fetchReviewRequestedPRs(
  db: AdasDatabase,
): Promise<{ fetched: number; itemsStored: number; commentsStored: number }> {
  try {
    const prs = await getReviewRequestedPRs();

    let itemsStored = 0;
    let commentsStored = 0;

    for (const pr of prs) {
      const result = processPR(db, pr, true);
      itemsStored += result.items;
      commentsStored += result.comments;
    }

    consola.debug(
      `[GitHub] Review requests: fetched ${prs.length}, stored ${itemsStored} items, ${commentsStored} comments`,
    );

    return { fetched: prs.length, itemsStored, commentsStored };
  } catch (error) {
    consola.error("[GitHub] Failed to fetch review requested PRs:", error);
    throw error;
  }
}

/**
 * Process a GitHub job
 */
export async function processGitHubJob(db: AdasDatabase, job: GitHubQueueJob): Promise<void> {
  switch (job.jobType) {
    case "fetch_issues":
      await fetchAssignedIssues(db);
      break;

    case "fetch_prs":
      await fetchAssignedPRs(db);
      break;

    case "fetch_review_requests":
      await fetchReviewRequestedPRs(db);
      break;

    default:
      throw new Error(`Unknown job type: ${job.jobType}`);
  }
}
