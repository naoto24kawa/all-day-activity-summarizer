/**
 * Tab Groups Configuration
 * タブグループの定義と設定
 */

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Bot,
  CheckSquare,
  FileText,
  FolderKanban,
  FolderOpen,
  Github,
  Laptop,
  MessageSquare,
  Mic,
  NotebookPen,
  Settings,
  Terminal,
  User,
} from "lucide-react";

export type TabGroupId = "overview" | "feeds" | "tools" | "system";
export type TabId =
  | "activity"
  | "tasks"
  | "audio"
  | "slack"
  | "github"
  | "notion"
  | "claude"
  | "learnings"
  | "projects"
  | "whisper"
  | "logs"
  | "dlq"
  | "profile"
  | "ai-settings"
  | "settings";

export interface TabConfig {
  id: TabId;
  label: string;
  icon: LucideIcon;
  badgeKey?: "tasks" | "learnings" | "slack" | "github" | "notion";
}

export interface TabGroupConfig {
  id: TabGroupId;
  label: string;
  icon: LucideIcon;
  tabs: TabConfig[];
}

export const TAB_GROUPS: TabGroupConfig[] = [
  {
    id: "overview",
    label: "Overview",
    icon: FolderOpen,
    tabs: [
      { id: "activity", label: "Activity", icon: Activity },
      { id: "tasks", label: "Tasks", icon: CheckSquare, badgeKey: "tasks" },
    ],
  },
  {
    id: "feeds",
    label: "Feeds",
    icon: MessageSquare,
    tabs: [
      { id: "audio", label: "Audio", icon: Mic },
      { id: "slack", label: "Slack", icon: MessageSquare },
      { id: "github", label: "GitHub", icon: Github, badgeKey: "github" },
      { id: "notion", label: "Notion", icon: NotebookPen, badgeKey: "notion" },
      { id: "claude", label: "Claude", icon: Terminal },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    icon: Laptop,
    tabs: [
      { id: "learnings", label: "Learnings", icon: BookOpen, badgeKey: "learnings" },
      { id: "projects", label: "Projects", icon: FolderKanban },
      { id: "whisper", label: "Whisper", icon: Mic },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: Settings,
    tabs: [
      { id: "logs", label: "Logs", icon: FileText },
      { id: "dlq", label: "DLQ", icon: AlertTriangle },
      { id: "profile", label: "Profile", icon: User },
      { id: "ai-settings", label: "AI Settings", icon: Bot },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
];

/**
 * グループのデフォルトタブを取得
 */
export function getDefaultTabForGroup(groupId: TabGroupId): TabId {
  const group = TAB_GROUPS.find((g) => g.id === groupId);
  return group?.tabs[0]?.id ?? "activity";
}

/**
 * タブIDからグループIDを取得
 */
export function getGroupForTab(tabId: TabId): TabGroupId {
  for (const group of TAB_GROUPS) {
    if (group.tabs.some((tab) => tab.id === tabId)) {
      return group.id;
    }
  }
  return "overview";
}
