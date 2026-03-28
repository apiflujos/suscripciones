"use client";

import { useState, useRef, useEffect } from "react";

export function HelpTip({ text, ariaLabel, position = "center" }: { text?: string; ariaLabel?: string; position?: "right" | "left" | "top" | "bottom" | "center" }) {
  const [isOpen, setIsOpen] = useState(false);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (tipRef.current && !tipRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className="helpTipWrap" ref={tipRef}>
      <button
        type="button"
        className="helpTip"
        aria-label={ariaLabel || "Ayuda"}
        onClick={() => setIsOpen(!isOpen)}
      >
        ?
      </button>
      {text ? (
        <div className={`helpTipBubble pos-${position} ${isOpen ? "is-open" : ""}`}>
          {text}
        </div>
      ) : null}
    </div>
  );
}
