import { describe, expect, it } from "vitest";
import { csvCell, csvDocument, csvLine } from "../csv";

describe("csvCell", () => {
  it("entrecomilla y dobla las comillas internas", () => {
    expect(csvCell('Plan "Premium"')).toBe('"Plan ""Premium"""');
  });

  it("nulos y undefined salen como celda vacía", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("entrecomilla solo lo que lo necesita", () => {
    expect(csvCell("Ana Gómez")).toBe("Ana Gómez");
    expect(csvCell("Bogotá, Colombia")).toBe('"Bogotá, Colombia"');
    expect(csvCell("linea1\nlinea2")).toBe('"linea1\nlinea2"');
    expect(csvCell("linea1\r\nlinea2")).toBe('"linea1\r\nlinea2"');
  });

  it("neutraliza fórmulas de Excel", () => {
    expect(csvCell('=HYPERLINK("http://malo","click")')).toBe('"\'=HYPERLINK(""http://malo"",""click"")"');
    expect(csvCell("@SUM(A1:A9)")).toBe("\"'@SUM(A1:A9)\"");
    expect(csvCell("+cmd|' /C calc'!A0")).toBe("\"'+cmd|' /C calc'!A0\"");
    expect(csvCell("\tcmd")).toBe("\"'\tcmd\"");
  });

  it("los números llegan como números, no como texto", () => {
    expect(csvCell(1500)).toBe("1500");
    expect(csvCell(-1500)).toBe("-1500");
    expect(csvCell("-1500")).toBe("-1500");
    expect(csvCell("+573001112233")).toBe("+573001112233");
    expect(csvCell(0)).toBe("0");
  });
});

describe("csvLine y csvDocument", () => {
  it("une celdas con coma", () => {
    expect(csvLine(["a", 1, null])).toBe("a,1,");
  });

  it("arma el documento con BOM y CRLF", () => {
    const doc = csvDocument(["Cliente", "Monto"], [["Ana", 1000]]);
    expect(doc.startsWith("﻿")).toBe(true);
    expect(doc).toBe("﻿Cliente,Monto\r\nAna,1000");
  });

  it("una celda con salto de línea no rompe las filas", () => {
    const doc = csvDocument(["Aviso"], [["hola\nmundo"], ["ok"]]);
    expect(doc).toBe('﻿Aviso\r\n"hola\nmundo"\r\nok');
  });
});
