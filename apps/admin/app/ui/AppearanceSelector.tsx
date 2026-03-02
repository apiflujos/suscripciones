"use client";

import { useEffect, useState } from "react";

type ThemeChoice = "auto" | "light" | "dark";
type ContrastChoice = "auto" | "normal" | "high";
type VisionChoice = "standard" | "safe";

const THEME_KEY = "apiflujos-theme";
const CONTRAST_KEY = "apiflujos-contrast";
const VISION_KEY = "apiflujos-vision";

function readAppearancePrefs() {
  const themeRaw = window.localStorage.getItem(THEME_KEY) || "";
  const contrastRaw = window.localStorage.getItem(CONTRAST_KEY) || "";
  const visionRaw = window.localStorage.getItem(VISION_KEY) || "";

  const theme: ThemeChoice = themeRaw === "dark" || themeRaw === "light" ? themeRaw : "auto";
  const contrast: ContrastChoice = contrastRaw === "high" ? "high" : contrastRaw === "normal" ? "normal" : "auto";
  const vision: VisionChoice = visionRaw === "safe" ? "safe" : "standard";

  return { theme, contrast, vision };
}

function writeAppearancePref(key: string, value: string | null) {
  if (value) window.localStorage.setItem(key, value);
  else window.localStorage.removeItem(key);
  window.dispatchEvent(new Event("apiflujos-theme:change"));
}

export function AppearanceSelector({ compact = false, cards = false }: { compact?: boolean; cards?: boolean }) {
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>("auto");
  const [contrastChoice, setContrastChoice] = useState<ContrastChoice>("auto");
  const [visionChoice, setVisionChoice] = useState<VisionChoice>("standard");

  useEffect(() => {
    const sync = () => {
      const prefs = readAppearancePrefs();
      setThemeChoice(prefs.theme);
      setContrastChoice(prefs.contrast);
      setVisionChoice(prefs.vision);
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
    writeAppearancePref(THEME_KEY, next === "auto" ? null : next);
  };

  const setContrast = (next: ContrastChoice) => {
    setContrastChoice(next);
    if (next === "auto") writeAppearancePref(CONTRAST_KEY, null);
    else writeAppearancePref(CONTRAST_KEY, next);
  };

  const setVision = (next: VisionChoice) => {
    setVisionChoice(next);
    writeAppearancePref(VISION_KEY, next === "standard" ? null : "safe");
  };

  return (
    <div className={`appearanceSelector ${compact ? "is-compact" : ""} ${cards ? "is-cards" : ""}`}>
      <div className="appearanceGroup">
        <div className="appearanceLabel">Tema</div>
        <div className="appearanceOptions">
          <button type="button" className={`appearanceOption ${themeChoice === "auto" ? "is-active" : ""}`} onClick={() => setTheme("auto")} aria-pressed={themeChoice === "auto"} data-loader="off">
            Sistema
          </button>
          <button type="button" className={`appearanceOption ${themeChoice === "light" ? "is-active" : ""}`} onClick={() => setTheme("light")} aria-pressed={themeChoice === "light"} data-loader="off">
            Claro
          </button>
          <button type="button" className={`appearanceOption ${themeChoice === "dark" ? "is-active" : ""}`} onClick={() => setTheme("dark")} aria-pressed={themeChoice === "dark"} data-loader="off">
            Oscuro
          </button>
        </div>
      </div>
      <div className="appearanceGroup">
        <div className="appearanceLabel">Visión</div>
        <div className="appearanceOptions">
          <button type="button" className={`appearanceOption ${visionChoice === "standard" ? "is-active" : ""}`} onClick={() => setVision("standard")} aria-pressed={visionChoice === "standard"} data-loader="off">
            Estándar
          </button>
          <button type="button" className={`appearanceOption ${visionChoice === "safe" ? "is-active" : ""}`} onClick={() => setVision("safe")} aria-pressed={visionChoice === "safe"} data-loader="off">
            Seguro
          </button>
        </div>
      </div>
      <div className="appearanceGroup">
        <div className="appearanceLabel">Contraste</div>
        <div className="appearanceOptions">
          <button type="button" className={`appearanceOption ${contrastChoice === "auto" ? "is-active" : ""}`} onClick={() => setContrast("auto")} aria-pressed={contrastChoice === "auto"} data-loader="off">
            Sistema
          </button>
          <button type="button" className={`appearanceOption ${contrastChoice === "normal" ? "is-active" : ""}`} onClick={() => setContrast("normal")} aria-pressed={contrastChoice === "normal"} data-loader="off">
            Normal
          </button>
          <button type="button" className={`appearanceOption ${contrastChoice === "high" ? "is-active" : ""}`} onClick={() => setContrast("high")} aria-pressed={contrastChoice === "high"} data-loader="off">
            Alto
          </button>
        </div>
      </div>
    </div>
  );
}
