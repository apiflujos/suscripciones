import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La campana no puede acumular identificadores para siempre.
 *
 * Cada aviso marcado como leído dejaba su id en localStorage y nada los borraba
 * nunca. localStorage tiene un techo de unos 5 MB, y al pasarlo `setItem` lanza
 * — pero el `catch {}` se lo traga. El síntoma no es un error: es que "marcar
 * como leído" deja de funcionar en silencio, se ve leído y vuelve al recargar.
 *
 * El hook usa refs y eventos del navegador, así que en vez de montarlo se fija
 * el contrato sobre el propio código: que la poda exista, que se llame en los dos
 * caminos por los que entra el feed, y que el notificador no acumule.
 */

const FEED = readFileSync(join(process.cwd(), "apps/admin/app/ui/notificationsFeed.tsx"), "utf8");
const NOTIFIER = readFileSync(join(process.cwd(), "apps/admin/app/ui/RealtimeNotifier.tsx"), "utf8");

describe("la campana no acumula identificadores para siempre", () => {
  it("poda los ids que ya no están en el feed", () => {
    expect(FEED).toMatch(/const pruneStoredIds\s*=/);
    // La poda es una intersección con el feed vivo: lo que ya no llega, se olvida.
    expect(FEED).toMatch(/for \(const id of actuales\) if \(vivos\.has\(id\)\)/);
  });

  it("poda por los dos caminos por los que entra el feed", () => {
    // Al cargar de localStorage y al recibir el evento en caliente. Si solo se
    // podara en uno, una pestaña abierta todo el día nunca podaría.
    // Dos invocaciones: load() y el evento en caliente. La definición usa
    // `pruneStoredIds = (`, así que no la cuenta este patrón.
    const llamadas = FEED.match(/pruneStoredIds\(/g) || [];
    expect(llamadas.length, "faltan llamadas a la poda: debe correr en load() y en el evento").toBeGreaterThanOrEqual(2);
  });

  it("poda tanto los leídos como los descartados", () => {
    expect(FEED).toMatch(/podar\(readIdsRef\.current\)/);
    expect(FEED).toMatch(/podar\(dismissedIdsRef\.current\)/);
  });

  it("no rompe si localStorage trae algo que no es una lista", () => {
    // Un valor viejo o corrupto pasaba el JSON.parse y reventaba en .map.
    const guardas = FEED.match(/Array\.isArray\(parsed\)\s*\?\s*parsed\s*:\s*\[\]/g) || [];
    expect(guardas.length, "faltan guardas de array al leer localStorage").toBeGreaterThanOrEqual(2);
  });

  it("el notificador reemplaza lo visto en vez de acumularlo", () => {
    expect(
      NOTIFIER,
      "volver a `nextSeen.add` por cada vuelta del sondeo hace crecer el conjunto toda la sesión"
    ).not.toMatch(/for \(const n of items\) if \(n\?\.id\) nextSeen\.add/);
    expect(NOTIFIER).toMatch(/lastSeenRef\.current = new Set\(/);
  });
});
