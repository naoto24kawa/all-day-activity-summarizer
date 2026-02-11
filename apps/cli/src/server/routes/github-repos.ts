import { Hono } from "hono";
import { listRepositories } from "../../github/client.js";

export function createGitHubReposRouter() {
  const app = new Hono();

  // GET / - リポジトリ一覧取得
  app.get("/", async (c) => {
    try {
      const repos = await listRepositories();
      return c.json(repos);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return c.json({ error: "Failed to list repositories", message }, 500);
    }
  });

  return app;
}
