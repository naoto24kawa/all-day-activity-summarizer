/**
 * Learnings Feed Component
 *
 * Displays learnings extracted from various sources
 */

import type { Learning, LearningSourceType } from "@repo/types";
import {
  BookOpen,
  Calendar,
  Code,
  Github,
  Loader2,
  MessageSquare,
  Mic,
  RefreshCw,
  Tag,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type LearningsStats,
  useLearnings,
  useLearningsExtract,
  useLearningsStats,
} from "@/hooks/use-learnings";

interface LearningsFeedProps {
  date?: string;
  className?: string;
}

const SOURCE_TYPE_LABELS: Record<LearningSourceType, { label: string; icon: React.ReactNode }> = {
  "claude-code": { label: "Claude", icon: <Code className="h-3 w-3" /> },
  transcription: { label: "Audio", icon: <Mic className="h-3 w-3" /> },
  "github-comment": { label: "GitHub", icon: <Github className="h-3 w-3" /> },
  "slack-message": { label: "Slack", icon: <MessageSquare className="h-3 w-3" /> },
};

function applyFilters(
  learnings: Learning[],
  categoryFilter: string | null,
  sourceFilter: LearningSourceType | null,
): Learning[] {
  let result = learnings;
  if (categoryFilter) {
    result = result.filter((l) => l.category === categoryFilter);
  }
  if (sourceFilter) {
    result = result.filter((l) => l.sourceType === sourceFilter);
  }
  return result;
}

interface ExtractButtonsProps {
  extractLoading: boolean;
  onExtract: (type: "transcription" | "github" | "slack") => void;
}

function ExtractButtons({ extractLoading, onExtract }: ExtractButtonsProps) {
  return (
    <div className="shrink-0 border-b px-6 pb-3">
      <p className="mb-2 text-xs text-muted-foreground">Extract learnings from:</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onExtract("transcription")}
          disabled={extractLoading}
        >
          {extractLoading ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Mic className="mr-1 h-3 w-3" />
          )}
          Transcriptions
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onExtract("github")}
          disabled={extractLoading}
        >
          {extractLoading ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Github className="mr-1 h-3 w-3" />
          )}
          GitHub Comments
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onExtract("slack")}
          disabled={extractLoading}
        >
          {extractLoading ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <MessageSquare className="mr-1 h-3 w-3" />
          )}
          Slack Messages
        </Button>
      </div>
    </div>
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
  const { learnings, loading, error, deleteLearning, refetch } = useLearnings({ date });
  const { stats, refetch: refetchStats } = useLearningsStats();
  const {
    loading: extractLoading,
    extractFromTranscriptions,
    extractFromGitHubComments,
    extractFromSlackMessages,
  } = useLearningsExtract();

  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<LearningSourceType | null>(null);

  const filteredLearnings = applyFilters(learnings, categoryFilter, sourceFilter);

  const handleExtract = async (type: "transcription" | "github" | "slack") => {
    const extractors = {
      transcription: extractFromTranscriptions,
      github: extractFromGitHubComments,
      slack: extractFromSlackMessages,
    };
    const result = await extractors[type](date);
    if (result) {
      refetch();
      refetchStats();
    }
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
          <Button variant="ghost" size="icon" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <ExtractButtons extractLoading={extractLoading} onExtract={handleExtract} />

      <FilterBar
        stats={stats}
        sourceFilter={sourceFilter}
        categoryFilter={categoryFilter}
        onSourceFilterChange={setSourceFilter}
        onCategoryFilterChange={setCategoryFilter}
      />

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
                onDelete={() => deleteLearning(learning.id)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface LearningItemProps {
  learning: Learning;
  onDelete: () => void;
}

function LearningItem({ learning, onDelete }: LearningItemProps) {
  const tags = learning.tags ? (JSON.parse(learning.tags) as string[]) : [];
  const isDue = !learning.nextReviewAt || new Date(learning.nextReviewAt) <= new Date();
  const sourceInfo = SOURCE_TYPE_LABELS[learning.sourceType];

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="flex-1 text-sm">{learning.content}</p>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-xs">
          {sourceInfo?.icon}
          <span className="ml-1">{sourceInfo?.label || learning.sourceType}</span>
        </Badge>

        {learning.category && (
          <Badge variant="secondary" className="text-xs">
            {learning.category}
          </Badge>
        )}
        {tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="text-xs">
            <Tag className="mr-1 h-2 w-2" />
            {tag}
          </Badge>
        ))}
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {learning.date}
        </span>
        {isDue && (
          <Badge variant="destructive" className="text-xs">
            Review due
          </Badge>
        )}
        {learning.confidence !== null && (
          <span className="text-xs text-muted-foreground">
            {Math.round(learning.confidence * 100)}% confidence
          </span>
        )}
      </div>
    </div>
  );
}
