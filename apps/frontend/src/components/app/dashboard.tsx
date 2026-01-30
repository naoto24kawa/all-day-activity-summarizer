import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTabBadges } from "@/hooks/use-tab-badges";
import { formatTimeJST, getTodayDateString } from "@/lib/date";
import { ActivityFeed } from "./activity-feed";
import { BrowserRecordingPanel } from "./browser-recording-panel";
import { ClaudeCodeFeed } from "./claude-code-feed";
import { EvaluatorLogPanel } from "./evaluator-log-panel";
import { GitHubFeed } from "./github-feed";
import { LearningsFeed } from "./learnings-feed";
import { MemoPanel } from "./memo-panel";
import { MonitoringPanel } from "./monitoring-panel";
import { ProfilePanel } from "./profile-panel";
import { ProjectsPanel } from "./projects-panel";
import { PromptImprovementsPanel } from "./prompt-improvements-panel";
import { ServerLogsPanel } from "./server-logs-panel";
import { SlackFeed } from "./slack-feed";
import { SlackUsersPanel } from "./slack-users-panel";
import { StatusPanel } from "./status-panel";
import { SummaryView } from "./summary-view";
import { TasksPanel } from "./tasks-panel";
import { Timeline } from "./timeline";
import { VocabularyPanel } from "./vocabulary-panel";

export function Dashboard() {
  const [date, setDate] = useState(getTodayDateString());
  const [now, setNow] = useState(new Date());
  const { badges } = useTabBadges(date);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden p-4">
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">All Day Activity Summarizer</h1>
          <span className="font-mono text-lg text-muted-foreground">{formatTimeJST(now)}</span>
        </div>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-auto"
        />
      </div>

      <div className="mt-4 grid shrink-0 gap-4 lg:grid-cols-2">
        <StatusPanel />
        <BrowserRecordingPanel />
      </div>

      <Tabs defaultValue="activity" className="mt-4 flex min-h-0 flex-1 flex-col">
        <TabsList className="shrink-0">
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="tasks">
            Tasks
            {badges.tasks > 0 && (
              <Badge variant="destructive" className="ml-1.5 h-5 min-w-5 px-1.5">
                {badges.tasks}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="learnings">
            Learnings
            {badges.learnings > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-5 min-w-5 px-1.5">
                {badges.learnings}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="slack">Slack</TabsTrigger>
          <TabsTrigger value="github">GitHub</TabsTrigger>
          <TabsTrigger value="claude">Claude</TabsTrigger>
          <TabsTrigger value="whisper">Whisper</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="activity" className="min-h-0 flex-1">
          <div className="grid h-full gap-4 lg:grid-cols-2">
            <SummaryView date={date} className="h-full" />
            <MemoPanel date={date} className="h-full" />
          </div>
        </TabsContent>
        <TabsContent value="learnings" className="min-h-0 flex-1">
          <LearningsFeed date={date} className="h-full" />
        </TabsContent>
        <TabsContent value="claude" className="min-h-0 flex-1">
          <ClaudeCodeFeed date={date} className="h-full" />
        </TabsContent>
        <TabsContent value="timeline" className="min-h-0 flex-1">
          <div className="grid h-full gap-4 lg:grid-cols-2">
            <ActivityFeed date={date} className="h-full" />
            <Timeline date={date} className="h-full" />
          </div>
        </TabsContent>
        <TabsContent value="tasks" className="min-h-0 flex-1">
          <div className="grid h-full gap-4 lg:grid-cols-[1fr_320px]">
            <TasksPanel date={date} className="h-full" />
            <ProjectsPanel />
          </div>
        </TabsContent>
        <TabsContent value="slack" className="min-h-0 flex-1">
          <div className="grid h-full gap-4 lg:grid-cols-[1fr_320px]">
            <SlackFeed date={date} className="h-full" />
            <SlackUsersPanel />
          </div>
        </TabsContent>
        <TabsContent value="github" className="min-h-0 flex-1">
          <GitHubFeed date={date} className="h-full" />
        </TabsContent>
        <TabsContent value="whisper" className="min-h-0 flex-1">
          <VocabularyPanel />
        </TabsContent>
        <TabsContent value="settings" className="min-h-0 flex-1 overflow-auto">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <ProfilePanel />
            </div>
            <div className="space-y-4">
              <PromptImprovementsPanel />
              <MonitoringPanel />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="logs" className="min-h-0 flex-1 overflow-auto">
          <div className="space-y-4">
            <ServerLogsPanel date={date} />
            <EvaluatorLogPanel date={date} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
