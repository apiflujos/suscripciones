"use client";

import { useId } from "react";

export function HelpTip({ text, ariaLabel }: { text: string; ariaLabel?: string }) {
  const id = useId();
  const label = ariaLabel || "Ayuda";
  return (
    <button type="button" className="helpTip" aria-label={label} aria-describedby={id}>
      ?
      <span id={id} role="tooltip" className="helpTipBubble">
        {text}
      </span>
    </button>
  );
}

