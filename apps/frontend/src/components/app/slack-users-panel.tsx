import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useSlackUsers } from "@/hooks/use-slack-users";
import { formatDateJST } from "@/lib/date";

export function SlackUsersPanel() {
  const { users, loading, error, updateDisplayName, resetDisplayName } = useSlackUsers();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const handleStartEdit = (userId: string, currentName: string | null) => {
    setEditingId(userId);
    setNameInput(currentName ?? "");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setNameInput("");
  };

  const handleSave = async (userId: string) => {
    const newName = nameInput.trim() || null;
    setPendingAction(userId);
    try {
      await updateDisplayName(userId, newName);
      handleCancelEdit();
    } finally {
      setPendingAction(null);
    }
  };

  const handleReset = async (userId: string) => {
    setPendingAction(userId);
    try {
      await resetDisplayName(userId);
    } finally {
      setPendingAction(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Slack Users</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {["skeleton-1", "skeleton-2", "skeleton-3"].map((id) => (
            <Skeleton key={id} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Slack Users</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Slack Users
          <Badge variant="secondary" className="ml-2">
            {users.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Slack users found.</p>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-3">
              {users.map((user) => (
                <div
                  key={user.userId}
                  className={`rounded-md border p-3 ${user.displayName ? "border-green-500/30 bg-green-50/50 dark:bg-green-950/10" : ""}`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    {editingId === user.userId ? (
                      <Input
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSave(user.userId);
                          if (e.key === "Escape") handleCancelEdit();
                        }}
                        placeholder={user.slackName ?? "Display name"}
                        className="h-7 text-sm font-medium"
                        disabled={pendingAction === user.userId}
                        autoFocus
                      />
                    ) : (
                      <>
                        <span className="text-sm font-medium">
                          {user.displayName ?? user.slackName ?? user.userId}
                        </span>
                        {user.displayName && user.slackName && (
                          <span className="text-xs text-muted-foreground">({user.slackName})</span>
                        )}
                      </>
                    )}
                    <Badge variant="outline">{user.messageCount} msgs</Badge>
                    {user.firstSeen && user.lastSeen && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {formatDateJST(user.firstSeen)} - {formatDateJST(user.lastSeen)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {editingId === user.userId ? (
                      <>
                        <Button
                          size="sm"
                          onClick={() => handleSave(user.userId)}
                          disabled={pendingAction === user.userId}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={handleCancelEdit}
                          disabled={pendingAction === user.userId}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleStartEdit(user.userId, user.displayName)}
                          disabled={pendingAction === user.userId}
                        >
                          Edit Name
                        </Button>
                        {user.displayName && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleReset(user.userId)}
                            disabled={pendingAction === user.userId}
                          >
                            Reset
                          </Button>
                        )}
                      </>
                    )}
                    <span className="ml-auto text-xs font-mono text-muted-foreground">
                      {user.userId}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
