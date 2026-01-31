import { spawn } from "node:child_process";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

interface ChatSession {
  summary: string;
  lastUserMessage: string;
  lastAssistantMessage: string;
}

// メモリ内セッション管理
const sessions = new Map<string, ChatSession>();

// セッションのTTL (30分)
const SESSION_TTL = 30 * 60 * 1000;

// 古いセッションをクリーンアップ
const sessionTimestamps = new Map<string, number>();
function cleanupOldSessions() {
  const now = Date.now();
  for (const [id, timestamp] of sessionTimestamps) {
    if (now - timestamp > SESSION_TTL) {
      sessions.delete(id);
      sessionTimestamps.delete(id);
    }
  }
}

// claude -p を実行してテキスト結果を返す
async function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ["-p", prompt, "--no-session-persistence", "--allowedTools", "Read,Glob,Grep"];

    const proc = spawn("claude", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}`));
        return;
      }
      resolve(stdout.trim());
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

// 要約を更新
async function updateSummary(
  sessionId: string,
  currentSummary: string,
  userMessage: string,
  assistantMessage: string,
): Promise<void> {
  try {
    const summarizePrompt = `以下の会話を簡潔に要約してください。重要な情報、決定事項、文脈を保持してください。

${currentSummary ? `[これまでの要約]\n${currentSummary}\n\n` : ""}[今回のやり取り]
User: ${userMessage}
Assistant: ${assistantMessage}

要約 (200文字以内):`;

    const newSummary = await runClaude(summarizePrompt);

    const session = sessions.get(sessionId);
    if (session) {
      session.summary = newSummary;
      session.lastUserMessage = userMessage;
      session.lastAssistantMessage = assistantMessage;
    }
  } catch (error) {
    console.error("[claude-chat] Failed to update summary:", error);
  }
}

export function createClaudeChatRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    const body = await c.req.json<{ prompt: string; sessionId?: string }>();
    const { prompt, sessionId = "default" } = body;

    if (!prompt || typeof prompt !== "string") {
      return c.json({ error: "prompt is required" }, 400);
    }

    // 古いセッションをクリーンアップ
    cleanupOldSessions();

    // セッション取得または作成
    let session = sessions.get(sessionId);
    if (!session) {
      session = { summary: "", lastUserMessage: "", lastAssistantMessage: "" };
      sessions.set(sessionId, session);
    }
    sessionTimestamps.set(sessionId, Date.now());

    // コンテキスト付きプロンプトを構築
    let contextPrompt = prompt;
    if (session.summary) {
      contextPrompt = `[これまでの会話の要約]
${session.summary}

[新しい質問]
${prompt}`;
    }

    return streamSSE(c, async (stream) => {
      const args = [
        "-p",
        contextPrompt,
        "--no-session-persistence",
        "--allowedTools",
        "Read,Glob,Grep",
        "--output-format",
        "stream-json",
        "--verbose",
      ];

      const proc = spawn("claude", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      let buffer = "";
      let fullResponse = "";

      proc.stdout.on("data", async (chunk: Buffer) => {
        buffer += chunk.toString();

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const event = JSON.parse(line);

            if (event.type === "assistant" && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === "text" && block.text) {
                  fullResponse = block.text;
                  await stream.writeSSE({
                    event: "text",
                    data: JSON.stringify({ text: block.text }),
                  });
                } else if (block.type === "tool_use") {
                  await stream.writeSSE({
                    event: "tool_use",
                    data: JSON.stringify({ tool: block.name }),
                  });
                }
              }
            } else if (event.type === "result") {
              fullResponse = event.result || fullResponse;
              await stream.writeSSE({
                event: "done",
                data: JSON.stringify({ result: event.result }),
              });
            }
          } catch {
            // JSON パースエラーは無視
          }
        }
      });

      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        console.error("[claude-chat] stderr:", text.slice(0, 200));
      });

      await new Promise<void>((resolve, reject) => {
        proc.on("close", async (code) => {
          // 残りのバッファを処理
          if (buffer.trim()) {
            try {
              const event = JSON.parse(buffer);
              if (event.type === "result") {
                fullResponse = event.result || fullResponse;
                await stream.writeSSE({
                  event: "done",
                  data: JSON.stringify({ result: event.result }),
                });
              }
            } catch {
              // 無視
            }
          }

          if (code !== 0) {
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify({ error: `claude exited with code ${code}` }),
            });
          } else if (fullResponse) {
            // 非同期で要約を更新
            updateSummary(sessionId, session.summary, prompt, fullResponse);
          }
          resolve();
        });

        proc.on("error", async (err) => {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({ error: err.message }),
          });
          reject(err);
        });
      });
    });
  });

  // セッションをクリア
  router.delete("/:sessionId", (c) => {
    const sessionId = c.req.param("sessionId");
    sessions.delete(sessionId);
    sessionTimestamps.delete(sessionId);
    return c.json({ success: true });
  });

  return router;
}
