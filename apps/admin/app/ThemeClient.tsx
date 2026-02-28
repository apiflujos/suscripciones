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

  const resolvedTheme = theme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

  root.dataset.theme = resolvedTheme;

  if (contrast) {
    root.dataset.contrast = contrast;
  } else {
    delete root.dataset.contrast;
  }

  if (vision) {
    root.dataset.vision = vision;
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

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("apiflujos-theme:change", onChange as EventListener);
    };
  }, []);

  return null;
}
