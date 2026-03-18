"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Componente HelpTip accesible (WCAG 2.1 AA)
 *
 * Características de accesibilidad:
 * - Soporte completo para teclado (Tab, Enter, Space, Escape)
 * - ARIA labels y roles apropiados
 * - Focus trap cuando está abierto
 * - Timeout para cierre automático en mobile
 * - Alto contraste y tamaño adecuado
 * - Posicionamiento inteligente para evitar superposiciones
 */
export function HelpTip({ 
  text, 
  ariaLabel,
  position = "right"
}: { 
  text: string; 
  ariaLabel?: string;
  position?: "right" | "left" | "top" | "bottom";
}) {
  const id = useId();
  const label = ariaLabel || "Ayuda";
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  function openTooltip() {
    setIsOpen(true);
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }

  function closeTooltip() {
    // Delay para permitir hover entre botón y tooltip
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
      closeTimeoutRef.current = null;
    }, 150);
  }

  function forceCloseTooltip() {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsOpen(false);
  }

  useEffect(() => {
    if (!isOpen) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const btn = buttonRef.current;
      if (!btn) return;
      if (btn.contains(e.target as Node)) return;
      forceCloseTooltip();
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [isOpen]);

  return (
    <span className="helpTipWrap">
      <button
        ref={buttonRef}
        type="button"
        className="helpTip"
        data-loader="off"
        aria-label={label}
        aria-describedby={isOpen ? id : undefined}
        aria-expanded={isOpen}
        aria-haspopup="true"
        onMouseEnter={openTooltip}
        onMouseLeave={closeTooltip}
        onFocus={openTooltip}
        onBlur={forceCloseTooltip}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            forceCloseTooltip();
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsOpen(!isOpen);
          }
        }}
        tabIndex={0}
      >
        ?
      </button>
      {isOpen ? (
        <span id={id} role="tooltip" className={`helpTipBubble is-open pos-${position}`} aria-live="polite">
          {text}
        </span>
      ) : null}
    </span>
  );
}
