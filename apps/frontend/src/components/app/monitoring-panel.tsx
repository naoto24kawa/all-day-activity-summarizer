import { Database, FileAudio, FileText, HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useStorage } from "@/hooks/use-storage";

export function MonitoringPanel() {
  const { data, loading, error } = useStorage();

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Storage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Storage</CardTitle>
        </CardHeader>
        <CardContent>
          <Badge variant="destructive">Error</Badge>
          <p className="mt-2 text-sm text-muted-foreground">Failed to fetch storage metrics</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="h-5 w-5" />
          Storage
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {/* Recordings */}
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <FileAudio className="h-4 w-4" />
            Recordings
          </dt>
          <dd className="text-right">
            <span className="font-medium">{data.recordings.formatted}</span>
            <span className="ml-1 text-muted-foreground">({data.recordings.fileCount} files)</span>
          </dd>

          {/* Database */}
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <Database className="h-4 w-4" />
            Database
          </dt>
          <dd className="text-right">
            <span className="font-medium">{data.database.formatted}</span>
          </dd>

          {/* Logs */}
          <dt className="flex items-center gap-1.5 text-muted-foreground">
            <FileText className="h-4 w-4" />
            Logs
          </dt>
          <dd className="text-right">
            <span className="font-medium">{data.logs.formatted}</span>
            <span className="ml-1 text-muted-foreground">({data.logs.fileCount} files)</span>
          </dd>

          {/* Total */}
          <dt className="border-t pt-2 font-medium">Total</dt>
          <dd className="border-t pt-2 text-right">
            <span className="font-bold">{data.total.formatted}</span>
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}
