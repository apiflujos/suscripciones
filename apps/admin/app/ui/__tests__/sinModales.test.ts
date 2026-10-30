import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * La interfaz no usa modales: toda acción con contenido es una página con URL propia
 * (ver docs/plan-ui-sin-modales.md). Esta prueba falla si alguien vuelve a:
 *  - importar AppModal o MapModal,
 *  - pintar a mano un fondo/panel de modal (`modal-backdrop`, `modal-panel`),
 *  - declarar un `role="dialog"` propio.
 */
const APP_DIR = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "__tests__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FORBIDDEN: Array<{ name: string; test: RegExp }> = [
  { name: "importa AppModal", test: /from\s+["'][^"']*AppModal["']/ },
  { name: "importa MapModal", test: /from\s+["'][^"']*MapModal["']/ },
  { name: "usa <AppModal>", test: /<AppModal[\s>]/ },
  { name: "pinta un modal a mano", test: /className=["'`{][^"'`}]*\bmodal-(backdrop|panel)\b/ },
  { name: "declara role=\"dialog\"", test: /role=["']dialog["']/ }
];

describe("la interfaz no usa modales", () => {
  const files = sourceFiles(APP_DIR);

  it("hay archivos que revisar", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("ningún archivo importa, usa o reimplementa un modal", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const rule of FORBIDDEN) {
        if (rule.test.test(text)) offenders.push(`${path.relative(APP_DIR, file)} — ${rule.name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
