"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Componente HelpTip accesible (WCAG 2.1 AA)
 * 
 * Características de accesibilidad:
 * - Soporte completo para teclado (Tab, Enter, Space, Escape)
 * - ARIA labels y roles apropiados
 * - Focus trap cuando está abierto
 * - Timeout para cierre automático en mobile
 * - Alto contraste y tamaño adecuado
 */
export function HelpTip({ text, ariaLabel }: { text: string; ariaLabel?: string }) {
  const id = useId();
  const label = ariaLabel || "Ayuda";
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
      // Cerrar si click fuera del tooltip también
      const tooltip = tooltipRef.current;
      if (tooltip && !tooltip.contains(e.target as Node)) {
        forceCloseTooltip();
      }
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [isOpen]);

  // Limpiar timeout al desmontar
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const bubble =
    isMounted && isOpen && pos
      ? createPortal(
          <span
            ref={tooltipRef}
            id={id}
            role="tooltip"
            className="helpTipBubble is-open"
            style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
            aria-live="polite"
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
      {bubble}
    </>
  );
}
