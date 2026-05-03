"use client";

import { useState, useTransition, useEffect, useRef } from "react";

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
  const [isPending, startTransition] = useTransition();
  const [localChecked, setLocalChecked] = useState(checked);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalChecked(checked);
  }, [checked]);

  // Safety valve: if isPending stays true for more than 8s, the transition
  // got stuck (action returned without revalidatePath/redirect). Reset the
  // visual state to the last known server value so the toggle isn't locked.
  useEffect(() => {
    if (isPending) {
      pendingTimerRef.current = setTimeout(() => {
        setLocalChecked(checked);
      }, 8000);
    } else {
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    }
    return () => {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    };
  }, [isPending, checked]);

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
      aria-busy={isPending}
      style={{ opacity: isPending ? 0.72 : 1, pointerEvents: disabled || isPending ? "none" : "auto" }}
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
