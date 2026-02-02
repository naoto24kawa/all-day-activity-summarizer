import { Book, Check, Pencil, RefreshCw, Search, Sparkles, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useVocabulary } from "@/hooks/use-vocabulary";
import { postAdasApi } from "@/lib/adas-api";
import { getTodayDateString } from "@/lib/date";
import { cn } from "@/lib/utils";

const SOURCE_OPTIONS = ["all", "manual", "transcribe", "feedback", "interpret"] as const;
type SourceFilter = (typeof SOURCE_OPTIONS)[number];

interface VocabularyPanelProps {
  className?: string;
}

interface EditForm {
  term: string;
  reading: string;
  category: string;
}

export function VocabularyPanel({ className }: VocabularyPanelProps) {
  const { terms, loading, error, addTerm, updateTerm, removeTerm, refresh } = useVocabulary();
  const [newTerm, setNewTerm] = useState("");
  const [newReading, setNewReading] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ term: "", reading: "", category: "" });
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; term: string } | null>(null);

  const targetDate = getTodayDateString();

  // カテゴリ一覧を動的に取得
  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const term of terms) {
      if (term.category) cats.add(term.category);
    }
    return Array.from(cats).sort();
  }, [terms]);

  // フィルタリング
  const filteredTerms = useMemo(() => {
    return terms.filter((term) => {
      // 検索フィルタ
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesTerm = term.term.toLowerCase().includes(query);
        const matchesReading = term.reading?.toLowerCase().includes(query);
        if (!matchesTerm && !matchesReading) return false;
      }
      // ソースフィルタ
      if (sourceFilter !== "all" && term.source !== sourceFilter) return false;
      // カテゴリフィルタ
      if (categoryFilter !== "all" && term.category !== categoryFilter) return false;
      return true;
    });
  }, [terms, searchQuery, sourceFilter, categoryFilter]);

  const hasActiveFilters = searchQuery || sourceFilter !== "all" || categoryFilter !== "all";

  const clearFilters = () => {
    setSearchQuery("");
    setSourceFilter("all");
    setCategoryFilter("all");
  };

  const handleExtractAll = async () => {
    setExtracting(true);
    try {
      await postAdasApi("/api/vocabulary/extract/all", { date: targetDate });
      await refresh();
    } catch (err) {
      console.error("Failed to extract vocabulary:", err);
    } finally {
      setExtracting(false);
    }
  };

  const handleAdd = async () => {
    if (!newTerm.trim()) return;

    setIsAdding(true);
    setAddError(null);

    try {
      await addTerm(newTerm.trim(), {
        reading: newReading.trim() || undefined,
        category: newCategory.trim() || undefined,
      });
      setNewTerm("");
      setNewReading("");
      setNewCategory("");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add term");
    } finally {
      setIsAdding(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (!deleteTarget) return;
    try {
      await removeTerm(deleteTarget.id);
    } catch (err) {
      console.error("Failed to remove term:", err);
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleStartEdit = (term: {
    id: number;
    term: string;
    reading?: string | null;
    category?: string | null;
  }) => {
    setEditingId(term.id);
    setEditForm({
      term: term.term,
      reading: term.reading ?? "",
      category: term.category ?? "",
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({ term: "", reading: "", category: "" });
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editForm.term.trim()) return;

    setIsSaving(true);
    try {
      await updateTerm(editingId, {
        term: editForm.term.trim(),
        reading: editForm.reading.trim() || null,
        category: editForm.category.trim() || null,
      });
      setEditingId(null);
      setEditForm({ term: "", reading: "", category: "" });
    } catch (err) {
      console.error("Failed to update term:", err);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className={cn("flex flex-col", className)}>
        <CardHeader>
          <CardTitle>Vocabulary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={cn("flex flex-col", className)}>
        <CardHeader>
          <CardTitle>Vocabulary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("flex flex-col", className)}>
      <CardHeader className="shrink-0 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Book className="h-5 w-5 text-purple-500" />
            Vocabulary
            <Badge variant="secondary" className="ml-1">
              {terms.length}
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExtractAll}
              disabled={extracting}
              title="Extract vocabulary from all feeds"
            >
              <Sparkles className={`mr-1 h-3 w-3 ${extracting ? "animate-pulse" : ""}`} />
              {extracting ? "..." : "用語抽出"}
            </Button>
            <Button variant="ghost" size="icon" onClick={() => refresh()} title="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col space-y-4">
        {/* Add form */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              placeholder="Term"
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              className="flex-1"
              disabled={isAdding}
            />
            <Input
              placeholder="Reading (optional)"
              value={newReading}
              onChange={(e) => setNewReading(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              className="w-32"
              disabled={isAdding}
            />
            <Input
              placeholder="Category"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              className="w-24"
              disabled={isAdding}
            />
            <Button onClick={handleAdd} disabled={isAdding || !newTerm.trim()}>
              Add
            </Button>
          </div>
          {addError && <p className="text-sm text-destructive">{addError}</p>}
        </div>

        {/* Search and filters */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search terms..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Source:</span>
            {SOURCE_OPTIONS.map((source) => (
              <Badge
                key={source}
                variant={sourceFilter === source ? "default" : "outline"}
                className="cursor-pointer text-xs"
                onClick={() => setSourceFilter(source)}
              >
                {source}
              </Badge>
            ))}
            {categories.length > 0 && (
              <>
                <span className="ml-2 text-xs text-muted-foreground">Category:</span>
                <Badge
                  variant={categoryFilter === "all" ? "default" : "outline"}
                  className="cursor-pointer text-xs"
                  onClick={() => setCategoryFilter("all")}
                >
                  all
                </Badge>
                {categories.map((cat) => (
                  <Badge
                    key={cat}
                    variant={categoryFilter === cat ? "default" : "outline"}
                    className="cursor-pointer text-xs"
                    onClick={() => setCategoryFilter(cat)}
                  >
                    {cat}
                  </Badge>
                ))}
              </>
            )}
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-6 px-2">
                <X className="mr-1 h-3 w-3" />
                Clear
              </Button>
            )}
          </div>
          {hasActiveFilters && (
            <p className="text-xs text-muted-foreground">
              {filteredTerms.length} / {terms.length} terms
            </p>
          )}
        </div>

        {/* Terms list */}
        {terms.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No vocabulary terms. Add terms to improve transcription accuracy.
          </p>
        ) : filteredTerms.length === 0 ? (
          <p className="text-sm text-muted-foreground">No terms match your filters.</p>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2">
              {filteredTerms.map((term) =>
                editingId === term.id ? (
                  <div
                    key={term.id}
                    className="flex items-center gap-2 rounded-md border border-primary bg-muted/50 p-2"
                  >
                    <Input
                      value={editForm.term}
                      onChange={(e) => setEditForm((f) => ({ ...f, term: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit();
                        if (e.key === "Escape") handleCancelEdit();
                      }}
                      className="h-7 flex-1"
                      placeholder="Term"
                      disabled={isSaving}
                      autoFocus
                    />
                    <Input
                      value={editForm.reading}
                      onChange={(e) => setEditForm((f) => ({ ...f, reading: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit();
                        if (e.key === "Escape") handleCancelEdit();
                      }}
                      className="h-7 w-28"
                      placeholder="Reading"
                      disabled={isSaving}
                    />
                    <Input
                      value={editForm.category}
                      onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit();
                        if (e.key === "Escape") handleCancelEdit();
                      }}
                      className="h-7 w-24"
                      placeholder="Category"
                      disabled={isSaving}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleSaveEdit}
                      disabled={isSaving || !editForm.term.trim()}
                      className="h-7 w-7"
                      title="Save (Enter)"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleCancelEdit}
                      disabled={isSaving}
                      className="h-7 w-7"
                      title="Cancel (Esc)"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div
                    key={term.id}
                    className="flex items-center justify-between gap-2 rounded-md border p-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{term.term}</span>
                      {term.reading && (
                        <span className="text-sm text-muted-foreground">({term.reading})</span>
                      )}
                      {term.category && (
                        <Badge variant="outline" className="text-xs">
                          {term.category}
                        </Badge>
                      )}
                      <Badge
                        variant={term.source === "manual" ? "default" : "secondary"}
                        className="text-xs"
                      >
                        {term.source}
                      </Badge>
                      {term.usageCount > 0 && (
                        <span className="text-xs text-muted-foreground">
                          used {term.usageCount}x
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleStartEdit(term)}
                        className="h-6 w-6"
                        title="Edit"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget({ id: term.id, term: term.term })}
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        title="Remove"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ),
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>用語を削除しますか?</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleteTarget?.term}」を削除します。この操作は取り消せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRemove}
              className="bg-destructive hover:bg-destructive/90"
            >
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
