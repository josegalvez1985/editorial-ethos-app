/**
 * El PDF de la consulta de transferencias: resumen, por ruta, por manual y el
 * detalle de cada transferencia con sus manuales.
 *
 * Lo común de los reportes —encabezado con logo, pie, tarjetas, estilo de
 * tabla, abrir en pestaña nueva— está en `pdf-base.ts`. Acá va solo el cuerpo.
 *
 * EL DETALLE ES UNA SOLA TABLA CON CELDAS UNIDAS. Cada transferencia ocupa las
 * filas de sus manuales, y su número, fecha, ruta y estado van en celdas que
 * abarcan esas filas (`rowSpan`). Una tabla por transferencia repetiría la
 * cabecera veinte veces; así se lee como una planilla. El fondo alterna POR
 * TRANSFERENCIA (no por fila) para que se vea dónde empieza y termina cada una.
 */

import type { CellInput } from "jspdf-autotable";

import {
  AMBAR,
  despuesDeTabla,
  dibujarFiltros,
  dibujarSeccion,
  dibujarTarjetas,
  ESTILO_TABLA,
  fmt,
  INICIO_PRIMERA,
  MARGEN,
  NAVY,
  nuevoReporte,
  rotuloContinuacion,
  t,
} from "@/lib/pdf-base";
import {
  agruparPorTransferencia,
  resumirManuales,
  resumirRutas,
  type LineaHistorial,
} from "@/lib/transferencias";

export { abrirPdfEnPestana } from "@/lib/pdf-base";

/** Lo que el encabezado dice del filtro usado. Ya en texto legible. */
export type MetaPdfTransferencias = {
  sucursal: string;
  estado: string;
  periodo: string;
  manuales: string;
  usuario: string;
};

const BLANCO: [number, number, number] = [255, 255, 255];
const CEBRA: [number, number, number] = [247, 248, 252];

export async function generarPdfTransferencias(
  lineas: LineaHistorial[],
  meta: MetaPdfTransferencias,
): Promise<Blob> {
  const { doc, autoTable, cerrar } = await nuevoReporte({
    titulo: "Transferencias de manuales",
    subtitulo: `Consulta · ${meta.sucursal}`,
    usuario: meta.usuario,
  });

  const transf = agruparPorTransferencia(lineas);
  const rutas = resumirRutas(transf);
  const manuales = resumirManuales(lineas);
  const enCamino = transf.filter((x) => !x.recibida).length;
  const unidades = transf.reduce((s, x) => s + x.unidades, 0);

  // ── Filtros y resumen ────────────────────────────────────────────────
  let y = dibujarFiltros(doc, INICIO_PRIMERA, [
    `Estado: ${meta.estado}   ·   Período: ${meta.periodo}`,
    `Manuales: ${meta.manuales}`,
  ]);
  y = dibujarTarjetas(doc, y, [
    { etiqueta: "Transferencias", valor: fmt(transf.length) },
    { etiqueta: "Libros movidos", valor: fmt(unidades) },
    { etiqueta: "En camino", valor: fmt(enCamino), color: enCamino ? AMBAR : NAVY },
    { etiqueta: "Recibidas", valor: fmt(transf.length - enCamino) },
  ]);

  if (transf.length === 0) {
    doc.setFontSize(10);
    doc.text("No hay transferencias con estos filtros.", MARGEN, y + 4);
    return cerrar();
  }

  // ── Por ruta ─────────────────────────────────────────────────────────
  y = dibujarSeccion(doc, y, "Por ruta", `${rutas.length} ruta${rutas.length === 1 ? "" : "s"}`);
  autoTable(doc, {
    ...ESTILO_TABLA,
    startY: y,
    head: [["Sale de", "Llega a", "Transferencias", "Libros"]],
    body: rutas.map((r) => [t(r.origen), t(r.destino), fmt(r.transferencias), fmt(r.unidades)]),
    foot: [["", "Total", fmt(transf.length), fmt(unidades)]],
    columnStyles: {
      2: { halign: "right", cellWidth: 28 },
      3: { halign: "right", cellWidth: 22 },
    },
    didParseCell: (d) => {
      if (d.section !== "body" && d.column.index >= 2) d.cell.styles.halign = "right";
    },
  });
  y = despuesDeTabla(doc, y);

  // ── Por manual ───────────────────────────────────────────────────────
  y = dibujarSeccion(
    doc,
    y,
    "Por manual",
    `${manuales.length} manual${manuales.length === 1 ? "" : "es"}`,
  );
  autoTable(doc, {
    ...ESTILO_TABLA,
    startY: y,
    didDrawPage: rotuloContinuacion(doc, doc.getNumberOfPages(), "Por manual"),
    head: [["Manual", "Transferencias", "Libros"]],
    body: manuales.map((m) => [t(m.manual), fmt(m.transferencias), fmt(m.unidades)]),
    foot: [["Total", "", fmt(unidades)]],
    columnStyles: {
      1: { halign: "right", cellWidth: 28 },
      2: { halign: "right", cellWidth: 22 },
    },
    didParseCell: (d) => {
      if (d.section !== "body" && d.column.index >= 1) d.cell.styles.halign = "right";
    },
  });
  y = despuesDeTabla(doc, y);

  // ── Detalle: una transferencia por grupo de filas ────────────────────
  y = dibujarSeccion(
    doc,
    y,
    "Detalle",
    `${transf.length} transferencia${transf.length === 1 ? "" : "s"} · ${fmt(unidades)} libros`,
  );

  const cuerpo: CellInput[][] = [];
  transf.forEach((x, gi) => {
    const fondo = gi % 2 ? CEBRA : BLANCO;
    const n = x.lineas.length;
    // Las celdas de la cabecera abarcan todas las filas de sus manuales.
    const unida = (content: string, extra: Record<string, unknown> = {}): CellInput => ({
      content,
      rowSpan: n,
      styles: { valign: "middle", fillColor: fondo, ...extra },
    });
    x.lineas.forEach((l, i) => {
      const fila: CellInput[] = [];
      if (i === 0) {
        fila.push(
          unida(`#${x.id_transferencia}`, { fontStyle: "bold", textColor: NAVY }),
          unida(x.fecha ?? "-"),
          unida(t(`${x.origen} > ${x.destino}`)),
          x.recibida
            ? // El salto va FUERA de t(): t() convierte "\n" en "?".
              unida(x.recibida_el ? `Recibida\n${x.recibida_el}` : "Recibida")
            : unida("En camino", { textColor: AMBAR, fontStyle: "bold" }),
        );
      }
      fila.push(
        { content: t(l.manual), styles: { fillColor: fondo } },
        { content: fmt(l.cantidad), styles: { fillColor: fondo, halign: "right" } },
      );
      cuerpo.push(fila);
    });
  });

  autoTable(doc, {
    ...ESTILO_TABLA,
    // La cebra va por transferencia (en cada celda), no por fila.
    alternateRowStyles: {},
    startY: y,
    // Un grupo no se corta entre páginas si entra entero en la siguiente.
    rowPageBreak: "avoid",
    didDrawPage: rotuloContinuacion(doc, doc.getNumberOfPages(), "Detalle"),
    head: [["Nº", "Fecha", "Ruta", "Estado", "Manual", "Cant."]],
    body: cuerpo,
    foot: [["", "", "", "", "Total", fmt(unidades)]],
    columnStyles: {
      0: { cellWidth: 12 },
      1: { cellWidth: 26 },
      2: { cellWidth: 44 },
      3: { cellWidth: 26 },
      5: { halign: "right", cellWidth: 14 },
    },
    didParseCell: (d) => {
      if (d.section !== "body" && d.column.index === 5) d.cell.styles.halign = "right";
    },
  });
  despuesDeTabla(doc, y);

  return cerrar();
}
