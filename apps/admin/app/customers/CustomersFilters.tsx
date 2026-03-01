"use client";

import { useMemo, useRef, useState } from "react";

export function CustomersFilters({
  q,
  tenantId,
  tenants,
  smartLists,
  smartListId
}: {
  q: string;
  tenantId: string;
  tenants: Array<{ id: string; name: string }>;
  smartLists: Array<{ id: string; name: string; system?: boolean; category?: string }>;
  smartListId: string;
}) {
  const [searchValue, setSearchValue] = useState(q);
  const canSearch = searchValue.trim().length > 0;
  const tenantFormRef = useRef<HTMLFormElement | null>(null);
  const listFormRef = useRef<HTMLFormElement | null>(null);

  const trimmed = useMemo(() => searchValue.trim(), [searchValue]);
  const systemLists = useMemo(() => smartLists.filter((list) => Boolean(list.system)), [smartLists]);
  const buildListHref = (listId: string) => {
    const sp = new URLSearchParams();
    if (trimmed) sp.set("q", trimmed);
    if (tenantId) sp.set("tenantId", tenantId);
    if (listId) sp.set("list", listId);
    return `/customers?${sp.toString()}`;
  };
  const iconForCategory = (category?: string) => {
    const key = String(category || "").toLowerCase();
    if (key.includes("gam")) {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2l2.4 6.4L21 9l-5 4 1.8 6-5.8-3.6L6.2 19 8 13 3 9l6.6-.6z" />
        </svg>
      );
    }
    if (key.includes("rank")) {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 4h12v4a6 6 0 0 1-12 0V4zm3 9h6v7H9z" />
        </svg>
      );
    }
    if (key.includes("estado") || key.includes("status")) {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 12l2 2 4-4M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
        </svg>
      );
    }
    if (key.includes("tend") || key.includes("trend")) {
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 14l4-4 4 4 8-8v6h-2V8.8l-6 6-4-4-3 3z" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 7h10v10H7zM4 4h4v2H6v2H4zM16 4h4v4h-2V6h-2zM4 16h2v2h2v2H4zM18 16h2v4h-4v-2h2z" />
      </svg>
    );
  };
  const toneForCategory = (category?: string) => {
    const key = String(category || "").toLowerCase();
    if (key.includes("gam")) return "gamification";
    if (key.includes("rank")) return "ranking";
    if (key.includes("estado") || key.includes("status")) return "status";
    if (key.includes("tend") || key.includes("trend")) return "trend";
    return "default";
  };

  return (
    <>
      {systemLists.length ? (
        <div className="filtersQuick">
          {systemLists.map((list) => (
            <a
              key={list.id}
              className={`pill quick-pill ${smartListId === list.id ? "is-active" : ""}`}
              href={buildListHref(list.id)}
              data-tone={toneForCategory(list.category)}
            >
              <span className="quick-pill-icon" aria-hidden="true">
                {iconForCategory(list.category)}
              </span>
              {list.name}
            </a>
          ))}
        </div>
      ) : null}
      <form
        action="/customers"
        method="GET"
        className="filtersForm"
        onSubmit={(event) => {
          if (!trimmed) event.preventDefault();
        }}
      >
        {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
        <input
          className="input"
          name="q"
          value={searchValue}
          placeholder="Nombre, email, teléfono o identificación..."
          aria-label="Buscar contactos"
          onChange={(event) => setSearchValue(event.target.value)}
        />
        <button className="ghost" type="submit" disabled={!canSearch}>
          Buscar
        </button>
      </form>

      <form ref={tenantFormRef} action="/customers" method="GET" className="filtersForm">
        {trimmed ? <input type="hidden" name="q" value={trimmed} /> : null}
        {smartListId ? <input type="hidden" name="list" value={smartListId} /> : null}
        <select
          className="select"
          name="tenantId"
          defaultValue={tenantId}
          onChange={() => tenantFormRef.current?.requestSubmit()}
        >
          <option value="">Canal: (todos)</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </form>

      <form ref={listFormRef} action="/customers" method="GET" className="filtersForm">
        {trimmed ? <input type="hidden" name="q" value={trimmed} /> : null}
        {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
        <select
          className="select"
          name="list"
          defaultValue={smartListId}
          onChange={() => listFormRef.current?.requestSubmit()}
        >
          <option value="">Lista inteligente: (todas)</option>
          {smartLists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </select>
      </form>
    </>
  );
}
