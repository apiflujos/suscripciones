"use client";

import { useMemo, useRef, useState } from "react";

export function ProductsFilters({
  q,
  tenantId,
  smartListId,
  tenants,
  smartLists
}: {
  q: string;
  tenantId: string;
  smartListId: string;
  tenants: Array<{ id: string; name: string }>;
  smartLists: Array<{ id: string; name: string }>;
}) {
  const [searchValue, setSearchValue] = useState(q);
  const canSearch = searchValue.trim().length > 0;
  const tenantFormRef = useRef<HTMLFormElement | null>(null);
  const listFormRef = useRef<HTMLFormElement | null>(null);

  const trimmed = useMemo(() => searchValue.trim(), [searchValue]);

  return (
    <>
      <form
        action="/products"
        method="GET"
        className="filtersForm"
        onSubmit={(event) => {
          if (!trimmed) event.preventDefault();
        }}
      >
        {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
        {smartListId ? <input type="hidden" name="list" value={smartListId} /> : null}
        <input
          className="input"
          name="q"
          value={searchValue}
          placeholder="Buscar..."
          aria-label="Buscar productos"
          onChange={(event) => setSearchValue(event.target.value)}
        />
        <button className="ghost" type="submit" disabled={!canSearch}>
          Buscar
        </button>
      </form>

      <form ref={tenantFormRef} action="/products" method="GET" className="filtersForm">
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

      <form ref={listFormRef} action="/products" method="GET" className="filtersForm">
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
