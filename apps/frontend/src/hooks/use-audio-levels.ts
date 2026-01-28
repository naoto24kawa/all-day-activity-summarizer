import { useCallback, useEffect, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_ADAS_API_URL || "http://localhost:3001";

interface AudioLevels {
  mic: number | null;
  speaker: number | null;
}

interface UseAudioLevelsOptions {
  enabled?: boolean;
}

export function useAudioLevels(options: UseAudioLevelsOptions = {}) {
  const { enabled = true } = options;
  const [levels, setLevels] = useState<AudioLevels>({ mic: null, speaker: null });
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`${API_URL}/api/recording/levels`);
    eventSourceRef.current = es;

    es.addEventListener("levels", (event) => {
      try {
        const data = JSON.parse(event.data) as AudioLevels;
        console.log("[SSE] levels:", data);
        setLevels(data);
      } catch {
        // Ignore parse errors
      }
    });

    es.onopen = () => {
      setConnected(true);
    };

    es.onerror = () => {
      setConnected(false);
      // Reconnect after 2 seconds
      setTimeout(() => {
        if (enabled) {
          connect();
        }
      }, 2000);
    };
  }, [enabled]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setConnected(false);
    setLevels({ mic: null, speaker: null });
  }, []);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  return { levels, connected };
}
