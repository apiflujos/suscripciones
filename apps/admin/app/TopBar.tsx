"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminSession } from "../lib/session";
import { AppearanceSelector } from "./ui/AppearanceSelector";

type Header = { title: string; subtitle: string };

function getHeader(pathname: string): Header {
  if (pathname === "/") return { title: "Métricas", subtitle: "Ajusta rango y granularidad para leer la evolución de las métricas." };
  if (pathname.startsWith("/logs")) return { title: "Logs de API", subtitle: "Seguimiento de procesos y sincronizaciones." };
  if (pathname.startsWith("/customers")) return { title: "Contactos", subtitle: "Clientes y datos de contacto." };
  if (pathname.startsWith("/products")) return { title: "Productos y Servicios", subtitle: "Catálogo para cobranza recurrente." };
  if (pathname.startsWith("/billing")) return { title: "Planes y Suscripciones", subtitle: "Cobranza recurrente y ciclos." };
  if (pathname.startsWith("/subscriptions")) return { title: "Suscripciones", subtitle: "Cobros, ciclos y links de pago." };
  if (pathname.startsWith("/plans")) return { title: "Planes", subtitle: "Tipos de suscripción: precio y periodicidad." };
  if (pathname.startsWith("/notifications")) return { title: "Notificaciones", subtitle: "Reglas, recordatorios y plantillas." };
  if (pathname.startsWith("/campaigns")) return { title: "Campañas", subtitle: "Mensajes masivos a listas inteligentes." };
  if (pathname.startsWith("/smart-lists")) return { title: "Listas inteligentes", subtitle: "Segmentación dinámica de contactos." };
  if (pathname.startsWith("/webhooks")) return { title: "Webhooks", subtitle: "Eventos entrantes y su estado." };
  if (pathname.startsWith("/settings")) return { title: "Configuración", subtitle: "Credenciales y conexiones." };
  if (pathname.startsWith("/sa") || pathname.startsWith("/__sa")) return { title: "Super Admin", subtitle: "Planes, módulos, usuarios y consumos." };
  return { title: "Panel", subtitle: "—" };
}

function UserMenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function displayNameFromEmail(email: string) {
  const e = String(email || "").trim();
  if (!e) return "Usuario";
  const local = e.split("@")[0] || e;
  return local.slice(0, 1).toUpperCase() + local.slice(1);
}

export function TopBar({ session }: { session: AdminSession | null }) {
  const pathname = usePathname() || "/";
  const header = useMemo(() => getHeader(pathname), [pathname]);
  const isSuperAdmin = session?.role === "SUPER_ADMIN";
  const [menuOpen, setMenuOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [paymentPulse, setPaymentPulse] = useState(false);
  const [rtSoundEnabled, setRtSoundEnabled] = useState(false);
  const [rtVolume, setRtVolume] = useState(0.55);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const appearanceRef = useRef<HTMLButtonElement | null>(null);
  const appearancePopoverRef = useRef<HTMLDivElement | null>(null);
  const pulseRef = useRef<NodeJS.Timeout | null>(null);

  const triggerPaymentPulse = () => {
    setPaymentPulse(true);
    if (pulseRef.current) clearTimeout(pulseRef.current);
    pulseRef.current = setTimeout(() => setPaymentPulse(false), 2200);
  };

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (menuRef.current && menuRef.current.contains(t)) return;
      if (appearanceRef.current && appearanceRef.current.contains(t)) return;
      if (appearancePopoverRef.current && appearancePopoverRef.current.contains(t)) return;
      setMenuOpen(false);
      setAppearanceOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setAppearanceOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const onPayment = () => triggerPaymentPulse();
    window.addEventListener("apiflujos:payment-approved", onPayment);
    return () => {
      window.removeEventListener("apiflujos:payment-approved", onPayment);
      if (pulseRef.current) clearTimeout(pulseRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("apiflujos-realtime-sound");
    if (stored === "1") setRtSoundEnabled(true);
    const storedVolume = window.localStorage.getItem("apiflujos-realtime-sound-volume");
    if (storedVolume) {
      const v = Number(storedVolume);
      if (Number.isFinite(v)) setRtVolume(Math.min(1, Math.max(0.1, v)));
    }
  }, []);

  const publishRealtimeSettings = (nextEnabled: boolean, nextVolume: number) => {
    setRtSoundEnabled(nextEnabled);
    setRtVolume(nextVolume);
    try {
      window.localStorage.setItem("apiflujos-realtime-sound", nextEnabled ? "1" : "0");
      window.localStorage.setItem("apiflujos-realtime-sound-volume", String(nextVolume));
    } catch {}
    try {
      window.dispatchEvent(
        new CustomEvent("apiflujos:realtime-settings", { detail: { soundEnabled: nextEnabled, volume: nextVolume } })
      );
    } catch {}
  };

  const runRealtimeTest = () => {
    try {
      const direct = (window as any).__apiflujosRealtimeTest;
      if (typeof direct === "function") {
        direct();
        return;
      }
      window.dispatchEvent(new CustomEvent("apiflujos:realtime-test"));
    } catch {}
  };

  return (
    <header className="topbar" aria-label="Topbar">
      <div className="topbarLeft">
        <div className="topbarLeftRow">
          <Link href="/" className="topbarLogoLink" prefetch={false} aria-label="Ir al home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo.png" alt="Logo" className="topbarLogo" />
            <span className="logoStatusDot" aria-hidden="true" />
          </Link>
          <div className="topbarTitleGroup">
            <h1 className="topbarTitle">{header.title}</h1>
            <div className="topbarSubtitle">{header.subtitle}</div>
          </div>
          <div className={`topbarPulse ${paymentPulse ? "is-active" : ""}`} aria-live="polite">
            <span className="topbarPulseDot" aria-hidden="true" />
            <span className="topbarPulseText">Pago recibido</span>
          </div>
        </div>
      </div>

      <div className="topbarRight" aria-label="Usuario">
        <div className="appearanceMenu">
          <button
            type="button"
            className="appearanceTrigger"
            data-loader="off"
            onClick={() => setAppearanceOpen((v) => !v)}
            aria-label="Cambiar apariencia"
            ref={appearanceRef}
            aria-expanded={appearanceOpen ? "true" : "false"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="5" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
            <span>Apariencia</span>
          </button>
          {appearanceOpen ? (
            <div className="appearancePopover" ref={appearancePopoverRef} role="dialog" aria-label="Apariencia">
              <div className="appearanceTitle">Apariencia</div>
              <AppearanceSelector compact />
              <div className="appearanceDivider" />
              <div className="appearanceSection">
                <div className="appearanceSectionTitle">Tiempo real</div>
                <div className="appearanceRow">
                  <label className="appearanceToggle">
                    <input
                      type="checkbox"
                      checked={rtSoundEnabled}
                      onChange={(e) => publishRealtimeSettings(e.target.checked, rtVolume)}
                    />
                    <span>Sonido</span>
                  </label>
                  <span className="appearanceValue">{Math.round(rtVolume * 100)}%</span>
                </div>
                <input
                  className="appearanceRange"
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={rtVolume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v)) return;
                    publishRealtimeSettings(rtSoundEnabled, v);
                  }}
                  aria-label="Volumen tiempo real"
                />
                {isSuperAdmin ? (
                  <button className="ghost btn-compact" type="button" data-loader="off" onClick={runRealtimeTest}>
                    Probar sonido
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <div className="userMenu" ref={menuRef}>
          <button
            type="button"
            className="userMenuBtn"
            data-loader="off"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Abrir menú de usuario"
            aria-haspopup="menu"
            aria-expanded={menuOpen ? "true" : "false"}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/avatar.png" alt="" className="userAvatar" />
            <div style={{ display: "grid", lineHeight: 1.1, textAlign: "left" }}>
              <div style={{ fontWeight: 700 }}>{displayNameFromEmail(session?.email || "")}</div>
              <div className="subtitle" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
                {session?.role || "—"}
              </div>
            </div>
            <UserMenuIcon className="userMenuIcon" />
          </button>

          {menuOpen ? (
            <div className="userMenuPopover" role="menu" aria-label="Menú de usuario">
              <Link className="userMenuItem" href="/settings" prefetch={false} role="menuitem">
                Configuración
              </Link>
              {isSuperAdmin ? (
                <Link className="userMenuItem" href="/sa" prefetch={false} role="menuitem">
                  Super Admin
                </Link>
              ) : null}
              {isSuperAdmin ? (
                <Link className="userMenuItem" href="/sa/users" prefetch={false} role="menuitem">
                  Usuarios
                </Link>
              ) : null}
              <Link className="userMenuItem isDanger" href="/logout" prefetch={false} role="menuitem">
                Salir
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
