import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useJobNotifications } from "@/hooks/use-job-notifications";
import { useTabBadges } from "@/hooks/use-tab-badges";
import { TAB_GROUPS, type TabGroupId, type TabId } from "@/lib/tab-groups";
import { ActivityFeed } from "./activity-feed";
import { AiProcessingLogPanel } from "./ai-processing-log-panel";
import { AISettingsPanel } from "./ai-settings-panel";
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
import { SubTabNav } from "./sub-tab-nav";
import { SummaryView } from "./summary-view";
import { TasksPanel } from "./tasks-panel";
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
  const { badges, groupBadges, refetch: refetchBadges } = useTabBadges();

  // AI Job通知フック (トースト通知 + リアルタイム統計)
  const { stats: jobStats } = useJobNotifications({
    enableToast: true,
    enableWebNotification: true,
    enableSound: true,
    onTasksUpdated: useCallback(() => {
      refetchBadges();
    }, [refetchBadges]),
    onLearningsUpdated: useCallback(() => {
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
        <HeaderControls now={now} jobStats={jobStats} />

        {/* 2段タブ構造 */}
        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          {/* 1段目: グループタブ (下線スタイル) */}
          <Tabs value={activeGroup} onValueChange={handleGroupChange} className="shrink-0">
            <TabsList variant="line" className="border-border border-b pb-0">
              {TAB_GROUPS.map((group) => {
                const GroupIcon = group.icon;
                const groupBadgeCount = groupBadges[group.id];
                return (
                  <TabsTrigger
                    key={group.id}
                    value={group.id}
                    className="gap-1.5 px-4 py-2 text-base font-medium"
                  >
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

          {/* 2段目: サブタブ (背景付き、インデント) */}
          {currentGroup && (
            <div className="bg-muted/30 mt-2 flex min-h-0 flex-1 flex-col rounded-lg border p-2">
              <SubTabNav
                tabs={currentGroup.tabs}
                value={currentTab}
                onValueChange={handleTabChange}
                badges={badges}
                badgeVariants={BADGE_VARIANTS}
                className="mb-2"
              />
              <Tabs
                value={currentTab}
                onValueChange={handleTabChange}
                className="flex min-h-0 flex-1 flex-col"
              >
                {/* コンテンツエリア */}
                <TabsContent value="activity" className="min-h-0 flex-1">
                  <SummaryView className="h-full" />
                </TabsContent>
                <TabsContent value="tasks" className="min-h-0 flex-1">
                  <TasksPanel className="h-full" />
                </TabsContent>
                <TabsContent value="audio" className="min-h-0 flex-1">
                  <div className="grid h-full gap-4 lg:grid-cols-2">
                    <ActivityFeed className="h-full" />
                    <Timeline className="h-full" />
                  </div>
                </TabsContent>
                <TabsContent value="slack" className="min-h-0 flex-1">
                  <SlackFeed className="h-full" />
                </TabsContent>
                <TabsContent value="github" className="min-h-0 flex-1">
                  <GitHubFeed className="h-full" />
                </TabsContent>
                <TabsContent value="claude" className="min-h-0 flex-1">
                  <ClaudeCodeFeed className="h-full" />
                </TabsContent>
                <TabsContent value="learnings" className="min-h-0 flex-1">
                  <LearningsFeed className="h-full" />
                </TabsContent>
                <TabsContent value="whisper" className="min-h-0 flex-1">
                  <VocabularyPanel className="h-full" />
                </TabsContent>
                <TabsContent value="logs" className="min-h-0 flex-1 overflow-auto">
                  <div className="space-y-4">
                    <AiProcessingLogPanel />
                    <ServerLogsPanel />
                    <EvaluatorLogPanel />
                  </div>
                </TabsContent>
                <TabsContent value="settings" className="min-h-0 flex-1 overflow-auto">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-4">
                      <IntegrationsPanel />
                      <ProfilePanel />
                    </div>
                    <div className="space-y-4">
                      <AISettingsPanel />
                      <MonitoringPanel />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </div>

        {/* フローティングモード時のパネル */}
        {!isMemoSidebar && (
          <MemoFloatingChat
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
      {isMemoSidebar && <MemoFloatingChat initialSidebar onSidebarChange={setIsMemoSidebar} />}
      {isClaudeChatSidebar && (
        <ClaudeChatPanel initialSidebar onSidebarChange={setIsClaudeChatSidebar} />
      )}
    </div>
  );
}
