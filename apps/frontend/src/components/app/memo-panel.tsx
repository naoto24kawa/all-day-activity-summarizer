import type { Memo } from "@repo/types";
import { Check, Mic, MicOff, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemos } from "@/hooks/use-memos";

interface MemoPanelProps {
  date: string;
}

export function MemoPanel({ date }: MemoPanelProps) {
  const { memos, loading, error, postMemo, updateMemo, deleteMemo, refetch } = useMemos(date);
  const [refreshing, setRefreshing] = useState(false);
  const [input, setInput] = useState("");
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
    setSending(true);
    try {
      await postMemo(content);
      setInput("");
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center">
          メモ
          <Badge variant="secondary" className="ml-2">
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
      <CardContent>
        <div
          ref={scrollRef}
          onScroll={checkNearBottom}
          className="h-[400px] overflow-y-auto rounded-[inherit]"
        >
          {memos.length === 0 ? (
            <p className="text-sm text-muted-foreground">メモはまだありません。</p>
          ) : (
            <div className="space-y-3">
              {memos.map((memo) => (
                <MemoItem key={memo.id} memo={memo} onUpdate={updateMemo} onDelete={deleteMemo} />
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="メモを入力... (Enter で送信, Shift+Enter で改行)"
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
              {sending ? "..." : "送信"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface MemoItemProps {
  memo: Memo;
  onUpdate: (id: number, content: string) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

function MemoItem({ memo, onUpdate, onDelete }: MemoItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(memo.content);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      await onUpdate(memo.id, content);
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditContent(memo.content);
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
      <div className="rounded-md border border-blue-300 bg-blue-100 p-3 dark:border-blue-700 dark:bg-blue-900">
        <div className="mb-1">
          <span className="text-xs font-medium text-blue-500 dark:text-blue-300">
            {new Date(memo.createdAt).toLocaleTimeString()}
          </span>
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
        <span className="text-xs font-medium text-blue-500 dark:text-blue-300">
          {new Date(memo.createdAt).toLocaleTimeString()}
        </span>
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
