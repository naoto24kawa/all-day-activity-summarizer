import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

export function createHealthRouter() {
  const router = new Hono();

  router.get("/", (c) => {
    const whisperxAvailable = checkWhisperX();
    const kuromojiAvailable = checkKuromoji();

    return c.json({
      status: "ok" as const,
      whisperx: whisperxAvailable,
      kuromoji: kuromojiAvailable,
    });
  });

  return router;
}

function checkWhisperX(): boolean {
  const venvPython = join(homedir(), ".adas", "whisperx-venv", "bin", "python3");
  return existsSync(venvPython);
}

function checkKuromoji(): boolean {
  // kuromoji の辞書ディレクトリの存在をチェック
  const dictPath = "node_modules/kuromoji/dict";
  return existsSync(dictPath);
}
