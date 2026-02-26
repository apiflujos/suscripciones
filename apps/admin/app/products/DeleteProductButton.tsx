"use client";

export function DeleteProductButton({
  action,
  csrfToken,
  productId,
  tenantId,
  returnTo
}: {
  action: (formData: FormData) => void | Promise<void>;
  csrfToken: string;
  productId: string;
  tenantId?: string;
  returnTo?: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("¿Eliminar este producto?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="csrf" value={csrfToken} />
      <input type="hidden" name="id" value={productId} />
      {tenantId ? <input type="hidden" name="tenantId" value={tenantId} /> : null}
      {returnTo ? <input type="hidden" name="returnTo" value={returnTo} /> : null}
      <button className="ghost btn-compact btn-red" type="submit" aria-label="Eliminar producto">
        Eliminar
      </button>
    </form>
  );
}
