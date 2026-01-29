import { useState } from "react";
import { Input } from "@/components/ui/input";
import { getTodayDateString } from "@/lib/date";
import { ActivityFeed } from "./activity-feed";
import { EvaluatorLogPanel } from "./evaluator-log-panel";
import { MemoPanel } from "./memo-panel";
import { SpeakerAssignPanel } from "./speaker-assign-panel";
import { StatusPanel } from "./status-panel";
import { SummaryView } from "./summary-view";
import { Timeline } from "./timeline";

export function Dashboard() {
  const [date, setDate] = useState(getTodayDateString());

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">All Day Activity Summarizer</h1>
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-auto"
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <StatusPanel />
        <Timeline date={date} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <SummaryView date={date} />
        <ActivityFeed date={date} />
        <MemoPanel date={date} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SpeakerAssignPanel />
        <EvaluatorLogPanel date={date} />
      </div>
    </div>
  );
}
