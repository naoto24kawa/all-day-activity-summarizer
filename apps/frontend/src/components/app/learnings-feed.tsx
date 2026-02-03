/**
 * Learnings Feed Component
 *
 * Displays learnings extracted from various sources
 */

import type { AIJobCompletedEvent, Learning, LearningSourceType, Project } from "@repo/types";
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
import { useCallback, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAIJobs } from "@/hooks/use-ai-jobs";
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
  projectFilter: number | "all" | "none";
  projects: Project[];
  projectCount: Map<number | "none", number>;
  onSourceFilterChange: (filter: LearningSourceType | null) => void;
  onCategoryFilterChange: (filter: string | null) => void;
  onProjectFilterChange: (filter: number | "all" | "none") => void;
}

function FilterBar({
  stats,
  sourceFilter,
  categoryFilter,
  projectFilter,
  projects,
  projectCount,
  onSourceFilterChange,
  onCategoryFilterChange,
  onProjectFilterChange,
}: FilterBarProps) {
  const sourceTypes = Object.entries(stats.bySourceType).sort((a, b) => b[1] - a[1]);
  const categories = Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]);
  const projectsWithLearnings = projects.filter(
    (p) => projectCount.has(p.id) && (projectCount.get(p.id) ?? 0) > 0,
  );

  const hasFilters =
    sourceTypes.length > 0 || categories.length > 0 || projectsWithLearnings.length > 0;

  if (!hasFilters) return null;

  return (
    <div className="shrink-0 border-b px-6 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Source Filter */}
        {sourceTypes.length > 0 && (
          <Select
            value={sourceFilter ?? "all"}
            onValueChange={(value) =>
              onSourceFilterChange(value === "all" ? null : (value as LearningSourceType))
            }
          >
            <SelectTrigger className="h-7 w-auto min-w-[100px] text-xs">
              <SelectValue placeholder="ソース" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全ソース ({stats.total})</SelectItem>
              {sourceTypes.map(([source, count]) => {
                const info = SOURCE_TYPE_LABELS[source as LearningSourceType];
                return (
                  <SelectItem key={source} value={source}>
                    {info?.label || source} ({count})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}

        {/* Category Filter */}
        {categories.length > 0 && (
          <Select
            value={categoryFilter ?? "all"}
            onValueChange={(value) => onCategoryFilterChange(value === "all" ? null : value)}
          >
            <SelectTrigger className="h-7 w-auto min-w-[110px] text-xs">
              <SelectValue placeholder="カテゴリ" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全カテゴリ</SelectItem>
              {categories.map(([category, count]) => (
                <SelectItem key={category} value={category}>
                  {category} ({count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Project Filter */}
        {projectsWithLearnings.length > 0 && (
          <Select
            value={String(projectFilter)}
            onValueChange={(value) => {
              if (value === "all" || value === "none") {
                onProjectFilterChange(value);
              } else {
                onProjectFilterChange(Number(value));
              }
            }}
          >
            <SelectTrigger className="h-7 w-auto min-w-[120px] text-xs">
              <SelectValue placeholder="プロジェクト" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全プロジェクト</SelectItem>
              {projectsWithLearnings.map((project) => (
                <SelectItem key={project.id} value={String(project.id)}>
                  {project.name} ({projectCount.get(project.id) ?? 0})
                </SelectItem>
              ))}
              {(projectCount.get("none") ?? 0) > 0 && (
                <SelectItem value="none">未分類 ({projectCount.get("none")})</SelectItem>
              )}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

export function LearningsFeed({ className }: LearningsFeedProps) {
  const { learnings, loading, error, deleteLearning, updateLearning, createLearning, refetch } =
    useLearnings();
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

  // SSE でジョブ完了を監視し、learning-extract 完了時に refetch
  useAIJobs({
    enableSSE: true,
    onJobCompleted: useCallback(
      (event: AIJobCompletedEvent) => {
        if (event.jobType === "learning-extract") {
          refetch();
          refetchStats();
        }
      },
      [refetch, refetchStats],
    ),
  });

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

  // 非同期版: ジョブをキューに登録 (結果はSSE通知で受け取る)
  const handleExtractAll = async () => {
    await Promise.all([
      extractFromTranscriptions(),
      extractFromGitHubComments(),
      extractFromSlackMessages(),
    ]);
    // ジョブ登録完了 - 実際の結果はSSE通知で受け取る
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
        category: data.category ?? undefined,
        tags: data.tags,
        projectId: data.projectId ?? undefined,
      });
    }
    refetchStats();
  };

  const handleExport = async () => {
    const data = await exportLearnings({});
    if (data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `learnings-all-${new Date().toISOString().split("T")[0]}.json`;
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
        projectFilter={projectFilter}
        projects={projects}
        projectCount={projectCount}
        onSourceFilterChange={setSourceFilter}
        onCategoryFilterChange={setCategoryFilter}
        onProjectFilterChange={setProjectFilter}
      />

      <CardContent className="min-h-0 flex-1 overflow-auto pt-4">
        {filteredLearnings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No learnings yet. Use the buttons above to extract learnings from various sources.
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
        <div className="flex w-full items-start justify-between">
          {/* タイトル部分 - クリックで展開 */}
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex-1 min-w-0 text-left cursor-pointer hover:bg-muted/50 rounded -m-1 p-1 transition-colors"
            >
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
            </button>
          </CollapsibleTrigger>
          {/* アクションボタン (CollapsibleTrigger の外) */}
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
              onClick={onEdit}
              title="編集"
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              title="削除"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
            {hasMoreContent && (
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6">
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </Button>
              </CollapsibleTrigger>
            )}
          </div>
        </div>

        {/* 展開時: Markdown コンテンツ + タグ詳細 + AI説明 */}
        <CollapsibleContent className="mt-3 space-y-3">
          <div className="prose prose-sm max-w-none text-muted-foreground dark:prose-invert">
            <Markdown remarkPlugins={[remarkGfm]}>{learning.content}</Markdown>
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
                <Markdown remarkPlugins={[remarkGfm]}>{explanation.explanation}</Markdown>
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
                        <Markdown remarkPlugins={[remarkGfm]}>{example}</Markdown>
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
