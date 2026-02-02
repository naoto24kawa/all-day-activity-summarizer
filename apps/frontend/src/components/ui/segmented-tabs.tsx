import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface SegmentedTab {
  id: string;
  label: string;
  icon?: LucideIcon;
  badge?: number;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
}

interface SegmentedTabsProps {
  tabs: SegmentedTab[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

export function SegmentedTabs({ tabs, value, onValueChange, className }: SegmentedTabsProps) {
  const activeIndex = tabs.findIndex((t) => t.id === value);

  return (
    <div className={cn("bg-muted relative inline-flex h-9 items-center rounded-lg p-1", className)}>
      {/* スライド背景 */}
      <div
        className="bg-background absolute h-7 rounded-md shadow-sm transition-all duration-200"
        style={{
          width: `calc(${100 / tabs.length}% - 4px)`,
          left: `calc(${(activeIndex * 100) / tabs.length}% + 2px)`,
        }}
      />
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = value === tab.id;
        return (
          <button
            type="button"
            key={tab.id}
            onClick={() => onValueChange(tab.id)}
            className={cn(
              "relative z-10 inline-flex h-7 items-center justify-center gap-1 px-2 text-xs font-medium transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            style={{ width: `calc(${100 / tabs.length}%)` }}
          >
            {Icon && <Icon className="h-3 w-3" />}
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <Badge variant={tab.badgeVariant ?? "destructive"} className="ml-1 h-4 px-1 text-xs">
                {tab.badge}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface SegmentedTabContentProps {
  value: string;
  activeValue: string;
  children: ReactNode;
  className?: string;
}

export function SegmentedTabContent({
  value,
  activeValue,
  children,
  className,
}: SegmentedTabContentProps) {
  if (value !== activeValue) return null;
  return <div className={cn("min-h-0 flex-1", className)}>{children}</div>;
}
