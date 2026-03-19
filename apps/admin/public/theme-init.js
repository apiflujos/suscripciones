(() => {
  try {
    const root = document.documentElement;
    const forceSystem = root.dataset.forceSystemTheme === "1";
    const theme = forceSystem ? "" : (localStorage.getItem("apiflujos-theme") || "");
    const contrast = forceSystem ? "" : (localStorage.getItem("apiflujos-contrast") || "");
    const vision = forceSystem ? "" : (localStorage.getItem("apiflujos-vision") || "");
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
    const favicon = document.querySelector('link[data-theme-favicon="true"]');
    const faviconMap = {
      light: "/brand/isotipo_icono.svg",
      dark: "/brand/isotipo_icono_dark.svg",
      "high-contrast": "/brand/isotipo_icono_high_contrast_white.svg",
      safe: "/brand/isotipo_icono_safe.svg"
    };

    root.dataset.theme = resolvedTheme;
    if (favicon) favicon.setAttribute("href", faviconMap[resolvedTheme] || faviconMap.light);

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
  } catch (_) {
    // no-op: theme bootstrap should never block app render
  }
})();
