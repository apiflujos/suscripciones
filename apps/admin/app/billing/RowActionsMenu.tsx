"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./row-actions-menu.css";

/**
 * Menú de acciones de una fila, detrás de un solo botón (kebab).
 *
 * Sus elementos son enlaces a páginas dedicadas (`<Link>`) o formularios de una
 * sola acción; ya no hay modales colgando de cada fila.
 *
 * El menú se pinta en un portal sobre `document.body`, con posición fija calculada
 * desde el botón. Así ningún contenedor con `overflow` de la lista lo recorta, y si
 * no cabe debajo de la última fila se abre hacia arriba.
 */
export function RowActionsMenu({
  children,
  label = "Acciones de la suscripción"
}: {
  children: React.ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  const close = useCallback(() => setOpen(false), []);

  // Posición: debajo del botón, alineado a su borde derecho; arriba si no cabe.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const height = menu.offsetHeight;
    const below = rect.bottom + 6;
    const fitsBelow = below + height <= window.innerHeight - 8;
    const top = fitsBelow ? below : Math.max(8, rect.top - 6 - height);
    setPos({ top, right: Math.max(8, window.innerWidth - rect.right) });
  }, [open]);

  // Teclado: al abrir se enfoca la primera opción; flechas, Inicio y Fin recorren el menú.
  useEffect(() => {
    if (!open || !pos) return;
    const menu = menuRef.current;
    if (!menu) return;
    const items = () =>
      Array.from(menu.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")).filter((el) => !el.closest("[hidden]"));
    items().forEach((el) => el.setAttribute("role", "menuitem"));
    items()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      const list = items();
      if (!list.length) return;
      const index = list.indexOf(document.activeElement as HTMLElement);
      let next = -1;
      if (event.key === "ArrowDown") next = (index + 1) % list.length;
      else if (event.key === "ArrowUp") next = (index - 1 + list.length) % list.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = list.length - 1;
      else if (event.key === "Tab") {
        close();
        return;
      }
      if (next >= 0) {
        event.preventDefault();
        list[next].focus();
      }
    };
    menu.addEventListener("keydown", onKey);
    return () => menu.removeEventListener("keydown", onKey);
  }, [open, pos, close]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    };
    // El menú está en posición fija: al desplazar o redimensionar quedaría
    // desalineado del botón, así que se cierra.
    const onViewportChange = () => close();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open, close]);

  return (
    <div className="row-actions">
      <button
        ref={triggerRef}
        type="button"
        className="ghost btn-icon-only btn-noicon row-actions-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        data-loader="off"
        onClick={() => {
          setPos(null);
          setOpen((v) => !v);
        }}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="2.2" />
          <circle cx="12" cy="12" r="2.2" />
          <circle cx="12" cy="19" r="2.2" />
        </svg>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className="row-actions-menu is-floating"
              id={menuId}
              role="menu"
              style={{
                position: "fixed",
                top: pos ? pos.top : -9999,
                right: pos ? pos.right : 0,
                visibility: pos ? "visible" : "hidden"
              }}
              // Un enlace cierra el menú. El envío de un formulario NO: desmontar el
              // formulario en el mismo clic cancelaría el envío; la página navega sola.
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("a")) close();
              }}
            >
              {children}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
