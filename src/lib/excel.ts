import { normalizar } from "@/lib/utils";

/*
 * La descarga "Excel" de los reportes. **Todo reporte con detalle la lleva**
 * (pedido el 12/10/2026): como el link "Excel" de los reportes de APEX.
 *
 * Es un CSV con `;` y BOM, que es lo que Excel en español abre directo en
 * columnas y con tildes, sin pasar por "Datos → Desde texto". No es un `.xlsx`
 * a propósito: no suma ninguna librería y abre igual en Excel, LibreOffice y
 * Google Sheets.
 *
 * Baja **todo lo filtrado**, no solo la página o lo que se ve: como APEX. Si el
 * reporte pagina en el backend, la pantalla junta las páginas antes (ver
 * `todasLasAgendas`). En el APK la descarga puede no andar: la WebView no
 * siempre descarga archivos, igual que con los PDF.
 */

/** Una columna: el título del encabezado y cómo sale el valor de cada fila. */
export type ColumnaExcel<T> = [
  titulo: string,
  valor: (fila: T) => string | number | null | undefined,
];

/** Arma el CSV y lo descarga como `<nombre>.csv`. */
export function descargarExcel<T>(
  nombre: string,
  columnas: ColumnaExcel<T>[],
  filas: readonly T[],
): void {
  const celda = (v: string | number | null | undefined) => {
    const t = v == null ? "" : String(v);
    return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const texto = [
    columnas.map(([titulo]) => celda(titulo)).join(";"),
    ...filas.map((f) => columnas.map(([, valor]) => celda(valor(f))).join(";")),
  ].join("\r\n");
  descargarBlob(new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" }), `${nombre}.csv`);
}

/** Descarga un archivo ya armado: el CSV de arriba o un `.xlsx` con formato. */
export function descargarBlob(blob: Blob, archivo: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = archivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Un texto para el nombre del archivo: "Sucursal Centro" → "sucursal-centro". */
export const paraArchivo = (s: string) =>
  normalizar(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
