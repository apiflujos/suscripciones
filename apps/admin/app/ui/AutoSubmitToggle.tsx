"use client";

import { useState, useTransition, useEffect } from "react";

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
  useEffect(() => {
    setLocalChecked(checked);
  }, [checked]);

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
        formElement.requestSubmit();
      }
    });
  };

  return (
    <label
      className="toggleControl"
      aria-label={name}
      style={{ opacity: isPending ? 0.72 : 1, pointerEvents: disabled ? "none" : "auto" }}
    >
      {!disabled ? <input type="hidden" name={name} value="0" /> : null}
      <input
        className="toggleInput"
        type="checkbox"
        name={disabled ? undefined : name}
        value="1"
        checked={localChecked}
        onChange={handleChange}
        disabled={disabled || isPending}
        data-auto-submit-self="true"
      />
      <span className="toggle" aria-hidden="true" />
    </label>
  );
}
