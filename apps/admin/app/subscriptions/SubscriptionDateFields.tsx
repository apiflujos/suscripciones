"use client";

import { useMemo, useState } from "react";

function toIsoFromLocalInput(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

export function SubscriptionDateFields() {
  const [startLocal, setStartLocal] = useState("");
  const [cutoffLocal, setCutoffLocal] = useState("");
  const [cutoffToday, setCutoffToday] = useState(false);

  const startAt = useMemo(() => toIsoFromLocalInput(startLocal), [startLocal]);
  const firstPeriodEndAt = useMemo(() => toIsoFromLocalInput(cutoffLocal), [cutoffLocal]);

  function setCutoffNow() {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(
      now.getMinutes()
    )}`;
    setCutoffLocal(local);
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <input type="hidden" name="startAt" value={startAt} />
      <input type="hidden" name="firstPeriodEndAt" value={firstPeriodEndAt} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="field">
          <label>Fecha de activación</label>
          <input
            className="input"
            type="datetime-local"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
            step={60}
            placeholder="Ahora"
          />
          <div className="field-hint">Si la dejas vacía, se usa la fecha/hora actual.</div>
        </div>

        <div className="field">
          <label>Fecha de corte (primer cobro)</label>
          <input
            className="input"
            type="datetime-local"
            value={cutoffLocal}
            onChange={(e) => setCutoffLocal(e.target.value)}
            step={60}
            disabled={cutoffToday}
          />
          <div className="field-hint">Opcional: distinta a la activación. Si está vacía, se calcula con el plan.</div>
          <div className="field-hint">Tip: si eliges corte manual, define también la activación.</div>
          <label className="field" style={{ marginTop: 6, gridAutoFlow: "column", justifyContent: "start", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={cutoffToday}
              onChange={(e) => {
                const v = e.target.checked;
                setCutoffToday(v);
                if (v) setCutoffNow();
              }}
            />
            <span>Fecha de corte es hoy (ahora)</span>
          </label>
        </div>
      </div>
    </div>
  );
}
