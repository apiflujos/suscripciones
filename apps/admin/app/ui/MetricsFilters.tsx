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
  minDate,
  maxDate
}: {
  from: string;
  to: string;
  g: "day" | "week" | "month";
  tenantId: string;
  tenants: Tenant[];
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
      
      {/* Izquierda: Botones de acción (Periodo y Canal) */}
      <div className="metricsFiltersGroup">
        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
            <span>Periodo</span>
            <HelpTip text="Agrupación de datos: día, semana o mes." />
          </label>
          <select className="select" name="g" value={gValue} onChange={(e) => setGValue(e.target.value as any)} required>
            <option value="day">Día</option>
            <option value="week">Semana</option>
            <option value="month">Mes</option>
          </select>
        </div>
        <div className="field">
          <label style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 2 }}>
            <span>Canal</span>
            <HelpTip text="Segmenta métricas por canal específico." />
          </label>
          <select className="select" name="tenantId" value={tenantValue} onChange={(e) => setTenantValue(e.target.value)}>
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
      <div className="metricsFiltersGroup metricsFiltersRight">
        <div className="field">
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
          />
        </div>
        <div className="field">
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
          />
        </div>
      </div>
    </form>
  );
}
