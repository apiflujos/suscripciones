"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Menú de acciones de una fila, detrás de un solo botón.
 *
 * Las acciones estaban sueltas en la fila y cada etiqueta ocupaba su ancho real
 * —"Enviar link de pago" son 152 px—, así que la columna necesitaba 256 px y era
 * la que empujaba la lista fuera de la pantalla. Un botón de 36 px devuelve ese
 * espacio a las columnas que llevan el dato que se lee.
 *
 * Es el patrón de la lista de pedidos de mesa de ayuda: un kebab por fila que
 * consolida todo, en vez de repartir botones por la fila.
 */
export function RowActionsMenu({
  children,
  label = "Acciones de la suscripción"
}: {
  children: React.ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    // Cerrar al pulsar fuera. Se escucha en captura para enterarse antes de que
    // el clic llegue a un botón del propio menú y lo desmonte.
    const onPointerDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="row-actions" ref={boxRef}>
      <button
        type="button"
        className="ghost btn-icon-only row-actions-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        data-loader="off"
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">⋮</span>
      </button>
      {open ? (
        // El menú se queda montado mientras esté abierto: cada hijo abre su propio
        // modal y necesita seguir vivo para que ese modal no desaparezca con él.
        <div className="row-actions-menu" id={menuId} role="menu">
          {children}
        </div>
      ) : null}
    </div>
  );
}
