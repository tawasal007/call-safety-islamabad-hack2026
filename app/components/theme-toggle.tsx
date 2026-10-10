"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "call-safety-theme";
type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    setReady(true);

    // Keep other open tabs in sync without reconnecting any audio room.
    function syncTheme(event: StorageEvent) {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      const nextTheme = event.newValue === "light" ? "light" : "dark";
      document.documentElement.dataset.theme = nextTheme;
      setTheme(nextTheme);
    }
    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);

  function changeTheme(nextTheme: Theme) {
    document.documentElement.dataset.theme = nextTheme;
    setTheme(nextTheme);
    try {
      localStorage.setItem(STORAGE_KEY, nextTheme);
    } catch {
      // The current page still switches if persistent storage is unavailable.
    }
  }

  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      <button type="button" aria-label="Light theme" aria-pressed={theme === "light"} disabled={!ready} onClick={() => changeTheme("light")}><Sun size={15} /><span>Light</span></button>
      <button type="button" aria-label="Dark theme" aria-pressed={theme === "dark"} disabled={!ready} onClick={() => changeTheme("dark")}><Moon size={15} /><span>Dark</span></button>
    </div>
  );
}
