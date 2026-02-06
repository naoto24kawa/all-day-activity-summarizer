/**
 * Notion Feed Controls Component
 *
 * Notion フィードのコントロールバー (Mark all read, Refresh)
 */

import { CheckCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotionFeedContext } from "./notion-feed-context";

export function NotionFeedControls() {
  const { date, counts, markAllAsRead, refetch, refetchUnreadCounts } = useNotionFeedContext();

  return (
    <div className="flex items-center justify-end gap-2">
      {/* Mark all read */}
      {counts.total > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await markAllAsRead({ date });
            refetchUnreadCounts();
          }}
        >
          <CheckCheck className="mr-1 h-3 w-3" />
          Mark all read
        </Button>
      )}

      {/* Refresh */}
      <Button variant="ghost" size="icon" onClick={refetch} title="Refresh">
        <RefreshCw className="h-4 w-4" />
      </Button>
    </div>
  );
}
