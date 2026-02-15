"use client";

import { useEffect, useRef } from "react";

export function WompiTokenizeWidget({ publicKey }: { publicKey: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";

    // Wompi widget expects to live inside a POST form.
    const form = document.createElement("form");
    form.setAttribute("method", "POST");
    form.setAttribute("action", window.location.pathname);
    host.appendChild(form);

    const script = document.createElement("script");
    script.src = "/wompi/widget";
    // Wompi widget is a classic script (not ESM). Using module breaks currentScript.
    script.setAttribute("data-render", "button");
    script.setAttribute("data-widget-operation", "tokenize");
    script.setAttribute("data-public-key", publicKey);
    form.appendChild(script);

    return () => {
      try {
        host.innerHTML = "";
      } catch {}
    };
  }, [publicKey]);

  return <div ref={hostRef} />;
}
