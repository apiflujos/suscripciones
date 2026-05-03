"use client";

import { useState, useEffect, useRef } from "react";

type AutoSubmitToggleProps = {
  name: string;
  checked: boolean;
  disabled?: boolean;
  requireConfirm?: boolean;
  confirmMessage?: string;
  loadingText?: string;
  form?: string;
};

export function AutoSubmitToggle({
  name,
  checked,
  disabled = false,
  requireConfirm = false,
  confirmMessage,
  loadingText = "Guardando...",
  form
}: AutoSubmitToggleProps) {
  const [localChecked, setLocalChecked] = useState(checked);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalChecked(checked);
    setIsSubmitting(false);
  }, [checked]);

  useEffect(() => {
    return () => {
      if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newChecked = e.target.checked;

    if (requireConfirm) {
      const message = confirmMessage || `¿Estás seguro de cambiar esta configuración? Esto afectará los cobros automáticos.`;
      if (!window.confirm(message)) {
        e.target.checked = !newChecked;
        return;
      }
    }

    setLocalChecked(newChecked);
    setIsSubmitting(true);

    if (submitTimerRef.current) {
      clearTimeout(submitTimerRef.current);
    }
    submitTimerRef.current = setTimeout(() => {
      setIsSubmitting(false);
      submitTimerRef.current = null;
    }, 1200);

    const formElement = form ? document.getElementById(form) : e.target.closest("form");
    if (formElement && formElement instanceof HTMLFormElement) {
      formElement.requestSubmit();
    }
  };

  return (
    <label
      className="toggleControl"
      aria-label={name}
      style={{ pointerEvents: disabled || isSubmitting ? "none" : "auto" }}
    >
      {!disabled ? <input type="hidden" name={name} value="0" /> : null}
      <input
        className="toggleInput"
        type="checkbox"
        name={disabled ? undefined : name}
        value="1"
        checked={localChecked}
        onChange={handleChange}
        disabled={disabled}
        data-auto-submit-self="true"
      />
      <span className="toggle" aria-hidden="true" />
    </label>
  );
}
