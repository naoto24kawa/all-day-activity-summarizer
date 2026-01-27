import { useState } from "react";
import { Input } from "@/components/ui/input";
import { StatusPanel } from "./status-panel";
import { SummaryView } from "./summary-view";
import { Timeline } from "./timeline";
import { TranscriptionList } from "./transcription-list";

function getTodayString(): string {
  return new Date().toISOString().slice(0, 10);
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

      <div className="grid gap-6 md:grid-cols-3">
        <StatusPanel />
        <div className="md:col-span-2">
          <Timeline date={date} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <SummaryView date={date} />
        <TranscriptionList date={date} />
      </div>
    </div>
  );
}
