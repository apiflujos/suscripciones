"use client";

import { useMemo, useState } from "react";
import { HelpTip } from "../ui/HelpTip";
import { PendingButton } from "../ui/PendingButton";

type SmartList = { id: string; name: string };
type MessageOption = { key: string; label: string; content: string };

export function NewMassMessageModal({
  csrfToken,
  returnTo,
  lists,
  messageOptions,
  action
}: {
  csrfToken: string;
  returnTo: string;
  lists: SmartList[];
  messageOptions: MessageOption[];
  action: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"MESSAGE" | "WHATSAPP_TEMPLATE">("MESSAGE");
  const [selectedMessage, setSelectedMessage] = useState<string>(messageOptions[0]?.key || "");

  const messageSelected = useMemo(
    () => messageOptions.find((item) => item.key === selectedMessage) || null,
    [messageOptions, selectedMessage]
  );

  return (
    <>
      <button className="primary" type="button" onClick={() => setOpen(true)} data-modal="true" data-loader="off">
        Nueva campaña
      </button>
      {open ? (
        <div className="modal-backdrop">
          <div className="modal-panel" style={{ maxWidth: 860 }}>
            <div className="panel-header">
              <strong>Nueva campaña</strong>
              <button className="ghost modal-close" type="button" onClick={() => setOpen(false)} aria-label="Cerrar" data-modal-close="true" data-loader="off">
                X
              </button>
            </div>
            <form action={action} className="panel module" style={{ display: "grid", gap: 12 }}>
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="templateKind" value={kind} />
              <input type="hidden" name="messagePresetKey" value={selectedMessage} />

              <div className="field">
                <label>Nombre</label>
                <input className="input" name="name" required placeholder="Ej: Recordatorio cartera marzo" />
              </div>

              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Tipo de envío</span>
                  <HelpTip text="Mensaje normal o plantilla WhatsApp." />
                </label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className={kind === "MESSAGE" ? "primary" : "ghost"} onClick={() => setKind("MESSAGE")} data-loader="off">
                    Mensaje
                  </button>
                  <button type="button" className={kind === "WHATSAPP_TEMPLATE" ? "primary" : "ghost"} onClick={() => setKind("WHATSAPP_TEMPLATE")} data-loader="off">
                    Plantilla WhatsApp
                  </button>
                </div>
              </div>

              <div className="field">
                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span>Filtro inteligente (audiencia)</span>
                  <HelpTip text="Selecciona la lista inteligente de contactos a la que se enviará el mensaje." />
                </label>
                <select className="select" name="smartListId" required>
                  <option value="">Selecciona una lista</option>
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>

              {kind === "MESSAGE" ? (
                <>
                  <div className="field">
                    <label>Qué mensaje enviar</label>
                    <select className="select" value={selectedMessage} onChange={(e) => setSelectedMessage(e.target.value)} required>
                      {messageOptions.map((op) => (
                        <option key={op.key} value={op.key}>
                          {op.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Vista previa</label>
                    <textarea
                      className="input"
                      name="content"
                      rows={7}
                      value={messageSelected?.content || ""}
                      onChange={() => {}}
                      readOnly
                      required
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="field">
                    <label>Nombre de plantilla WhatsApp</label>
                    <input className="input" name="templateName" required placeholder="nombre_template" />
                  </div>
                  <div className="field">
                    <label>Parámetros plantilla (JSON opcional)</label>
                    <textarea
                      className="input"
                      name="templateParams"
                      rows={4}
                      placeholder='{"name":"Juan","amount":"$49.000"}'
                    />
                  </div>
                  <div className="field">
                    <label>Texto de apoyo (opcional)</label>
                    <textarea className="input" name="content" rows={4} placeholder="Mensaje visible junto a la plantilla (opcional)." />
                  </div>
                </>
              )}

              <div className="module-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="ghost" type="button" onClick={() => setOpen(false)} data-loader="off">
                  Cancelar
                </button>
                <PendingButton className="primary" type="submit" pendingText="Guardando...">
                  Guardar campaña
                </PendingButton>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

