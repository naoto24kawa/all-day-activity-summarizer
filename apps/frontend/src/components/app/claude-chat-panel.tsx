import {
  ChevronDown,
  GripVertical,
  MessageSquare,
  Mic,
  PanelRight,
  PanelRightClose,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { useClaudeChat } from "@/hooks/use-claude-chat";

type ChatMode = "floating" | "sidebar";

const DEFAULT_SIZE = { width: 420, height: 550 };
const MIN_SIZE = { width: 320, height: 420 };
export const CLAUDE_CHAT_SIDEBAR_WIDTH = 450;

/** アイコンの高さ + 余白 */
const ICON_HEIGHT = 56 + 8; // h-14 + gap

const STORAGE_KEY_OPEN = "adas-chat-panel-open";
const STORAGE_KEY_SIZE = "adas-chat-panel-size";

/** LocalStorage から開閉状態を読み込む */
function loadOpenState(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_OPEN);
    if (saved !== null) {
      return saved === "true";
    }
  } catch {
    // LocalStorage アクセスエラーは無視
  }
  return false; // デフォルト: 閉じている
}

/** LocalStorage からサイズを読み込む */
function loadSize(): { width: number; height: number } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_SIZE);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (
        typeof parsed.width === "number" &&
        typeof parsed.height === "number" &&
        parsed.width >= MIN_SIZE.width &&
        parsed.height >= MIN_SIZE.height
      ) {
        return parsed;
      }
    }
  } catch {
    // LocalStorage アクセスエラーは無視
  }
  return DEFAULT_SIZE;
}

/** LocalStorage に開閉状態を保存 */
function saveOpenState(isOpen: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY_OPEN, String(isOpen));
  } catch {
    // LocalStorage アクセスエラーは無視
  }
}

/** LocalStorage にサイズを保存 */
function saveSize(size: { width: number; height: number }): void {
  try {
    localStorage.setItem(STORAGE_KEY_SIZE, JSON.stringify(size));
  } catch {
    // LocalStorage アクセスエラーは無視
  }
}

interface ClaudeChatPanelProps {
  /** サイドバーモードで開始するか */
  initialSidebar?: boolean;
  onSidebarChange?: (isSidebar: boolean) => void;
  /** メモパネルが開いているか */
  memoOpen?: boolean;
  /** メモパネルの高さ */
  memoHeight?: number;
}

export function ClaudeChatPanel({
  initialSidebar = false,
  onSidebarChange,
  memoOpen = false,
  memoHeight = 500,
}: ClaudeChatPanelProps) {
  const { messages, isStreaming, currentResponse, sendMessage, clearMessages } = useClaudeChat();
  const [isOpen, setIsOpen] = useState(loadOpenState);
  const [mode, setMode] = useState<ChatMode>(initialSidebar ? "sidebar" : "floating");
  const [size, setSize] = useState(loadSize);

  // サイズ変更時に LocalStorage に保存
  useEffect(() => {
    saveSize(size);
  }, [size]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  const checkNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 100;
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  // メッセージ追加時のスクロール
  useEffect(() => {
    const totalMessages = messages.length + (currentResponse ? 1 : 0);
    if (totalMessages > prevCountRef.current && isNearBottomRef.current) {
      const el = scrollRef.current;
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    }
    prevCountRef.current = totalMessages;
  }, [messages.length, currentResponse]);

  // パネルを開いたときに最下部にスクロール & LocalStorage に保存
  useEffect(() => {
    saveOpenState(isOpen);
    if (isOpen && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [isOpen]);

  // リサイズ処理
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      resizeStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        width: size.width,
        height: size.height,
      };
    },
    [size],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const { x, y, width, height } = resizeStartRef.current;
      const newWidth = Math.max(MIN_SIZE.width, width + (x - e.clientX));
      const newHeight = Math.max(MIN_SIZE.height, height + (y - e.clientY));
      setSize({ width: newWidth, height: newHeight });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  const handleSend = async () => {
    const content = input.trim();
    if (!content || isStreaming) return;

    // 音声入力中の場合は停止
    if (listening && recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
      setListening(false);
    }

    setInput("");
    await sendMessage(content);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    // Cmd+Enter (Mac) / Ctrl+Enter (Windows) で送信
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  // 音声認識
  const toggleListening = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("このブラウザは音声認識に対応していません。");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "ja-JP";
    recognition.continuous = true;
    recognition.interimResults = true;

    const baseText = input;
    let committed = "";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let newFinal = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal) {
          newFinal += result[0]?.transcript ?? "";
        } else {
          interim += result?.[0]?.transcript ?? "";
        }
      }
      if (newFinal) committed += newFinal;
      setInput(baseText + committed + interim);
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognition.onerror = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  const toggleMode = () => {
    const newMode = mode === "floating" ? "sidebar" : "floating";
    setMode(newMode);
    onSidebarChange?.(newMode === "sidebar");
  };

  // 位置計算: メモの状態に基づいてオフセット
  const bottomOffset = memoOpen ? 16 + memoHeight + 8 : 16 + ICON_HEIGHT;

  // 閉じた状態のボタン
  if (!isOpen) {
    return (
      <div className="fixed right-4 z-50" style={{ bottom: bottomOffset }}>
        <Button
          onClick={() => setIsOpen(true)}
          className="h-14 w-14 rounded-full bg-violet-600 shadow-lg hover:bg-violet-700"
          size="icon"
          title="Claude Chat を開く"
        >
          <MessageSquare className="h-6 w-6" />
        </Button>
      </div>
    );
  }

  // サイドバーモード
  if (mode === "sidebar") {
    return (
      <div
        className="flex h-full shrink-0 flex-col border-l bg-background"
        style={{ width: CLAUDE_CHAT_SIDEBAR_WIDTH }}
      >
        {/* ヘッダー */}
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-violet-500" />
            <span className="font-semibold">Claude Chat</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={clearMessages}
              disabled={isStreaming || messages.length === 0}
              title="チャット履歴をクリア"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={toggleMode}
              title="フローティングモード"
            >
              <PanelRightClose className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => {
                setIsOpen(false);
                onSidebarChange?.(false);
              }}
              title="閉じる"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* メッセージエリア */}
        <div
          ref={scrollRef}
          onScroll={checkNearBottom}
          className="min-h-0 flex-1 overflow-y-auto p-3"
        >
          {messages.length === 0 && !currentResponse ? (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
              <MessageSquare className="mb-2 h-12 w-12 opacity-50" />
              <p className="text-sm">質問を入力してください</p>
              <p className="mt-1 text-xs opacity-75">(読み取り専用モード)</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* biome-ignore lint/suspicious/noArrayIndexKey: メッセージは追加のみで順序が固定 */}
              {messages.map((msg, index) => (
                <MessageBubble key={index} role={msg.role} content={msg.content} />
              ))}
              {currentResponse && (
                // biome-ignore lint/a11y/useValidAriaRole: role is a component prop, not ARIA role
                <MessageBubble role="assistant" content={currentResponse} isStreaming />
              )}
            </div>
          )}
        </div>

        {/* 入力エリア */}
        <div className="shrink-0 border-t p-3">
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="質問を入力... (Cmd+Enter で送信)"
              className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              rows={2}
              disabled={isStreaming}
            />
            <div className="flex flex-col justify-end gap-1">
              <Button
                size="icon"
                variant={listening ? "destructive" : "outline"}
                onClick={toggleListening}
                disabled={isStreaming}
                className={`h-8 w-8 ${listening ? "animate-pulse" : ""}`}
                title="音声入力"
              >
                <Mic className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                onClick={handleSend}
                disabled={isStreaming || !input.trim()}
                className="h-8 w-8 bg-violet-600 hover:bg-violet-700"
              >
                {isStreaming ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // フローティングモード
  return (
    <div
      className="fixed right-4 z-50 flex flex-col rounded-lg border bg-background shadow-2xl"
      style={{ width: size.width, height: size.height, bottom: bottomOffset }}
    >
      {/* リサイズハンドル */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="リサイズハンドル"
        aria-valuemin={320}
        aria-valuemax={800}
        aria-valuenow={size.width}
        onMouseDown={handleResizeStart}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            setSize((prev) => ({
              width: Math.max(320, prev.width - 10),
              height: Math.max(420, prev.height - 10),
            }));
          } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            setSize((prev) => ({
              width: Math.min(800, prev.width + 10),
              height: Math.min(900, prev.height + 10),
            }));
          }
        }}
        className="absolute -top-1 -left-1 z-10 flex h-6 w-6 cursor-nwse-resize items-center justify-center rounded-tl-lg bg-muted/50 opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary"
        title="ドラッグしてリサイズ"
      >
        <GripVertical className="h-3 w-3 rotate-45 text-muted-foreground" />
      </div>

      {/* ヘッダー */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-violet-500" />
          <span className="font-semibold">Claude Chat</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={clearMessages}
            disabled={isStreaming || messages.length === 0}
            title="チャット履歴をクリア"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={toggleMode}
            title="サイドバーモード"
          >
            <PanelRight className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={() => setIsOpen(false)}
            title="最小化"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* メッセージエリア */}
      <div
        ref={scrollRef}
        onScroll={checkNearBottom}
        className="min-h-0 flex-1 overflow-y-auto p-3"
      >
        {messages.length === 0 && !currentResponse ? (
          <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
            <MessageSquare className="mb-2 h-12 w-12 opacity-50" />
            <p className="text-sm">質問を入力してください</p>
            <p className="mt-1 text-xs opacity-75">(読み取り専用モード)</p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* biome-ignore lint/suspicious/noArrayIndexKey: メッセージは追加のみで順序が固定 */}
            {messages.map((msg, index) => (
              <MessageBubble key={index} role={msg.role} content={msg.content} />
            ))}
            {currentResponse && (
              // biome-ignore lint/a11y/useValidAriaRole: role is a component prop, not ARIA role
              <MessageBubble role="assistant" content={currentResponse} isStreaming />
            )}
          </div>
        )}
      </div>

      {/* 入力エリア */}
      <div className="shrink-0 border-t p-3">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="質問を入力... (Cmd+Enter で送信)"
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            rows={2}
            disabled={isStreaming}
          />
          <div className="flex flex-col justify-end gap-1">
            <Button
              size="icon"
              variant={listening ? "destructive" : "outline"}
              onClick={toggleListening}
              disabled={isStreaming}
              className={`h-8 w-8 ${listening ? "animate-pulse" : ""}`}
              title="音声入力"
            >
              <Mic className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
              className="h-8 w-8 bg-violet-600 hover:bg-violet-700"
            >
              {isStreaming ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

function MessageBubble({ role, content, isStreaming }: MessageBubbleProps) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser ? "bg-violet-600 text-white" : "border border-border bg-muted/50 text-foreground"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{content}</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{content}</ReactMarkdown>
            {isStreaming && <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-current" />}
          </div>
        )}
      </div>
    </div>
  );
}
