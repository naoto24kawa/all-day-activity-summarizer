import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getTodayDateString } from "@/lib/date";
import { ActivityFeed } from "./activity-feed";
import { BrowserRecordingPanel } from "./browser-recording-panel";
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

      <div className="grid gap-6 lg:grid-cols-2">
        <StatusPanel />
        <BrowserRecordingPanel />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Timeline date={date} />
        <SummaryView date={date} />
      </div>

      <Tabs defaultValue="activity">
        <TabsList>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="activity">
          <div className="grid gap-6 pt-4 lg:grid-cols-2">
            <ActivityFeed date={date} />
            <MemoPanel date={date} />
          </div>
        </TabsContent>
        <TabsContent value="settings">
          <div className="pt-4">
            <SpeakerAssignPanel />
          </div>
        </TabsContent>
        <TabsContent value="logs">
          <div className="pt-4">
            <EvaluatorLogPanel date={date} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
