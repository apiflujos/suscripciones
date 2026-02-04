"use client";

import { useEffect, useRef } from "react";

export function WompiTokenizeWidget({ publicKey }: { publicKey: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.innerHTML = "";

    const script = document.createElement("script");
    script.src = "https://checkout.wompi.co/widget.js";
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

