import { spawn } from "node:child_process";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

export function createClaudeChatRouter() {
  const router = new Hono();

  router.post("/", async (c) => {
    const body = await c.req.json<{ prompt: string }>();
    const { prompt } = body;

    if (!prompt || typeof prompt !== "string") {
      return c.json({ error: "prompt is required" }, 400);
    }

    return streamSSE(c, async (stream) => {
      const args = [
        "-p",
        prompt,
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

      proc.stdout.on("data", async (chunk: Buffer) => {
        buffer += chunk.toString();

        // 改行で分割して JSON Lines をパース
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const event = JSON.parse(line);

            if (event.type === "assistant" && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === "text" && block.text) {
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

  return router;
}
