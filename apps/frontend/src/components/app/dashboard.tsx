import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ActivityFeed } from "./activity-feed";
import { EvaluatorLogPanel } from "./evaluator-log-panel";
import { MemoPanel } from "./memo-panel";
import { SpeakerAssignPanel } from "./speaker-assign-panel";
import { StatusPanel } from "./status-panel";
import { SummaryView } from "./summary-view";
import { Timeline } from "./timeline";

function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function Dashboard() {
  const [date, setDate] = useState(getTodayString());

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
