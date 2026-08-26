import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El tope de intentos por ciclo no puede fallar abriendo.
 *
 * Es la guarda que corta el bucle que llegó a pasar la misma tarjeta 62 veces en
 * un ciclo. Estaba envuelta en `.catch(() => ({ exhausted: false, ... }))` en sus
 * dos llamadas: si la consulta que cuenta los cobros fallaba, se asumía que no
 * estaban agotados y se cobraba igual.
 *
 * Cuando no se puede verificar cuántas veces se pasó la tarjeta, la respuesta
 * correcta es no pasarla. Aplazar cuesta una pasada del worker; cobrar de más le
 * cuesta al cliente y al comercio el bloqueo del medio de pago.
 */

const ARCHIVOS = [
  "packages/core/src/jobs/runner.ts",
  "packages/core/src/jobs/handlers/paymentRetry.ts"
];

describe("el tope de intentos falla cerrado", () => {
  /** Los comentarios explican el fallo antiguo: se miran solo si están en el código. */
  function soloCodigo(src: string) {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  it.each(ARCHIVOS)("%s no asume 'no agotado' ante un error", (ruta) => {
    const src = soloCodigo(readFileSync(join(process.cwd(), ruta), "utf8"));

    expect(
      src,
      "Un catch que devuelve `exhausted: false` deja pasar el cobro justo cuando no se pudo comprobar cuántos van"
    ).not.toMatch(/exhausted:\s*false/);
  });

  it.each(ARCHIVOS)("%s llama al tope antes de cobrar", (ruta) => {
    const src = readFileSync(join(process.cwd(), ruta), "utf8");
    expect(src).toMatch(/hasExhaustedCycleAttempts\(/);
  });
});
