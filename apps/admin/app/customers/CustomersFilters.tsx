"use client";

import { useMemo, useRef, useState } from "react";

export function CustomersFilters({
  q,
  tenantId,
  tenants
}: {
  q: string;
  tenantId: string;
  tenants: Array<{ id: string; name: string }>;
}) {
  const [searchValue, setSearchValue] = useState(q);
  const canSearch = searchValue.trim().length > 0;
  const tenantFormRef = useRef<HTMLFormElement | null>(null);

  const trimmed = useMemo(() => searchValue.trim(), [searchValue]);

  return (
    <>
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
    </>
  );
}
