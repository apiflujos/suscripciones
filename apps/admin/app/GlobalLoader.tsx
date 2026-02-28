"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const AUTO_HIDE_MS = 15000;
const MODAL_SELECTOR =
  ".modal-backdrop, .modal-panel, [role='dialog'][aria-modal='true'], [role='dialog']:not([aria-modal='false'])";

function shouldTriggerLoader(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-loader="off"]')) return false;
  if (target.closest('[aria-haspopup="dialog"], [data-modal="true"], [data-modal-trigger="true"]')) return false;
  if (target.closest('[aria-haspopup="menu"], [role="menu"], .userMenuPopover')) return false;

  const anchor = target.closest("a[href]");
  if (anchor) {
    const href = anchor.getAttribute("href") || "";
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return false;
    if (anchor.getAttribute("aria-current") === "page") return false;
    if (anchor.getAttribute("aria-disabled") === "true") return false;
    if (anchor.classList.contains("is-active")) return false;
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
    requestAnimationFrame(() => {
      if (loadingRef.current && isModalOpen()) {
        hide();
      }
    });
    timeoutRef.current = window.setTimeout(() => {
      loadingRef.current = false;
      setLoading(false);
    }, AUTO_HIDE_MS);
  };

  const scheduleShow = () => {
    if (loadingRef.current) return;
    clearPendingShow();
    pendingShowRef.current = window.setTimeout(() => {
      pendingShowRef.current = null;
      if (isModalOpen()) return;
      show();
    }, 0);
  };

  useEffect(() => {
    hide();
  }, [pathname, searchParams?.toString()]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      if (!shouldTriggerLoader(event.target)) return;
      scheduleShow();
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
      clearPendingShow();
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
        <img className="global-loader-gif" src="/brand/loader.gif" alt="" aria-hidden="true" />
        <div className="global-loader-text">Procesando…</div>
      </div>
    </div>
  );
}
