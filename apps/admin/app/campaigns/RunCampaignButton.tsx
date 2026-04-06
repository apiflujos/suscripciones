"use client";

import { useEffect, useRef, useState } from "react";
import { AppModal } from "../ui/AppModal";

type TemplateParams = {
  name?: string;
  language?: string;
  processed_params?: {
    body?: Array<{ value: string }>;
    header?: Array<{ value: string }>;
    buttons?: Array<{ value: string }>;
  };
};

export function RunCampaignButton({
  disabled,
  label = "Enviar",
  name,
  content,
  template
}: {
  disabled?: boolean;
  label?: string;
  name?: string;
  content?: string | null;
  template?: TemplateParams | null;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!buttonRef.current) return;
    formRef.current = buttonRef.current.closest("form");
  }, []);

  const tplName = String(template?.name || "").trim();
  const tplLang = String(template?.language || "").trim();
  const bodyParams = template?.processed_params?.body || [];
  const headerParams = template?.processed_params?.header || [];
  const buttonParams = template?.processed_params?.buttons || [];

  return (
    <>
      <button
        ref={buttonRef}
        className="ghost btn-send"
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen(true);
        }}
      >
        {label}
      </button>

      <AppModal
        open={open}
        onClose={() => setOpen(false)}
        title="Enviar campaña"
        maxWidth={560}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="ghost btn-compact" type="button" onClick={() => setOpen(false)} data-loader="off">
              Cancelar
            </button>
            <button
              className="primary btn-compact"
              type="button"
              onClick={() => {
                setOpen(false);
                formRef.current?.requestSubmit();
              }}
            >
              Enviar campaña
            </button>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <div className="field-hint">Campaña</div>
            <div style={{ fontWeight: 600 }}>{name || "—"}</div>
          </div>
          <div>
            <div className="field-hint">Plantilla WhatsApp</div>
            <div>{tplName ? `${tplName}${tplLang ? ` (${tplLang})` : ""}` : "—"}</div>
          </div>
          {content ? (
            <div>
              <div className="field-hint">Contenido</div>
              <div className="muted" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{content}</div>
            </div>
          ) : null}
          {bodyParams.length || headerParams.length || buttonParams.length ? (
            <div className="muted" style={{ fontSize: 12 }}>
              {bodyParams.length ? `Body: ${bodyParams.map((p) => p.value).join(" | ")}` : ""}
              {headerParams.length ? ` · Header: ${headerParams.map((p) => p.value).join(" | ")}` : ""}
              {buttonParams.length ? ` · Botones: ${buttonParams.map((p) => p.value).join(" | ")}` : ""}
            </div>
          ) : null}
        </div>
      </AppModal>
    </>
  );
}
