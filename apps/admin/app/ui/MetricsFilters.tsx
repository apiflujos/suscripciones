"use client";

import { useEffect, useMemo, useState } from "react";
import { HelpTip } from "./HelpTip";

type Tenant = { id: string; name?: string };

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function clampDate(value: string, min?: string, max?: string) {
  if (!isIsoDate(value)) return value;
  let next = value;
  if (min && isIsoDate(min) && next < min) next = min;
  if (max && isIsoDate(max) && next > max) next = max;
  return next;
}

export function MetricsFilters({
  from,
  to,
  g,
  tenantId,
  tenants,
  view,
  minDate,
  maxDate
}: {
  from: string;
  to: string;
  g: "day" | "week" | "month";
  tenantId: string;
  tenants: Tenant[];
  view?: string;
  minDate?: string;
  maxDate?: string;
}) {
  const [fromValue, setFromValue] = useState(from || "");
  const [toValue, setToValue] = useState(to || "");
  const [gValue, setGValue] = useState(g || "day");
  const [tenantValue, setTenantValue] = useState(tenantId || "");

  useEffect(() => {
    setFromValue((current) => clampDate(current || minDate || "", minDate, maxDate));
  }, [minDate, maxDate]);

  useEffect(() => {
    if (!fromValue) return;
    setToValue((current) => {
      if (!current) return current;
      return clampDate(current, fromValue, maxDate);
    });
  }, [fromValue, maxDate]);

  useEffect(() => {
    if (maxDate) {
      setToValue((current) => clampDate(current, undefined, maxDate));
    }
  }, [maxDate]);

  const isValid = useMemo(() => {
    if (!fromValue || !toValue || !gValue) return false;
    if (minDate && isIsoDate(fromValue) && fromValue < minDate) return false;
    if (maxDate && isIsoDate(toValue) && toValue > maxDate) return false;
    if (isIsoDate(fromValue) && isIsoDate(toValue) && toValue < fromValue) return false;
    return true;
  }, [fromValue, toValue, gValue, minDate, maxDate]);

  return (
    <form method="get" className="filtersForm">
      {view ? <input type="hidden" name="view" value={view} /> : null}
      
      {/* Izquierda: Botones de acción (Periodo y Canal) */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
        <div className="field" style={{ margin: 0, minWidth: "100px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
            <span>Periodo</span>
            <HelpTip text="Agrupación de datos: día, semana o mes." />
          </label>
          <select className="select" name="g" value={gValue} onChange={(e) => setGValue(e.target.value as any)} required style={{ height: 26, minHeight: 26 }}>
            <option value="day">Día</option>
            <option value="week">Semana</option>
            <option value="month">Mes</option>
          </select>
        </div>
        <div className="field" style={{ margin: 0, minWidth: "120px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
            <span>Canal</span>
            <HelpTip text="Segmenta métricas por canal específico." />
          </label>
          <select className="select" name="tenantId" value={tenantValue} onChange={(e) => setTenantValue(e.target.value)} style={{ height: 26, minHeight: 26 }}>
            <option value="">Todos</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      
      {/* Derecha: Fechas */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, marginLeft: "auto" }}>
        <div className="field" style={{ margin: 0, minWidth: "130px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
            <span>Desde</span>
            <HelpTip text="Fecha de inicio del rango en UTC." />
          </label>
          <input
            className="input"
            type="date"
            name="from"
            value={fromValue}
            onChange={(e) => setFromValue(e.target.value)}
            min={minDate}
            max={toValue || maxDate}
            required
            style={{ height: 26, minHeight: 26 }}
          />
        </div>
        <div className="field" style={{ margin: 0, minWidth: "130px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
            <span>Hasta</span>
            <HelpTip text="Fecha de cierre del rango en UTC (incluye todo el día)." />
          </label>
          <input
            className="input"
            type="date"
            name="to"
            value={toValue}
            onChange={(e) => setToValue(e.target.value)}
            min={fromValue || minDate}
            max={maxDate}
            required
            disabled={!fromValue}
            style={{ height: 26, minHeight: 26 }}
          />
        </div>
      </div>
    </form>
  );
}
