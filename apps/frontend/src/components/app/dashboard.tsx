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
import { GitHubFeed } from "./github-feed";
import { HeaderControls } from "./header-controls";
import { IntegrationsPanel } from "./integrations-panel";
import { LearningsFeed } from "./learnings-feed";
import { MemoFloatingChat } from "./memo-floating-chat";
import { MonitoringPanel } from "./monitoring-panel";
import { NotionFeed } from "./notion-feed";
import { ProfilePanel } from "./profile-panel";
import { ServerLogsPanel } from "./server-logs-panel";
import { SlackFeed } from "./slack-feed";
import { SubTabNav } from "./sub-tab-nav";
import { SummaryView } from "./summary-view";
import { SystemControlPanel } from "./system-control-panel";
import { TasksPanel } from "./tasks-panel";
import { Timeline } from "./timeline";
import { VocabularyPanel } from "./vocabulary-panel";

// LocalStorage keys
const STORAGE_KEY_ACTIVE_GROUP = "adas-dashboard-active-group";
const STORAGE_KEY_ACTIVE_TABS = "adas-dashboard-active-tabs";
const STORAGE_KEY_MEMO_SIDEBAR = "adas-memo-sidebar";
const STORAGE_KEY_CLAUDE_CHAT_SIDEBAR = "adas-claude-chat-sidebar";
const STORAGE_KEY_MEMO_HEIGHT = "adas-memo-height";

const DEFAULT_ACTIVE_TABS: Record<TabGroupId, TabId> = {
  overview: "activity",
  feeds: "audio",
  tools: "learnings",
  system: "logs",
};

/** LocalStorage から activeGroup を読み込む */
function loadActiveGroup(): TabGroupId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_ACTIVE_GROUP);
    if (saved && TAB_GROUPS.some((g) => g.id === saved)) {
      return saved as TabGroupId;
    }
  } catch {
    // LocalStorage アクセスエラーは無視
  }
  return "overview";
}

/** LocalStorage から activeTabs を読み込む */
function loadActiveTabs(): Record<TabGroupId, TabId> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY_ACTIVE_TABS);
    if (saved) {
      const parsed = JSON.parse(saved);
      // 各グループに有効なタブがあるか検証
      const result = { ...DEFAULT_ACTIVE_TABS };
      for (const group of TAB_GROUPS) {
        if (parsed[group.id] && group.tabs.some((t) => t.id === parsed[group.id])) {
          result[group.id] = parsed[group.id];
        }
      }
      return result;
    }
  } catch {
    // LocalStorage アクセスエラーは無視
  }
  return DEFAULT_ACTIVE_TABS;
}

/** LocalStorage から boolean を読み込む */
function loadBoolean(key: string, defaultValue: boolean): boolean {
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) {
      return saved === "true";
    }
  } catch {
    // LocalStorage アクセスエラーは無視
  }
  return defaultValue;
}

/** LocalStorage から number を読み込む */
function loadNumber(key: string, defaultValue: number): number {
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null) {
      const num = Number(saved);
      if (!Number.isNaN(num)) {
        return num;
      }
    }
  } catch {
    // LocalStorage アクセスエラーは無視
  }
  return defaultValue;
}

/** LocalStorage に保存 */
function saveToStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // LocalStorage アクセスエラーは無視
  }
}

// バッジのバリアントマッピング
const BADGE_VARIANTS: Record<string, "destructive" | "secondary" | "default" | "outline"> = {
  tasks: "destructive",
  learnings: "secondary",
  slack: "default",
  github: "outline",
};

export function Dashboard() {
  const [now, setNow] = useState(new Date());
  const [isMemoSidebar, setIsMemoSidebar] = useState(() =>
    loadBoolean(STORAGE_KEY_MEMO_SIDEBAR, false),
  );
  const [isClaudeChatSidebar, setIsClaudeChatSidebar] = useState(() =>
    loadBoolean(STORAGE_KEY_CLAUDE_CHAT_SIDEBAR, false),
  );
  // フローティングパネルの開閉状態 (アイコン位置調整用)
  const [isMemoOpen, setIsMemoOpen] = useState(true);
  const [memoHeight, setMemoHeight] = useState(() => loadNumber(STORAGE_KEY_MEMO_HEIGHT, 500));
  const [activeGroup, setActiveGroup] = useState<TabGroupId>(loadActiveGroup);
  const [activeTabs, setActiveTabs] = useState<Record<TabGroupId, TabId>>(loadActiveTabs);
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

  // 状態変更時に LocalStorage に保存
  useEffect(() => {
    saveToStorage(STORAGE_KEY_ACTIVE_GROUP, activeGroup);
  }, [activeGroup]);

  useEffect(() => {
    saveToStorage(STORAGE_KEY_ACTIVE_TABS, JSON.stringify(activeTabs));
  }, [activeTabs]);

  useEffect(() => {
    saveToStorage(STORAGE_KEY_MEMO_SIDEBAR, String(isMemoSidebar));
  }, [isMemoSidebar]);

  useEffect(() => {
    saveToStorage(STORAGE_KEY_CLAUDE_CHAT_SIDEBAR, String(isClaudeChatSidebar));
  }, [isClaudeChatSidebar]);

  useEffect(() => {
    saveToStorage(STORAGE_KEY_MEMO_HEIGHT, String(memoHeight));
  }, [memoHeight]);

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
                <TabsContent value="notion" className="min-h-0 flex-1">
                  <NotionFeed className="h-full" />
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
                  </div>
                </TabsContent>
                <TabsContent value="profile" className="min-h-0 flex-1 overflow-auto">
                  <ProfilePanel className="h-full" />
                </TabsContent>
                <TabsContent value="ai-settings" className="min-h-0 flex-1 overflow-auto">
                  <AISettingsPanel className="h-full" />
                </TabsContent>
                <TabsContent value="settings" className="min-h-0 flex-1 overflow-auto">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <IntegrationsPanel />
                    <div className="space-y-4">
                      <SystemControlPanel />
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
