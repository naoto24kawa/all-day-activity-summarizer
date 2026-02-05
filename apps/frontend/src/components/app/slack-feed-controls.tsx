/**
 * Slack Feed Controls Component
 *
 * Slack フィードのコントロールバー (フィルター、Mark all read、Users、Refresh)
 */

import type { SlackMessagePriority } from "@repo/types";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  CheckCheck,
  Filter,
  Loader2,
  RefreshCw,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSlackFeedContext } from "./slack-feed-context";

export function SlackFeedControls() {
  const {
    date,
    counts,
    priorityCounts,
    users,
    usersLoading,
    priorityFilter,
    setPriorityFilter,
    usersPopoverOpen,
    setUsersPopoverOpen,
    editingUserId,
    userNameInput,
    pendingUserAction,
    handleStartUserEdit,
    handleCancelUserEdit,
    handleSaveUserName,
    handleResetUserName,
    markingAllAsRead,
    refetch,
    markAllAsRead,
    refetchUnreadCounts,
    refetchPriorityCounts,
  } = useSlackFeedContext();

  return (
    <div className="flex items-center justify-end gap-2">
      {/* 優先度フィルター */}
      <Select
        value={priorityFilter}
        onValueChange={(value) => setPriorityFilter(value as SlackMessagePriority | "all")}
      >
        <SelectTrigger className="h-8 w-[140px] text-xs">
          <Filter className="mr-1 h-3 w-3" />
          <SelectValue placeholder="優先度" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">すべて ({priorityCounts.total})</SelectItem>
          <SelectItem value="high">
            <span className="flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-red-500" />高 ({priorityCounts.high})
            </span>
          </SelectItem>
          <SelectItem value="medium">
            <span className="flex items-center gap-1">
              <ArrowRight className="h-3 w-3 text-yellow-500" />中 ({priorityCounts.medium})
            </span>
          </SelectItem>
          <SelectItem value="low">
            <span className="flex items-center gap-1">
              <ArrowDown className="h-3 w-3 text-green-500" />低 ({priorityCounts.low})
            </span>
          </SelectItem>
        </SelectContent>
      </Select>

      {/* Mark all read */}
      {counts.total > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await markAllAsRead({ date });
            refetchUnreadCounts();
            refetchPriorityCounts();
          }}
          disabled={markingAllAsRead}
        >
          {markingAllAsRead ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <CheckCheck className="mr-1 h-3 w-3" />
          )}
          Mark all read
        </Button>
      )}

      {/* Slack Users Popover */}
      <Popover open={usersPopoverOpen} onOpenChange={setUsersPopoverOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" title="Slack Users">
            <Users className="mr-1 h-3 w-3" />
            Users
            {users.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-xs">
                {users.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-96 p-0" align="end">
          <div className="border-b px-3 py-2">
            <h4 className="font-medium text-sm">Slack Users</h4>
            <p className="text-xs text-muted-foreground">表示名を編集してサマリの可読性を向上</p>
          </div>
          {usersLoading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">読み込み中...</div>
          ) : users.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">ユーザーがいません</div>
          ) : (
            <ScrollArea className="h-[300px]">
              <div className="space-y-2 p-2">
                {users.map((user) => (
                  <div
                    key={user.userId}
                    className={`rounded-md border p-2 text-sm ${user.displayName ? "border-green-500/30 bg-green-50/50 dark:bg-green-950/10" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      {editingUserId === user.userId ? (
                        <Input
                          value={userNameInput}
                          onChange={(e) => setUserNameInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSaveUserName(user.userId);
                            if (e.key === "Escape") handleCancelUserEdit();
                          }}
                          placeholder={user.slackName ?? "表示名"}
                          className="h-7 text-xs"
                          disabled={pendingUserAction === user.userId}
                          autoFocus
                        />
                      ) : (
                        <>
                          <span className="font-medium truncate">
                            {user.displayName ?? user.slackName ?? user.userId}
                          </span>
                          {user.displayName && user.slackName && (
                            <span className="text-xs text-muted-foreground">
                              ({user.slackName})
                            </span>
                          )}
                        </>
                      )}
                      <Badge variant="outline" className="ml-auto shrink-0 text-xs">
                        {user.messageCount}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      {editingUserId === user.userId ? (
                        <>
                          <Button
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => handleSaveUserName(user.userId)}
                            disabled={pendingUserAction === user.userId}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            onClick={handleCancelUserEdit}
                            disabled={pendingUserAction === user.userId}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-xs"
                            onClick={() => handleStartUserEdit(user.userId, user.displayName)}
                            disabled={pendingUserAction === user.userId}
                          >
                            Edit
                          </Button>
                          {user.displayName && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-xs"
                              onClick={() => handleResetUserName(user.userId)}
                              disabled={pendingUserAction === user.userId}
                            >
                              Reset
                            </Button>
                          )}
                        </>
                      )}
                      <span className="ml-auto text-xs font-mono text-muted-foreground truncate max-w-24">
                        {user.userId}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </PopoverContent>
      </Popover>

      {/* Refresh */}
      <Button variant="ghost" size="icon" onClick={() => refetch()} title="Refresh">
        <RefreshCw className="h-4 w-4" />
      </Button>
    </div>
  );
}
