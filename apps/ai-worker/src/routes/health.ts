import { Hono } from "hono";

export function createHealthRouter() {
  const router = new Hono();

  router.get("/", (c) => {
    const claudeAvailable = checkClaude();

    return c.json({
      status: "ok" as const,
      claude: claudeAvailable,
    });
  });

  return router;
}

function checkClaude(): boolean {
  try {
    const proc = Bun.spawnSync(["claude", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}
