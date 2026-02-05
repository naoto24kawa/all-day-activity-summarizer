/**
 * Learnings Feed Component
 *
 * Displays learnings extracted from various sources
 */

import type {
  AIJobCompletedEvent,
  Learning,
  LearningExplanationResult,
  LearningSourceType,
  Project,
} from "@repo/types";
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  Check,
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
  X,
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
  type ExplanationStatus,
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

  // SSE でジョブ完了を監視し、learning-extract/learning-explain 完了時に refetch
  useAIJobs({
    enableSSE: true,
    onJobCompleted: useCallback(
      (event: AIJobCompletedEvent) => {
        if (event.jobType === "learning-extract" || event.jobType === "learning-explain") {
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
  const [showExplanation, setShowExplanation] = useState(false);
  const [localStatus, setLocalStatus] = useState<ExplanationStatus | null>(
    learning.explanationStatus as ExplanationStatus | null,
  );
  const [localResult, setLocalResult] = useState<LearningExplanationResult | null>(() => {
    if (learning.pendingExplanation) {
      try {
        return JSON.parse(learning.pendingExplanation) as LearningExplanationResult;
      } catch {
        return null;
      }
    }
    return null;
  });

  const {
    loading: explainLoading,
    startExplain,
    applyExplanation,
    discardExplanation,
  } = useLearningExplain();

  const tags = learning.tags ? (JSON.parse(learning.tags) as string[]) : [];
  const isDue = !learning.nextReviewAt || new Date(learning.nextReviewAt) <= new Date();
  const sourceInfo = SOURCE_TYPE_LABELS[learning.sourceType];
  const projectName = getProjectName(projects, learning.projectId);

  // content の最初の行をタイトルとして取得
  const lines = learning.content.split("\n");
  const title = lines[0]?.replace(/^#+\s*/, "") || "No title";
  const hasMoreContent = lines.length > 1 || learning.content.length > 100;

  // Learning の props が変わったらローカル状態を更新
  const learningStatus = learning.explanationStatus as ExplanationStatus | null;
  if (learningStatus !== localStatus) {
    setLocalStatus(learningStatus);
    if (learning.pendingExplanation) {
      try {
        setLocalResult(JSON.parse(learning.pendingExplanation) as LearningExplanationResult);
      } catch {
        setLocalResult(null);
      }
    }
  }

  const handleExplain = async (e: React.MouseEvent) => {
    e.stopPropagation();

    // applied 状態: expandedContent を表示トグル
    if (localStatus === "applied") {
      setShowExplanation(!showExplanation);
      if (!isOpen) setIsOpen(true);
      return;
    }

    // completed 状態: プレビューを表示トグル
    if (localStatus === "completed" && localResult) {
      setShowExplanation(!showExplanation);
      if (!isOpen) setIsOpen(true);
      return;
    }

    // pending 状態: 何もしない (ローディング中)
    if (localStatus === "pending") {
      return;
    }

    // null/failed 状態: ジョブを開始
    const result = await startExplain(learning.id);
    if (result) {
      setLocalStatus("pending");
      setIsOpen(true);
    }
  };

  const handleApply = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await applyExplanation(learning.id);
    if (result) {
      setLocalStatus("applied");
      setShowExplanation(true);
    }
  };

  const handleDiscard = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const success = await discardExplanation(learning.id);
    if (success) {
      setLocalStatus(null);
      setLocalResult(null);
      setShowExplanation(false);
    }
  };

  // Lightbulb ボタンのスタイルを状態に応じて変更
  const getLightbulbStyle = () => {
    switch (localStatus) {
      case "pending":
        return "text-yellow-500 animate-pulse";
      case "completed":
        return "text-yellow-500";
      case "applied":
        return "text-green-500";
      case "failed":
        return "text-red-500";
      default:
        return "text-muted-foreground hover:text-yellow-500";
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
              className={`h-6 w-6 ${getLightbulbStyle()}`}
              onClick={handleExplain}
              disabled={explainLoading || localStatus === "pending"}
              title={
                localStatus === "pending"
                  ? "生成中..."
                  : localStatus === "completed"
                    ? "詳細説明をプレビュー"
                    : localStatus === "applied"
                      ? "詳細説明を表示"
                      : localStatus === "failed"
                        ? "再試行"
                        : "AIで詳しく説明"
              }
            >
              {explainLoading || localStatus === "pending" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : localStatus === "failed" ? (
                <AlertTriangle className="h-3 w-3" />
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

          {/* AI 説明セクション - pending 状態 */}
          {localStatus === "pending" && (
            <div className="mt-4 p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 text-yellow-600 dark:text-yellow-400 animate-spin" />
                <span className="font-medium text-yellow-800 dark:text-yellow-300">
                  AI による詳細説明を生成中...
                </span>
              </div>
            </div>
          )}

          {/* AI 説明セクション - completed 状態 (プレビュー + 適用/破棄) */}
          {showExplanation && localStatus === "completed" && localResult && (
            <div className="mt-4 p-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                  <span className="font-medium text-yellow-800 dark:text-yellow-300">
                    AI による詳細説明 (プレビュー)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-green-600 border-green-300 hover:bg-green-50"
                    onClick={handleApply}
                    disabled={explainLoading}
                  >
                    <Check className="mr-1 h-3 w-3" />
                    適用
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-red-600 border-red-300 hover:bg-red-50"
                    onClick={handleDiscard}
                    disabled={explainLoading}
                  >
                    <X className="mr-1 h-3 w-3" />
                    破棄
                  </Button>
                </div>
              </div>

              {/* 詳細説明 - Markdown 形式で表示 */}
              <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-yellow-800 dark:prose-headings:text-yellow-300 prose-p:text-yellow-900 dark:prose-p:text-yellow-100 prose-li:text-yellow-900 dark:prose-li:text-yellow-100 prose-code:text-yellow-900 dark:prose-code:text-yellow-100 prose-strong:text-yellow-800 dark:prose-strong:text-yellow-200 mb-4">
                <Markdown remarkPlugins={[remarkGfm]}>{localResult.explanation}</Markdown>
              </div>

              {/* 重要ポイント */}
              {localResult.keyPoints.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-2">
                    重要ポイント
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-sm text-yellow-900 dark:text-yellow-100">
                    {localResult.keyPoints.map((point, idx) => (
                      <li key={`keypoint-${idx}`}>{point}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 関連トピック */}
              {localResult.relatedTopics.length > 0 && (
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-2">
                    関連トピック
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {localResult.relatedTopics.map((topic) => (
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

              {/* 実践例 - Markdown 形式で表示 */}
              {localResult.practicalExamples && localResult.practicalExamples.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-2">
                    実践例
                  </h4>
                  <div className="space-y-2">
                    {localResult.practicalExamples.map((example, idx) => (
                      <div
                        key={`example-${idx}`}
                        className="prose prose-sm max-w-none dark:prose-invert prose-p:text-yellow-900 dark:prose-p:text-yellow-100 prose-li:text-yellow-900 dark:prose-li:text-yellow-100 prose-code:bg-yellow-200/50 dark:prose-code:bg-yellow-700/50 bg-yellow-100/50 dark:bg-yellow-800/30 p-2 rounded"
                      >
                        <Markdown remarkPlugins={[remarkGfm]}>{example}</Markdown>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* AI 説明セクション - applied 状態 (expandedContent を Markdown で表示) */}
          {showExplanation && localStatus === "applied" && learning.expandedContent && (
            <div className="mt-4 p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="h-4 w-4 text-green-600 dark:text-green-400" />
                <span className="font-medium text-green-800 dark:text-green-300">
                  AI による詳細説明
                </span>
              </div>
              <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-green-800 dark:prose-headings:text-green-300 prose-p:text-green-900 dark:prose-p:text-green-100 prose-li:text-green-900 dark:prose-li:text-green-100 prose-code:text-green-900 dark:prose-code:text-green-100 prose-code:bg-green-200/50 dark:prose-code:bg-green-700/50 prose-strong:text-green-800 dark:prose-strong:text-green-200 prose-a:text-green-700 dark:prose-a:text-green-300">
                <Markdown remarkPlugins={[remarkGfm]}>{learning.expandedContent}</Markdown>
              </div>
            </div>
          )}

          {/* AI 説明セクション - failed 状態 */}
          {localStatus === "failed" && (
            <div className="mt-4 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                  <span className="font-medium text-red-800 dark:text-red-300">
                    詳細説明の生成に失敗しました
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-red-600 border-red-300 hover:bg-red-50"
                  onClick={handleExplain}
                  disabled={explainLoading}
                >
                  <RefreshCw className="mr-1 h-3 w-3" />
                  再試行
                </Button>
              </div>
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
