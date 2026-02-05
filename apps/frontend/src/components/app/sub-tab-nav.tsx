import { Badge } from "@/components/ui/badge";
import type { TabBadges } from "@/hooks/use-tab-badges";
import type { TabConfig } from "@/lib/tab-groups";
import { cn } from "@/lib/utils";

/** 数値を返すバッジキー (taskBadges オブジェクトを除く) */
export type BadgeKey = "tasks" | "learnings" | "slack" | "github";
type BadgeVariant = "destructive" | "secondary" | "default" | "outline";

interface SubTabNavProps {
  tabs: TabConfig[];
  value: string;
  onValueChange: (value: string) => void;
  badges: TabBadges;
  badgeVariants: Record<BadgeKey, BadgeVariant>;
  className?: string;
}

/** Tasks タブ用の複数バッジを生成 */
function TasksBadges({ badges }: { badges: TabBadges }) {
  const { taskBadges } = badges;
  const badgeItems = [
    // 承認待ち (一番左)
    { count: taskBadges.pending, variant: "outline" as const, title: "承認待ち" },
    // 承認済み: 優先度別 (高→中→低の順)
    { count: taskBadges.acceptedHigh, className: "bg-red-500 text-white", title: "高優先度" },
    {
      count: taskBadges.acceptedMedium,
      className: "bg-amber-500 text-white",
      title: "中優先度",
    },
    { count: taskBadges.acceptedLow, className: "bg-blue-500 text-white", title: "低優先度" },
  ];

  return (
    <>
      {badgeItems.map(
        (item, idx) =>
          item.count > 0 && (
            <Badge
              key={idx}
              variant={item.variant}
              className={cn("ml-0.5 h-5 min-w-5 px-1.5", item.className)}
              title={item.title}
            >
              {item.count}
            </Badge>
          ),
      )}
    </>
  );
}

export function SubTabNav({
  tabs,
  value,
  onValueChange,
  badges,
  badgeVariants,
  className,
}: SubTabNavProps) {
  return (
    <div
      className={cn("bg-muted relative flex h-10 w-full items-center rounded-lg p-1", className)}
    >
      {/* スライド背景 */}
      <div
        className="bg-background absolute h-8 rounded-md shadow-sm transition-all duration-200"
        style={{
          width: `calc(${100 / tabs.length}% - 4px)`,
          left: `calc(${(tabs.findIndex((t) => t.id === value) * 100) / tabs.length}% + 2px)`,
        }}
      />
      {tabs.map((tab) => {
        const TabIcon = tab.icon;
        const isActive = value === tab.id;
        const isTasksTab = tab.id === "tasks";

        // Tasks タブの場合は複数バッジを表示
        if (isTasksTab) {
          return (
            <button
              type="button"
              key={tab.id}
              onClick={() => onValueChange(tab.id)}
              className={cn(
                "relative z-10 inline-flex h-8 items-center justify-center gap-1 px-3 text-sm font-medium transition-colors",
                isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              style={{ width: `calc(${100 / tabs.length}%)` }}
            >
              <TabIcon className="h-4 w-4" />
              {tab.label}
              <TasksBadges badges={badges} />
            </button>
          );
        }

        // その他のタブは従来通り
        const badgeCount = tab.badgeKey ? badges[tab.badgeKey] : 0;
        const badgeVariant = tab.badgeKey ? badgeVariants[tab.badgeKey] : "secondary";
        return (
          <button
            type="button"
            key={tab.id}
            onClick={() => onValueChange(tab.id)}
            className={cn(
              "relative z-10 inline-flex h-8 items-center justify-center gap-1.5 px-3 text-sm font-medium transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            style={{ width: `calc(${100 / tabs.length}%)` }}
          >
            <TabIcon className="h-4 w-4" />
            {tab.label}
            {badgeCount > 0 && (
              <Badge variant={badgeVariant} className="ml-1 h-5 min-w-5 px-1.5">
                {badgeCount}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
