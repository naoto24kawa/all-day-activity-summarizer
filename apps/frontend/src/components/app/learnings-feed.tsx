/**
 * Learnings Feed Component
 *
 * Displays learnings extracted from Claude Code sessions
 */

import type { Learning } from "@repo/types";
import { BookOpen, Calendar, Tag, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLearnings, useLearningsStats } from "@/hooks/use-learnings";

interface LearningsFeedProps {
  date?: string;
  className?: string;
}

export function LearningsFeed({ date, className }: LearningsFeedProps) {
  const { learnings, loading, error, deleteLearning } = useLearnings({ date });
  const { stats } = useLearningsStats();
  const [filter, setFilter] = useState<string | null>(null);

  const filteredLearnings = filter ? learnings.filter((l) => l.category === filter) : learnings;

  const categories = Object.entries(stats.byCategory).sort((a, b) => b[1] - a[1]);

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
      </CardHeader>

      {categories.length > 0 && (
        <div className="shrink-0 border-b px-6 pb-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={filter === null ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(null)}
            >
              All
            </Button>
            {categories.map(([category, count]) => (
              <Button
                key={category}
                variant={filter === category ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(category)}
              >
                {category} ({count})
              </Button>
            ))}
          </div>
        </div>
      )}

      <CardContent className="min-h-0 flex-1 overflow-auto pt-4">
        {filteredLearnings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {date
              ? "No learnings for this date."
              : "No learnings yet. Sync Claude Code sessions to extract learnings."}
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
        {learning.category && (
          <Badge variant="outline" className="text-xs">
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
