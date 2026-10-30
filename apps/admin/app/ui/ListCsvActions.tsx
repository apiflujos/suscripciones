"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

type EntityType = "customers" | "products" | "companies" | "payments";

export function ListCsvActions({
  exportHref,
  tenantId,
  defaultEntity = "customers",
  allowImport = true
}: {
  exportHref: string;
  tenantId?: string;
  defaultEntity?: EntityType;
  allowImport?: boolean;
}) {
  // La importación es una página: lleva el entity y a qué lista volver.
  const pathname = usePathname() || "/";
  const search = useSearchParams()?.toString() || "";
  const returnTo = search ? `${pathname}?${search}` : pathname;
  const importHref = `/import?entity=${encodeURIComponent(defaultEntity)}&returnTo=${encodeURIComponent(returnTo)}${tenantId ? `&tenantId=${encodeURIComponent(tenantId)}` : ""}`;

  return (
    <>
      <div className="filtersRight list-csv-actions">
        {allowImport ? (
          <Link className="ghost btn-compact btn-icon-only btn-noicon btn-import" href={importHref} aria-label="Importar CSV" title="Importar CSV" data-loader="off">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2a.75.75 0 0 1 .75.75v6.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V2.75A.75.75 0 0 1 8 2z"/>
            <path d="M2 10.75A2.75 2.75 0 0 1 4.75 8h6.5A2.75 2.75 0 0 1 14 10.75v2.5A2.75 2.75 0 0 1 11.25 16h-6.5A2.75 2.75 0 0 1 2 13.25v-2.5zm2.75-1.25A1.25 1.25 0 0 0 3.5 10.75v2.5A1.25 1.25 0 0 0 4.75 14.5h6.5a1.25 1.25 0 0 0 1.25-1.25v-2.5a1.25 1.25 0 0 0-1.25-1.25h-6.5z"/>
          </svg>
          </Link>
        ) : (
          <button className="ghost btn-compact btn-icon-only btn-noicon btn-import is-disabled" type="button" aria-label="Importación no disponible" title="Importación no disponible" disabled>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2a.75.75 0 0 1 .75.75v6.19l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 1 1 1.06-1.06l2.22 2.22V2.75A.75.75 0 0 1 8 2z"/>
            <path d="M2 10.75A2.75 2.75 0 0 1 4.75 8h6.5A2.75 2.75 0 0 1 14 10.75v2.5A2.75 2.75 0 0 1 11.25 16h-6.5A2.75 2.75 0 0 1 2 13.25v-2.5zm2.75-1.25A1.25 1.25 0 0 0 3.5 10.75v2.5A1.25 1.25 0 0 0 4.75 14.5h6.5a1.25 1.25 0 0 0 1.25-1.25v-2.5a1.25 1.25 0 0 0-1.25-1.25h-6.5z"/>
          </svg>
          </button>
        )}
        <a className="ghost btn-compact btn-icon-only btn-noicon btn-export" href={exportHref} aria-label="Exportar CSV" title="Exportar CSV" data-loader="off">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 14a.75.75 0 0 0 .75-.75V7.06l2.22 2.22a.75.75 0 1 0 1.06-1.06l-3.5-3.5a.75.75 0 0 0-1.06 0l-3.5 3.5a.75.75 0 0 0 1.06 1.06l2.22-2.22v6.19A.75.75 0 0 0 8 14z"/>
            <path d="M2 2.75A2.75 2.75 0 0 1 4.75 0h6.5A2.75 2.75 0 0 1 14 2.75v2.5A2.75 2.75 0 0 1 11.25 8h-6.5A2.75 2.75 0 0 1 2 5.25v-2.5zm2.75-1.25A1.25 1.25 0 0 0 3.5 2.75v2.5A1.25 1.25 0 0 0 4.75 6.5h6.5a1.25 1.25 0 0 0 1.25-1.25v-2.5A1.25 1.25 0 0 0 11.25 1.5h-6.5z"/>
          </svg>
        </a>
      </div>
    </>
  );
}
