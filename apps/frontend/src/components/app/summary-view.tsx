import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSummaries } from "@/hooks/use-summaries";

interface SummaryViewProps {
  date: string;
}

export function SummaryView({ date }: SummaryViewProps) {
  const {
    summaries: pomodoroSummaries,
    loading: pomodoroLoading,
    error: pomodoroError,
  } = useSummaries(date, "pomodoro");
  const {
    summaries: hourlySummaries,
    loading: hourlyLoading,
    error: hourlyError,
  } = useSummaries(date, "hourly");
  const {
    summaries: dailySummaries,
    loading: dailyLoading,
    error: dailyError,
  } = useSummaries(date, "daily");
  const { generateSummary } = useSummaries(date);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateSummary({ date });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Summaries</CardTitle>
          <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating}>
            {generating ? "Generating..." : "Generate"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="daily">
          <TabsList className="mb-4">
            <TabsTrigger value="daily">
              Daily
              {dailySummaries.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {dailySummaries.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="hourly">
              Hourly
              {hourlySummaries.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {hourlySummaries.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="pomodoro">
              Pomodoro
              {pomodoroSummaries.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {pomodoroSummaries.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="daily">
            {dailyLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : dailyError ? (
              <p className="text-sm text-muted-foreground">{dailyError}</p>
            ) : dailySummaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No daily summary yet.</p>
            ) : (
              <ScrollArea className="h-[300px]">
                {dailySummaries.map((summary) => (
                  <div key={summary.id} className="prose prose-sm dark:prose-invert max-w-none">
                    <pre className="whitespace-pre-wrap text-sm">{summary.content}</pre>
                  </div>
                ))}
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="hourly">
            {hourlyLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : hourlyError ? (
              <p className="text-sm text-muted-foreground">{hourlyError}</p>
            ) : hourlySummaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hourly summaries yet.</p>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-4">
                  {[...hourlySummaries].reverse().map((summary) => (
                    <div key={summary.id} className="rounded-md border p-3">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        {new Date(summary.periodStart).toLocaleTimeString()} -{" "}
                        {new Date(summary.periodEnd).toLocaleTimeString()}
                      </p>
                      <pre className="whitespace-pre-wrap text-sm">{summary.content}</pre>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="pomodoro">
            {pomodoroLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : pomodoroError ? (
              <p className="text-sm text-muted-foreground">{pomodoroError}</p>
            ) : pomodoroSummaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pomodoro summaries yet.</p>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-4">
                  {[...pomodoroSummaries].reverse().map((summary) => (
                    <div key={summary.id} className="rounded-md border p-3">
                      <p className="mb-1 text-xs font-medium text-muted-foreground">
                        {new Date(summary.periodStart).toLocaleTimeString()} -{" "}
                        {new Date(summary.periodEnd).toLocaleTimeString()}
                      </p>
                      <pre className="whitespace-pre-wrap text-sm">{summary.content}</pre>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
