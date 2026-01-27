import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useTranscriptions } from "@/hooks/use-transcriptions";

interface TimelineProps {
  date: string;
}

export function Timeline({ date }: TimelineProps) {
  const { segments } = useTranscriptions(date);

  // Group segments by hour
  const hourlyData = Array.from({ length: 24 }, (_, hour) => {
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
    <Card>
      <CardHeader>
        <CardTitle>Activity Timeline</CardTitle>
      </CardHeader>
      <CardContent>
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
