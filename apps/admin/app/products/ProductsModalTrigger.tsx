"use client";

export function ProductsModalTrigger() {
  return (
    <button
      className="primary btn-compact"
      type="button"
      id="products-modal-trigger"
      onClick={() => document.getElementById("products-modals-container")?.querySelector("button")?.click()}
    >
      Crear producto
    </button>
  );
}
