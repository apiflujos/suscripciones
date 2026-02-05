"use client";

import { useMemo, useState } from "react";

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
  disabled
}: {
  option1Name?: string;
  option2Name?: string;
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<VariantRow[]>([]);

  const json = useMemo(() => {
    const normalized = rows
      .map((r) => ({
        option1: (r.option1 || "").trim() || null,
        option2: (r.option2 || "").trim() || null,
        priceDeltaInCents: pesosToCents(r.priceDeltaPesos || "")
      }))
      .filter((r) => r.option1 || r.option2 || r.priceDeltaInCents !== 0);
    return JSON.stringify(normalized);
  }, [rows, option1Name, option2Name]);

  return (
    <div className="panel" style={{ borderColor: "rgba(15, 23, 42, 0.12)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <strong>Variantes</strong>
        <button
          type="button"
          className="ghost"
          disabled={!!disabled}
          onClick={() => setRows((prev) => [...prev, { option1: "", option2: "", priceDeltaPesos: "" }])}
        >
          + Agregar
        </button>
      </div>

      <input type="hidden" name="variantsJson" value={json} />

      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
        {disabled ? <div className="field-hint">Define el nombre de las opciones para poder agregar variantes.</div> : null}
        {rows.map((r, idx) => (
          <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 8, alignItems: "end" }}>
            <div className="field">
              <label>{option1Name || "Opción 1"}</label>
              <input
                className="input"
                value={r.option1 || ""}
                onChange={(e) => setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, option1: e.target.value } : x)))}
                placeholder="Ej: M / 40 / 1 mes"
              />
            </div>
            <div className="field">
              <label>{option2Name || "Opción 2"}</label>
              <input
                className="input"
                value={r.option2 || ""}
                onChange={(e) => setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, option2: e.target.value } : x)))}
                placeholder="Ej: Negro / Rojo"
              />
            </div>
            <div className="field">
              <label>Modificador de precio</label>
              <input
                className="input"
                value={r.priceDeltaPesos || ""}
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((x, i) => (i === idx ? { ...x, priceDeltaPesos: formatCopSignedCurrency(e.target.value) } : x))
                  )
                }
                placeholder="+$ 5.000 o -$ 2.000"
              />
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
              aria-label="Eliminar variante"
            >
              Eliminar
            </button>
          </div>
        ))}

        {rows.length === 0 && !disabled ? <div className="field-hint">Sin variantes.</div> : null}
      </div>
    </div>
  );
}
