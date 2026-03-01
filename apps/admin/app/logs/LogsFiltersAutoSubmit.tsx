"use client";

import { useEffect } from "react";

const DEBOUNCE_MS = 500;

export function LogsFiltersAutoSubmit() {
  useEffect(() => {
    const forms = Array.from(document.querySelectorAll<HTMLFormElement>('form[data-debounce-form="true"]'));
    const cleanups: Array<() => void> = [];

    for (const form of forms) {
      const search = form.querySelector<HTMLInputElement>('input[name="q"]');
      if (search) {
        let timer: number | null = null;
        const onInput = () => {
          if (timer) window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            form.requestSubmit();
          }, DEBOUNCE_MS);
        };
        search.addEventListener("input", onInput);
        cleanups.push(() => {
          if (timer) window.clearTimeout(timer);
          search.removeEventListener("input", onInput);
        });
      }

      const autoFields = Array.from(form.querySelectorAll<HTMLElement>("[data-auto-submit='true']"));
      for (const field of autoFields) {
        const onChange = () => form.requestSubmit();
        field.addEventListener("change", onChange);
        cleanups.push(() => field.removeEventListener("change", onChange));
      }
    }

    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  return null;
}
