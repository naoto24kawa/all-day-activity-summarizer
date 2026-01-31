import type { Memo, MemoTag, Project } from "@repo/types";
import { MEMO_TAGS } from "@repo/types";
import {
  Check,
  FolderGit2,
  Mic,
  MicOff,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemos } from "@/hooks/use-memos";
import { getProjectName, useProjects } from "@/hooks/use-projects";
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

interface MemoPanelProps {
  date: string;
  className?: string;
}

export function MemoPanel({ date, className }: MemoPanelProps) {
  const { memos, loading, error, postMemo, updateMemo, deleteMemo, refetch } = useMemos(date);
  const { projects } = useProjects();
  const [refreshing, setRefreshing] = useState(false);
  const [input, setInput] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const isNearBottomRef = useRef(true);

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
      await postMemo(
        content,
        selectedTags.length > 0 ? selectedTags : undefined,
        selectedProjectId,
      );
      setInput("");
      setSelectedTags([]);
      setSelectedProjectId(null);
    } finally {
      setSending(false);
    }
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

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>メモ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>メモ</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Card className={`flex min-h-0 flex-col overflow-hidden ${className ?? ""}`}>
      <CardHeader className="flex shrink-0 flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2">
          <StickyNote className="h-5 w-5 text-yellow-500" />
          メモ
          <Badge variant="secondary" className="ml-1">
            {memos.length}
          </Badge>
        </CardTitle>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={checkNearBottom}
          className="min-h-0 flex-1 overflow-y-auto rounded-[inherit]"
        >
          {memos.length === 0 ? (
            <p className="text-sm text-muted-foreground">メモはまだありません。</p>
          ) : (
            <div className="space-y-3">
              {memos.map((memo) => (
                <MemoItem
                  key={memo.id}
                  memo={memo}
                  projects={projects}
                  onUpdate={updateMemo}
                  onDelete={deleteMemo}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <TagSelector
              selectedTags={selectedTags}
              onTagsChange={setSelectedTags}
              disabled={sending}
            />
            {projects.length > 0 && (
              <Select
                value={selectedProjectId?.toString() ?? "none"}
                onValueChange={(v) => setSelectedProjectId(v === "none" ? null : Number(v))}
                disabled={sending}
              >
                <SelectTrigger className="h-7 w-[140px] text-xs">
                  <FolderGit2 className="mr-1 h-3 w-3" />
                  <SelectValue placeholder="プロジェクト" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">なし</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id.toString()}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
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
                onClick={toggleListening}
                title={listening ? "音声入力を停止" : "音声入力"}
              >
                {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Button onClick={handleSend} disabled={sending || !input.trim()}>
                <Send className="mr-1 h-4 w-4" />
                {sending ? "..." : "送信"}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface MemoItemProps {
  memo: Memo;
  projects: Project[];
  onUpdate: (
    id: number,
    content: string,
    tags?: string[] | null,
    projectId?: number | null,
  ) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

function MemoItem({ memo, projects, onUpdate, onDelete }: MemoItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(memo.content);
  const [editTags, setEditTags] = useState<string[]>(parseTags(memo.tags));
  const [editProjectId, setEditProjectId] = useState<number | null>(memo.projectId);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const memoTags = parseTags(memo.tags);
  const projectName = getProjectName(projects, memo.projectId);

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
      await onUpdate(memo.id, content, editTags.length > 0 ? editTags : null, editProjectId);
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditContent(memo.content);
    setEditTags(parseTags(memo.tags));
    setEditProjectId(memo.projectId);
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
      <div className="rounded-md border border-blue-300 bg-blue-100 p-3 dark:border-blue-700 dark:bg-blue-900">
        <div className="mb-1">
          <span className="text-xs font-medium text-blue-500 dark:text-blue-300">
            {formatTimeJST(memo.createdAt)}
          </span>
        </div>
        <div className="mb-2 flex items-center gap-2">
          <TagSelector selectedTags={editTags} onTagsChange={setEditTags} disabled={saving} />
          {projects.length > 0 && (
            <Select
              value={editProjectId?.toString() ?? "none"}
              onValueChange={(v) => setEditProjectId(v === "none" ? null : Number(v))}
              disabled={saving}
            >
              <SelectTrigger className="h-7 w-[140px] text-xs">
                <FolderGit2 className="mr-1 h-3 w-3" />
                <SelectValue placeholder="プロジェクト" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">なし</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id.toString()}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          rows={3}
          disabled={saving}
        />
        <div className="mt-2 flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={handleCancel} disabled={saving}>
            <X className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !editContent.trim()}>
            <Check className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group rounded-md border border-blue-300 bg-blue-100 p-3 dark:border-blue-700 dark:bg-blue-900">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-blue-500 dark:text-blue-300">
            {formatTimeJST(memo.createdAt)}
          </span>
          {memoTags.length > 0 && (
            <div className="flex gap-1">
              {memoTags.map((tag) => (
                <span
                  key={tag}
                  className={`rounded-full px-2 py-0.5 text-xs ${TAG_COLORS[tag as MemoTag] || "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"}`}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          {projectName && (
            <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              <FolderGit2 className="h-3 w-3" />
              {projectName}
            </span>
          )}
        </div>
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setIsEditing(true)}
            disabled={deleting}
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-destructive hover:text-destructive"
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
