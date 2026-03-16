"use client";

import { useEffect } from "react";

type AutoSubmitOnChangeProps = {
  selector?: string;
};

export function AutoSubmitOnChange({ selector = "form[data-auto-submit-form='true']" }: AutoSubmitOnChangeProps) {
  useEffect(() => {
    const forms = Array.from(document.querySelectorAll<HTMLFormElement>(selector));
    const cleanups: Array<() => void> = [];

    for (const form of forms) {
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
  }, [selector]);

  return null;
}
