/**
 * Escapado de CSV compartido por las descargas del admin.
 *
 * Neutraliza la inyección de fórmulas: Excel y Google Sheets ejecutan cualquier
 * celda que empiece por `=`, `+`, `-` o `@`, así que un cliente que se llame
 * `=HYPERLINK("http://…")` se convierte en código en cuanto alguien abre el
 * archivo. Anteponer una comilla simple hace que la hoja lo trate como texto
 * sin mostrarla.
 *
 * Los números se dejan intactos —incluidos los negativos y los teléfonos con
 * `+`— para que entren como números y no como texto.
 */
export function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  const isNumeric = text.trim() !== "" && Number.isFinite(Number(text));
  const safe = !isNumeric && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  // Solo se entrecomilla lo que lo necesita: un número entre comillas llega a
  // Excel como texto y deja de sumar.
  const needsQuotes = safe !== text || /[",\r\n]/.test(safe);
  return needsQuotes ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Una fila de CSV ya escapada. */
export function csvLine(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * Documento CSV completo: BOM para que Excel respete los acentos y CRLF como
 * separador de líneas, que es lo que espera Excel en Windows.
 */
export function csvDocument(header: string[], rows: unknown[][]): string {
  return "﻿" + [csvLine(header), ...rows.map(csvLine)].join("\r\n");
}
