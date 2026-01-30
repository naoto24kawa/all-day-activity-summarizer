/**
 * Learnings Feed Component
 *
 * Displays learnings extracted from various sources
 */

import type { Learning, LearningSourceType, Project } from "@repo/types";
import {
  BookOpen,
  Calendar,
  ChevronDown,
  Code,
  Download,
  FolderGit2,
  Github,
  Lightbulb,
  Loader2,
  MessageSquare,
  Mic,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  User,
} from "lucide-react";
import { useState } from "react";
import Markdown from "react-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type LearningExplanation,
  type LearningImportItem,
  type LearningsStats,
  useLearningExplain,
  useLearnings,
  useLearningsExportImport,
  useLearningsExtract,
  useLearningsStats,
} from "@/hooks/use-learnings";
import { getProjectName, useProjects } from "@/hooks/use-projects";
import { LearningEditDialog } from "./learning-edit-dialog";

interface LearningsFeedProps {
  date?: string;
  className?: string;
}

const SOURCE_TYPE_LABELS: Record<LearningSourceType, { label: string; icon: React.ReactNode }> = {
  "claude-code": { label: "Claude", icon: <Code className="h-3 w-3" /> },
  transcription: { label: "Audio", icon: <Mic className="h-3 w-3" /> },
  "github-comment": { label: "GitHub", icon: <Github className="h-3 w-3" /> },
  "slack-message": { label: "Slack", icon: <MessageSquare className="h-3 w-3" /> },
  manual: { label: "Manual", icon: <User className="h-3 w-3" /> },
};

function applyFilters(
  learnings: Learning[],
  categoryFilter: string | null,
  sourceFilter: LearningSourceType | null,
  projectFilter: number | "all" | "none",
): Learning[] {
  let result = learnings;
  if (categoryFilter) {
    result = result.filter((l) => l.category === categoryFilter);
  }
  if (sourceFilter) {
    result = result.filter((l) => l.sourceType === sourceFilter);
  }
  if (projectFilter !== "all") {
    if (projectFilter === "none") {
      result = result.filter((l) => l.projectId === null);
    } else {
      result = result.filter((l) => l.projectId === projectFilter);
    }
  }
  return result;
}

interface ExtractButtonProps {
  extractLoading: boolean;
  onExtractAll: () => void;
}

function ExtractButton({ extractLoading, onExtractAll }: ExtractButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onExtractAll}
      disabled={extractLoading}
      title="全ソースから学びを抽出"
      className={extractLoading ? "opacity-70" : ""}
    >
      {extractLoading ? (
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
      ) : (
        <Sparkles className="mr-1 h-3 w-3" />
      )}
      {extractLoading ? "Extracting..." : "Extract"}
    </Button>
  );
}

interface FilterBarProps {
  stats: LearningsStats;
  sourceFilter: LearningSourceType | null;
  categoryFilter: string | null;
  onSourceFilterChange: (filter: LearningSourceType | null) => void;
  onCategoryFilterChange: (filter: string | null) => void;
}

function FilterBar({
  stats,
  sourceFilter,
  categoryFilter,
  onSourceFilterChange,
  onCategoryFilterChange,
}: FilterBarProps) {
  const sourceTypes = Object.entries(stats.bySourceType).sort((a, b) => b[1] - a[1]);
  const categories = Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]);

  return (
    <>
      {sourceTypes.length > 0 && (
        <div className="shrink-0 border-b px-6 py-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={sourceFilter === null ? "default" : "outline"}
              size="sm"
              onClick={() => onSourceFilterChange(null)}
            >
              All Sources
            </Button>
            {sourceTypes.map(([source, count]) => {
              const info = SOURCE_TYPE_LABELS[source as LearningSourceType];
              return (
                <Button
                  key={source}
                  variant={sourceFilter === source ? "default" : "outline"}
                  size="sm"
                  onClick={() => onSourceFilterChange(source as LearningSourceType)}
                >
                  {info?.icon}
                  <span className="ml-1">
                    {info?.label || source} ({count})
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      )}

      {categories.length > 0 && (
        <div className="shrink-0 border-b px-6 py-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={categoryFilter === null ? "default" : "outline"}
              size="sm"
              onClick={() => onCategoryFilterChange(null)}
            >
              All Categories
            </Button>
            {categories.map(([category, count]) => (
              <Button
                key={category}
                variant={categoryFilter === category ? "default" : "outline"}
                size="sm"
                onClick={() => onCategoryFilterChange(category)}
              >
                {category} ({count})
              </Button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export function LearningsFeed({ date, className }: LearningsFeedProps) {
  const { learnings, loading, error, deleteLearning, updateLearning, createLearning, refetch } =
    useLearnings({ date });
  const { stats, refetch: refetchStats } = useLearningsStats();
  const { projects } = useProjects();
  const {
    loading: extractLoading,
    extractFromTranscriptions,
    extractFromGitHubComments,
    extractFromSlackMessages,
  } = useLearningsExtract();
  const {
    loading: exportImportLoading,
    exportLearnings,
    importLearnings,
  } = useLearningsExportImport();

  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<LearningSourceType | null>(null);
  const [projectFilter, setProjectFilter] = useState<number | "all" | "none">("all");

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingLearning, setEditingLearning] = useState<Learning | null>(null);

  const filteredLearnings = applyFilters(learnings, categoryFilter, sourceFilter, projectFilter);

  // Count learnings by project
  const projectCount = new Map<number | "none", number>();
  projectCount.set("none", 0);
  for (const learning of learnings) {
    if (learning.projectId === null) {
      projectCount.set("none", (projectCount.get("none") ?? 0) + 1);
    } else {
      projectCount.set(learning.projectId, (projectCount.get(learning.projectId) ?? 0) + 1);
    }
  }

  // Get projects that have learnings
  const projectsWithLearnings = projects.filter(
    (p) => projectCount.has(p.id) && (projectCount.get(p.id) ?? 0) > 0,
  );

  const handleExtractAll = async () => {
    await Promise.all([
      extractFromTranscriptions(date),
      extractFromGitHubComments(date),
      extractFromSlackMessages(date),
    ]);
    refetch();
    refetchStats();
  };

  const handleAddClick = () => {
    setEditingLearning(null);
    setEditDialogOpen(true);
  };

  const handleEditClick = (learning: Learning) => {
    setEditingLearning(learning);
    setEditDialogOpen(true);
  };

  const handleEditDialogSubmit = async (data: {
    content: string;
    category?: string | null;
    tags?: string[];
    projectId?: number | null;
  }) => {
    if (editingLearning) {
      await updateLearning(editingLearning.id, data);
    } else {
      await createLearning({
        content: data.content,
        date,
        category: data.category ?? undefined,
        tags: data.tags,
        projectId: data.projectId ?? undefined,
      });
    }
    refetchStats();
  };

  const handleExport = async () => {
    const data = await exportLearnings({ date });
    if (data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `learnings-${date || "all"}-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const text = await file.text();
      try {
        const data = JSON.parse(text) as LearningImportItem[];
        const result = await importLearnings(data);
        if (result) {
          refetch();
          refetchStats();
          alert(`インポート完了: ${result.imported}件追加、${result.skipped}件スキップ`);
        }
      } catch {
        alert("JSONファイルの解析に失敗しました");
      }
    };
    input.click();
  };

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Learnings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Learnings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`flex min-h-0 flex-col overflow-hidden ${className ?? ""}`}>
      <CardHeader className="shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Learnings
            {stats.total > 0 && (
              <Badge variant="secondary" className="ml-2">
                {stats.total} total
              </Badge>
            )}
            {stats.dueForReview > 0 && (
              <Badge variant="destructive" className="ml-1">
                {stats.dueForReview} due
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleAddClick} title="手動で学びを追加">
              <Plus className="mr-1 h-3 w-3" />
              Add
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleImport}
              disabled={exportImportLoading}
              title="JSONからインポート"
            >
              <Upload className="mr-1 h-3 w-3" />
              Import
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={exportImportLoading}
              title="JSONにエクスポート"
            >
              <Download className="mr-1 h-3 w-3" />
              Export
            </Button>
            <ExtractButton extractLoading={extractLoading} onExtractAll={handleExtractAll} />
            <Button variant="ghost" size="icon" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <FilterBar
        stats={stats}
        sourceFilter={sourceFilter}
        categoryFilter={categoryFilter}
        onSourceFilterChange={setSourceFilter}
        onCategoryFilterChange={setCategoryFilter}
      />

      {/* Project Filter */}
      {projectsWithLearnings.length > 0 && (
        <div className="shrink-0 border-b px-6 py-2">
          <div className="flex flex-wrap gap-2">
            <FolderGit2 className="mr-1 h-4 w-4 text-muted-foreground" />
            <Button
              variant={projectFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setProjectFilter("all")}
            >
              All Projects
            </Button>
            {projectsWithLearnings.map((project) => (
              <Button
                key={project.id}
                variant={projectFilter === project.id ? "default" : "outline"}
                size="sm"
                onClick={() => setProjectFilter(project.id)}
              >
                {project.name} ({projectCount.get(project.id) ?? 0})
              </Button>
            ))}
            {(projectCount.get("none") ?? 0) > 0 && (
              <Button
                variant={projectFilter === "none" ? "default" : "outline"}
                size="sm"
                onClick={() => setProjectFilter("none")}
              >
                Unassigned ({projectCount.get("none")})
              </Button>
            )}
          </div>
        </div>
      )}

      <CardContent className="min-h-0 flex-1 overflow-auto pt-4">
        {filteredLearnings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {date
              ? "No learnings for this date. Try extracting from the sources above."
              : "No learnings yet. Use the buttons above to extract learnings from various sources."}
          </p>
        ) : (
          <div className="space-y-3">
            {filteredLearnings.map((learning) => (
              <LearningItem
                key={learning.id}
                learning={learning}
                projects={projects}
                onEdit={() => handleEditClick(learning)}
                onDelete={() => deleteLearning(learning.id)}
              />
            ))}
          </div>
        )}
      </CardContent>

      <LearningEditDialog
        open={editDialogOpen}
        learning={editingLearning}
        projects={projects}
        onSubmit={handleEditDialogSubmit}
        onCancel={() => setEditDialogOpen(false)}
      />
    </Card>
  );
}

interface LearningItemProps {
  learning: Learning;
  projects: Project[];
  onEdit: () => void;
  onDelete: () => void;
}

function LearningItem({ learning, projects, onEdit, onDelete }: LearningItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [explanation, setExplanation] = useState<LearningExplanation | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const { loading: explainLoading, explainLearning } = useLearningExplain();

  const tags = learning.tags ? (JSON.parse(learning.tags) as string[]) : [];
  const isDue = !learning.nextReviewAt || new Date(learning.nextReviewAt) <= new Date();
  const sourceInfo = SOURCE_TYPE_LABELS[learning.sourceType];
  const projectName = getProjectName(projects, learning.projectId);

  // content の最初の行をタイトルとして取得
  const lines = learning.content.split("\n");
  const title = lines[0]?.replace(/^#+\s*/, "") || "No title";
  const hasMoreContent = lines.length > 1 || learning.content.length > 100;

  const handleExplain = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (explanation) {
      // Already have explanation, just toggle display
      setShowExplanation(!showExplanation);
      if (!isOpen) setIsOpen(true);
      return;
    }
    // Fetch explanation
    const result = await explainLearning(learning.id);
    if (result) {
      setExplanation(result);
      setShowExplanation(true);
      setIsOpen(true);
    }
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={`rounded-md border p-3 ${
          isDue ? "border-destructive/30 bg-destructive/5" : "border-border"
        }`}
      >
        {/* ヘッダー: タイトル + バッジ + 削除ボタン */}
        <CollapsibleTrigger className="flex w-full items-start justify-between text-left">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="font-medium text-sm truncate">{title}</span>
              <Badge variant="outline" className="text-xs shrink-0">
                {sourceInfo?.icon}
                <span className="ml-1">{sourceInfo?.label || learning.sourceType}</span>
              </Badge>
              {projectName && (
                <Badge variant="outline" className="text-xs bg-blue-50 border-blue-200 shrink-0">
                  <FolderGit2 className="mr-1 h-2 w-2" />
                  {projectName}
                </Badge>
              )}
              {learning.category && (
                <Badge variant="secondary" className="text-xs shrink-0">
                  {learning.category}
                </Badge>
              )}
              {isDue && (
                <Badge variant="destructive" className="text-xs shrink-0">
                  Review due
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {learning.date}
              </span>
              {learning.confidence !== null && (
                <span>{Math.round(learning.confidence * 100)}% confidence</span>
              )}
              {tags.length > 0 && (
                <span className="flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  {tags.length} tags
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 ml-2 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 ${showExplanation ? "text-yellow-500" : "text-muted-foreground hover:text-yellow-500"}`}
              onClick={handleExplain}
              disabled={explainLoading}
              title="AIで詳しく説明"
            >
              {explainLoading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Lightbulb className="h-3 w-3" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-blue-500"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              title="編集"
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              title="削除"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
            {hasMoreContent && (
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform ${
                  isOpen ? "rotate-180" : ""
                }`}
              />
            )}
          </div>
        </CollapsibleTrigger>

        {/* 展開時: Markdown コンテンツ + タグ詳細 + AI説明 */}
        <CollapsibleContent className="mt-3 space-y-3">
          <div className="prose prose-sm max-w-none text-muted-foreground dark:prose-invert">
            <Markdown>{learning.content}</Markdown>
          </div>

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-2 border-t">
              {tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  <Tag className="mr-1 h-2 w-2" />
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {/* AI 説明セクション */}
          {showExplanation && explanation && (
            <div className="mt-4 p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                <span className="font-medium text-yellow-800 dark:text-yellow-300">
                  AI による詳細説明
                </span>
              </div>

              {/* 詳細説明 */}
              <div className="prose prose-sm max-w-none text-yellow-900 dark:text-yellow-100 dark:prose-invert mb-4">
                <Markdown>{explanation.explanation}</Markdown>
              </div>

              {/* 重要ポイント */}
              {explanation.keyPoints.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-2">
                    重要ポイント
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-sm text-yellow-900 dark:text-yellow-100">
                    {explanation.keyPoints.map((point, idx) => (
                      <li key={`keypoint-${idx}`}>{point}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 関連トピック */}
              {explanation.relatedTopics.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-2">
                    関連トピック
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {explanation.relatedTopics.map((topic) => (
                      <Badge
                        key={topic}
                        variant="outline"
                        className="text-xs bg-yellow-100 dark:bg-yellow-800 border-yellow-300 dark:border-yellow-600"
                      >
                        {topic}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* 実践例 */}
              {explanation.practicalExamples && explanation.practicalExamples.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-2">
                    実践例
                  </h4>
                  <div className="space-y-2">
                    {explanation.practicalExamples.map((example, idx) => (
                      <div
                        key={`example-${idx}`}
                        className="prose prose-sm max-w-none text-yellow-900 dark:text-yellow-100 dark:prose-invert bg-yellow-100/50 dark:bg-yellow-800/30 p-2 rounded"
                      >
                        <Markdown>{example}</Markdown>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
