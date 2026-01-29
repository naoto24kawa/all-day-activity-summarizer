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
  ExternalLink,
  Hash,
  MessageSquare,
  RefreshCw,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSlackMessages, useSlackUnreadCounts } from "@/hooks/use-slack-messages";

interface SlackFeedProps {
  date: string;
}

export function SlackFeed({ date }: SlackFeedProps) {
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
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
      <CardContent>
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Slack messages for this date.</p>
        ) : (
          <Tabs defaultValue="mention">
            <TabsList>
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
            <TabsContent value="mention">
              <MessageList messages={mentionMessages} onMarkAsRead={markAsRead} />
            </TabsContent>
            <TabsContent value="channel">
              <MessageList messages={channelMessages} onMarkAsRead={markAsRead} />
            </TabsContent>
            <TabsContent value="dm">
              <MessageList messages={dmMessages} onMarkAsRead={markAsRead} />
            </TabsContent>
            <TabsContent value="keyword">
              <MessageList messages={keywordMessages} onMarkAsRead={markAsRead} />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function MessageList({
  messages,
  onMarkAsRead,
}: {
  messages: SlackMessage[];
  onMarkAsRead: (id: number) => void;
}) {
  if (messages.length === 0) {
    return <p className="py-4 text-center text-sm text-muted-foreground">No messages.</p>;
  }

  return (
    <div className="h-[400px] overflow-y-auto">
      <div className="space-y-3">
        {messages.map((message) => (
          <SlackMessageItem key={message.id} message={message} onMarkAsRead={onMarkAsRead} />
        ))}
      </div>
    </div>
  );
}

function SlackMessageItem({
  message,
  onMarkAsRead,
}: {
  message: SlackMessage;
  onMarkAsRead: (id: number) => void;
}) {
  // Convert Slack timestamp to readable time
  const messageTime = new Date(Number(message.messageTs.split(".")[0]) * 1000);

  return (
    <div
      className={`rounded-md border p-3 ${message.isRead ? "opacity-60" : "border-primary/30 bg-primary/5"}`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {messageTime.toLocaleTimeString()}
          </span>
          {message.channelName && (
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
      <p className="text-sm">{message.text}</p>
    </div>
  );
}
