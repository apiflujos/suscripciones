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

  const fallbackTheme = theme === "auto" ? (prefersDark ? "dark" : "light") : theme;
  const resolvedTheme =
    fallbackTheme === "high-contrast" || contrast === "high" || prefersContrast || forcedColors
      ? "high-contrast"
      : fallbackTheme === "safe" || vision === "safe"
        ? "safe"
        : fallbackTheme === "dark"
          ? "dark"
          : "light";

  root.dataset.theme = resolvedTheme;

  const logoMap = {
    horizontal: {
      light: "/brand/logo_horizontal.svg",
      dark: "/brand/logo_horizontal_dark.svg",
      "high-contrast": "/brand/logo_horizontal_high_contrast_white.svg",
      safe: "/brand/logo_horizontal_safe.svg"
    },
    vertical: {
      light: "/brand/logo_vertical.svg",
      dark: "/brand/logo_vertical_dark.svg",
      "high-contrast": "/brand/logo_vertical_high_contrast_white.svg",
      safe: "/brand/logo_vertical_safe.svg"
    }
  } as const;

  const faviconMap = {
    light: "/brand/isotipo_icono.svg",
    dark: "/brand/isotipo_icono_dark.svg",
    "high-contrast": "/brand/isotipo_icono_high_contrast_white.svg",
    safe: "/brand/isotipo_icono_safe.svg"
  } as const;

  const updateAssets = (themeName: keyof typeof faviconMap) => {
    const favicon = document.querySelector<HTMLLinkElement>('link[data-theme-favicon="true"]');
    if (favicon) favicon.href = faviconMap[themeName] || faviconMap.light;

    document.querySelectorAll<HTMLImageElement>("[data-theme-logo]").forEach((img) => {
      const kind = img.dataset.themeLogo as "horizontal" | "vertical" | undefined;
      if (!kind || !logoMap[kind]) return;
      img.src = logoMap[kind][themeName] || logoMap[kind].light;
    });
  };

  updateAssets(resolvedTheme);

  if (resolvedTheme === "high-contrast") {
    root.dataset.contrast = "high";
    delete root.dataset.vision;
    return;
  }

  if (resolvedTheme === "safe") {
    root.dataset.vision = "safe";
    delete root.dataset.contrast;
    return;
  }

  if (contrast === "high") root.dataset.contrast = "high";
  else delete root.dataset.contrast;

  if (vision === "safe") root.dataset.vision = "safe";
  else delete root.dataset.vision;
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
