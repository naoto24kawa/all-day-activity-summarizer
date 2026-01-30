import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTabBadges } from "@/hooks/use-tab-badges";
import { formatTimeJST, getTodayDateString } from "@/lib/date";
import { TAB_GROUPS, type TabGroupId, type TabId } from "@/lib/tab-groups";
import { ActivityFeed } from "./activity-feed";
import { AiProcessingLogPanel } from "./ai-processing-log-panel";
import { BrowserRecordingPanel } from "./browser-recording-panel";
import { ClaudeCodeFeed } from "./claude-code-feed";
import { EvaluatorLogPanel } from "./evaluator-log-panel";
import { GitHubFeed } from "./github-feed";
import { IntegrationsPanel } from "./integrations-panel";
import { LearningsFeed } from "./learnings-feed";
import { MemoFloatingChat } from "./memo-floating-chat";
import { MonitoringPanel } from "./monitoring-panel";
import { ProfilePanel } from "./profile-panel";
import { ProjectsPanel } from "./projects-panel";
import { ServerLogsPanel } from "./server-logs-panel";
import { SlackFeed } from "./slack-feed";
import { SlackUsersPanel } from "./slack-users-panel";
import { StatusPanel } from "./status-panel";
import { SummaryView } from "./summary-view";
import { TasksPanel } from "./tasks-panel";
import { ThemeToggle } from "./theme-toggle";
import { Timeline } from "./timeline";
import { VocabularyPanel } from "./vocabulary-panel";

// バッジのバリアントマッピング
const BADGE_VARIANTS: Record<string, "destructive" | "secondary" | "default" | "outline"> = {
  tasks: "destructive",
  learnings: "secondary",
  slack: "default",
  github: "outline",
};

export function Dashboard() {
  const [date, setDate] = useState(getTodayDateString());
  const [now, setNow] = useState(new Date());
  const [isMemoSidebar, setIsMemoSidebar] = useState(false);
  const [activeGroup, setActiveGroup] = useState<TabGroupId>("overview");
  const [activeTabs, setActiveTabs] = useState<Record<TabGroupId, TabId>>({
    overview: "activity",
    feeds: "slack",
    tools: "learnings",
    system: "logs",
  });
  const { badges, groupBadges } = useTabBadges(date);

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleGroupChange = (groupId: string) => {
    setActiveGroup(groupId as TabGroupId);
  };

  const handleTabChange = (tabId: string) => {
    setActiveTabs((prev) => ({
      ...prev,
      [activeGroup]: tabId as TabId,
    }));
  };

  const currentGroup = TAB_GROUPS.find((g) => g.id === activeGroup);
  const currentTab = activeTabs[activeGroup];

  return (
    <div className="flex h-screen overflow-hidden">
      {/* メインコンテンツ */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-4">
        <div className="flex shrink-0 items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">All Day Activity Summarizer</h1>
            <span className="font-mono text-lg text-muted-foreground">{formatTimeJST(now)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-auto"
            />
            <ThemeToggle />
          </div>
        </div>

        <div className="mt-4 grid shrink-0 gap-4 lg:grid-cols-2">
          <StatusPanel />
          <BrowserRecordingPanel />
        </div>

        {/* 2段タブ構造 */}
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          {/* 1段目: グループタブ */}
          <Tabs value={activeGroup} onValueChange={handleGroupChange} className="shrink-0">
            <TabsList>
              {TAB_GROUPS.map((group) => {
                const GroupIcon = group.icon;
                const groupBadgeCount = groupBadges[group.id];
                return (
                  <TabsTrigger key={group.id} value={group.id} className="gap-1.5">
                    <GroupIcon className="h-4 w-4" />
                    {group.label}
                    {groupBadgeCount > 0 && (
                      <Badge variant="secondary" className="ml-1.5 h-5 min-w-5 px-1.5">
                        {groupBadgeCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>

          {/* 2段目: サブタブ */}
          {currentGroup && (
            <Tabs
              value={currentTab}
              onValueChange={handleTabChange}
              className="mt-2 flex min-h-0 flex-1 flex-col"
            >
              <TabsList className="shrink-0">
                {currentGroup.tabs.map((tab) => {
                  const TabIcon = tab.icon;
                  const badgeCount = tab.badgeKey ? badges[tab.badgeKey] : 0;
                  const badgeVariant = tab.badgeKey ? BADGE_VARIANTS[tab.badgeKey] : "secondary";
                  return (
                    <TabsTrigger key={tab.id} value={tab.id} className="gap-1.5">
                      <TabIcon className="h-4 w-4" />
                      {tab.label}
                      {badgeCount > 0 && (
                        <Badge variant={badgeVariant} className="ml-1.5 h-5 min-w-5 px-1.5">
                          {badgeCount}
                        </Badge>
                      )}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {/* コンテンツエリア */}
              <TabsContent value="activity" className="min-h-0 flex-1">
                <SummaryView date={date} className="h-full" />
              </TabsContent>
              <TabsContent value="timeline" className="min-h-0 flex-1">
                <div className="grid h-full gap-4 lg:grid-cols-2">
                  <ActivityFeed date={date} className="h-full" />
                  <Timeline date={date} className="h-full" />
                </div>
              </TabsContent>
              <TabsContent value="tasks" className="min-h-0 flex-1">
                <div className="grid h-full gap-4 lg:grid-cols-[3fr_2fr]">
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
              <TabsContent value="claude" className="min-h-0 flex-1">
                <ClaudeCodeFeed date={date} className="h-full" />
              </TabsContent>
              <TabsContent value="learnings" className="min-h-0 flex-1">
                <LearningsFeed date={date} className="h-full" />
              </TabsContent>
              <TabsContent value="whisper" className="min-h-0 flex-1">
                <VocabularyPanel date={date} />
              </TabsContent>
              <TabsContent value="logs" className="min-h-0 flex-1 overflow-auto">
                <div className="space-y-4">
                  <AiProcessingLogPanel date={date} />
                  <ServerLogsPanel date={date} />
                  <EvaluatorLogPanel date={date} />
                </div>
              </TabsContent>
              <TabsContent value="settings" className="min-h-0 flex-1 overflow-auto">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-4">
                    <IntegrationsPanel />
                    <ProfilePanel />
                  </div>
                  <div className="space-y-4">
                    <MonitoringPanel />
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </div>

        {/* フローティングモード時のメモチャット */}
        {!isMemoSidebar && <MemoFloatingChat date={date} onSidebarChange={setIsMemoSidebar} />}
      </div>

      {/* サイドバーモード時のメモチャット */}
      {isMemoSidebar && (
        <MemoFloatingChat date={date} initialSidebar onSidebarChange={setIsMemoSidebar} />
      )}
    </div>
  );
}
