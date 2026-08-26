export type Permission =
  | "customers:read"
  | "customers:write"
  | "products:read"
  | "products:write"
  | "plans:read"
  | "plans:write"
  | "subscriptions:read"
  | "subscriptions:write"
  | "payments:read"
  | "payments:write"
  | "logs:read"
  | "settings:read"
  | "settings:write"
  | "reports:read"
  | "metrics:read"
  | "notifications:read"
  | "notifications:write"
  | "comms:read"
  | "comms:write"
  | "smartviews:read"
  | "smartviews:write"
  | "tenants:read"
  | "tenants:write"
  | "orders:read"
  | "orders:write"
  | "media:read"
  | "media:write"
  | "ai:read"
  | "ai:write"
  | "webhook:receive"
  | "audit:read"
  | "sa:read"
  | "sa:write";

export type Role = "SUPER_ADMIN" | "ADMIN" | "AGENT" | "WEBHOOK";

const ALL_PERMS: Permission[] = [
  "customers:read",
  "customers:write",
  "products:read",
  "products:write",
  "plans:read",
  "plans:write",
  "subscriptions:read",
  "subscriptions:write",
  "payments:read",
  "payments:write",
  "logs:read",
  "settings:read",
  "settings:write",
  "reports:read",
  "metrics:read",
  "notifications:read",
  "notifications:write",
  "comms:read",
  "comms:write",
  "smartviews:read",
  "smartviews:write",
  "tenants:read",
  "tenants:write",
  "orders:read",
  "orders:write",
  "media:read",
  "media:write",
  "ai:read",
  "ai:write",
  "webhook:receive",
  "audit:read",
  "sa:read",
  "sa:write"
];

export function getRolePermissions(role: Role): Permission[] {
  if (role === "SUPER_ADMIN") return ALL_PERMS;
  if (role === "ADMIN") {
    return ALL_PERMS.filter((p) => !p.startsWith("sa:") && p !== "audit:read");
  }
  if (role === "AGENT") {
    return [
      "customers:read",
      "customers:write",
      "products:read",
      "plans:read",
      "subscriptions:read",
      "payments:read",
      "notifications:read",
      "comms:read",
      "smartviews:read",
      "reports:read",
      "metrics:read",
      "media:read"
    ];
  }
  return ["webhook:receive"];
}

export function hasPermissions(required: Permission[] | undefined, granted: Permission[] | undefined) {
  if (!required || required.length === 0) return true;
  if (!granted || granted.length === 0) return false;
  return required.every((p) => granted.includes(p));
}

export function permissionsForPath(pathname: string, method: string): Permission[] | null {
  const m = method.toUpperCase();
  const write = m !== "GET" && m !== "HEAD";

  if (pathname.startsWith("/webhooks")) return ["webhook:receive"];
  if (pathname.startsWith("/admin/sa")) return [write ? "sa:write" : "sa:read"];
  if (pathname.startsWith("/logs")) return ["audit:read"];

  if (pathname.startsWith("/admin/customers") || pathname.startsWith("/api/customers"))
    return [write ? "customers:write" : "customers:read"];
  if (pathname.startsWith("/admin/products") || pathname.startsWith("/api/products"))
    return [write ? "products:write" : "products:read"];
  if (pathname.startsWith("/admin/plans") || pathname.startsWith("/api/plans"))
    return [write ? "plans:write" : "plans:read"];
  if (pathname.startsWith("/admin/subscriptions") || pathname.startsWith("/api/subscriptions"))
    return [write ? "subscriptions:write" : "subscriptions:read"];
  if (pathname.startsWith("/admin/payments") || pathname.startsWith("/api/payments"))
    return [write ? "payments:write" : "payments:read"];
  if (pathname.startsWith("/admin/reports")) return ["reports:read"];
  if (pathname.startsWith("/admin/metrics")) return ["metrics:read"];
  if (pathname.startsWith("/admin/notifications") || pathname.startsWith("/api/notifications"))
    return [write ? "notifications:write" : "notifications:read"];
  if (pathname.startsWith("/admin/comms") || pathname.startsWith("/api/comms"))
    return [write ? "comms:write" : "comms:read"];
  if (pathname.startsWith("/admin/smart-views") || pathname.startsWith("/api/smart-views"))
    return [write ? "smartviews:write" : "smartviews:read"];
  if (pathname.startsWith("/admin/tenants") || pathname.startsWith("/api/tenants"))
    return [write ? "tenants:write" : "tenants:read"];
  if (pathname.startsWith("/admin/orders") || pathname.startsWith("/api/orders"))
    return [write ? "orders:write" : "orders:read"];
  if (pathname.startsWith("/admin/media") || pathname.startsWith("/api/uploads"))
    return [write ? "media:write" : "media:read"];
  if (pathname.startsWith("/admin/ai") || pathname.startsWith("/api/ai"))
    return [write ? "ai:write" : "ai:read"];

  // ── Rutas que estaban fuera del mapa ──────────────────────────────────────
  // `settings:read` y `settings:write` existían como permisos y no estaban
  // conectados a ninguna ruta: cualquier token válido podía leer y reescribir
  // las credenciales de la pasarela de pagos, la configuración de cobro y los
  // usuarios, sin necesitar permiso alguno para ello.
  if (pathname.startsWith("/admin/settings") || pathname.startsWith("/api/settings"))
    return [write ? "settings:write" : "settings:read"];

  // `/logs` estaba mapeado, pero las rutas reales viven bajo `/admin/logs` y no
  // empiezan por `/logs`, así que caían fuera. Las de pagos mueven dinero
  // —reconciliar y recobrar— y piden permiso de pagos, no de lectura de logs.
  if (pathname.startsWith("/admin/logs/payments"))
    return [write ? "payments:write" : "payments:read"];
  if (pathname.startsWith("/admin/logs") || pathname.startsWith("/api/logs"))
    return [write ? "audit:read" : "audit:read"];

  if (pathname.startsWith("/admin/webhook-events")) return ["audit:read"];

  // Chatwoot es el canal de mensajes al cliente.
  if (pathname.startsWith("/admin/chatwoot") || pathname.startsWith("/api/chatwoot"))
    return [write ? "comms:write" : "comms:read"];

  if (pathname.startsWith("/admin/checkout-templates") || pathname.startsWith("/api/checkout-templates"))
    return [write ? "settings:write" : "settings:read"];

  if (pathname.startsWith("/admin/gamification") || pathname.startsWith("/api/gamification"))
    return [write ? "customers:write" : "customers:read"];

  if (pathname.startsWith("/admin/empresas") || pathname.startsWith("/api/empresas"))
    return [write ? "customers:write" : "customers:read"];

  if (pathname.startsWith("/admin/billing") || pathname.startsWith("/api/billing"))
    return [write ? "subscriptions:write" : "subscriptions:read"];

  if (pathname.startsWith("/admin/import") || pathname.startsWith("/api/import"))
    return [write ? "customers:write" : "customers:read"];

  if (pathname.startsWith("/api/search")) return ["customers:read"];
  if (pathname.startsWith("/api/list-csv")) return ["customers:read"];
  if (pathname.startsWith("/api/realtime")) return [write ? "notifications:write" : "notifications:read"];

  // ⛔ CIERRA POR DEFECTO. Antes devolvía null, y quien consulta este mapa hace
  // `if (required && !hasPermissions(...))`: sin entrada, la comprobación se
  // saltaba entera y bastaba un token válido —de cualquier alcance— para entrar.
  // Una lista blanca que autoriza todo lo que no está en ella no protege nada.
  //
  // Lo que de verdad es público (/health, /public/*, /webhooks) no pasa por
  // estas guardas, así que no se ve afectado; lo comprueba
  // `todaRutaExigePermiso.test.ts`, que recorre las rutas del repositorio.
  return write ? ["sa:write"] : ["sa:read"];
}
