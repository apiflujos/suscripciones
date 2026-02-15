"use client";

import { useEffect, useRef } from "react";

export function WompiTokenizeWidget({ publicKey }: { publicKey: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";

    const baseUrl =
      (process.env.NEXT_PUBLIC_ADMIN_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim();

    // Wompi widget expects the script to be a direct child of a POST form.
    const form = host.closest("form");
    if (!form) return;
    form.setAttribute("method", "POST");
    if (!form.getAttribute("action")) {
      const path = window.location.pathname;
      const actionUrl = baseUrl ? `${baseUrl.replace(/\/$/, "")}${path}` : path;
      form.setAttribute("action", actionUrl);
    }

    const prevScript = form.querySelector('script[data-wompi-widget="tokenize"]');
    if (prevScript) prevScript.remove();
    const prevButton = form.querySelector(".waybox-button");
    if (prevButton) prevButton.remove();

    const script = document.createElement("script");
    script.src = "/wompi/widget";
    // Wompi widget is a classic script (not ESM). Using module breaks currentScript.
    script.setAttribute("data-render", "button");
    script.setAttribute("data-widget-operation", "tokenize");
    script.setAttribute("data-public-key", publicKey);
    script.setAttribute("data-wompi-widget", "tokenize");
    form.appendChild(script);

    return () => {
      try {
        const currentScript = form.querySelector('script[data-wompi-widget="tokenize"]');
        if (currentScript) currentScript.remove();
      } catch {}
    };
  }, [publicKey]);

  return <div ref={hostRef} />;
}
