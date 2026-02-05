/**
 * Slack Feed Context
 *
 * SlackFeed と SlackFeedControls で状態を共有するための Context
 */

import type { Project, SlackMessage, SlackMessagePriority, SlackUser } from "@repo/types";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { useProjects } from "@/hooks/use-projects";
import { useSlackChannels } from "@/hooks/use-slack-channels";
import {
  useSlackMessages,
  useSlackPriorityCounts,
  useSlackUnreadCounts,
} from "@/hooks/use-slack-messages";
import { useSlackUsers } from "@/hooks/use-slack-users";
import { getTodayDateString } from "@/lib/date";

interface SlackFeedContextValue {
  // データ
  date: string;
  messages: SlackMessage[];
  loading: boolean;
  error: string | null;
  counts: { total: number; mention: number; channel: number; dm: number; keyword: number };
  priorityCounts: { total: number; high: number; medium: number; low: number };
  projects: Project[];
  users: SlackUser[];
  usersLoading: boolean;

  // フィルター
  priorityFilter: SlackMessagePriority | "all";
  setPriorityFilter: (filter: SlackMessagePriority | "all") => void;
  filteredMessages: SlackMessage[];

  // Users Popover
  usersPopoverOpen: boolean;
  setUsersPopoverOpen: (open: boolean) => void;
  editingUserId: string | null;
  userNameInput: string;
  setUserNameInput: (value: string) => void;
  pendingUserAction: string | null;
  handleStartUserEdit: (userId: string, currentName: string | null) => void;
  handleCancelUserEdit: () => void;
  handleSaveUserName: (userId: string) => Promise<void>;
  handleResetUserName: (userId: string) => Promise<void>;

  // アクション
  markingAllAsRead: boolean;
  refetch: () => void;
  markAsRead: (id: number) => void;
  markAllAsRead: (params: { date: string }) => Promise<void>;
  updateMessage: (id: number, data: { projectId?: number | null }) => void;
  updatePriority: (id: number, priority: SlackMessagePriority) => void;
  updateChannelProject: (channelId: string, projectId: number | null) => void;
  getChannelProjectId: (channelId: string) => number | null;
  refetchUnreadCounts: () => void;
  refetchPriorityCounts: () => void;
}

const SlackFeedContext = createContext<SlackFeedContextValue | null>(null);

export function SlackFeedProvider({ children }: { children: ReactNode }) {
  const date = getTodayDateString();
  const {
    messages,
    loading,
    error,
    markingAllAsRead,
    refetch,
    markAsRead,
    markAllAsRead,
    updateMessage,
    updatePriority,
  } = useSlackMessages();
  const { counts, refetch: refetchUnreadCounts } = useSlackUnreadCounts(date);
  const { counts: priorityCounts, refetch: refetchPriorityCounts } = useSlackPriorityCounts();
  const { projects } = useProjects();
  const { updateChannelProject, getChannelProjectId } = useSlackChannels();
  const { users, loading: usersLoading, updateDisplayName, resetDisplayName } = useSlackUsers();

  // フィルター状態
  const [priorityFilter, setPriorityFilter] = useState<SlackMessagePriority | "all">("all");

  // Users Popover 状態
  const [usersPopoverOpen, setUsersPopoverOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userNameInput, setUserNameInput] = useState("");
  const [pendingUserAction, setPendingUserAction] = useState<string | null>(null);

  const handleStartUserEdit = (userId: string, currentName: string | null) => {
    setEditingUserId(userId);
    setUserNameInput(currentName ?? "");
  };

  const handleCancelUserEdit = () => {
    setEditingUserId(null);
    setUserNameInput("");
  };

  const handleSaveUserName = async (userId: string) => {
    const newName = userNameInput.trim() || null;
    setPendingUserAction(userId);
    try {
      await updateDisplayName(userId, newName);
      handleCancelUserEdit();
    } finally {
      setPendingUserAction(null);
    }
  };

  const handleResetUserName = async (userId: string) => {
    setPendingUserAction(userId);
    try {
      await resetDisplayName(userId);
    } finally {
      setPendingUserAction(null);
    }
  };

  // feeds-refresh (統一更新) と slack-refresh (個別) をリッスン
  useEffect(() => {
    const handleRefresh = () => {
      refetch();
      refetchUnreadCounts();
      refetchPriorityCounts();
    };
    window.addEventListener("feeds-refresh", handleRefresh);
    window.addEventListener("slack-refresh", handleRefresh);
    return () => {
      window.removeEventListener("feeds-refresh", handleRefresh);
      window.removeEventListener("slack-refresh", handleRefresh);
    };
  }, [refetch, refetchUnreadCounts, refetchPriorityCounts]);

  // フィルタリング
  const filteredMessages =
    priorityFilter === "all" ? messages : messages.filter((m) => m.priority === priorityFilter);

  const value: SlackFeedContextValue = {
    date,
    messages,
    loading,
    error,
    counts,
    priorityCounts,
    projects,
    users,
    usersLoading,
    priorityFilter,
    setPriorityFilter,
    filteredMessages,
    usersPopoverOpen,
    setUsersPopoverOpen,
    editingUserId,
    userNameInput,
    setUserNameInput,
    pendingUserAction,
    handleStartUserEdit,
    handleCancelUserEdit,
    handleSaveUserName,
    handleResetUserName,
    markingAllAsRead,
    refetch,
    markAsRead,
    markAllAsRead,
    updateMessage,
    updatePriority,
    updateChannelProject,
    getChannelProjectId,
    refetchUnreadCounts,
    refetchPriorityCounts,
  };

  return <SlackFeedContext.Provider value={value}>{children}</SlackFeedContext.Provider>;
}

export function useSlackFeedContext() {
  const context = useContext(SlackFeedContext);
  if (!context) {
    throw new Error("useSlackFeedContext must be used within a SlackFeedProvider");
  }
  return context;
}
