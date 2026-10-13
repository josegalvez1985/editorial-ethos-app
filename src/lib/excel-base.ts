/**
 * Lo común de los Excel CON FORMATO (`.xlsx`): el libro listo para imprimir,
 * el encabezado con logo, las tarjetas, las secciones, las tablas y las firmas,
 * con los colores de la marca de `pdf-base.ts`. Es al `.xlsx` lo que
 * `pdf-base.ts` es al PDF: cada comprobante arma solo su cuerpo.
 *
 * Lo usan el de una transferencia (`excel-transferencia.ts`) y el de un envío
 * de gráficas (`excel-envio-grafica.ts`), los dos con el mismo formato que su
 * PDF (pedidos el 13/10/2026). Salió de `excel-transferencia.ts` al hacer el
 * segundo, para que no se desincronicen.
 *
 * Por qué `.xlsx` y no el CSV de `lib/excel.ts`: un CSV no lleva logo, colores
 * ni celdas unidas. Lo arma `exceljs`, que como jsPDF se carga recién al tocar
 * el botón (`import()` dinámico): el resto del sitio no lo descarga.
 *
 * La hoja queda lista para imprimir: A4 vertical, ajustada al ancho, sin
 * cuadrícula y con el pie "Página X de Y" del PDF. **La columna A es angosta y
 * vacía**, como el margen del PDF: ahí va el logo. Los rangos se escriben como
 * en Excel ("B5:E5"); una celda sola, "B5".
 */

import type { Borders, Cell, Fill, Font, Workbook, Worksheet } from "exceljs";

import { descargarBlob } from "@/lib/excel";
import { ahora, GRIS, logoDataUrl, NAVY, ROJO, SUAVE, type RGB } from "@/lib/pdf-base";

export const argb = ([r, g, b]: RGB) =>
  "FF" +
  [r, g, b]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

/** "#e74c3c" → el ARGB de exceljs. */
export const argbHex = (hex: string) => "FF" + hex.slice(1).toUpperCase();

export const BLANCO = "FFFFFFFF";
export const CEBRA = argb([247, 248, 252]);
export const CEBRA_SUAVE = argb([250, 251, 254]);
const LINEA = argb([226, 229, 238]);
const FUENTE = "Arial";
export const ENTERO = "#,##0";

export type Estilo = Partial<Pick<Cell, "font" | "fill" | "border" | "alignment" | "numFmt">>;

export const relleno = (color: string): Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: color },
});
export const letra = (f: Partial<Font> = {}): Partial<Font> => ({ name: FUENTE, size: 10, ...f });
export const abajo: Partial<Borders> = { bottom: { style: "thin", color: { argb: LINEA } } };
export const GRIS_CHICO: Estilo = { font: letra({ size: 9, color: { argb: argb(GRIS) } }) };

/** Las letras de `desde` a `hasta` ("B", "E" → B, C, D, E). Hasta la Z. */
export const letras = (desde: string, hasta: string) =>
  Array.from({ length: hasta.charCodeAt(0) - desde.charCodeAt(0) + 1 }, (_, i) =>
    String.fromCharCode(desde.charCodeAt(0) + i),
  );

/* -------------------------------------------------------------------------- */
/* El libro                                                                   */
/* -------------------------------------------------------------------------- */

export type Libro = { wb: Workbook; ws: Worksheet; logo: string | null };

/**
 * Un libro con UNA hoja lista para imprimir. `anchos` son los anchos de las
 * columnas desde la A (la A es el margen con el logo).
 */
export async function nuevoLibro(titulo: string, hoja: string, anchos: number[]): Promise<Libro> {
  const [mod, logo] = await Promise.all([import("exceljs"), logoDataUrl()]);
  // exceljs es CommonJS: según el empaquetador llega como `default` o suelto.
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Juventud con Valores";
  wb.title = titulo;
  const ws = wb.addWorksheet(hoja.slice(0, 31), {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 },
    },
    headerFooter: {
      oddFooter: `&L&8&K6E7282Juventud con Valores · ${titulo}&R&8&K6E7282Página &P de &N`,
    },
  });
  ws.columns = anchos.map((width) => ({ width }));
  return { wb, ws, logo };
}

/**
 * El encabezado del PDF en las filas 1 a 3: logo, título y subtítulo en
 * `titulo` (un rango de la fila 1, ej. "B:C"), "Emitido" y "Por" a la derecha
 * en `emitido` ("D:E"), y la franja roja de punta a punta hasta `ultima`.
 */
export function encabezado(
  { wb, ws, logo }: Libro,
  o: {
    titulo: string;
    subtitulo: string;
    usuario: string;
    colTitulo: [string, string];
    colEmitido: [string, string];
    ultima: string;
  },
) {
  ws.getRow(1).height = 26;
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 8;
  if (logo) {
    const img = wb.addImage({ base64: logo, extension: "png" });
    ws.addImage(img, { tl: { col: 0.12, row: 0.1 }, ext: { width: 48, height: 48 } });
  }
  const [t1, t2] = o.colTitulo;
  const [e1, e2] = o.colEmitido;
  escribir(ws, `${t1}1:${t2}1`, o.titulo, {
    font: letra({ size: 16, bold: true, color: { argb: argb(NAVY) } }),
  });
  escribir(ws, `${t1}2:${t2}2`, o.subtitulo, {
    font: letra({ size: 10, color: { argb: argb(GRIS) } }),
  });
  const derecha = { horizontal: "right", vertical: "middle" } as const;
  const chico = letra({ size: 8, color: { argb: argb(GRIS) } });
  escribir(ws, `${e1}1:${e2}1`, `Emitido ${ahora()}`, { font: chico, alignment: derecha });
  escribir(ws, `${e1}2:${e2}2`, `Por ${o.usuario}`, { font: chico, alignment: derecha });
  // El acento rojo de la franja del logo.
  for (const c of letras("A", o.ultima))
    ws.getCell(`${c}3`).border = { bottom: { style: "medium", color: { argb: argb(ROJO) } } };
}

/* -------------------------------------------------------------------------- */
/* Piezas del cuerpo                                                          */
/* -------------------------------------------------------------------------- */

/** Escribe en un rango (lo une si son varias celdas) y le da el estilo. */
export function escribir(
  ws: Worksheet,
  rango: string,
  valor: string | number,
  estilo: Estilo = {},
) {
  const [ini, fin] = rango.split(":");
  if (fin && fin !== ini) ws.mergeCells(rango);
  const c = ws.getCell(ini);
  c.value = valor;
  Object.assign(c, { alignment: { vertical: "middle" }, ...estilo });
}

/** Un número entero con separador de miles, a la derecha. */
export function numero(c: Cell, valor: number, estilo: Estilo = {}) {
  c.value = valor;
  c.numFmt = ENTERO;
  c.font = letra();
  c.alignment = { horizontal: "right", vertical: "middle" };
  Object.assign(c, estilo);
}

/** Pinta el fondo de todas las celdas de `desde` a `hasta` en una fila. */
export function pintar(ws: Worksheet, fila: number, desde: string, hasta: string, color: string) {
  for (const c of letras(desde, hasta)) ws.getCell(`${c}${fila}`).fill = relleno(color);
}

/**
 * Las tarjetas de resumen: etiqueta gris arriba (fila `fila`) y valor grande
 * abajo (`fila + 1`), cada una en su rango de columnas. Un borde blanco grueso
 * las separa, como el espacio del PDF.
 */
export function tarjetas(
  ws: Worksheet,
  fila: number,
  lista: { desde: string; hasta: string; etiqueta: string; valor: string | number; color?: RGB }[],
) {
  ws.getRow(fila).height = 18;
  ws.getRow(fila + 1).height = 24;
  const separador: Partial<Borders> = {
    left: { style: "thick", color: { argb: BLANCO } },
    right: { style: "thick", color: { argb: BLANCO } },
  };
  for (const t of lista) {
    pintar(ws, fila, t.desde, t.hasta, argb(SUAVE));
    pintar(ws, fila + 1, t.desde, t.hasta, argb(SUAVE));
    escribir(ws, `${t.desde}${fila}:${t.hasta}${fila}`, t.etiqueta, {
      font: letra({ size: 8, color: { argb: argb(GRIS) } }),
      fill: relleno(argb(SUAVE)),
      alignment: { vertical: "bottom", indent: 1 },
      border: separador,
    });
    escribir(ws, `${t.desde}${fila + 1}:${t.hasta}${fila + 1}`, t.valor, {
      font: letra({ size: 14, bold: true, color: { argb: argb(t.color ?? NAVY) } }),
      fill: relleno(argb(SUAVE)),
      alignment: { vertical: "middle", horizontal: "left", indent: 1 },
      border: separador,
      ...(typeof t.valor === "number" ? { numFmt: ENTERO } : {}),
    });
  }
}

/** Título de sección en navy con el complemento gris al lado, como el PDF. */
export function seccion(
  ws: Worksheet,
  fila: number,
  titulo: string,
  detalle: string,
  rango: [string, string],
) {
  ws.mergeCells(`${rango[0]}${fila}:${rango[1]}${fila}`);
  const c = ws.getCell(`${rango[0]}${fila}`);
  c.value = {
    richText: [
      { text: titulo, font: letra({ size: 11, bold: true, color: { argb: argb(NAVY) } }) },
      ...(detalle
        ? [{ text: `   ${detalle}`, font: letra({ size: 8.5, color: { argb: argb(GRIS) } }) }]
        : []),
    ],
  };
  c.alignment = { vertical: "bottom" };
  ws.getRow(fila).height = 20;
}

/**
 * La cabecera navy de una tabla: `[desde, hasta, texto]` por columna. Las de
 * `derecha` van alineadas a la derecha (números); `colores` pinta una columna
 * con otro fondo y otra letra (los manuales).
 */
export function cabecera(
  ws: Worksheet,
  fila: number,
  cols: [string, string, string][],
  o: { derecha?: string[]; colores?: Record<string, { fondo: string; tinta: string }> } = {},
) {
  for (const [desde, hasta, texto] of cols) {
    const color = o.colores?.[desde];
    const fondo = color?.fondo ?? argb(NAVY);
    pintar(ws, fila, desde, hasta, fondo);
    escribir(ws, `${desde}${fila}:${hasta}${fila}`, texto, {
      font: letra({ bold: true, color: { argb: color?.tinta ?? BLANCO } }),
      fill: relleno(fondo),
      alignment: {
        vertical: "middle",
        horizontal: o.derecha?.includes(desde) ? "right" : "left",
      },
    });
  }
  ws.getRow(fila).height = 20;
}

/**
 * La fila de total: fondo suave de `pintarDesde` a `pintarHasta`, "Total" en
 * `rotulo` (un rango) y cada suma en su columna.
 */
export function filaTotal(
  ws: Worksheet,
  fila: number,
  o: { pintar: [string, string]; rotulo: [string, string]; valores: [string, number][] },
) {
  const estilo = {
    font: letra({ bold: true, color: { argb: argb(NAVY) } }),
    fill: relleno(argb(SUAVE)),
  };
  pintar(ws, fila, o.pintar[0], o.pintar[1], argb(SUAVE));
  escribir(ws, `${o.rotulo[0]}${fila}:${o.rotulo[1]}${fila}`, "Total", estilo);
  for (const [c, v] of o.valores) numero(ws.getCell(`${c}${fila}`), v, estilo);
  ws.getRow(fila).height = 18;
}

/**
 * Las firmas, de a dos por renglón: una línea arriba, quién en navy y "Nombre,
 * firma y fecha" en gris. `izquierda` y `derecha` son los rangos de columnas de
 * cada una. Devuelve la fila siguiente.
 */
export function firmas(
  ws: Worksheet,
  fila: number,
  quienes: string[],
  izquierda: [string, string],
  derecha: [string, string],
): number {
  for (let i = 0; i < quienes.length; i += 2) {
    quienes.slice(i, i + 2).forEach((quien, j) => {
      const [desde, hasta] = j === 0 ? izquierda : derecha;
      escribir(ws, `${desde}${fila}:${hasta}${fila}`, quien, {
        font: letra({ size: 9, bold: true, color: { argb: argb(NAVY) } }),
      });
      for (const c of letras(desde, hasta))
        ws.getCell(`${c}${fila}`).border = {
          top: { style: "thin", color: { argb: argb(GRIS) } },
        };
      escribir(ws, `${desde}${fila + 1}:${hasta}${fila + 1}`, "Nombre, firma y fecha", {
        font: letra({ size: 8, color: { argb: argb(GRIS) } }),
      });
    });
    fila += 5;
  }
  return fila;
}

/** Arma el `.xlsx` y lo descarga. */
export async function bajarLibro(wb: Workbook, archivo: string) {
  const buf = await wb.xlsx.writeBuffer();
  descargarBlob(
    new Blob([buf as ArrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    archivo,
  );
}
