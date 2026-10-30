"use client";

import { useEffect, useMemo, useState } from "react";
import "./products.css";

type VariantRow = { option1?: string; option2?: string; priceDeltaPesos?: string };

function formatCopSignedCurrency(input: string): string {
  const raw = String(input || "");
  const trimmed = raw.trimStart();
  const sign = trimmed.startsWith("-") ? "-" : trimmed.startsWith("+") ? "+" : "";
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return sign;
  const value = Number(digits);
  if (!Number.isFinite(value)) return sign;
  const formatted = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
  return sign ? `${sign}${formatted}` : formatted;
}

function pesosToCents(pesosRaw: string): number {
  const digits = String(pesosRaw || "").replace(/[^\d-]/g, "");
  if (!digits) return 0;
  const pesos = Number(digits);
  if (!Number.isFinite(pesos)) return 0;
  return Math.trunc(pesos) * 100;
}

export function VariantsEditor({
  option1Name,
  option2Name,
  showOption2,
  disabled,
  fieldName,
  onJsonChange,
  initialJson,
  resetKey
}: {
  option1Name?: string;
  option2Name?: string;
  showOption2?: boolean;
  disabled?: boolean;
  fieldName?: string;
  onJsonChange?: (json: string) => void;
  initialJson?: string;
  resetKey?: string;
}) {
  const [rows, setRows] = useState<VariantRow[]>([]);

  function formatCopSignedFromCents(cents: number) {
    if (!Number.isFinite(cents)) return "";
    if (cents === 0) return "";
    const sign = cents < 0 ? "-" : "+";
    const abs = Math.abs(cents);
    const formatted = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(abs / 100);
    return `${sign}${formatted}`;
  }

  const json = useMemo(() => {
    const normalized = rows
      .map((r) => ({
        option1: (r.option1 || "").trim() || null,
        option2: showOption2 ? (r.option2 || "").trim() || null : null,
        priceDeltaInCents: pesosToCents(r.priceDeltaPesos || "")
      }))
      .filter((r) => r.option1 || r.option2 || r.priceDeltaInCents !== 0);
    return JSON.stringify(normalized);
  }, [rows, showOption2]);

  useEffect(() => {
    onJsonChange?.(json);
  }, [json, onJsonChange]);

  useEffect(() => {
    if (!initialJson) {
      setRows([]);
      return;
    }
    try {
      const parsed = JSON.parse(initialJson);
      if (!Array.isArray(parsed)) {
        setRows([]);
        return;
      }
      const next = parsed.map((r: any) => ({
        option1: r?.option1 || "",
        option2: r?.option2 || "",
        priceDeltaPesos: formatCopSignedFromCents(Number(r?.priceDeltaInCents || 0))
      }));
      setRows(next);
    } catch {
      setRows([]);
    }
  }, [initialJson, resetKey]);

  return (
    <div className="variants-editor">
      <div className="variants-editor-head">
        <strong>Variantes</strong>
        <button
          type="button"
          className="ghost btn-compact"
          disabled={!!disabled}
          onClick={() => setRows((prev) => [...prev, { option1: "", option2: "", priceDeltaPesos: "" }])}
        >
          + Agregar
        </button>
      </div>

      <input type="hidden" name={fieldName || "variantsJson"} value={json} />

      <div className="variants-editor-rows">
        {disabled ? <div className="field-hint">Define el nombre de las opciones para poder agregar variantes.</div> : null}
        {rows.map((r, idx) => (
          <div key={idx} className={`variants-editor-row${showOption2 ? " has-option2" : ""}`}>
            <div className="field">
              <label htmlFor={`variant-${idx}-o1`}>{option1Name || "Opción 1"}</label>
              <input
                id={`variant-${idx}-o1`}
                className="input"
                value={r.option1 || ""}
                onChange={(e) => setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, option1: e.target.value } : x)))}
                placeholder="Ej: M / 40 / 1 mes"
              />
            </div>
            {showOption2 ? (
              <div className="field">
                <label htmlFor={`variant-${idx}-o2`}>{option2Name || "Opción 2"}</label>
                <input
                  id={`variant-${idx}-o2`}
                  className="input"
                  value={r.option2 || ""}
                  onChange={(e) => setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, option2: e.target.value } : x)))}
                  placeholder="Ej: Negro / Rojo"
                />
              </div>
            ) : null}
            <div className="field">
              <label htmlFor={`variant-${idx}-delta`}>Modificador de precio</label>
              <input
                id={`variant-${idx}-delta`}
                className="input"
                value={r.priceDeltaPesos || ""}
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, priceDeltaPesos: formatCopSignedCurrency(e.target.value) } : x))
                  )
                }
                placeholder="+$ 5.000 o -$ 2.000"
              />
              <div className="field-hint">Suma o resta al precio base.</div>
            </div>
            <button
              type="button"
              className="ghost btn-compact btn-red btn-delete-icon"
              onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
              aria-label="Eliminar variante"
              title="Eliminar variante"
            />
          </div>
        ))}

        {rows.length === 0 && !disabled ? <div className="field-hint">Sin variantes.</div> : null}
      </div>
    </div>
  );
}
