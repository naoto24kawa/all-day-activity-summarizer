/**
 * Calendar Hooks
 */

import { useCallback, useEffect, useState } from "react";
import { fetchAdasApi, patchAdasApi } from "@/lib/adas-api";

export interface CalendarEventAttendee {
  email: string;
  displayName: string | null;
  responseStatus: string;
}

export interface CalendarEventOrganizer {
  email: string;
  displayName: string | null;
}

export interface CalendarEvent {
  id: number;
  date: string;
  eventId: string;
  calendarId: string;
  summary: string;
  description: string | null;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  location: string | null;
  attendees: CalendarEventAttendee[] | null;
  organizer: CalendarEventOrganizer | null;
  conferenceLink: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  isRead: boolean;
  projectId: number | null;
  syncedAt: string;
  createdAt: string;
}

export function useCalendarEvents(options?: {
  date?: string;
  startDate?: string;
  endDate?: string;
}) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const params = new URLSearchParams();
        if (options?.date) params.set("date", options.date);
        if (options?.startDate) params.set("startDate", options.startDate);
        if (options?.endDate) params.set("endDate", options.endDate);

        const url = `/api/calendar${params.toString() ? `?${params.toString()}` : ""}`;
        const data = await fetchAdasApi<CalendarEvent[]>(url);
        setEvents(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch calendar events");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [options?.date, options?.startDate, options?.endDate],
  );

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(() => fetchEvents(true), 60_000); // 1分ごとに更新
    return () => clearInterval(interval);
  }, [fetchEvents]);

  const markAsRead = useCallback(
    async (id: number) => {
      await patchAdasApi(`/api/calendar/${id}`, { isRead: true });
      await fetchEvents(true);
    },
    [fetchEvents],
  );

  const markMultipleAsRead = useCallback(
    async (ids: number[]) => {
      await patchAdasApi("/api/calendar/mark-read", { ids });
      await fetchEvents(true);
    },
    [fetchEvents],
  );

  return { events, error, loading, refetch: fetchEvents, markAsRead, markMultipleAsRead };
}

export function useTodayEvents() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await fetchAdasApi<CalendarEvent[]>("/api/calendar/today");
      setEvents(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch today's events");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(() => fetchEvents(true), 60_000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  return { events, error, loading, refetch: fetchEvents };
}

export function useCalendarUnreadCount(date?: string) {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchCount = useCallback(async () => {
    try {
      const params = date ? `?date=${date}` : "";
      const data = await fetchAdasApi<{ count: number }>(`/api/calendar/unread-count${params}`);
      setCount(data.count);
    } catch {
      // Ignore errors for unread count
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    return () => clearInterval(interval);
  }, [fetchCount]);

  return { count, loading, refetch: fetchCount };
}
