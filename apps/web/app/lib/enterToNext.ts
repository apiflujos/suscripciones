"use client";

import type { KeyboardEvent } from "react";

function isVisible(el: HTMLElement) {
  const rects = el.getClientRects();
  return rects && rects.length > 0;
}

function isFocusable(el: HTMLElement) {
  if (!isVisible(el)) return false;
  if (el.hasAttribute("disabled")) return false;
  if (el.getAttribute("aria-disabled") === "true") return false;
  if (el.getAttribute("type") === "hidden") return false;
  if (el.getAttribute("hidden") != null) return false;
  if (el.tabIndex < 0) return false;
  if (el.dataset.enterSkip === "1") return false;
  return true;
}

export function enterToNextField(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "Enter") return;
  if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return;

  const target = e.target as HTMLElement | null;
  if (!target) return;

  if (target instanceof HTMLTextAreaElement) return;
  if (target instanceof HTMLButtonElement) return;
  if (target instanceof HTMLAnchorElement) return;

  if (target instanceof HTMLInputElement) {
    const t = String(target.type || "").toLowerCase();
    if (t === "submit" || t === "button" || t === "reset") return;
    if (t === "checkbox" || t === "radio" || t === "file") return;
  }

  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  if ((target as any).dataset?.enterSubmit === "1") return;

  const form = target.closest("form");
  if (!form) return;

  const focusables = Array.from(form.querySelectorAll<HTMLElement>("input, select, textarea, button")).filter(isFocusable);
  const idx = focusables.indexOf(target);
  if (idx < 0) return;

  const next = focusables.slice(idx + 1).find((el) => isFocusable(el));
  if (!next) return;

  e.preventDefault();
  next.focus();
}

