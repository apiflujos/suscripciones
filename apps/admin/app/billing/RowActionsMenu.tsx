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
  const [montado, setMontado] = useState(false);
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
        className="ghost btn-icon-only btn-noicon row-actions-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        data-loader="off"
        onClick={() => {
          setMontado(true);
          setOpen((v) => !v);
        }}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="2.2" />
          <circle cx="12" cy="12" r="2.2" />
          <circle cx="12" cy="19" r="2.2" />
        </svg>
      </button>
      {/* Una vez abierto, el menú NO se desmonta: se oculta. Los modales de estos
          botones se renderizan como hijos suyos —AppModal no usa portal—, así que
          desmontar el menú al cerrarlo se llevaría por delante el modal que
          acababa de abrir. */}
      {montado ? (
        <div
          className="row-actions-menu"
          id={menuId}
          role="menu"
          hidden={!open}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
