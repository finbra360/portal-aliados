/**
 * CSV seguro para Excel: escapa comillas y neutraliza fórmulas (=, +, -, @, tab, CR)
 * para evitar inyección de fórmulas al abrir el archivo.
 */
export function csvCelda(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** BOM para que Excel en español detecte UTF-8 (acentos). */
export function aCsv(encabezados: string[], filas: unknown[][]): string {
  return "﻿" + [encabezados, ...filas].map((r) => r.map(csvCelda).join(",")).join("\r\n");
}
