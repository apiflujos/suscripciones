import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { permissionsForPath } from "../../../../lib/rbac";

/**
 * Ninguna ruta protegida puede quedarse fuera del mapa de permisos.
 *
 * `permissionsForPath` devolvía `null` para todo lo que no reconocía, y sus tres
 * consumidores hacen `if (required && !hasPermissions(...))`: sin entrada en el
 * mapa, la comprobación se saltaba ENTERA. Bastaba un token válido —de cualquier
 * alcance— para leer y reescribir las credenciales de la pasarela de pagos, la
 * configuración de cobro y los usuarios.
 *
 * `settings:read` y `settings:write` existían como permisos desde el principio y
 * no estaban conectados a ninguna ruta. Nadie lo notó porque no fallaba nada:
 * fallaba abriendo.
 *
 * Esta guarda recorre las rutas del repositorio, así que una ruta nueva sin
 * mapear falla aquí y no en producción.
 */

const RAIZ = join(process.cwd(), "apps/admin/app");

/** Rutas públicas por diseño: no pasan por ninguna guarda de permisos. */
const PUBLICAS = [
  "/health",
  "/healthz",
  "/logout",
  "/sa/logout",
  "/__sa/logout",
  "/admin/auth/login",
  "/public/",
  "/api/public/",
  "/webhooks/",
  "/wompi/widget",
  "/api/diag"
];

function rutasDelRepo(dir: string, base = ""): Array<{ ruta: string; archivo: string }> {
  const salida: Array<{ ruta: string; archivo: string }> = [];
  for (const entrada of readdirSync(dir)) {
    const completa = join(dir, entrada);
    if (statSync(completa).isDirectory()) {
      salida.push(...rutasDelRepo(completa, `${base}/${entrada}`));
    } else if (entrada === "route.ts") {
      salida.push({ ruta: base || "/", archivo: completa });
    }
  }
  return salida;
}

/** Rutas que delegan su autorización en el mapa. */
function rutasProtegidas() {
  return rutasDelRepo(RAIZ)
    .filter(({ ruta }) => !PUBLICAS.some((p) => ruta.startsWith(p)))
    .filter(({ archivo }) => {
      const src = readFileSync(archivo, "utf8");
      return /requireAdminToken|requireApiSession/.test(src);
    });
}

describe("toda ruta protegida exige algún permiso", () => {
  it("encuentra rutas que auditar", () => {
    expect(rutasProtegidas().length).toBeGreaterThan(20);
  });

  it.each(["GET", "POST"])("ninguna queda sin permiso en %s", (metodo) => {
    const huerfanas = rutasProtegidas()
      .map(({ ruta }) => ({ ruta, permisos: permissionsForPath(ruta, metodo) }))
      .filter((r) => !r.permisos || r.permisos.length === 0)
      .map((r) => r.ruta);

    expect(
      huerfanas,
      `Sin permiso exigido en ${metodo}. Quien consulta el mapa hace ` +
        `\`if (required && ...)\`, así que estas rutas aceptan cualquier token válido:\n` +
        huerfanas.map((r) => `  ${r}`).join("\n")
    ).toEqual([]);
  });

  it("las de configuración piden permiso de configuración, no cualquiera", () => {
    // Aquí viven las credenciales de Wompi y de Chatwoot.
    expect(permissionsForPath("/admin/settings/wompi", "POST")).toEqual(["settings:write"]);
    expect(permissionsForPath("/admin/settings/users", "POST")).toEqual(["settings:write"]);
    expect(permissionsForPath("/admin/settings/auto-debit", "GET")).toEqual(["settings:read"]);
  });

  it("las que mueven dinero piden permiso de pagos", () => {
    // Reconciliar y recobrar no son "leer logs" por vivir bajo /admin/logs.
    expect(permissionsForPath("/admin/logs/payments/reconcile", "POST")).toEqual(["payments:write"]);
    expect(permissionsForPath("/admin/logs/payments/recollect", "POST")).toEqual(["payments:write"]);
    expect(permissionsForPath("/admin/logs/payments", "GET")).toEqual(["payments:read"]);
  });

  it("una ruta desconocida cierra en vez de abrir", () => {
    // El caso que abría la puerta: lo no reconocido ya no devuelve null.
    const desconocida = permissionsForPath("/admin/algo-que-no-existe-todavia", "POST");
    expect(desconocida).not.toBeNull();
    expect(desconocida).toEqual(["sa:write"]);
  });
});
