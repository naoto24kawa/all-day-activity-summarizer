/**
 * Calendar Panel Component
 *
 * Displays Google Calendar events for the current day
 */

import {
  Calendar,
  CalendarDays,
  Check,
  Clock,
  ExternalLink,
  MapPin,
  RefreshCw,
  Users,
  Video,
} from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { type CalendarEvent, useCalendarEvents } from "@/hooks/use-calendar";
import { useConfig } from "@/hooks/use-config";
import { getTodayDateString } from "@/lib/date";

interface CalendarPanelProps {
  className?: string;
}

function formatTimeRange(startTime: string, endTime: string, isAllDay: boolean): string {
  if (isAllDay) {
    return "終日";
  }

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  };

  return `${formatTime(startTime)} - ${formatTime(endTime)}`;
}

function getEventStatus(event: CalendarEvent): "past" | "current" | "upcoming" {
  const now = new Date();
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);

  if (now > end) return "past";
  if (now >= start && now <= end) return "current";
  return "upcoming";
}

function CalendarEventItem({
  event,
  onMarkAsRead,
}: {
  event: CalendarEvent;
  onMarkAsRead: (id: number) => void;
}) {
  const status = getEventStatus(event);

  return (
    <div
      className={`group p-3 rounded-lg border transition-colors ${
        status === "current"
          ? "border-green-500 bg-green-500/10"
          : status === "past"
            ? "border-muted bg-muted/30 opacity-60"
            : "border-border hover:bg-muted/50"
      } ${!event.isRead ? "border-l-4 border-l-primary" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Time and Title */}
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`text-sm font-mono ${
                status === "current"
                  ? "text-green-600 dark:text-green-400"
                  : "text-muted-foreground"
              }`}
            >
              {formatTimeRange(event.startTime, event.endTime, event.isAllDay)}
            </span>
            {status === "current" && (
              <Badge variant="default" className="bg-green-500 text-xs">
                開催中
              </Badge>
            )}
          </div>
          <h4 className="font-medium truncate">{event.summary}</h4>

          {/* Location */}
          {event.location && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
              <MapPin className="h-3 w-3" />
              <span className="truncate">{event.location}</span>
            </div>
          )}

          {/* Conference Link */}
          {event.conferenceLink && (
            <div className="flex items-center gap-1 text-sm mt-1">
              <Video className="h-3 w-3 text-blue-500" />
              <a
                href={event.conferenceLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline truncate"
              >
                ビデオ会議に参加
                <ExternalLink className="h-3 w-3 inline ml-1" />
              </a>
            </div>
          )}

          {/* Attendees */}
          {event.attendees && event.attendees.length > 0 && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
              <Users className="h-3 w-3" />
              <span className="truncate">
                {event.attendees
                  .slice(0, 3)
                  .map((a) => a.displayName || a.email.split("@")[0])
                  .join(", ")}
                {event.attendees.length > 3 && ` 他${event.attendees.length - 3}名`}
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!event.isRead && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onMarkAsRead(event.id)}
            >
              <Check className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function CalendarPanel({ className }: CalendarPanelProps) {
  const date = getTodayDateString();
  const { integrations, loading: configLoading } = useConfig();
  const { events, loading, error, refetch, markAsRead } = useCalendarEvents({ date });

  // イベントを時間順にソート
  const sortedEvents = useMemo(() => {
    return [...events].sort((a, b) => {
      if (a.isAllDay && !b.isAllDay) return -1;
      if (!a.isAllDay && b.isAllDay) return 1;
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });
  }, [events]);

  // 統計
  const stats = useMemo(() => {
    const now = new Date();
    let past = 0;
    let current = 0;
    let upcoming = 0;
    let unread = 0;

    for (const event of events) {
      const start = new Date(event.startTime);
      const end = new Date(event.endTime);

      if (now > end) past++;
      else if (now >= start) current++;
      else upcoming++;

      if (!event.isRead) unread++;
    }

    return { past, current, upcoming, unread, total: events.length };
  }, [events]);

  // 連携が無効な場合
  if (!configLoading && integrations && !integrations.calendar?.enabled) {
    return (
      <Card className={className}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="h-5 w-5" />
            Google Calendar
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Google Calendar 連携は無効です</p>
            <p className="text-sm mt-1">Integrations パネルで有効にしてください</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calendar className="h-5 w-5" />
            本日の予定
            {stats.unread > 0 && (
              <Badge variant="secondary" className="ml-2">
                {stats.unread} 新着
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        {/* サマリー */}
        {events.length > 0 && (
          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
            <span className="flex items-center gap-1">
              <CalendarDays className="h-4 w-4" />
              {stats.total}件
            </span>
            {stats.current > 0 && (
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <Clock className="h-4 w-4" />
                {stats.current}件開催中
              </span>
            )}
            {stats.upcoming > 0 && (
              <span className="flex items-center gap-1">{stats.upcoming}件予定</span>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : error ? (
          <div className="text-center py-8 text-destructive">
            <p>エラー: {error}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
              再試行
            </Button>
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>本日の予定はありません</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedEvents.map((event) => (
              <CalendarEventItem key={event.id} event={event} onMarkAsRead={markAsRead} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
