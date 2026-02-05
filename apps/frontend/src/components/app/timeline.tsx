import { Clock } from "lucide-react";
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useTranscriptions } from "@/hooks/use-transcriptions";
import { getTodayDateString } from "@/lib/date";

interface TimelineProps {
  className?: string;
}

export function Timeline({ className }: TimelineProps) {
  const date = getTodayDateString();
  const { segments, refetch } = useTranscriptions(date);

  // 外部からの更新イベントをリッスン
  useEffect(() => {
    const handleRefresh = () => refetch();
    window.addEventListener("audio-refresh", handleRefresh);
    return () => window.removeEventListener("audio-refresh", handleRefresh);
  }, [refetch]);

  const START_HOUR = 9;
  const END_HOUR = 19;

  // Group segments by hour (business hours only)
  const hourlyData = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => {
    const hour = START_HOUR + i;
    const hourSegments = segments.filter((s) => {
      const h = new Date(s.startTime).getHours();
      return h === hour;
    });
    return {
      hour,
      count: hourSegments.length,
      totalChars: hourSegments.reduce((sum, s) => sum + s.transcription.length, 0),
    };
  });

  const maxChars = Math.max(...hourlyData.map((d) => d.totalChars), 1);

  return (
    <Card className={`flex min-h-0 flex-col overflow-hidden ${className ?? ""}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-cyan-500" />
          Activity Timeline
        </CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 overflow-auto">
        <div className="space-y-1">
          {hourlyData.map(({ hour, count, totalChars }) => (
            <div key={hour} className="flex items-center gap-2">
              <span className="w-12 text-right text-xs text-muted-foreground">
                {String(hour).padStart(2, "0")}:00
              </span>
              <Progress value={(totalChars / maxChars) * 100} className="h-3 flex-1" />
              <span className="w-8 text-xs text-muted-foreground">{count > 0 ? count : ""}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
