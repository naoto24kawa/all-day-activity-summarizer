/**
 * Slack Feed Component
 *
 * Displays Slack messages from mentions, channels, and DMs
 */

import type { SlackMessage } from "@repo/types";
import {
  AtSign,
  Check,
  CheckCheck,
  ChevronDown,
  ExternalLink,
  Hash,
  MessageSquare,
  RefreshCw,
  Search,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSlackMessages, useSlackUnreadCounts } from "@/hooks/use-slack-messages";
import { formatSlackTsJST } from "@/lib/date";

interface SlackFeedProps {
  date: string;
  className?: string;
}

export function SlackFeed({ date, className }: SlackFeedProps) {
  const { messages, loading, error, refetch, markAsRead, markAllAsRead } = useSlackMessages(date);
  const { counts } = useSlackUnreadCounts(date);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Slack</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Slack</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  const mentionMessages = messages.filter((m) => m.messageType === "mention");
  const channelMessages = messages.filter((m) => m.messageType === "channel");
  const dmMessages = messages.filter((m) => m.messageType === "dm");
  const keywordMessages = messages.filter((m) => m.messageType === "keyword");

  return (
    <Card className={`flex min-h-0 flex-col overflow-hidden ${className ?? ""}`}>
      <CardHeader className="flex shrink-0 flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          Slack
          {counts.total > 0 && (
            <Badge variant="destructive" className="ml-2">
              {counts.total} unread
            </Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-2">
          {counts.total > 0 && (
            <Button variant="outline" size="sm" onClick={() => markAllAsRead({ date })}>
              <CheckCheck className="mr-1 h-3 w-3" />
              Mark all read
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Slack messages for this date.</p>
        ) : (
          <Tabs defaultValue="mention" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="shrink-0">
              <TabsTrigger value="mention" className="flex items-center gap-1">
                <AtSign className="h-3 w-3" />
                Mentions
                {counts.mention > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1 text-xs">
                    {counts.mention}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="channel" className="flex items-center gap-1">
                <Hash className="h-3 w-3" />
                Channels
                {counts.channel > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1 text-xs">
                    {counts.channel}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="dm" className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                DMs
                {counts.dm > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1 text-xs">
                    {counts.dm}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="keyword" className="flex items-center gap-1">
                <Search className="h-3 w-3" />
                Keywords
                {counts.keyword > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 px-1 text-xs">
                    {counts.keyword}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="mention" className="min-h-0 flex-1">
              <GroupedMessageList messages={mentionMessages} onMarkAsRead={markAsRead} />
            </TabsContent>
            <TabsContent value="channel" className="min-h-0 flex-1">
              <GroupedMessageList messages={channelMessages} onMarkAsRead={markAsRead} />
            </TabsContent>
            <TabsContent value="dm" className="min-h-0 flex-1">
              <GroupedMessageList messages={dmMessages} onMarkAsRead={markAsRead} isDM />
            </TabsContent>
            <TabsContent value="keyword" className="min-h-0 flex-1">
              <GroupedMessageList messages={keywordMessages} onMarkAsRead={markAsRead} />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function GroupedMessageList({
  messages,
  onMarkAsRead,
  isDM = false,
}: {
  messages: SlackMessage[];
  onMarkAsRead: (id: number) => void;
  isDM?: boolean;
}) {
  const [openChannels, setOpenChannels] = useState<Set<string>>(new Set());

  if (messages.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No messages.</p>;
  }

  // チャンネル名でグループ化
  const groupedMessages = messages.reduce<Record<string, SlackMessage[]>>((acc, message) => {
    const channelName = message.channelName ?? "Unknown";
    if (!acc[channelName]) {
      acc[channelName] = [];
    }
    acc[channelName].push(message);
    return acc;
  }, {});

  // チャンネル名でソート(未読数が多い順、次にチャンネル名のアルファベット順)
  const sortedChannels = Object.keys(groupedMessages).sort((a, b) => {
    const unreadA = groupedMessages[a].filter((m) => !m.isRead).length;
    const unreadB = groupedMessages[b].filter((m) => !m.isRead).length;
    if (unreadA !== unreadB) return unreadB - unreadA;
    return a.localeCompare(b);
  });

  const toggleChannel = (channelName: string) => {
    setOpenChannels((prev) => {
      const next = new Set(prev);
      if (next.has(channelName)) {
        next.delete(channelName);
      } else {
        next.add(channelName);
      }
      return next;
    });
  };

  const Icon = isDM ? MessageSquare : Hash;

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-2">
        {sortedChannels.map((channelName) => {
          const channelMessages = groupedMessages[channelName];
          const unreadCount = channelMessages.filter((m) => !m.isRead).length;
          const isOpen = openChannels.has(channelName);

          return (
            <Collapsible
              key={channelName}
              open={isOpen}
              onOpenChange={() => toggleChannel(channelName)}
            >
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border p-3 hover:bg-muted/50">
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
              <CollapsibleContent className="mt-2 space-y-3 pl-4">
                {channelMessages.map((message) => (
                  <SlackMessageItem
                    key={message.id}
                    message={message}
                    onMarkAsRead={onMarkAsRead}
                    showChannel={false}
                  />
                ))}
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
  showChannel = true,
}: {
  message: SlackMessage;
  onMarkAsRead: (id: number) => void;
  showChannel?: boolean;
}) {
  return (
    <div
      className={`rounded-md border p-3 ${message.isRead ? "opacity-60" : "border-primary/30 bg-primary/5"}`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
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
