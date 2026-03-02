"use client";

import { useEffect, useState } from "react";

type Props = {
  name: string;
  label: string;
  defaultValue?: string;
  hint?: string;
};

export function LogoUploadField({ name, label, defaultValue, hint }: Props) {
  const [value, setValue] = useState<string>(defaultValue || "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (defaultValue && defaultValue !== value) {
      setValue(defaultValue);
    }
  }, [defaultValue]);

  async function handleFile(file: File) {
    setError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/uploads/product-image", { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.url) {
        throw new Error(json?.error || "upload_failed");
      }
      setValue(String(json.url || ""));
    } catch (err: any) {
      setError(String(err?.message || "upload_failed"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="field">
      <label>{label}</label>
      <input type="hidden" name={name} value={value} />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {value ? (
          <img src={value} alt="Logo" style={{ height: 46, width: 46, borderRadius: 10, objectFit: "cover", border: "1px solid var(--stroke)" }} />
        ) : (
          <div style={{ height: 46, width: 46, borderRadius: 10, border: "1px dashed var(--stroke)", background: "var(--panel-soft)" }} />
        )}
        <label className="ghost btn-compact btn-noicon" style={{ cursor: "pointer" }}>
          {uploading ? "Subiendo..." : "Subir archivo"}
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.currentTarget.value = "";
            }}
          />
        </label>
        {value ? (
          <button className="ghost btn-compact btn-noicon btn-red" type="button" onClick={() => setValue("")}>
            Quitar
          </button>
        ) : null}
      </div>
      {hint ? <div className="field-hint">{hint}</div> : null}
      {error ? (
        <div className="field-hint" style={{ color: "var(--danger)" }}>
          Error al subir: {error}
        </div>
      ) : null}
    </div>
  );
}
