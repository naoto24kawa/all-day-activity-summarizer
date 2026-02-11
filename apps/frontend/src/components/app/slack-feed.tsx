/**
 * Slack Feed Component
 *
 * Displays Slack messages from mentions, channels, and DMs
 * Summary + expand-on-demand pattern: channel list initially, messages on expand
 */

import type { Project, SlackMessage } from "@repo/types";
import { Check, ChevronDown, ExternalLink, FolderGit2, Hash, Settings } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfig } from "@/hooks/use-config";
import { type SlackChannelSummary, useSlackChannelMessages } from "@/hooks/use-slack-messages";
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
    channelSummaries,
    summaryLoading,
    summaryError,
    projects,
    markAsRead,
    updateMessage,
    updateChannelProject,
    getChannelProjectId,
  } = useSlackFeedContext();

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

  if (summaryLoading) {
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

  if (summaryError) {
    return (
      <Card className={className}>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">{summaryError}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`flex min-h-0 flex-1 flex-col overflow-hidden ${className ?? ""}`}>
      <CardContent className="flex min-h-0 flex-1 flex-col pt-4">
        {channelSummaries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Slack messages for this date.</p>
        ) : (
          <ChannelSummaryList
            channels={channelSummaries}
            onMarkAsRead={markAsRead}
            onUpdateProject={updateMessage}
            onUpdateChannelProject={updateChannelProject}
            getChannelProjectId={getChannelProjectId}
            projects={projects}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** チャンネル一覧 (summary ベース) */
function ChannelSummaryList({
  channels,
  onMarkAsRead,
  onUpdateProject,
  onUpdateChannelProject,
  getChannelProjectId,
  projects,
}: {
  channels: SlackChannelSummary[];
  onMarkAsRead: (id: number) => void;
  onUpdateProject: (id: number, data: { projectId?: number | null }) => void;
  onUpdateChannelProject: (channelId: string, projectId: number | null) => void;
  getChannelProjectId: (channelId: string) => number | null;
  projects: Project[];
}) {
  const activeProjects = projects.filter((p) => p.isActive);

  // 未読数が多い順、次にチャンネル名のアルファベット順
  const sortedChannels = [...channels].sort((a, b) => {
    if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
    return (a.channelName ?? "").localeCompare(b.channelName ?? "");
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-2">
        {sortedChannels.map((channel) => (
          <ChannelCollapsible
            key={channel.channelId}
            channel={channel}
            onMarkAsRead={onMarkAsRead}
            onUpdateProject={onUpdateProject}
            onUpdateChannelProject={onUpdateChannelProject}
            getChannelProjectId={getChannelProjectId}
            projects={projects}
            activeProjects={activeProjects}
          />
        ))}
      </div>
    </div>
  );
}

/** チャンネル行 (折りたたみ) - 展開時にメッセージ取得 */
function ChannelCollapsible({
  channel,
  onMarkAsRead,
  onUpdateProject,
  onUpdateChannelProject,
  getChannelProjectId,
  projects,
  activeProjects,
}: {
  channel: SlackChannelSummary;
  onMarkAsRead: (id: number) => void;
  onUpdateProject: (id: number, data: { projectId?: number | null }) => void;
  onUpdateChannelProject: (channelId: string, projectId: number | null) => void;
  getChannelProjectId: (channelId: string) => number | null;
  projects: Project[];
  activeProjects: Project[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const channelProjectId = getChannelProjectId(channel.channelId);

  const handleChannelProjectChange = (value: string) => {
    const newProjectId = value === "none" ? null : Number(value);
    onUpdateChannelProject(channel.channelId, newProjectId);
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="flex items-center gap-2 rounded-md border p-3 hover:bg-muted/50">
        <CollapsibleTrigger className="flex flex-1 items-center justify-between">
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">#{channel.channelName ?? "Unknown"}</span>
            <span className="text-xs text-muted-foreground">({channel.messageCount})</span>
            {channel.unreadCount > 0 && (
              <Badge variant="default" className="text-xs">
                {channel.unreadCount}
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
            onValueChange={handleChannelProjectChange}
          >
            <SelectTrigger className="h-7 w-[130px] text-xs" onClick={(e) => e.stopPropagation()}>
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
        {isOpen && (
          <ChannelMessages
            channelId={channel.channelId}
            channelProjectId={channelProjectId}
            onMarkAsRead={onMarkAsRead}
            onUpdateProject={onUpdateProject}
            projects={projects}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

const INITIAL_MESSAGES_PER_CHANNEL = 5;
const LOAD_MORE_COUNT = 10;

/** チャンネル展開時のメッセージ一覧 (展開時に取得) */
function ChannelMessages({
  channelId,
  channelProjectId,
  onMarkAsRead,
  onUpdateProject,
  projects,
}: {
  channelId: string;
  channelProjectId: number | null;
  onMarkAsRead: (id: number) => void;
  onUpdateProject: (id: number, data: { projectId?: number | null }) => void;
  projects: Project[];
}) {
  const { messages, loading } = useSlackChannelMessages(channelId);
  const { priorityFilter } = useSlackFeedContext();
  const [limit, setLimit] = useState(INITIAL_MESSAGES_PER_CHANNEL);

  if (loading) {
    return (
      <div className="space-y-2">
        {["s1", "s2", "s3"].map((id) => (
          <Skeleton key={id} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  // 優先度フィルター適用
  const filteredMessages =
    priorityFilter === "all"
      ? messages
      : messages.filter((m) => m.effectivePriority === priorityFilter);

  if (filteredMessages.length === 0) {
    return <p className="py-2 text-center text-sm text-muted-foreground">No messages.</p>;
  }

  const displayedMessages = filteredMessages.slice(0, limit);
  const hasMore = filteredMessages.length > limit;
  const remainingCount = filteredMessages.length - limit;

  return (
    <>
      {displayedMessages.map((message) => (
        <SlackMessageItem
          key={message.id}
          message={message}
          onMarkAsRead={onMarkAsRead}
          onUpdateProject={onUpdateProject}
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
          onClick={() => setLimit((prev) => prev + LOAD_MORE_COUNT)}
        >
          もっと見る ({remainingCount}件)
        </Button>
      )}
    </>
  );
}

function SlackMessageItem({
  message,
  onMarkAsRead,
  onUpdateProject,
  projects,
  channelProjectId,
  showChannel = true,
}: {
  message: SlackMessage;
  onMarkAsRead: (id: number) => void;
  onUpdateProject: (id: number, data: { projectId?: number | null }) => void;
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

  return (
    <div
      className={`rounded-md border p-3 ${message.isRead ? "opacity-60" : "border-primary/30 bg-primary/5"}`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {formatSlackTsJST(message.messageTs)}
          </span>
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
