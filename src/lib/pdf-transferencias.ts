/**
 * El PDF de la consulta de transferencias: resumen, por ruta, por manual, por
 * facilitador y el detalle de cada transferencia con sus manuales, cada uno con
 * el facilitador y la institución a los que fue (12/10/2026).
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
  ALTO,
  AMBAR,
  ANCHO,
  despuesDeTabla,
  dibujarFiltros,
  dibujarSeccion,
  dibujarTarjetas,
  ESTILO_TABLA,
  fmt,
  GRIS,
  INICIO_PRIMERA,
  MARGEN,
  NAVY,
  nuevoReporte,
  rotuloContinuacion,
  t,
  TOPE_CONTENIDO,
} from "@/lib/pdf-base";
import {
  agruparPorTransferencia,
  resumirFacilitadores,
  resumirManuales,
  resumirRutas,
  textoDestinatario,
  type LineaDetalle,
  type LineaHistorial,
  type TransferenciaDetalle,
} from "@/lib/transferencias";

export { abrirPdfEnPestana } from "@/lib/pdf-base";

/** Lo que el encabezado dice del filtro usado. Ya en texto legible. */
export type MetaPdfTransferencias = {
  sucursal: string;
  estado: string;
  periodo: string;
  manuales: string;
  facilitadores: string;
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
  const porFacilitador = resumirFacilitadores(lineas);
  const enCamino = transf.filter((x) => !x.recibida).length;
  const unidades = transf.reduce((s, x) => s + x.unidades, 0);

  // ── Filtros y resumen ────────────────────────────────────────────────
  let y = dibujarFiltros(doc, INICIO_PRIMERA, [
    `Estado: ${meta.estado}   ·   Período: ${meta.periodo}`,
    `Manuales: ${meta.manuales}`,
    `Facilitadores: ${meta.facilitadores}`,
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

  // ── Por facilitador ──────────────────────────────────────────────────
  y = dibujarSeccion(
    doc,
    y,
    "Por facilitador",
    `${porFacilitador.length} facilitador${porFacilitador.length === 1 ? "" : "es"}`,
  );
  autoTable(doc, {
    ...ESTILO_TABLA,
    startY: y,
    didDrawPage: rotuloContinuacion(doc, doc.getNumberOfPages(), "Por facilitador"),
    head: [["Facilitador", "Instituciones", "Libros"]],
    body: porFacilitador.map((p) => [t(p.facilitador), fmt(p.instituciones), fmt(p.unidades)]),
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
        { content: t(textoDestinatario(l)), styles: { fillColor: fondo } },
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
    head: [["Nº", "Fecha", "Ruta", "Estado", "Facilitador / Institución", "Manual", "Cant."]],
    body: cuerpo,
    foot: [["", "", "", "", "", "Total", fmt(unidades)]],
    columnStyles: {
      0: { cellWidth: 11 },
      1: { cellWidth: 22 },
      2: { cellWidth: 32 },
      3: { cellWidth: 22 },
      6: { halign: "right", cellWidth: 13 },
    },
    didParseCell: (d) => {
      if (d.section !== "body" && d.column.index === 6) d.cell.styles.halign = "right";
    },
  });
  despuesDeTabla(doc, y);

  return cerrar();
}

/* -------------------------------------------------------------------------- */
/* El PDF de UNA transferencia (13/10/2026)                                   */
/* -------------------------------------------------------------------------- */

/**
 * El comprobante de una transferencia: datos y estado, resumen, cuántos libros
 * de cada manual, el detalle por facilitador e institución y, al final, lugar
 * para las firmas de quien entrega y quien recibe (va impreso con los libros).
 *
 * Se arma con lo GUARDADO (`TransferenciaDetalle`), no con lo que se esté
 * editando en el formulario: la pantalla lo avisa.
 */
export async function generarPdfTransferencia(
  x: TransferenciaDetalle,
  usuario: string,
): Promise<Blob> {
  const { doc, autoTable, cerrar } = await nuevoReporte({
    titulo: `Transferencia Nº ${x.id_transferencia}`,
    subtitulo: `${x.origen} > ${x.destino}`,
    usuario,
  });

  const unidades = x.detalle.reduce((s, l) => s + l.cantidad, 0);
  const porManual = new Map<string, number>();
  for (const l of x.detalle) porManual.set(l.manual, (porManual.get(l.manual) ?? 0) + l.cantidad);
  const facilitadores = new Set(x.detalle.map((l) => l.facilitador ?? "Sin asignar"));

  // ── Datos y resumen ──────────────────────────────────────────────────
  let y = dibujarFiltros(doc, INICIO_PRIMERA, [
    `Fecha: ${x.fecha ?? "-"}   ·   Sale de: ${x.origen}   ·   Llega a: ${x.destino}`,
    x.recibida
      ? `Recibida${x.recibida_el ? ` el ${x.recibida_el}` : ""}${x.recibida_por ? ` por ${x.recibida_por}` : ""}.`
      : "En camino: todavía no se confirmó la recepción.",
  ]);
  y = dibujarTarjetas(doc, y, [
    { etiqueta: "Libros", valor: fmt(unidades) },
    { etiqueta: "Manuales", valor: fmt(porManual.size) },
    { etiqueta: "Facilitadores", valor: fmt(facilitadores.size) },
    {
      etiqueta: "Estado",
      valor: x.recibida ? "Recibida" : "En camino",
      color: x.recibida ? NAVY : AMBAR,
    },
  ]);

  if (x.detalle.length === 0) {
    doc.setFontSize(10);
    doc.text("La transferencia no tiene manuales.", MARGEN, y + 4);
    return cerrar();
  }

  // ── Por manual ───────────────────────────────────────────────────────
  const manuales = [...porManual].sort((a, b) => a[0].localeCompare(b[0], "es"));
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
    head: [["Manual", "Libros"]],
    body: manuales.map(([m, c]) => [t(m), fmt(c)]),
    foot: [["Total", fmt(unidades)]],
    columnStyles: { 1: { halign: "right", cellWidth: 26 } },
    didParseCell: (d) => {
      if (d.section !== "body" && d.column.index === 1) d.cell.styles.halign = "right";
    },
  });
  y = despuesDeTabla(doc, y);

  // ── Detalle: un grupo de filas por facilitador e institución ─────────
  // Como el detalle de la consulta: facilitador e institución en celdas que
  // abarcan sus manuales, y la cebra por grupo.
  const grupos = new Map<string, LineaDetalle[]>();
  for (const l of x.detalle) {
    const k = `${l.id_facilitador ?? ""}|${l.id_institucion ?? ""}`;
    const g = grupos.get(k);
    if (g) g.push(l);
    else grupos.set(k, [l]);
  }
  y = dibujarSeccion(
    doc,
    y,
    "Detalle",
    `${grupos.size} destinatario${grupos.size === 1 ? "" : "s"} · ${fmt(unidades)} libros`,
  );
  const cuerpo: CellInput[][] = [];
  [...grupos.values()].forEach((lineas, gi) => {
    const fondo = gi % 2 ? CEBRA : BLANCO;
    const unida = (content: string): CellInput => ({
      content,
      rowSpan: lineas.length,
      styles: { valign: "middle", fillColor: fondo },
    });
    lineas.forEach((l, i) => {
      const fila: CellInput[] = [];
      if (i === 0) {
        const sinAsignar = l.id_facilitador == null && l.id_institucion == null;
        fila.push(
          unida(t(sinAsignar ? "Sin asignar" : (l.facilitador ?? "Sin facilitador"))),
          unida(t(sinAsignar ? "-" : (l.institucion ?? "Sin institución"))),
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
    alternateRowStyles: {},
    startY: y,
    rowPageBreak: "avoid",
    didDrawPage: rotuloContinuacion(doc, doc.getNumberOfPages(), "Detalle"),
    head: [["Facilitador", "Institución", "Manual", "Cant."]],
    body: cuerpo,
    foot: [["", "", "Total", fmt(unidades)]],
    columnStyles: { 3: { halign: "right", cellWidth: 16 } },
    didParseCell: (d) => {
      if (d.section !== "body" && d.column.index === 3) d.cell.styles.halign = "right";
    },
  });
  y = despuesDeTabla(doc, y, 6);

  // ── Firmas ───────────────────────────────────────────────────────────
  if (y > ALTO - 50) {
    doc.addPage();
    y = TOPE_CONTENIDO + 4;
  }
  const yLinea = y + 22;
  const ancho = (ANCHO - 2 * MARGEN - 20) / 2;
  [
    ["Entregó", x.origen],
    ["Recibió", x.destino],
  ].forEach(([quien, sucursal], i) => {
    const x0 = MARGEN + i * (ancho + 20);
    doc.setDrawColor(...GRIS);
    doc.setLineWidth(0.3);
    doc.line(x0, yLinea, x0 + ancho, yLinea);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...NAVY);
    doc.text(t(`${quien} · ${sucursal}`), x0, yLinea + 5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIS);
    doc.text("Nombre, firma y fecha", x0, yLinea + 9.5);
  });

  return cerrar();
}
