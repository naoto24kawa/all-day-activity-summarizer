import { useCallback, useRef, useState } from "react";
import { ADAS_API_URL } from "@/lib/adas-api";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface UseClaudeChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  currentResponse: string;
  sendMessage: (prompt: string) => Promise<void>;
  clearMessages: () => void;
}

// セッションID生成
function generateSessionId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function useClaudeChat(): UseClaudeChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentResponse, setCurrentResponse] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>(generateSessionId());

  const sendMessage = useCallback(
    async (prompt: string) => {
      if (isStreaming || !prompt.trim()) return;

      // ユーザーメッセージを追加
      const newUserMessage: ChatMessage = { role: "user", content: prompt };
      setMessages((prev) => [...prev, newUserMessage]);
      setIsStreaming(true);
      setCurrentResponse("..."); // ローディング表示

      // 前のリクエストがあればキャンセル
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();

      try {
        const response = await fetch(`${ADAS_API_URL}/api/claude-chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, sessionId: sessionIdRef.current }),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Response body is not readable");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let fullResponse = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // SSE イベントをパース
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";

          for (const eventStr of events) {
            if (!eventStr.trim()) continue;

            const lines = eventStr.split("\n");
            let eventType = "";
            let data = "";

            for (const line of lines) {
              if (line.startsWith("event:")) {
                eventType = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                data = line.slice(5).trim();
              }
            }

            if (!eventType || !data) continue;

            try {
              const parsed = JSON.parse(data);

              switch (eventType) {
                case "text":
                  fullResponse = parsed.text; // claude -p は一括で返すので置き換え
                  setCurrentResponse(fullResponse);
                  break;
                case "tool_use":
                  // ツール使用中の表示
                  setCurrentResponse(`${fullResponse || "..."}\n\n_${parsed.tool} を実行中..._`);
                  break;
                case "done":
                  // 完了
                  break;
                case "error":
                  throw new Error(parsed.error);
              }
            } catch {
              // パースエラーは無視
            }
          }
        }

        // アシスタントメッセージを追加
        if (fullResponse) {
          setMessages((prev) => [...prev, { role: "assistant", content: fullResponse }]);
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }
        const errorMessage = error instanceof Error ? error.message : "An error occurred";
        setMessages((prev) => [...prev, { role: "assistant", content: `Error: ${errorMessage}` }]);
      } finally {
        setIsStreaming(false);
        setCurrentResponse("");
      }
    },
    [isStreaming],
  );

  const clearMessages = useCallback(() => {
    // バックエンドのセッションをクリア
    fetch(`${ADAS_API_URL}/api/claude-chat/${sessionIdRef.current}`, {
      method: "DELETE",
    }).catch(() => {
      // エラーは無視
    });

    // 新しいセッションID
    sessionIdRef.current = generateSessionId();

    setMessages([]);
    setCurrentResponse("");
    abortControllerRef.current?.abort();
  }, []);

  return {
    messages,
    isStreaming,
    currentResponse,
    sendMessage,
    clearMessages,
  };
}
