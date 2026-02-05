/**
 * Slack Feed Component
 *
 * Displays Slack messages from mentions, channels, and DMs
 */

import type { Project, SlackMessage, SlackMessagePriority } from "@repo/types";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  AtSign,
  Check,
  ChevronDown,
  ExternalLink,
  FolderGit2,
  Hash,
  Loader2,
  MessageSquare,
  Search,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SegmentedTabContent, SegmentedTabs } from "@/components/ui/segmented-tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfig } from "@/hooks/use-config";
import { formatSlackTsJST } from "@/lib/date";
import { SlackFeedProvider, useSlackFeedContext } from "./slack-feed-context";

interface SlackFeedProps {
  className?: string;
}

export function SlackFeed({ className }: SlackFeedProps) {
  return (
    <SlackFeedProvider>
      <SlackFeedInner className={className} />
    </SlackFeedProvider>
  );
}

/** SlackFeed の内部コンポーネント (Provider なし) */
export function SlackFeedInner({ className }: SlackFeedProps) {
  const { integrations, loading: configLoading } = useConfig();
  const {
    messages,
    loading,
    error,
    counts,
    projects,
    filteredMessages,
    markAsRead,
    updateMessage,
    updatePriority,
    updateChannelProject,
    getChannelProjectId,
  } = useSlackFeedContext();

  // タブ状態
  const [activeTab, setActiveTab] = useState("mention");

  // 連携が無効な場合
  if (!configLoading && integrations && !integrations.slack.enabled) {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center justify-center py-8">
          <Settings className="mb-2 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Slack 連携は無効化されています</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Settings タブの Integrations で有効にできます
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="space-y-3 pt-6">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const mentionMessages = filteredMessages.filter((m) => m.messageType === "mention");
  const channelMessages = filteredMessages.filter((m) => m.messageType === "channel");
  const dmMessages = filteredMessages.filter((m) => m.messageType === "dm");
  const keywordMessages = filteredMessages.filter((m) => m.messageType === "keyword");

  return (
    <Card className={`flex min-h-0 flex-1 flex-col overflow-hidden ${className ?? ""}`}>
      <CardContent className="flex min-h-0 flex-1 flex-col pt-4">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Slack messages for this date.</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <SegmentedTabs
              tabs={[
                { id: "mention", label: "Mentions", icon: AtSign, badge: counts.mention },
                { id: "channel", label: "Channels", icon: Hash, badge: counts.channel },
                { id: "dm", label: "DMs", icon: MessageSquare, badge: counts.dm },
                { id: "keyword", label: "Keywords", icon: Search, badge: counts.keyword },
              ]}
              value={activeTab}
              onValueChange={setActiveTab}
              className="mb-2 shrink-0"
            />
            <SegmentedTabContent value="mention" activeValue={activeTab}>
              <GroupedMessageList
                messages={mentionMessages}
                onMarkAsRead={markAsRead}
                onUpdateProject={updateMessage}
                onUpdatePriority={updatePriority}
                onUpdateChannelProject={updateChannelProject}
                getChannelProjectId={getChannelProjectId}
                projects={projects}
              />
            </SegmentedTabContent>
            <SegmentedTabContent value="channel" activeValue={activeTab}>
              <GroupedMessageList
                messages={channelMessages}
                onMarkAsRead={markAsRead}
                onUpdateProject={updateMessage}
                onUpdatePriority={updatePriority}
                onUpdateChannelProject={updateChannelProject}
                getChannelProjectId={getChannelProjectId}
                projects={projects}
              />
            </SegmentedTabContent>
            <SegmentedTabContent value="dm" activeValue={activeTab}>
              <GroupedMessageList
                messages={dmMessages}
                onMarkAsRead={markAsRead}
                onUpdateProject={updateMessage}
                onUpdatePriority={updatePriority}
                onUpdateChannelProject={updateChannelProject}
                getChannelProjectId={getChannelProjectId}
                projects={projects}
                isDM
              />
            </SegmentedTabContent>
            <SegmentedTabContent value="keyword" activeValue={activeTab}>
              <GroupedMessageList
                messages={keywordMessages}
                onMarkAsRead={markAsRead}
                onUpdateProject={updateMessage}
                onUpdatePriority={updatePriority}
                onUpdateChannelProject={updateChannelProject}
                getChannelProjectId={getChannelProjectId}
                projects={projects}
              />
            </SegmentedTabContent>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const INITIAL_MESSAGES_PER_CHANNEL = 5;
const LOAD_MORE_COUNT = 10;

function GroupedMessageList({
  messages,
  onMarkAsRead,
  onUpdateProject,
  onUpdatePriority,
  onUpdateChannelProject,
  getChannelProjectId,
  projects,
  isDM = false,
}: {
  messages: SlackMessage[];
  onMarkAsRead: (id: number) => void;
  onUpdateProject: (id: number, data: { projectId?: number | null }) => void;
  onUpdatePriority: (id: number, priority: SlackMessagePriority) => void;
  onUpdateChannelProject: (channelId: string, projectId: number | null) => void;
  getChannelProjectId: (channelId: string) => number | null;
  projects: Project[];
  isDM?: boolean;
}) {
  const [openChannels, setOpenChannels] = useState<Set<string>>(new Set());
  // チャンネルごとの表示件数を管理
  const [channelLimits, setChannelLimits] = useState<Record<string, number>>({});
  // ローディング中のチャンネル
  const [loadingChannels, setLoadingChannels] = useState<Set<string>>(new Set());
  const activeProjects = projects.filter((p) => p.isActive);

  if (messages.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No messages.</p>;
  }

  // チャンネルIDでグループ化 (チャンネル名も保持)
  const groupedMessages = messages.reduce<
    Record<string, { channelId: string; channelName: string; messages: SlackMessage[] }>
  >((acc, message) => {
    const channelId = message.channelId;
    const channelName = message.channelName ?? "Unknown";
    if (!acc[channelId]) {
      acc[channelId] = { channelId, channelName, messages: [] };
    }
    acc[channelId].messages.push(message);
    return acc;
  }, {});

  // チャンネル名でソート(未読数が多い順、次にチャンネル名のアルファベット順)
  const sortedChannelIds = Object.keys(groupedMessages).sort((a, b) => {
    const groupA = groupedMessages[a];
    const groupB = groupedMessages[b];
    if (!groupA || !groupB) return 0;
    const unreadA = groupA.messages.filter((m) => !m.isRead).length;
    const unreadB = groupB.messages.filter((m) => !m.isRead).length;
    if (unreadA !== unreadB) return unreadB - unreadA;
    return groupA.channelName.localeCompare(groupB.channelName);
  });

  const toggleChannel = (channelId: string) => {
    setOpenChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) {
        next.delete(channelId);
      } else {
        next.add(channelId);
      }
      return next;
    });
  };

  const getChannelLimit = (channelId: string) =>
    channelLimits[channelId] ?? INITIAL_MESSAGES_PER_CHANNEL;

  const loadMoreMessages = async (channelId: string) => {
    setLoadingChannels((prev) => new Set(prev).add(channelId));
    // 少し遅延を入れてローディング表示を見せる
    await new Promise((resolve) => setTimeout(resolve, 300));
    setChannelLimits((prev) => ({
      ...prev,
      [channelId]: (prev[channelId] ?? INITIAL_MESSAGES_PER_CHANNEL) + LOAD_MORE_COUNT,
    }));
    setLoadingChannels((prev) => {
      const next = new Set(prev);
      next.delete(channelId);
      return next;
    });
  };

  const handleChannelProjectChange = (channelId: string, value: string) => {
    const newProjectId = value === "none" ? null : Number(value);
    onUpdateChannelProject(channelId, newProjectId);
  };

  const Icon = isDM ? MessageSquare : Hash;

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-2">
        {sortedChannelIds.map((channelId) => {
          const group = groupedMessages[channelId];
          if (!group) return null;
          const { channelName, messages: channelMessages } = group;
          const unreadCount = channelMessages.filter((m) => !m.isRead).length;
          const isOpen = openChannels.has(channelId);
          const channelProjectId = getChannelProjectId(channelId);

          return (
            <Collapsible
              key={channelId}
              open={isOpen}
              onOpenChange={() => toggleChannel(channelId)}
            >
              <div className="flex items-center gap-2 rounded-md border p-3 hover:bg-muted/50">
                <CollapsibleTrigger className="flex flex-1 items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{isDM ? channelName : `#${channelName}`}</span>
                    <Badge variant="secondary" className="text-xs">
                      {channelMessages.length}
                    </Badge>
                    {unreadCount > 0 && (
                      <Badge variant="destructive" className="text-xs">
                        {unreadCount} unread
                      </Badge>
                    )}
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </CollapsibleTrigger>
                {/* チャンネル単位のプロジェクト設定 */}
                {activeProjects.length > 0 && (
                  <Select
                    value={channelProjectId?.toString() ?? "none"}
                    onValueChange={(value) => handleChannelProjectChange(channelId, value)}
                  >
                    <SelectTrigger
                      className="h-7 w-[130px] text-xs"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <FolderGit2 className="mr-1 h-3 w-3" />
                      <SelectValue placeholder="Ch Project" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">なし</SelectItem>
                      {activeProjects.map((project) => (
                        <SelectItem key={project.id} value={project.id.toString()}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <CollapsibleContent className="mt-2 space-y-3 pl-4">
                {(() => {
                  const limit = getChannelLimit(channelId);
                  const displayedMessages = channelMessages.slice(0, limit);
                  const hasMore = channelMessages.length > limit;
                  const remainingCount = channelMessages.length - limit;

                  return (
                    <>
                      {displayedMessages.map((message) => (
                        <SlackMessageItem
                          key={message.id}
                          message={message}
                          onMarkAsRead={onMarkAsRead}
                          onUpdateProject={onUpdateProject}
                          onUpdatePriority={onUpdatePriority}
                          projects={projects}
                          channelProjectId={channelProjectId}
                          showChannel={false}
                        />
                      ))}
                      {hasMore && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full text-muted-foreground"
                          onClick={() => loadMoreMessages(channelId)}
                          disabled={loadingChannels.has(channelId)}
                        >
                          {loadingChannels.has(channelId) ? (
                            <>
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              読み込み中...
                            </>
                          ) : (
                            <>もっと見る ({remainingCount}件)</>
                          )}
                        </Button>
                      )}
                    </>
                  );
                })()}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}

function SlackMessageItem({
  message,
  onMarkAsRead,
  onUpdateProject,
  onUpdatePriority,
  projects,
  channelProjectId,
  showChannel = true,
}: {
  message: SlackMessage;
  onMarkAsRead: (id: number) => void;
  onUpdateProject: (id: number, data: { projectId?: number | null }) => void;
  onUpdatePriority: (id: number, priority: SlackMessagePriority) => void;
  projects: Project[];
  channelProjectId?: number | null;
  showChannel?: boolean;
}) {
  // 有効プロジェクトID: メッセージ > チャンネル > effectiveProjectId (バックエンドで計算済み)
  const effectiveProjectId =
    message.projectId ?? channelProjectId ?? message.effectiveProjectId ?? null;
  const projectName = effectiveProjectId
    ? projects.find((p) => p.id === effectiveProjectId)?.name
    : null;
  const activeProjects = projects.filter((p) => p.isActive);
  // メッセージ個別に設定されているか判定 (チャンネル設定と異なる場合)
  const hasMessageProject = message.projectId !== null && message.projectId !== undefined;
  const isInheritedFromChannel = !hasMessageProject && channelProjectId !== null;

  const handleProjectChange = (value: string) => {
    const newProjectId = value === "none" ? null : Number(value);
    onUpdateProject(message.id, { projectId: newProjectId });
  };

  const handlePriorityChange = (value: string) => {
    onUpdatePriority(message.id, value as SlackMessagePriority);
  };

  return (
    <div
      className={`rounded-md border p-3 ${message.isRead ? "opacity-60" : "border-primary/30 bg-primary/5"} ${
        message.priority === "high" ? "border-l-4 border-l-red-500" : ""
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {formatSlackTsJST(message.messageTs)}
          </span>
          {/* 優先度バッジ */}
          <PriorityBadge priority={message.priority ?? null} onChange={handlePriorityChange} />
          {showChannel && message.channelName && (
            <Badge variant="outline" className="text-xs">
              {message.messageType === "dm" ? message.channelName : `#${message.channelName}`}
            </Badge>
          )}
          {message.userName && (
            <Badge variant="secondary" className="text-xs">
              {message.userName}
            </Badge>
          )}
          {activeProjects.length > 0 && (
            <Select
              value={message.projectId?.toString() ?? "none"}
              onValueChange={handleProjectChange}
            >
              <SelectTrigger
                className={`h-6 w-[120px] text-xs ${isInheritedFromChannel ? "border-dashed opacity-70" : ""}`}
                title={isInheritedFromChannel ? "チャンネル設定から継承" : undefined}
              >
                <FolderGit2 className="mr-1 h-3 w-3" />
                <SelectValue
                  placeholder={isInheritedFromChannel && projectName ? projectName : "プロジェクト"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  {isInheritedFromChannel && projectName ? `Ch: ${projectName}` : "なし"}
                </SelectItem>
                {activeProjects.map((project) => (
                  <SelectItem key={project.id} value={project.id.toString()}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!activeProjects.length && projectName && (
            <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              <FolderGit2 className="h-3 w-3" />
              {projectName}
              {isInheritedFromChannel && <span className="opacity-60">(Ch)</span>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {message.permalink && (
            <Button variant="ghost" size="icon" className="h-6 w-6" asChild>
              <a href={message.permalink} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          )}
          {!message.isRead && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onMarkAsRead(message.id)}
              title="Mark as read"
            >
              <Check className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      <p className="whitespace-pre-wrap text-sm">{message.text}</p>
    </div>
  );
}

/**
 * 優先度バッジコンポーネント
 */
function PriorityBadge({
  priority,
  onChange,
}: {
  priority: SlackMessagePriority | null;
  onChange: (priority: string) => void;
}) {
  const getPriorityConfig = (p: SlackMessagePriority | null) => {
    switch (p) {
      case "high":
        return {
          icon: AlertTriangle,
          label: "高",
          className: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400",
        };
      case "medium":
        return {
          icon: ArrowRight,
          label: "中",
          className: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400",
        };
      case "low":
        return {
          icon: ArrowDown,
          label: "低",
          className: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
        };
      default:
        return {
          icon: null,
          label: "-",
          className: "bg-muted text-muted-foreground",
        };
    }
  };

  const config = getPriorityConfig(priority);
  const Icon = config.icon;

  return (
    <Select value={priority ?? "unassigned"} onValueChange={onChange}>
      <SelectTrigger className={`h-5 w-[70px] border-0 px-1.5 text-xs ${config.className}`}>
        {Icon && <Icon className="mr-0.5 h-3 w-3" />}
        <span>{config.label}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="high">
          <span className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-red-500" />高
          </span>
        </SelectItem>
        <SelectItem value="medium">
          <span className="flex items-center gap-1">
            <ArrowRight className="h-3 w-3 text-yellow-500" />中
          </span>
        </SelectItem>
        <SelectItem value="low">
          <span className="flex items-center gap-1">
            <ArrowDown className="h-3 w-3 text-green-500" />低
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
