"use client";

export function CustomersModalTrigger() {
  return (
    <button
      className="primary btn-compact"
      type="button"
      id="customers-modal-trigger"
      onClick={() => document.getElementById("customers-modals-container")?.querySelector("button")?.click()}
    >
      Crear contacto
    </button>
  );
}
