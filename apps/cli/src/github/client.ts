/**
 * GitHub CLI Client
 *
 * Uses `gh` command for authentication and API access.
 * Requires `gh auth login` to be completed beforehand.
 */

import { spawn } from "node:child_process";
import consola from "consola";

// Rate limiting: GitHub API allows 5000 requests per hour for authenticated users
const RATE_LIMIT_DELAY_MS = 100;

/**
 * GitHub Issue/PR common fields
 */
export interface GitHubItemData {
  number: number;
  title: string;
  state: string;
  url: string;
  author: { login: string } | null;
  assignees: { nodes: Array<{ login: string }> };
  labels: { nodes: Array<{ name: string }> };
  body: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  repository: {
    owner: { login: string };
    name: string;
  };
  comments: {
    totalCount: number;
    nodes: Array<{
      id: string;
      author: { login: string } | null;
      body: string;
      url: string;
      createdAt: string;
    }>;
  };
}

/**
 * GitHub PR specific fields
 */
export interface GitHubPRData extends GitHubItemData {
  isDraft: boolean;
  mergedAt: string | null;
  reviewDecision: string | null;
  reviews: {
    nodes: Array<{
      id: string;
      author: { login: string } | null;
      body: string;
      state: string;
      url: string;
      submittedAt: string;
    }>;
  };
  reviewRequests: {
    nodes: Array<{
      requestedReviewer: { login: string } | null;
    }>;
  };
}

/**
 * Execute gh command and return JSON output
 */
async function execGh<T>(args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const proc = spawn("gh", args, { shell: false });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`gh command failed (exit ${code}): ${stderr}`));
        return;
      }
      try {
        const result = JSON.parse(stdout) as T;
        resolve(result);
      } catch (_err) {
        reject(new Error(`Failed to parse gh output: ${stdout}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn gh: ${err.message}`));
    });
  });
}

/**
 * Rate-limited gh execution
 */
let lastRequestTime = 0;
async function rateLimitedExecGh<T>(args: string[]): Promise<T> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;

  if (elapsed < RATE_LIMIT_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS - elapsed));
  }

  lastRequestTime = Date.now();
  return execGh<T>(args);
}

/**
 * Check if gh is authenticated
 */
export async function checkAuth(): Promise<{ authenticated: boolean; username?: string }> {
  try {
    const result = await execGh<{ login: string }>(["api", "user", "--jq", ".login"]);
    // gh api user --jq .login returns just the username string
    const username = typeof result === "string" ? (result as string).trim() : result.login;
    return { authenticated: true, username };
  } catch {
    // Try alternative method
    try {
      const proc = spawn("gh", ["auth", "status"], { shell: false });
      return new Promise((resolve) => {
        let stdout = "";
        proc.stdout.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
        proc.on("close", (code) => {
          if (code === 0) {
            const match = stdout.match(/Logged in to .+ as (\S+)/);
            resolve({
              authenticated: true,
              username: match?.[1],
            });
          } else {
            resolve({ authenticated: false });
          }
        });
        proc.on("error", () => resolve({ authenticated: false }));
      });
    } catch {
      return { authenticated: false };
    }
  }
}

/**
 * Get current username
 */
export async function getCurrentUser(): Promise<string | null> {
  try {
    const result = await execGh<string>(["api", "user", "--jq", ".login"]);
    return typeof result === "string" ? result.trim() : null;
  } catch (err) {
    consola.warn("Failed to get current user:", err);
    return null;
  }
}

/**
 * Get issues assigned to the current user
 */
export async function getAssignedIssues(): Promise<GitHubItemData[]> {
  const query = `
    query {
      search(query: "is:issue is:open assignee:@me", type: ISSUE, first: 50) {
        nodes {
          ... on Issue {
            number
            title
            state
            url
            author { login }
            assignees(first: 5) { nodes { login } }
            labels(first: 10) { nodes { name } }
            body
            createdAt
            updatedAt
            closedAt
            repository {
              owner { login }
              name
            }
            comments(first: 20) {
              totalCount
              nodes {
                id
                author { login }
                body
                url
                createdAt
              }
            }
          }
        }
      }
    }
  `;

  try {
    const result = await rateLimitedExecGh<{
      data: { search: { nodes: GitHubItemData[] } };
    }>(["api", "graphql", "-f", `query=${query}`]);

    return result.data.search.nodes;
  } catch (err) {
    consola.error("Failed to fetch assigned issues:", err);
    throw err;
  }
}

/**
 * Get PRs assigned to the current user (as assignee)
 */
export async function getAssignedPRs(): Promise<GitHubPRData[]> {
  const query = `
    query {
      search(query: "is:pr is:open assignee:@me", type: ISSUE, first: 50) {
        nodes {
          ... on PullRequest {
            number
            title
            state
            url
            isDraft
            author { login }
            assignees(first: 5) { nodes { login } }
            labels(first: 10) { nodes { name } }
            body
            createdAt
            updatedAt
            closedAt
            mergedAt
            reviewDecision
            repository {
              owner { login }
              name
            }
            comments(first: 20) {
              totalCount
              nodes {
                id
                author { login }
                body
                url
                createdAt
              }
            }
            reviews(first: 20) {
              nodes {
                id
                author { login }
                body
                state
                url
                submittedAt
              }
            }
            reviewRequests(first: 10) {
              nodes {
                requestedReviewer {
                  ... on User { login }
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const result = await rateLimitedExecGh<{
      data: { search: { nodes: GitHubPRData[] } };
    }>(["api", "graphql", "-f", `query=${query}`]);

    return result.data.search.nodes;
  } catch (err) {
    consola.error("Failed to fetch assigned PRs:", err);
    throw err;
  }
}

/**
 * Get PRs where review is requested from the current user
 */
export async function getReviewRequestedPRs(): Promise<GitHubPRData[]> {
  const query = `
    query {
      search(query: "is:pr is:open review-requested:@me", type: ISSUE, first: 50) {
        nodes {
          ... on PullRequest {
            number
            title
            state
            url
            isDraft
            author { login }
            assignees(first: 5) { nodes { login } }
            labels(first: 10) { nodes { name } }
            body
            createdAt
            updatedAt
            closedAt
            mergedAt
            reviewDecision
            repository {
              owner { login }
              name
            }
            comments(first: 20) {
              totalCount
              nodes {
                id
                author { login }
                body
                url
                createdAt
              }
            }
            reviews(first: 20) {
              nodes {
                id
                author { login }
                body
                state
                url
                submittedAt
              }
            }
            reviewRequests(first: 10) {
              nodes {
                requestedReviewer {
                  ... on User { login }
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const result = await rateLimitedExecGh<{
      data: { search: { nodes: GitHubPRData[] } };
    }>(["api", "graphql", "-f", `query=${query}`]);

    return result.data.search.nodes;
  } catch (err) {
    consola.error("Failed to fetch review requested PRs:", err);
    throw err;
  }
}

/**
 * Item state response
 */
export interface GitHubItemState {
  state: "open" | "closed" | "merged";
  closedAt: string | null;
  mergedAt: string | null;
}

/**
 * Get specific Issue/PR state by owner/repo/number
 */
export async function getItemState(
  owner: string,
  repo: string,
  number: number,
): Promise<GitHubItemState | null> {
  // まず PR として取得を試みる
  const prQuery = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          state
          closedAt
          mergedAt
        }
      }
    }
  `;

  try {
    const prResult = await rateLimitedExecGh<{
      data: {
        repository: {
          pullRequest: {
            state: string;
            closedAt: string | null;
            mergedAt: string | null;
          } | null;
        };
      };
    }>([
      "api",
      "graphql",
      "-f",
      `query=${prQuery}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `repo=${repo}`,
      "-F",
      `number=${number}`,
    ]);

    const pr = prResult.data.repository.pullRequest;
    if (pr) {
      return {
        state: pr.mergedAt ? "merged" : (pr.state.toLowerCase() as "open" | "closed"),
        closedAt: pr.closedAt,
        mergedAt: pr.mergedAt,
      };
    }
  } catch {
    // PR ではない場合、Issue として取得を試みる
  }

  // Issue として取得
  const issueQuery = `
    query($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          state
          closedAt
        }
      }
    }
  `;

  try {
    const issueResult = await rateLimitedExecGh<{
      data: {
        repository: {
          issue: {
            state: string;
            closedAt: string | null;
          } | null;
        };
      };
    }>([
      "api",
      "graphql",
      "-f",
      `query=${issueQuery}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `repo=${repo}`,
      "-F",
      `number=${number}`,
    ]);

    const issue = issueResult.data.repository.issue;
    if (issue) {
      return {
        state: issue.state.toLowerCase() as "open" | "closed",
        closedAt: issue.closedAt,
        mergedAt: null,
      };
    }
  } catch (err) {
    consola.warn(`Failed to fetch item state for ${owner}/${repo}#${number}:`, err);
  }

  return null;
}
