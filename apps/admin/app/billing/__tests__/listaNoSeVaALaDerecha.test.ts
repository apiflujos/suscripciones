import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La lista de suscripciones no se puede ir a la derecha.
 *
 * Antes era una rejilla de pistas con mínimos fijos que sumaban 1.262 px y un
 * `overflow-x: auto` para taparlo: en un portátil el operador leía las tres
 * primeras columnas y el resto lo buscaba con la barra horizontal.
 *
 * Esta guarda no se cree un número escrito a mano: lo DERIVA del CSS. Si alguien
 * ensancha una columna o añade otra, el test dice cuánto se pasó.
 */

const CSS = readFileSync(join(process.cwd(), "apps/admin/app/styles.css"), "utf8");

/**
 * El ancho real que le queda a la lista en el portátil más estrecho del equipo:
 * 1.280 px de pantalla menos la barra lateral desplegada y el relleno de la
 * página. Es el escenario que hay que garantizar, no el del monitor grande.
 */
const ANCHO_DISPONIBLE_PEOR_CASO = 940;

function leerBloque(nombre: string): string {
  const inicio = CSS.indexOf(`--${nombre}:`);
  expect(inicio, `no se encontró --${nombre} en styles.css`).toBeGreaterThan(-1);
  const fin = CSS.indexOf(";", inicio);
  return CSS.slice(inicio, fin);
}

/** Suma los mínimos de `minmax(min, …)` y los anchos sueltos (`40px`). */
function sumarMinimos(declaracion: string): { total: number; pistas: number } {
  const sinComentarios = declaracion.replace(/\/\*[\s\S]*?\*\//g, "");
  const cuerpo = sinComentarios.slice(sinComentarios.indexOf(":") + 1);

  const minmax = [...cuerpo.matchAll(/minmax\(\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  const fijas = [...cuerpo.replace(/minmax\([^)]*\)/g, "").matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) =>
    Number(m[1])
  );

  return { total: [...minmax, ...fijas].reduce((a, b) => a + b, 0), pistas: minmax.length + fijas.length };
}

function leerPx(nombre: string): number {
  const match = CSS.match(new RegExp(`--${nombre}:\\s*(\\d+(?:\\.\\d+)?)px`));
  expect(match, `no se encontró --${nombre}`).not.toBeNull();
  return Number(match![1]);
}

describe("la lista de suscripciones no se va a la derecha", () => {
  it("los mínimos de las columnas caben en el portátil más estrecho", () => {
    const { total, pistas } = sumarMinimos(leerBloque("billing-list-cols"));

    // --list-gap está declarado como var(--space-5); se resuelve su valor real.
    const gap = leerPx("space-5");
    const relleno = leerPx("space-6") * 2; // --list-px a cada lado
    const bordes = 2;

    const anchoMinimo = total + gap * (pistas - 1) + relleno + bordes;

    expect(
      anchoMinimo,
      `Las columnas necesitan ${anchoMinimo}px y solo hay ${ANCHO_DISPONIBLE_PEOR_CASO}px. ` +
        `Se pasa por ${anchoMinimo - ANCHO_DISPONIBLE_PEOR_CASO}px: baja un mínimo en --billing-list-cols.`
    ).toBeLessThanOrEqual(ANCHO_DISPONIBLE_PEOR_CASO);
  });

  it("la lista no tapa el desbordamiento con una barra horizontal", () => {
    const bloque = CSS.slice(CSS.indexOf(".billing-list {"), CSS.indexOf(".billing-list-header"));

    expect(
      bloque,
      "`overflow-x: auto` devuelve el scroll horizontal que las pistas minmax vienen a evitar"
    ).not.toMatch(/overflow-x:\s*auto/);
  });

  it("las celdas truncan dentro en vez de empujar a la vecina", () => {
    expect(CSS).toMatch(/\.billing-list-cell\s*>\s*\*\s*{[^}]*text-overflow:\s*ellipsis/);
  });

  it("la columna de acciones cabe en un solo botón", () => {
    const { total } = sumarMinimos(leerBloque("billing-list-cols"));
    const declaracion = leerBloque("billing-list-cols");
    const ultima = [...declaracion.matchAll(/(\d+)px;?\s*(?:\/\*[^*]*\*\/)?\s*$/g)];

    // La botonera suelta necesitaba 256px; el kebab, 40.
    expect(total, "algún mínimo volvió a crecer como la botonera antigua").toBeLessThan(800);
    expect(ultima.length, "la última pista debe ser un ancho fijo, no un minmax").toBeGreaterThan(0);
  });
});
