"use client";

import { useState } from "react";
import { PendingButton } from "../ui/PendingButton";

type Props = {
  action: (formData: FormData) => void;
  csrfToken: string;
  tenantId: string;
  returnTo: string;
};

export function DeleteTenantButton({ action, csrfToken, tenantId, returnTo }: Props) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirmed) {
          const ok = window.confirm("¿Eliminar este canal? Esta acción no se puede deshacer.");
          if (!ok) {
            e.preventDefault();
            return;
          }
          setConfirmed(true);
        }
      }}
    >
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <PendingButton className="ghost danger" type="submit" pendingText="Eliminando...">
        Eliminar
      </PendingButton>
    </form>
  );
}
