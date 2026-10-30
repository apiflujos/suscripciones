"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Botón de filtros inteligentes. Ya no abre un modal: lleva a la página
 * `/filters/<scope>`, que recibe a qué lista volver y con qué parámetros.
 *
 * `onSaved`, `reloadOnSave` e `initialFields` se mantienen en la firma por
 * compatibilidad con quien ya los pasa, pero no hacen nada: al guardar, la página
 * de filtros vuelve a la lista con la lista inteligente ya elegida (`viewId`).
 */
export function FilterButton({
  scope,
  baseParams,
  compactInline: _compactInline,
  label,
  fullWidth
}: {
  scope?: string;
  baseParams?: Record<string, string>;
  initialFields?: unknown;
  compactInline?: boolean;
  label?: string;
  fullWidth?: boolean;
  onSaved?: (created?: { id?: string; name?: string }) => void;
  reloadOnSave?: boolean;
}) {
  const pathname = usePathname() || "/";

  // Sin scope no hay de dónde sacar campos: queda el botón deshabilitado de siempre.
  if (!scope) {
    return label ? (
      <button className="ghost btn-compact btn-filter" type="button" aria-label="Filtros" title="Crear filtro inteligente" disabled style={{ opacity: 0.5, width: fullWidth ? "100%" : undefined, justifyContent: fullWidth ? "center" : undefined }}>
        {label}
      </button>
    ) : (
      <button className="ghost btn-compact btn-icon-only btn-filter" type="button" aria-label="Filtros" title="Crear filtro inteligente" disabled style={{ opacity: 0.5 }} />
    );
  }

  const params = new URLSearchParams(baseParams || {});
  const qs = params.toString();
  const returnTo = qs ? `${pathname}?${qs}` : pathname;
  const href = `/filters/${encodeURIComponent(scope)}?returnTo=${encodeURIComponent(returnTo)}`;

  return label ? (
    <Link
      className="ghost btn-compact btn-filter"
      href={href}
      aria-label={label}
      title={label}
      style={{ width: fullWidth ? "100%" : undefined, justifyContent: fullWidth ? "center" : undefined }}
    >
      {label}
    </Link>
  ) : (
    <Link className="ghost btn-compact btn-icon-only btn-filter" href={href} aria-label="Crear filtro inteligente" title="Crear filtro inteligente" />
  );
}
