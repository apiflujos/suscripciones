"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const AUTO_HIDE_MS = 15000;

function shouldTriggerLoader(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-loader="off"]')) return false;

  const anchor = target.closest("a[href]");
  if (anchor) {
    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return false;
    if (anchor.getAttribute("target") === "_blank") return false;
    return true;
  }

  const button = target.closest("button, input[type='submit'], input[type='button']");
  if (button) {
    if ((button as HTMLButtonElement).disabled) return false;
    return true;
  }

  return false;
}

export function GlobalLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const loadingRef = useRef(false);

  const clearTimer = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const hide = () => {
    clearTimer();
    loadingRef.current = false;
    setLoading(false);
  };

  const show = () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    clearTimer();
    timeoutRef.current = window.setTimeout(() => {
      loadingRef.current = false;
      setLoading(false);
    }, AUTO_HIDE_MS);
  };

  useEffect(() => {
    hide();
  }, [pathname, searchParams?.toString()]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (!shouldTriggerLoader(event.target)) return;
      show();
    };

    const onSubmit = () => {
      show();
    };

    const onShow = () => show();
    const onHide = () => hide();
    const onPageShow = () => hide();

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("global-loader:show", onShow as EventListener);
    window.addEventListener("global-loader:hide", onHide as EventListener);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("global-loader:show", onShow as EventListener);
      window.removeEventListener("global-loader:hide", onHide as EventListener);
      window.removeEventListener("pageshow", onPageShow);
      clearTimer();
    };
  }, []);

  useEffect(() => {
    if (loading) {
      document.body.classList.add("is-global-loading");
    } else {
      document.body.classList.remove("is-global-loading");
    }
  }, [loading]);

  if (!loading) return null;

  return (
    <div className="global-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="global-loader-backdrop" />
      <div className="global-loader-card">
        <div className="global-spinner" aria-hidden="true" />
        <div className="global-loader-text">Procesando…</div>
      </div>
    </div>
  );
}
