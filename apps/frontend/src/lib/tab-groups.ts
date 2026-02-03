/**
 * Tab Groups Configuration
 * タブグループの定義と設定
 */

import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BookOpen,
  CheckSquare,
  FileText,
  FolderOpen,
  Github,
  Laptop,
  MessageSquare,
  Mic,
  Settings,
  Terminal,
} from "lucide-react";

export type TabGroupId = "overview" | "feeds" | "tools" | "system";
export type TabId =
  | "activity"
  | "tasks"
  | "audio"
  | "slack"
  | "github"
  | "claude"
  | "learnings"
  | "whisper"
  | "logs"
  | "settings";

export interface TabConfig {
  id: TabId;
  label: string;
  icon: LucideIcon;
  badgeKey?: "tasks" | "learnings" | "slack" | "github";
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
      { id: "claude", label: "Claude", icon: Terminal },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    icon: Laptop,
    tabs: [
      { id: "learnings", label: "Learnings", icon: BookOpen, badgeKey: "learnings" },
      { id: "whisper", label: "Whisper", icon: Mic },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: Settings,
    tabs: [
      { id: "logs", label: "Logs", icon: FileText },
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
