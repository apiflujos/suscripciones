"use client";

import { useEffect, useRef } from "react";

export function WompiTokenizeWidget({ publicKey }: { publicKey: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";

    const form = host.closest("form");
    if (form) {
      // Wompi widget expects POST (uppercase) on the parent form.
      form.setAttribute("method", "POST");
      if (!form.getAttribute("action")) form.setAttribute("action", window.location.pathname);
    }

    const script = document.createElement("script");
    script.src = "/wompi/widget";
    script.type = "module";
    script.setAttribute("data-render", "button");
    script.setAttribute("data-widget-operation", "tokenize");
    script.setAttribute("data-public-key", publicKey);
    host.appendChild(script);

    return () => {
      try {
        host.innerHTML = "";
      } catch {}
    };
  }, [publicKey]);

  return <div ref={hostRef} />;
}
