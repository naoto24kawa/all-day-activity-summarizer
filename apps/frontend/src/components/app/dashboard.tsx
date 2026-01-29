import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getTodayDateString } from "@/lib/date";
import { ActivityFeed } from "./activity-feed";
import { ClaudeCodeFeed } from "./claude-code-feed";
import { EvaluatorLogPanel } from "./evaluator-log-panel";
import { MemoPanel } from "./memo-panel";
import { MonitoringPanel } from "./monitoring-panel";
import { SlackFeed } from "./slack-feed";
import { SpeakerAssignPanel } from "./speaker-assign-panel";
import { StatusPanel } from "./status-panel";
import { SummaryView } from "./summary-view";
import { Timeline } from "./timeline";

export function Dashboard() {
  const [date, setDate] = useState(getTodayDateString());
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">All Day Activity Summarizer</h1>
          <span className="font-mono text-lg text-muted-foreground">
            {now.toLocaleTimeString()}
          </span>
        </div>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-auto"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <StatusPanel />
        <SummaryView date={date} />
      </div>

      <Tabs defaultValue="activity">
        <TabsList>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="activity">
          <div className="space-y-6 pt-4">
            <div className="grid gap-6 lg:grid-cols-2">
              <ActivityFeed date={date} />
              <MemoPanel date={date} />
            </div>
            <SlackFeed date={date} />
            <ClaudeCodeFeed date={date} />
          </div>
        </TabsContent>
        <TabsContent value="timeline">
          <div className="pt-4">
            <Timeline date={date} />
          </div>
        </TabsContent>
        <TabsContent value="settings">
          <div className="grid gap-6 pt-4 lg:grid-cols-2">
            <SpeakerAssignPanel />
            <MonitoringPanel />
          </div>
        </TabsContent>
        <TabsContent value="logs">
          <div className="pt-4">
            <EvaluatorLogPanel date={date} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
