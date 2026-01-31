import { Book, FileText, Github, MessageSquare, Sparkles, Terminal } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useVocabulary } from "@/hooks/use-vocabulary";
import { postAdasApi } from "@/lib/adas-api";
import { getTodayDateString } from "@/lib/date";

interface VocabularyPanelProps {
  date?: string;
}

export function VocabularyPanel({ date }: VocabularyPanelProps) {
  const { terms, loading, error, addTerm, removeTerm, refresh } = useVocabulary();
  const [newTerm, setNewTerm] = useState("");
  const [newReading, setNewReading] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  const targetDate = date ?? getTodayDateString();

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

  const handleExtractSource = async (source: "slack" | "github" | "claude-code" | "memo") => {
    setExtracting(true);
    try {
      await postAdasApi(`/api/vocabulary/extract/${source}`, { date: targetDate });
      await refresh();
    } catch (err) {
      console.error(`Failed to extract vocabulary from ${source}:`, err);
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

  const handleRemove = async (id: number) => {
    try {
      await removeTerm(id);
    } catch (err) {
      console.error("Failed to remove term:", err);
    }
  };

  if (loading) {
    return (
      <Card>
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
      <Card>
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
    <Card>
      <CardHeader className="pb-2">
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
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleExtractSource("slack")}
              disabled={extracting}
              title="Extract from Slack"
            >
              <MessageSquare className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleExtractSource("github")}
              disabled={extracting}
              title="Extract from GitHub"
            >
              <Github className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleExtractSource("claude-code")}
              disabled={extracting}
              title="Extract from Claude Code"
            >
              <Terminal className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleExtractSource("memo")}
              disabled={extracting}
              title="Extract from Memos"
            >
              <FileText className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
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

        {/* Terms list */}
        {terms.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No vocabulary terms. Add terms to improve transcription accuracy.
          </p>
        ) : (
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {terms.map((term) => (
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
                      <span className="text-xs text-muted-foreground">used {term.usageCount}x</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(term.id)}
                    className="h-6 px-2 text-destructive hover:text-destructive"
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
