import { Badge } from "@/components/ui/badge";
import type { TabBadges } from "@/hooks/use-tab-badges";
import type { TabConfig } from "@/lib/tab-groups";
import { cn } from "@/lib/utils";

type BadgeKey = keyof TabBadges;
type BadgeVariant = "destructive" | "secondary" | "default" | "outline";

interface SubTabNavProps {
  tabs: TabConfig[];
  value: string;
  onValueChange: (value: string) => void;
  badges: TabBadges;
  badgeVariants: Record<BadgeKey, BadgeVariant>;
  className?: string;
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
      className={cn("bg-muted relative inline-flex h-10 items-center rounded-lg p-1", className)}
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
        const badgeCount = tab.badgeKey ? badges[tab.badgeKey] : 0;
        const badgeVariant = tab.badgeKey ? badgeVariants[tab.badgeKey] : "secondary";
        const isActive = value === tab.id;
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
