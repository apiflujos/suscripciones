"use client";

import { useEffect, useRef, useState, useTransition } from "react";

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
  const [cutoffAt, setCutoffAt] = useState(toLocalInput(currentEndAt));
  const [isPending, startTransition] = useTransition();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSubmittedRef = useRef(toLocalInput(currentEndAt));

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

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
        onChange={(e) => {
          const next = e.target.value;
          setCutoffAt(next);
          if (!next) return;
          if (next === latestSubmittedRef.current) return;
          const form = e.currentTarget.form;
          if (!form) return;
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          timeoutRef.current = setTimeout(() => {
            latestSubmittedRef.current = next;
            startTransition(() => {
              form.requestSubmit();
            });
          }, 450);
        }}
        required
        disabled={isPending}
      />
      {isPending ? <span className="field-hint">Guardando...</span> : null}
    </form>
  );
}
