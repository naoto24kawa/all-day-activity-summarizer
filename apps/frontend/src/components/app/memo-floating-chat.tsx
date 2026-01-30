import type { Memo, MemoTag } from "@repo/types";
import { MEMO_TAGS } from "@repo/types";
import {
  Check,
  ChevronDown,
  GripVertical,
  Mic,
  MicOff,
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
import { useMemos } from "@/hooks/use-memos";
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
}

export function MemoFloatingChat({
  date,
  initialSidebar = false,
  onSidebarChange,
}: MemoFloatingChatProps) {
  const { memos, loading, error, postMemo, updateMemo, deleteMemo, refetch } = useMemos(date);
  const [isOpen, setIsOpen] = useState(true);
  const [mode, setMode] = useState<MemoMode>(initialSidebar ? "sidebar" : "floating");
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [refreshing, setRefreshing] = useState(false);
  const [input, setInput] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
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

  const handleSend = async () => {
    const content = input.trim();
    if (!content || sending) return;

    // 音声入力中の場合は停止し、結果ハンドラを無効化
    if (listening && recognitionRef.current) {
      recognitionRef.current.onresult = null;
      recognitionRef.current.stop();
    }

    setSending(true);
    try {
      await postMemo(content, selectedTags.length > 0 ? selectedTags : undefined);
      setInput("");
      setSelectedTags([]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME変換中は送信しない
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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

    // 音声認識開始時のテキストを保持
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

  // 閉じた状態のボタン
  if (!isOpen) {
    return (
      <div className="fixed right-4 bottom-4 z-50">
        <Button
          onClick={() => setIsOpen(true)}
          className="h-14 w-14 rounded-full shadow-lg"
          size="icon"
        >
          <StickyNote className="h-6 w-6" />
          {memos.length > 0 && (
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
                <MemoItem key={memo.id} memo={memo} onUpdate={updateMemo} onDelete={deleteMemo} />
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
              placeholder="メモを入力... (Enter で送信)"
              className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              rows={2}
              disabled={sending}
            />
            <div className="flex flex-col justify-end gap-1">
              <Button
                size="icon"
                variant={listening ? "destructive" : "outline"}
                onClick={toggleListening}
                title={listening ? "音声入力を停止" : "音声入力"}
                className="h-8 w-8"
              >
                {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Button
                size="icon"
                onClick={handleSend}
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
              <MemoItem key={memo.id} memo={memo} onUpdate={updateMemo} onDelete={deleteMemo} />
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
            placeholder="メモを入力... (Enter で送信)"
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            rows={2}
            disabled={sending}
          />
          <div className="flex flex-col justify-end gap-1">
            <Button
              size="icon"
              variant={listening ? "destructive" : "outline"}
              onClick={toggleListening}
              title={listening ? "音声入力を停止" : "音声入力"}
              className="h-8 w-8"
            >
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Button
              size="icon"
              onClick={handleSend}
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
  memo: Memo;
  onUpdate: (id: number, content: string, tags?: string[] | null) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

function MemoItem({ memo, onUpdate, onDelete }: MemoItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(memo.content);
  const [editTags, setEditTags] = useState<string[]>(parseTags(memo.tags));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const memoTags = parseTags(memo.tags);

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
    if (!window.confirm("このメモを削除しますか?")) return;
    setDeleting(true);
    try {
      await onDelete(memo.id);
    } finally {
      setDeleting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
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
    <div className="group rounded-md border border-blue-300 bg-blue-100 p-2 dark:border-blue-700 dark:bg-blue-900">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs font-medium text-blue-500 dark:text-blue-300">
            {formatTimeJST(memo.createdAt)}
          </span>
          {memoTags.map((tag) => (
            <span
              key={tag}
              className={`rounded-full px-1.5 py-0.5 text-[10px] ${TAG_COLORS[tag as MemoTag] || "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"}`}
            >
              {tag}
            </span>
          ))}
        </div>
        <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5"
            onClick={() => setIsEditing(true)}
            disabled={deleting}
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5 text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={deleting}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <p className="text-sm whitespace-pre-wrap text-blue-900 dark:text-blue-100">{memo.content}</p>
    </div>
  );
}
