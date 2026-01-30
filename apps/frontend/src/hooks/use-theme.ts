import { useCallback, useEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "adas-theme";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getResolvedTheme(theme: Theme): "light" | "dark" {
  return theme === "system" ? getSystemTheme() : theme;
}

function applyTheme(theme: Theme) {
  const resolved = getResolvedTheme(theme);
  const root = document.documentElement;

  root.classList.remove("light", "dark");
  root.classList.add(resolved);
}

// External store for theme state
let currentTheme: Theme = getStoredTheme();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Theme {
  return currentTheme;
}

function setTheme(theme: Theme) {
  currentTheme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
  for (const listener of listeners) {
    listener();
  }
}

/**
 * テーマ管理フック
 * - localStorage でテーマ設定を永続化
 * - システム設定 (prefers-color-scheme) に対応
 * - light / dark / system の3モードをサポート
 */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, () => "system" as Theme);

  const resolvedTheme = getResolvedTheme(theme);

  const setThemeCallback = useCallback((newTheme: Theme) => {
    setTheme(newTheme);
  }, []);

  // 初回マウント時にテーマを適用
  useEffect(() => {
    applyTheme(currentTheme);
  }, []);

  // システムテーマの変更を監視
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = () => {
      if (currentTheme === "system") {
        applyTheme("system");
        for (const listener of listeners) {
          listener();
        }
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return {
    theme,
    resolvedTheme,
    setTheme: setThemeCallback,
  };
}
