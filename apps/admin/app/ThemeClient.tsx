"use client";

import { useEffect } from "react";

const THEME_KEY = "apiflujos-theme";
const CONTRAST_KEY = "apiflujos-contrast";
const VISION_KEY = "apiflujos-vision";

function applyTheme() {
  const root = document.documentElement;
  const theme = window.localStorage.getItem(THEME_KEY) || "";
  const contrast = window.localStorage.getItem(CONTRAST_KEY) || "";
  const vision = window.localStorage.getItem(VISION_KEY) || "";
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const prefersContrast = window.matchMedia("(prefers-contrast: more)").matches;
  const forcedColors = window.matchMedia("(forced-colors: active)").matches;

  const resolvedTheme = theme && theme !== "auto" ? theme : prefersDark ? "dark" : "light";
  const resolvedContrast = contrast === "high" ? "high" : contrast === "normal" ? "" : prefersContrast || forcedColors ? "high" : "";
  const resolvedVision = vision && vision !== "standard" ? vision : "";

  root.dataset.theme = resolvedTheme;

  if (resolvedContrast) root.dataset.contrast = resolvedContrast;
  else delete root.dataset.contrast;

  if (resolvedVision) {
    root.dataset.vision = resolvedVision;
  } else {
    delete root.dataset.vision;
  }
}

export function ThemeClient() {
  useEffect(() => {
    applyTheme();

    const onStorage = (event: StorageEvent) => {
      if (!event.key) return;
      if (event.key === THEME_KEY || event.key === CONTRAST_KEY || event.key === VISION_KEY) {
        applyTheme();
      }
    };

    const onChange = () => applyTheme();

    window.addEventListener("storage", onStorage);
    window.addEventListener("apiflujos-theme:change", onChange as EventListener);

    const schemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const contrastQuery = window.matchMedia("(prefers-contrast: more)");
    const forcedQuery = window.matchMedia("(forced-colors: active)");
    const onMedia = () => applyTheme();

    schemeQuery.addEventListener("change", onMedia);
    contrastQuery.addEventListener("change", onMedia);
    forcedQuery.addEventListener("change", onMedia);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("apiflujos-theme:change", onChange as EventListener);
      schemeQuery.removeEventListener("change", onMedia);
      contrastQuery.removeEventListener("change", onMedia);
      forcedQuery.removeEventListener("change", onMedia);
    };
  }, []);

  return null;
}
