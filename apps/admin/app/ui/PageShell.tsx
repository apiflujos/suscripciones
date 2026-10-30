import Link from "next/link";
import type { ReactNode } from "react";
import "./page-shell.css";

export type Crumb = { label: string; href?: string };

/**
 * Estructura común de toda página dedicada (la que antes era un modal).
 *
 * - Migas de pan y botón "Volver" arriba: siempre se sabe dónde se está y cómo salir.
 * - El contenido ocupa el ancho de la página; nada queda dentro de una capa
 *   flotante que recorte lo que se ve.
 * - Las acciones (Guardar / Cancelar) van en una barra fija abajo: no hay que
 *   bajar hasta el final de un formulario largo para encontrarlas.
 *
 * Es un componente de servidor: no maneja estado.
 */
export function PageShell({
  title,
  subtitle,
  crumbs,
  backHref,
  backLabel = "Volver",
  headerActions,
  notice,
  width = "form",
  children
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  crumbs?: Crumb[];
  backHref?: string;
  backLabel?: string;
  headerActions?: ReactNode;
  /** Mensaje de resultado (éxito o error) que se muestra bajo el título. */
  notice?: { tone: "ok" | "error" | "info"; text: ReactNode } | null;
  /** form ≈ 760 px · wide ≈ 1120 px · full = todo el ancho. */
  width?: "form" | "wide" | "full";
  children: ReactNode;
}) {
  return (
    <main className={`page pageWide page-shell page-shell-${width}`}>
      <header className="page-shell-header">
        {crumbs && crumbs.length ? (
          <nav className="page-shell-crumbs" aria-label="Ruta">
            {crumbs.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`} className="page-shell-crumb">
                {crumb.href ? <Link href={crumb.href}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}
              </span>
            ))}
          </nav>
        ) : null}
        <div className="page-shell-title-row">
          <div className="page-shell-title-block">
            {backHref ? (
              <Link className="ghost btn-compact page-shell-back" href={backHref} data-loader="off">
                <span aria-hidden="true">←</span> {backLabel}
              </Link>
            ) : null}
            <div>
              <h1 className="page-shell-title">{title}</h1>
              {subtitle ? <p className="page-shell-subtitle">{subtitle}</p> : null}
            </div>
          </div>
          {headerActions ? <div className="page-shell-header-actions">{headerActions}</div> : null}
        </div>
      </header>

      {notice ? (
        <div className={`page-shell-notice is-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </div>
      ) : null}

      <div className="page-shell-body">{children}</div>
    </main>
  );
}

/** Tarjeta de sección dentro de una página dedicada. */
export function PageSection({
  title,
  description,
  children
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="page-shell-section">
      {title || description ? (
        <div className="page-shell-section-head">
          {title ? <h2 className="page-shell-section-title">{title}</h2> : null}
          {description ? <p className="page-shell-section-desc">{description}</p> : null}
        </div>
      ) : null}
      <div className="page-shell-section-body">{children}</div>
    </section>
  );
}

/**
 * Barra de acciones fija al pie. `cancelHref` es un enlace, no un botón que cierra
 * una capa: cancelar es volver a la página anterior.
 */
export function FormActions({
  cancelHref,
  cancelLabel = "Cancelar",
  children
}: {
  cancelHref: string;
  cancelLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="page-shell-actions">
      <Link className="ghost btn-compact btn-cancel" href={cancelHref} data-loader="off">
        {cancelLabel}
      </Link>
      {children}
    </div>
  );
}
