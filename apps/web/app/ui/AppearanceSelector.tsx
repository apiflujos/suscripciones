"use client";

import { useEffect, useState } from "react";

type ThemeChoice = "light" | "dark" | "high-contrast" | "safe";

const THEME_KEY = "apiflujos-theme";
const CONTRAST_KEY = "apiflujos-contrast";
const VISION_KEY = "apiflujos-vision";

function readAppearancePrefs() {
  const themeRaw = window.localStorage.getItem(THEME_KEY) || "";
  const contrastRaw = window.localStorage.getItem(CONTRAST_KEY) || "";
  const visionRaw = window.localStorage.getItem(VISION_KEY) || "";

  const theme: ThemeChoice =
    themeRaw === "dark" || themeRaw === "high-contrast" || themeRaw === "safe" || themeRaw === "light"
      ? themeRaw
      : visionRaw === "safe"
        ? "safe"
        : contrastRaw === "high"
          ? "high-contrast"
          : "light";

  return { theme };
}

function writeAppearancePref(key: string, value: string | null) {
  if (value) window.localStorage.setItem(key, value);
  else window.localStorage.removeItem(key);
  window.dispatchEvent(new Event("apiflujos-theme:change"));
}

export function AppearanceSelector({ compact = false, cards = false }: { compact?: boolean; cards?: boolean }) {
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>("light");

  useEffect(() => {
    const sync = () => {
      const prefs = readAppearancePrefs();
      setThemeChoice(prefs.theme);
    };
    sync();

    const onStorage = (event: StorageEvent) => {
      if (!event.key) return;
      if (event.key === THEME_KEY || event.key === CONTRAST_KEY || event.key === VISION_KEY) sync();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("apiflujos-theme:change", sync as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("apiflujos-theme:change", sync as EventListener);
    };
  }, []);

  const setTheme = (next: ThemeChoice) => {
    setThemeChoice(next);
    writeAppearancePref(THEME_KEY, next);
    if (next === "high-contrast") {
      writeAppearancePref(CONTRAST_KEY, "high");
      writeAppearancePref(VISION_KEY, null);
      return;
    }
    if (next === "safe") {
      writeAppearancePref(VISION_KEY, "safe");
      writeAppearancePref(CONTRAST_KEY, null);
      return;
    }
    writeAppearancePref(CONTRAST_KEY, null);
    writeAppearancePref(VISION_KEY, null);
  };

  return (
    <div className={`appearanceSelector ${compact ? "is-compact" : ""} ${cards ? "is-cards" : ""}`}>
      <div className="appearanceGroup">
        <div className="appearanceLabel">Tema</div>
        <div className="appearanceOptions">
          <button type="button" className={`appearanceOption ${themeChoice === "light" ? "is-active" : ""}`} onClick={() => setTheme("light")} aria-pressed={themeChoice === "light"} data-loader="off">
            Claro
          </button>
          <button type="button" className={`appearanceOption ${themeChoice === "dark" ? "is-active" : ""}`} onClick={() => setTheme("dark")} aria-pressed={themeChoice === "dark"} data-loader="off">
            Oscuro
          </button>
          <button type="button" className={`appearanceOption ${themeChoice === "high-contrast" ? "is-active" : ""}`} onClick={() => setTheme("high-contrast")} aria-pressed={themeChoice === "high-contrast"} data-loader="off">
            Alto contraste
          </button>
          <button type="button" className={`appearanceOption ${themeChoice === "safe" ? "is-active" : ""}`} onClick={() => setTheme("safe")} aria-pressed={themeChoice === "safe"} data-loader="off">
            Accesibilidad
          </button>
        </div>
      </div>
    </div>
  );
}
