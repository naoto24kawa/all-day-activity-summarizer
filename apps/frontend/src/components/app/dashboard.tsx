import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useJobNotifications } from "@/hooks/use-job-notifications";
import { useTabBadges } from "@/hooks/use-tab-badges";
import { formatTimeJST, getTodayDateString } from "@/lib/date";
import { TAB_GROUPS, type TabGroupId, type TabId } from "@/lib/tab-groups";
import { ActivityFeed } from "./activity-feed";
import { AiProcessingLogPanel } from "./ai-processing-log-panel";
import { ClaudeChatPanel } from "./claude-chat-panel";
import { ClaudeCodeFeed } from "./claude-code-feed";
import { EvaluatorLogPanel } from "./evaluator-log-panel";
import { GitHubFeed } from "./github-feed";
import { HeaderControls } from "./header-controls";
import { IntegrationsPanel } from "./integrations-panel";
import { LearningsFeed } from "./learnings-feed";
import { MemoFloatingChat } from "./memo-floating-chat";
import { MonitoringPanel } from "./monitoring-panel";
import { ProfilePanel } from "./profile-panel";
import { ServerLogsPanel } from "./server-logs-panel";
import { SlackFeed } from "./slack-feed";
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
  const [isClaudeChatSidebar, setIsClaudeChatSidebar] = useState(false);
  // フローティングパネルの開閉状態 (アイコン位置調整用)
  const [isMemoOpen, setIsMemoOpen] = useState(true);
  const [memoHeight, setMemoHeight] = useState(500); // デフォルト高さ
  const [activeGroup, setActiveGroup] = useState<TabGroupId>("overview");
  const [activeTabs, setActiveTabs] = useState<Record<TabGroupId, TabId>>({
    overview: "activity",
    feeds: "audio",
    tools: "learnings",
    system: "logs",
  });
  const { badges, groupBadges, refetch: refetchBadges } = useTabBadges(date);

  // AI Job通知フック (トースト通知 + リアルタイム統計)
  const { stats: jobStats } = useJobNotifications({
    enableToast: true,
    enableWebNotification: true,
    enableSound: true,
    onTasksUpdated: useCallback(() => {
      refetchBadges();
    }, [refetchBadges]),
  });

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
        <HeaderControls now={now} date={date} onDateChange={setDate} jobStats={jobStats} />

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
              <TabsContent value="tasks" className="min-h-0 flex-1">
                <TasksPanel date={date} className="h-full" />
              </TabsContent>
              <TabsContent value="audio" className="min-h-0 flex-1">
                <div className="grid h-full gap-4 lg:grid-cols-2">
                  <ActivityFeed date={date} className="h-full" />
                  <Timeline date={date} className="h-full" />
                </div>
              </TabsContent>
              <TabsContent value="slack" className="min-h-0 flex-1">
                <SlackFeed date={date} className="h-full" />
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
                <VocabularyPanel date={date} className="h-full" />
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

        {/* フローティングモード時のパネル */}
        {!isMemoSidebar && (
          <MemoFloatingChat
            date={date}
            onSidebarChange={setIsMemoSidebar}
            onOpenChange={setIsMemoOpen}
            onHeightChange={setMemoHeight}
          />
        )}
        {!isClaudeChatSidebar && (
          <ClaudeChatPanel
            onSidebarChange={setIsClaudeChatSidebar}
            memoOpen={!isMemoSidebar && isMemoOpen}
            memoHeight={memoHeight}
          />
        )}
      </div>

      {/* サイドバーモード時のパネル */}
      {isMemoSidebar && (
        <MemoFloatingChat date={date} initialSidebar onSidebarChange={setIsMemoSidebar} />
      )}
      {isClaudeChatSidebar && (
        <ClaudeChatPanel initialSidebar onSidebarChange={setIsClaudeChatSidebar} />
      )}
    </div>
  );
}
