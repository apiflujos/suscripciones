"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function HelpTip({ text, ariaLabel }: { text: string; ariaLabel?: string }) {
  const id = useId();
  const label = ariaLabel || "Ayuda";
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  function recomputePosition() {
    const el = buttonRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      top: Math.round(rect.bottom + 8),
      left: Math.round(rect.right)
    });
  }

  useLayoutEffect(() => {
    if (!isOpen) return;
    recomputePosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onAnyScroll = () => recomputePosition();
    const onResize = () => recomputePosition();
    window.addEventListener("scroll", onAnyScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onAnyScroll, true);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const btn = buttonRef.current;
      if (!btn) return;
      if (btn.contains(e.target as Node)) return;
      setIsOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [isOpen]);

  const bubble =
    isMounted && isOpen && pos
      ? createPortal(
          <span
            id={id}
            role="tooltip"
            className="helpTipBubble is-open"
            style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
          >
            {text}
          </span>,
          document.body
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="helpTip"
        aria-label={label}
        aria-describedby={isOpen ? id : undefined}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onClick={() => setIsOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setIsOpen(false);
        }}
      >
        ?
      </button>
      {bubble}
    </>
  );
}
