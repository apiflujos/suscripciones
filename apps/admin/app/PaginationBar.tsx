import React from "react";

interface PaginationBarProps {
  currentPage: number;
  totalPages: number;
  pageHref: (page: number) => string;
  style?: React.CSSProperties;
}

export function PaginationBar({ currentPage, totalPages, pageHref, style }: PaginationBarProps) {
  const window = 10;
  let start = Math.max(1, currentPage - Math.floor(window / 2));
  let end = start + window - 1;
  if (end > totalPages) {
    end = totalPages;
    start = Math.max(1, end - (window - 1));
  }
  const pages: number[] = [];
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="pagination pagination-indicator" style={style}>
      {currentPage <= 1 ? (
        <span className="page-link page-nav" aria-disabled="true">Anterior</span>
      ) : (
        <a className="page-link page-nav" href={pageHref(currentPage - 1)}>Anterior</a>
      )}
      <div className="pagination-pages">
        {totalPages > 1 && start > 1 && (
          <>
            <a className="page-link" href={pageHref(1)}>1</a>
            {start > 2 && <span className="page-link" aria-disabled="true" style={{ pointerEvents: "none", opacity: 0.4 }}>…</span>}
          </>
        )}
        {pages.map((p) => (
          <a
            key={p}
            className={`page-link${p === currentPage ? " is-active" : ""}`}
            href={pageHref(p)}
            aria-current={p === currentPage ? "page" : undefined}
          >
            {p}
          </a>
        ))}
        {totalPages > 1 && end < totalPages && (
          <>
            {end < totalPages - 1 && <span className="page-link" aria-disabled="true" style={{ pointerEvents: "none", opacity: 0.4 }}>…</span>}
            <a className="page-link" href={pageHref(totalPages)}>{totalPages}</a>
          </>
        )}
      </div>
      {currentPage >= totalPages ? (
        <span className="page-link page-nav" aria-disabled="true">Siguiente</span>
      ) : (
        <a className="page-link page-nav" href={pageHref(currentPage + 1)}>Siguiente</a>
      )}
    </div>
  );
}
