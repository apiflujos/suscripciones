"use client";

import { useState, useTransition } from "react";

type AutoSubmitToggleProps = {
  name: string;
  checked: boolean;
  disabled?: boolean;
  requireConfirm?: boolean;
  confirmMessage?: string;
  loadingText?: string;
  form?: string;
};

/**
 * Toggle con loading state y confirmación opcional para cambios críticos
 * 
 * Usa useTransition para mostrar estado pendiente mientras se envía al servidor
 */
export function AutoSubmitToggle({
  name,
  checked,
  disabled = false,
  requireConfirm = false,
  confirmMessage,
  loadingText = "Guardando...",
  form
}: AutoSubmitToggleProps) {
  const [isPending, startTransition] = useTransition();
  const [localChecked, setLocalChecked] = useState(checked);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newChecked = e.target.checked;
    
    // Confirmar si es requerido
    if (requireConfirm) {
      const message = confirmMessage || `¿Estás seguro de cambiar esta configuración? Esto afectará los cobros automáticos.`;
      if (!window.confirm(message)) {
        // Revertir al estado anterior
        e.target.checked = !newChecked;
        return;
      }
    }
    
    // Actualizar estado local inmediatamente para UX responsivo
    setLocalChecked(newChecked);
    
    // Enviar formulario con transition para mostrar loading
    startTransition(() => {
      const formElement = form ? document.getElementById(form) : e.target.closest("form");
      if (formElement && formElement instanceof HTMLFormElement) {
        // Crear hidden input para el valor
        const hiddenInput = document.createElement("input");
        hiddenInput.type = "hidden";
        hiddenInput.name = name;
        hiddenInput.value = newChecked ? "true" : "false";
        formElement.appendChild(hiddenInput);
        
        // Submit
        formElement.requestSubmit();
        
        // Limpiar hidden input después de submit
        setTimeout(() => {
          hiddenInput.remove();
        }, 100);
      }
    });
  };

  return (
    <label className="toggleControl" aria-label={name} style={{ opacity: isPending ? 0.7 : 1, pointerEvents: isPending || disabled ? "none" : "auto" }}>
      <input type="hidden" name={name} value="false" />
      <input
        className="toggleInput"
        type="checkbox"
        name={name}
        value="true"
        checked={localChecked}
        onChange={handleChange}
        disabled={disabled || isPending}
        data-auto-submit="true"
      />
      <span className="toggle" aria-hidden="true" style={{ position: "relative" }}>
        {isPending && (
          <span style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: "10px",
            color: "var(--muted)"
          }}>
            ⏳
          </span>
        )}
      </span>
      {isPending && (
        <span className="field-hint" style={{ marginLeft: 8, fontStyle: "italic" }}>
          {loadingText}
        </span>
      )}
    </label>
  );
}
