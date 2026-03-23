"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const AUTO_HIDE_MS = 8000; // Reducido de 15000 a 8000ms
const DELAY_MS = 600; // Más delay: menos ruido visual
const MODAL_SELECTOR =
  ".modal-backdrop, .modal-panel, [role='dialog'][aria-modal='true'], [role='dialog']:not([aria-modal='false'])";

function shouldTriggerLoader(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;

  // Solo dispara loader si el elemento lo pide explícitamente
  if (target.closest('[data-loader="on"]')) return true;
  return false;
}

export function GlobalLoader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const pendingShowRef = useRef<number | null>(null);
  const modalObserverRef = useRef<MutationObserver | null>(null);
  const loadingRef = useRef(false);

  const clearTimer = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const clearPendingShow = () => {
    if (pendingShowRef.current !== null) {
      window.clearTimeout(pendingShowRef.current);
      pendingShowRef.current = null;
    }
  };

  const stopModalObserver = () => {
    if (modalObserverRef.current) {
      modalObserverRef.current.disconnect();
      modalObserverRef.current = null;
    }
  };

  const isModalOpen = () => Boolean(document.querySelector(MODAL_SELECTOR));

  const hide = () => {
    clearPendingShow();
    clearTimer();
    stopModalObserver();
    loadingRef.current = false;
    setLoading(false);
    document.body.classList.remove("is-global-loading");
  };

  const startModalObserver = () => {
    if (modalObserverRef.current) return;
    const observer = new MutationObserver(() => {
      if (!loadingRef.current) {
        stopModalObserver();
        return;
      }
      if (isModalOpen()) {
        hide();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    modalObserverRef.current = observer;
  };

  const show = () => {
    if (loadingRef.current) return;
    if (isModalOpen()) return;
    loadingRef.current = true;
    setLoading(true);
    clearTimer();
    startModalObserver();
    document.body.classList.add("is-global-loading");
    requestAnimationFrame(() => {
      if (loadingRef.current && isModalOpen()) {
        hide();
      }
    });
    timeoutRef.current = window.setTimeout(() => {
      loadingRef.current = false;
      setLoading(false);
      document.body.classList.remove("is-global-loading");
    }, AUTO_HIDE_MS);
  };

  const scheduleShow = () => {
    if (loadingRef.current) return;
    clearPendingShow();
    // NUEVO: Delay antes de mostrar loader para evitar parpadeos
    pendingShowRef.current = window.setTimeout(() => {
      pendingShowRef.current = null;
      if (isModalOpen()) return;
      show();
    }, DELAY_MS);
  };

  useEffect(() => {
    hide();
  }, [pathname, searchParams?.toString()]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (pathname?.startsWith("/public")) return;
      if (!shouldTriggerLoader(event.target)) return;
      scheduleShow();
    };

    const onSubmit = (event: SubmitEvent) => {
      if (pathname?.startsWith("/public")) return;
      const form = event.target as Element | null;
      const submitter = event.submitter as Element | null;
      if (submitter?.closest('[data-loader="off"]')) return;
      if (form?.closest('[data-loader="off"]')) return;
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
      clearPendingShow();
      clearTimer();
    };
  }, []);

  if (!loading) return null;

  return (
    <div className="global-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="global-loader-backdrop" />
      <div className="global-loader-card">
        <span className="global-loader-spinner" aria-hidden="true" />
        <div className="global-loader-text">Procesando…</div>
      </div>
    </div>
  );
}
