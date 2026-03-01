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

  return (
    <>
      {systemLists.length ? (
        <div className="filtersQuick">
          {systemLists.map((list) => (
            <a
              key={list.id}
              className={`pill quick-pill ${smartListId === list.id ? "is-active" : ""}`}
              href={buildListHref(list.id)}
            >
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
