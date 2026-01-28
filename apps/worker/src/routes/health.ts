import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

export function createHealthRouter() {
  const router = new Hono();

  router.get("/", (c) => {
    const whisperxAvailable = checkWhisperX();
    const claudeAvailable = checkClaude();

    return c.json({
      status: "ok" as const,
      whisperx: whisperxAvailable,
      claude: claudeAvailable,
    });
  });

  return router;
}

function checkWhisperX(): boolean {
  const venvPython = join(homedir(), ".adas", "whisperx-venv", "bin", "python3");
  return existsSync(venvPython);
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
