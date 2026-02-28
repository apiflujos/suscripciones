"use client";

import { useEffect } from "react";

type FieldInput = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const INPUT_SELECTOR = "input, select, textarea";

function isSkippable(el: FieldInput) {
  if (el instanceof HTMLInputElement) {
    if (["hidden", "submit", "button", "reset", "file"].includes(el.type)) return true;
  }
  return el.hasAttribute("data-validate-off");
}

function getMessage(el: FieldInput) {
  const v = el.validity;
  if (v.valueMissing) return "Este campo es obligatorio.";
  if (v.typeMismatch) {
    if (el instanceof HTMLInputElement) {
      if (el.type === "email") return "Ingresa un email válido.";
      if (el.type === "url") return "Ingresa una URL válida.";
    }
    return "Formato inválido.";
  }
  if (v.patternMismatch) return "Formato inválido.";
  if (v.tooShort) return `Mínimo ${el.minLength} caracteres.`;
  if (v.tooLong) return `Máximo ${el.maxLength} caracteres.`;
  if (v.rangeUnderflow) return `Mínimo ${el.getAttribute("min") || ""}.`;
  if (v.rangeOverflow) return `Máximo ${el.getAttribute("max") || ""}.`;
  if (v.stepMismatch) return "Valor inválido.";
  return el.validationMessage || "Revisa este campo.";
}

function updateField(el: FieldInput, force = false) {
  const field = el.closest(".field") as HTMLElement | null;
  if (!field) return;
  if (isSkippable(el)) return;

  const required = el.hasAttribute("required") || el.getAttribute("aria-required") === "true";
  const hasValue = String(el.value || "").trim().length > 0;
  const touched = force || field.dataset.touched === "1";

  if (!touched) {
    field.classList.remove("is-error", "is-valid");
    const msg = field.querySelector(".field-error[data-validation]") as HTMLElement | null;
    if (msg) msg.textContent = "";
    return;
  }

  if (!required && !hasValue) {
    field.classList.remove("is-error", "is-valid");
    const msg = field.querySelector(".field-error[data-validation]") as HTMLElement | null;
    if (msg) msg.textContent = "";
    return;
  }

  const valid = el.checkValidity();
  field.classList.toggle("is-error", !valid);
  field.classList.toggle("is-valid", valid);

  let msg = field.querySelector(".field-error[data-validation]") as HTMLElement | null;
  if (!msg) {
    msg = document.createElement("div");
    msg.className = "field-error";
    msg.setAttribute("data-validation", "error");
    field.appendChild(msg);
  }

  msg.textContent = valid ? "" : getMessage(el);
}

function markTouched(el: FieldInput) {
  const field = el.closest(".field") as HTMLElement | null;
  if (!field) return;
  field.dataset.touched = "1";
}

export function FormValidation() {
  useEffect(() => {
    const handleInput = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
      updateField(target);
    };

    const handleBlur = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
      markTouched(target);
      updateField(target, true);
    };

    const handleSubmit = (event: Event) => {
      const form = event.target as HTMLFormElement | null;
      if (!form) return;
      const fields = Array.from(form.querySelectorAll(INPUT_SELECTOR));
      fields.forEach((node) => {
        if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement) {
          markTouched(node);
          updateField(node, true);
        }
      });
    };

    document.addEventListener("input", handleInput, true);
    document.addEventListener("blur", handleBlur, true);
    document.addEventListener("change", handleInput, true);
    document.addEventListener("submit", handleSubmit, true);

    return () => {
      document.removeEventListener("input", handleInput, true);
      document.removeEventListener("blur", handleBlur, true);
      document.removeEventListener("change", handleInput, true);
      document.removeEventListener("submit", handleSubmit, true);
    };
  }, []);

  return null;
}
