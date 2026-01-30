/**
 * Browser Notifications Hook
 */

import { useCallback, useEffect, useState } from "react";

export function useNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    if ("Notification" in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (!("Notification" in window)) {
      console.warn("This browser does not support notifications");
      return false;
    }

    const result = await Notification.requestPermission();
    setPermission(result);
    return result === "granted";
  }, []);

  const notify = useCallback(
    (title: string, options?: NotificationOptions) => {
      if (!("Notification" in window)) {
        return null;
      }

      if (permission !== "granted") {
        return null;
      }

      return new Notification(title, {
        icon: "/favicon.svg",
        ...options,
      });
    },
    [permission],
  );

  const notifyHighPriorityTask = useCallback(
    (taskTitle: string, source: string) => {
      return notify(`High Priority Task: ${taskTitle}`, {
        body: `From ${source}. Click to view.`,
        tag: "high-priority-task",
        requireInteraction: true,
      });
    },
    [notify],
  );

  return {
    permission,
    isSupported: "Notification" in window,
    requestPermission,
    notify,
    notifyHighPriorityTask,
  };
}
