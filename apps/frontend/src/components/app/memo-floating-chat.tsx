import type { MemoTag } from "@repo/types";
import { MEMO_TAGS } from "@repo/types";
import {
  Check,
  ChevronDown,
  GripVertical,
  ListTodo,
  Loader2,
  Mic,
  PanelRight,
  PanelRightClose,
  Pencil,
  RefreshCw,
  Send,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type MemoWithPending, useMemos } from "@/hooks/use-memos";
import { useTasks } from "@/hooks/use-tasks";
import { formatTimeJST } from "@/lib/date";

/** タグごとの色定義 */
const TAG_COLORS: Record<MemoTag, string> = {
  完了: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  重要: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  TODO: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  要確認: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  後で: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  アイデア: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  問題: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  メモ: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
};

interface TagSelectorProps {
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  disabled?: boolean;
}

function TagSelector({ selectedTags, onTagsChange, disabled }: TagSelectorProps) {
  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter((t) => t !== tag));
    } else {
      onTagsChange([...selectedTags, tag]);
    }
  };

  return (
    <div className="flex flex-wrap gap-1">
      {MEMO_TAGS.map((tag) => {
        const isSelected = selectedTags.includes(tag);
        const colorClass = TAG_COLORS[tag];
        return (
          <button
            key={tag}
            type="button"
            onClick={() => toggleTag(tag)}
            disabled={disabled}
            className={`rounded-full px-2 py-0.5 text-xs transition-all ${
              isSelected
                ? colorClass
                : "bg-gray-50 text-gray-400 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-500 dark:hover:bg-gray-700"
            } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}

/** タグを JSON 文字列からパース */
function parseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type MemoMode = "floating" | "sidebar";

const DEFAULT_SIZE = { width: 380, height: 500 };
const MIN_SIZE = { width: 300, height: 400 };
export const MEMO_SIDEBAR_WIDTH = 400;

interface MemoFloatingChatProps {
  date: string;
  /** サイドバーモードで開始するか */
  initialSidebar?: boolean;
  onSidebarChange?: (isSidebar: boolean) => void;
  /** パネルの開閉状態を通知 */
  onOpenChange?: (isOpen: boolean) => void;
  /** パネルの高さを通知 */
  onHeightChange?: (height: number) => void;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: PTT logic adds complexity, will refactor later
export function MemoFloatingChat({
  date,
  initialSidebar = false,
  onSidebarChange,
  onOpenChange,
  onHeightChange,
}: MemoFloatingChatProps) {
  const { memos, loading, error, postMemo, updateMemo, deleteMemo, refetch } = useMemos(date);
  const { extractMemoTasks } = useTasks();
  const [isOpen, setIsOpen] = useState(true);
  const [mode, setMode] = useState<MemoMode>(initialSidebar ? "sidebar" : "floating");
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [refreshing, setRefreshing] = useState(false);
  const [input, setInput] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sending, _setSending] = useState(false);
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

  useEffect(() => {
    if (memos.length > prevCountRef.current && isNearBottomRef.current) {
      const el = scrollRef.current;
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    }
    prevCountRef.current = memos.length;
  }, [memos.length]);

  // パネルを開いたときに最下部にスクロール
  useEffect(() => {
    if (isOpen && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [isOpen]);

  // 親に開閉状態を通知
  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  // 親に高さを通知
  useEffect(() => {
    onHeightChange?.(size.height);
  }, [size.height, onHeightChange]);

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
      // 左上からリサイズするので、マウスが左/上に動くとサイズが大きくなる
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

  const handleSend = (contentOverride?: string) => {
    const content = (contentOverride ?? input).trim();
    if (!content) return;

    // 音声入力中の場合は停止し、結果ハンドラを無効化
    if (listening && recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
    }

    // 入力をすぐにクリアして次の入力を受け付け可能に
    const tagsToSend = selectedTags.length > 0 ? [...selectedTags] : undefined;
    setInput("");
    setSelectedTags([]);

    // 送信はバックグラウンドで実行 (await しない)
    postMemo(content, tagsToSend).catch((err) => {
      console.error("メモ送信エラー:", err);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME変換中は送信しない
    if (e.nativeEvent.isComposing) return;
    // Cmd+Enter (Mac) / Ctrl+Enter (Windows) で送信
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  // 長押し判定用
  const LONG_PRESS_THRESHOLD = 300; // ms
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPttModeRef = useRef(false);
  const pttInputRef = useRef("");

  // 従来のトグル動作 (クリック用)
  const toggleListening = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);

      // 最後の結果を取得して即座に送信
      const content = pttInputRef.current.trim();
      if (content) {
        handleSend(content);
        pttInputRef.current = "";
      }
      return;
    }
    startRecognition(false);
  };

  // 音声認識を開始
  const startRecognition = (isPtt: boolean) => {
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
    pttInputRef.current = baseText;

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
      const newInput = baseText + committed + interim;
      setInput(newInput);
      // PTT用: 暫定テキストも含めて保存 (離した時に送信するため)
      pttInputRef.current = newInput;
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
    isPttModeRef.current = isPtt;
  };

  // マウス/タッチ開始
  const handleMicDown = () => {
    // 長押し判定タイマー開始
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      // 長押し: PTTモードで開始
      if (!listening) {
        startRecognition(true);
      }
    }, LONG_PRESS_THRESHOLD);
  };

  // マウス/タッチ終了
  const handleMicUp = () => {
    if (longPressTimerRef.current) {
      // タイマーがまだあれば短押し → トグル動作
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
      toggleListening();
      return;
    }

    // 長押しモードで録音中なら送信
    if (listening && isPttModeRef.current && recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
      setListening(false);
      isPttModeRef.current = false;

      // 最後の結果を取得して即座に送信
      const content = pttInputRef.current.trim();
      if (content) {
        handleSend(content);
        pttInputRef.current = "";
      }
    }
  };

  // マウスがボタンから離れた場合
  const handleMicLeave = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    // PTTモードで録音中なら送信
    if (listening && isPttModeRef.current) {
      handleMicUp();
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const toggleMode = () => {
    const newMode = mode === "floating" ? "sidebar" : "floating";
    setMode(newMode);
    onSidebarChange?.(newMode === "sidebar");
  };

  // 閉じた状態: クリックで開く、長押しでPTT
  const handleClosedButtonDown = () => {
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      if (!listening) {
        startRecognition(true);
      }
    }, LONG_PRESS_THRESHOLD);
  };

  const handleClosedButtonUp = () => {
    if (longPressTimerRef.current) {
      // 短押し → パネルを開く
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
      setIsOpen(true);
      return;
    }

    // 長押しモードで録音中なら送信
    if (listening && isPttModeRef.current && recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
      setListening(false);
      isPttModeRef.current = false;

      // 最後の結果を取得して即座に送信
      const content = pttInputRef.current.trim();
      if (content) {
        handleSend(content);
        pttInputRef.current = "";
      }
    }
  };

  const handleClosedButtonLeave = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (listening && isPttModeRef.current) {
      handleClosedButtonUp();
    }
  };

  // 閉じた状態のボタン
  if (!isOpen) {
    return (
      <div className="fixed right-4 bottom-4 z-50">
        <Button
          onMouseDown={handleClosedButtonDown}
          onMouseUp={handleClosedButtonUp}
          onMouseLeave={handleClosedButtonLeave}
          onTouchStart={handleClosedButtonDown}
          onTouchEnd={handleClosedButtonUp}
          className={`h-14 w-14 rounded-full shadow-lg ${listening ? "animate-pulse bg-destructive hover:bg-destructive/90" : ""}`}
          size="icon"
          title="クリック: 開く、長押し: 音声メモ"
        >
          {listening ? <Mic className="h-6 w-6" /> : <StickyNote className="h-6 w-6" />}
          {!listening && memos.length > 0 && (
            <Badge variant="destructive" className="absolute -top-1 -right-1 h-5 min-w-5 px-1.5">
              {memos.length}
            </Badge>
          )}
        </Button>
      </div>
    );
  }

  // サイドバーモード
  if (mode === "sidebar") {
    return (
      <div
        className="flex h-full shrink-0 flex-col border-l bg-background"
        style={{ width: MEMO_SIDEBAR_WIDTH }}
      >
        {/* ヘッダー */}
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <StickyNote className="h-5 w-5 text-yellow-500" />
            <span className="font-semibold">メモ</span>
            <Badge variant="secondary" className="ml-1">
              {memos.length}
            </Badge>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={handleRefresh}
              disabled={refreshing}
              title="更新"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
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
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-sm text-muted-foreground">{error}</p>
          ) : memos.length === 0 ? (
            <p className="text-sm text-muted-foreground">メモはまだありません。</p>
          ) : (
            <div className="space-y-3">
              {memos.map((memo) => (
                <MemoItem
                  key={memo.id}
                  memo={memo}
                  onUpdate={updateMemo}
                  onDelete={deleteMemo}
                  onCreateTask={extractMemoTasks}
                />
              ))}
            </div>
          )}
        </div>

        {/* 入力エリア */}
        <div className="shrink-0 space-y-2 border-t p-3">
          <TagSelector
            selectedTags={selectedTags}
            onTagsChange={setSelectedTags}
            disabled={sending}
          />
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="メモを入力... (Cmd+Enter で送信)"
              className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              rows={2}
              disabled={sending}
            />
            <div className="flex flex-col justify-end gap-1">
              <Button
                size="icon"
                variant={listening ? "destructive" : "outline"}
                onMouseDown={handleMicDown}
                onMouseUp={handleMicUp}
                onMouseLeave={handleMicLeave}
                onTouchStart={handleMicDown}
                onTouchEnd={handleMicUp}
                title="クリック: 録音開始/停止、長押し: 離すと送信"
                className={`h-8 w-8 ${listening && isPttModeRef.current ? "animate-pulse" : ""}`}
              >
                <Mic className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                onClick={() => handleSend()}
                disabled={sending || !input.trim()}
                className="h-8 w-8"
              >
                <Send className="h-4 w-4" />
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
      className="fixed right-4 bottom-4 z-50 flex flex-col rounded-lg border bg-background shadow-2xl"
      style={{ width: size.width, height: size.height }}
    >
      {/* リサイズハンドル (左上) */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="リサイズハンドル"
        aria-valuemin={300}
        aria-valuemax={800}
        aria-valuenow={size.width}
        onMouseDown={handleResizeStart}
        onKeyDown={(e) => {
          // キーボードでのリサイズをサポート
          if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            setSize((prev) => ({
              width: Math.max(300, prev.width - 10),
              height: Math.max(400, prev.height - 10),
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
          <StickyNote className="h-5 w-5 text-yellow-500" />
          <span className="font-semibold">メモ</span>
          <Badge variant="secondary" className="ml-1">
            {memos.length}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            onClick={handleRefresh}
            disabled={refreshing}
            title="更新"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
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
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : memos.length === 0 ? (
          <p className="text-sm text-muted-foreground">メモはまだありません。</p>
        ) : (
          <div className="space-y-3">
            {memos.map((memo) => (
              <MemoItem
                key={memo.id}
                memo={memo}
                onUpdate={updateMemo}
                onDelete={deleteMemo}
                onCreateTask={extractMemoTasks}
              />
            ))}
          </div>
        )}
      </div>

      {/* 入力エリア */}
      <div className="shrink-0 space-y-2 border-t p-3">
        <TagSelector
          selectedTags={selectedTags}
          onTagsChange={setSelectedTags}
          disabled={sending}
        />
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="メモを入力... (Cmd+Enter で送信)"
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            rows={2}
            disabled={sending}
          />
          <div className="flex flex-col justify-end gap-1">
            <Button
              size="icon"
              variant={listening ? "destructive" : "outline"}
              onMouseDown={handleMicDown}
              onMouseUp={handleMicUp}
              onMouseLeave={handleMicLeave}
              onTouchStart={handleMicDown}
              onTouchEnd={handleMicUp}
              title="クリック: 録音開始/停止、長押し: 離すと送信"
              className={`h-8 w-8 ${listening && isPttModeRef.current ? "animate-pulse" : ""}`}
            >
              <Mic className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              onClick={() => handleSend()}
              disabled={sending || !input.trim()}
              className="h-8 w-8"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface MemoItemProps {
  memo: MemoWithPending;
  onUpdate: (id: number, content: string, tags?: string[] | null) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  onCreateTask: (options: { memoIds: number[] }) => Promise<{ extracted: number }>;
}

function MemoItem({ memo, onUpdate, onDelete, onCreateTask }: MemoItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(memo.content);
  const [editTags, setEditTags] = useState<string[]>(parseTags(memo.tags));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const memoTags = parseTags(memo.tags);
  const isPending = memo.pending === true;

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(editContent.length, editContent.length);
    }
  }, [isEditing, editContent.length]);

  const handleSave = async () => {
    const content = editContent.trim();
    if (!content || saving) return;
    setSaving(true);
    try {
      await onUpdate(memo.id, content, editTags.length > 0 ? editTags : null);
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditContent(memo.content);
    setEditTags(parseTags(memo.tags));
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete(memo.id);
    } finally {
      setDeleting(false);
    }
  };

  const handleCreateTask = async () => {
    if (creatingTask) return;
    setCreatingTask(true);
    try {
      const result = await onCreateTask({ memoIds: [memo.id] });
      if (result.extracted > 0) {
        alert(`${result.extracted} 件のタスクを作成しました`);
      } else {
        alert("タスクは抽出されませんでした");
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : "タスク作成に失敗しました");
    } finally {
      setCreatingTask(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    // Cmd+Enter (Mac) / Ctrl+Enter (Windows) で保存
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSave();
    }
    if (e.key === "Escape") {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className="rounded-md border border-blue-300 bg-blue-100 p-2 dark:border-blue-700 dark:bg-blue-900">
        <div className="mb-1">
          <span className="text-xs font-medium text-blue-500 dark:text-blue-300">
            {formatTimeJST(memo.createdAt)}
          </span>
        </div>
        <div className="mb-2">
          <TagSelector selectedTags={editTags} onTagsChange={setEditTags} disabled={saving} />
        </div>
        <textarea
          ref={textareaRef}
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full resize-none rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          rows={2}
          disabled={saving}
        />
        <div className="mt-1 flex justify-end gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={handleCancel}
            disabled={saving}
          >
            <X className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            className="h-6 w-6"
            onClick={handleSave}
            disabled={saving || !editContent.trim()}
          >
            <Check className="h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group rounded-md border p-2 ${
        isPending
          ? "border-blue-200 bg-blue-50 opacity-70 dark:border-blue-800 dark:bg-blue-950"
          : "border-blue-300 bg-blue-100 dark:border-blue-700 dark:bg-blue-900"
      }`}
    >
      <div className="mb-1 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1">
          {isPending ? (
            <span className="flex items-center gap-1 text-xs font-medium text-blue-400 dark:text-blue-400">
              <Loader2 className="h-3 w-3 animate-spin" />
              送信中...
            </span>
          ) : (
            <span className="text-xs font-medium text-blue-500 dark:text-blue-300">
              {formatTimeJST(memo.createdAt)}
            </span>
          )}
          {memoTags.map((tag) => (
            <span
              key={tag}
              className={`rounded-full px-1.5 py-0.5 text-[10px] ${TAG_COLORS[tag as MemoTag] || "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"}`}
            >
              {tag}
            </span>
          ))}
        </div>
        {!isPending && (
          <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={handleCreateTask}
              disabled={creatingTask || deleting}
              title="タスク化"
            >
              {creatingTask ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ListTodo className="h-3 w-3" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5"
              onClick={() => setIsEditing(true)}
              disabled={deleting || creatingTask}
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 text-destructive hover:text-destructive"
              onClick={handleDelete}
              disabled={deleting || creatingTask}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        )}
      </div>
      <p className="text-sm whitespace-pre-wrap text-blue-900 dark:text-blue-100">{memo.content}</p>
    </div>
  );
}
