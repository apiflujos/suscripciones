"use client";

import { useState } from "react";

type SqlResult = {
  statement: string;
  type: "query" | "execute";
  rowCount?: number;
  affectedRows?: number;
  truncated?: boolean;
  rows?: any[];
};

export function SqlConsoleClient() {
  const [sql, setSql] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<{ statementCount: number; durationMs: number } | null>(null);
  const [results, setResults] = useState<SqlResult[]>([]);

  const run = async () => {
    const query = String(sql || "").trim();
    if (!query) return;
    setLoading(true);
    setError("");
    setMeta(null);
    setResults([]);
    try {
      const res = await fetch("/api/sa/sql-console/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sql: query })
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(String(json?.message || json?.error || `request_failed_${res.status}`));
        return;
      }
      setMeta({ statementCount: Number(json?.statementCount || 0), durationMs: Number(json?.durationMs || 0) });
      setResults(Array.isArray(json?.results) ? json.results : []);
    } catch (err: any) {
      setError(String(err?.message || "request_failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="settings-group">
      <div className="settings-group-header">
        <div className="panelHeaderRow">
          <h3>SQL Console</h3>
        </div>
      </div>
      <div className="settings-group-body">
        <div className="panel module" style={{ display: "grid", gap: 10 }}>
          <textarea
            className="input"
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder="Pega aqui el SQL..."
            style={{ minHeight: 180, width: "100%", padding: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" className="primary btn-noicon btn-compact" onClick={run} disabled={loading}>
              {loading ? "Ejecutando..." : "Ejecutar SQL"}
            </button>
            {meta ? <span className="field-hint">Statements: {meta.statementCount} · {meta.durationMs}ms</span> : null}
            {error ? <span className="field-hint" style={{ color: "var(--danger)" }}>{error}</span> : null}
          </div>
          {results.map((r, idx) => (
            <div key={idx} className="saved-conn-card" style={{ display: "grid", gap: 8 }}>
              <div className="field-hint" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{r.statement}</div>
              <div className="field-hint">
                {r.type === "query"
                  ? `Query · Filas: ${Number(r.rowCount || 0)}${r.truncated ? " (truncado)" : ""}`
                  : `Execute · Afectadas: ${Number(r.affectedRows || 0)}`}
              </div>
              {r.type === "query" ? (
                <pre style={{ margin: 0, overflow: "auto", background: "var(--surface-2)", border: "1px solid var(--stroke)", borderRadius: 8, padding: 10 }}>
                  {JSON.stringify(r.rows || [], null, 2)}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

