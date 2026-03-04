"use client";

import { useEffect, useMemo, useState } from "react";
import { PendingButton } from "../ui/PendingButton";

function toLocalInput(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export function AutoCutoffInlineForm({
  subscriptionId,
  csrfToken,
  returnTo,
  tenantId,
  currentEndAt,
  action
}: {
  subscriptionId: string;
  csrfToken: string;
  returnTo: string;
  tenantId?: string;
  currentEndAt?: string | null;
  action: (formData: FormData) => void;
}) {
  const initialCutoff = useMemo(() => toLocalInput(currentEndAt), [currentEndAt]);
  const [cutoffAt, setCutoffAt] = useState(initialCutoff);

  useEffect(() => {
    setCutoffAt(initialCutoff);
  }, [initialCutoff]);

  return (
    <form action={action} className="billing-inline-cutoff">
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
      <input
        className="input"
        type="datetime-local"
        name="cutoffAt"
        value={cutoffAt}
        onChange={(e) => setCutoffAt(e.target.value)}
        required
      />
      <PendingButton
        className="ghost btn-compact btn-noicon btn-save"
        type="submit"
        pendingText="Guardando..."
        disabled={!cutoffAt || cutoffAt === initialCutoff}
      >
        Guardar
      </PendingButton>
    </form>
  );
}
