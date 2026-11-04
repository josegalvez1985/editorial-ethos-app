/**
 * El PDF de Pagos a Facilitadores (04/11/2026), para Tesorería.
 *
 * Lo común de los reportes —encabezado con logo, pie, tarjetas, estilo de
 * tabla, abrir en pestaña nueva— está en `pdf-base.ts`. Acá va solo el cuerpo.
 *
 * La pantalla tiene 19 columnas: en A4 vertical no entran en una tabla. Por eso
 * el PDF se arma como lo usa Tesorería:
 *
 * 1. **A pagar por facilitador**: una fila por facilitador con su cuenta y el
 *    total a transferir. Es la lista para hacer las transferencias.
 * 2. **El detalle**: por facilitador, sus datos bancarios, RUC y emisor en un
 *    recuadro, y la tabla de sus facturas con el subtotal.
 *
 * Recibe las filas que se ven en la pantalla (con los filtros de columna y en
 * su orden), igual que el Excel.
 */

import type { PagoFactura } from "@/lib/facturas-facilitadores";
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
  SUAVE,
  t,
  TOPE_CONTENIDO,
} from "@/lib/pdf-base";

export { abrirPdfEnPestana } from "@/lib/pdf-base";

/** Lo que el encabezado dice del filtro usado. Ya en texto legible. */
export type MetaPdfPagos = {
  /** "01/10/2026 al 31/10/2026". */
  periodo: string;
  facilitador: string;
  /** Si hay filtros de columna puestos: el PDF lo avisa. */
  conFiltrosColumna: boolean;
  usuario: string;
};

/** `YYYY-MM-DD` → `DD/MM/YYYY`. */
const dmy = (iso: string) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";

/** Un dato del facilitador, o "Sin cargar". */
const o = (v: string) => (v.trim() ? v.trim() : "Sin cargar");

const sinCuenta = (p: PagoFactura) => !p.banco.trim() || !p.nroCuenta.trim();

export async function generarPdfPagos(filas: PagoFactura[], meta: MetaPdfPagos): Promise<Blob> {
  const { doc, autoTable, cerrar } = await nuevoReporte({
    titulo: "Pagos a Facilitadores",
    subtitulo: `Facturas emitidas del ${meta.periodo}`,
    usuario: meta.usuario,
  });

  // Por facilitador, en el orden en que aparecen en la pantalla.
  const grupos = new Map<number, PagoFactura[]>();
  for (const p of filas) {
    const g = grupos.get(p.idFacilitador);
    if (g) g.push(p);
    else grupos.set(p.idFacilitador, [p]);
  }
  const lista = [...grupos.values()];
  const total = filas.reduce((s, p) => s + p.monto, 0);
  const intervenciones = filas.reduce((s, p) => s + p.cantidad, 0);
  const faltan = lista.filter((g) => sinCuenta(g[0])).length;

  // ── Filtros y resumen ────────────────────────────────────────────────
  let y = dibujarFiltros(doc, INICIO_PRIMERA, [
    `Por fecha de la factura: ${meta.periodo}   ·   Facilitador: ${meta.facilitador}`,
    ...(meta.conFiltrosColumna ? ["Con filtros de columna aplicados en la pantalla."] : []),
  ]);
  y = dibujarTarjetas(doc, y, [
    { etiqueta: "Facturas", valor: fmt(filas.length) },
    { etiqueta: "Facilitadores", valor: fmt(lista.length) },
    { etiqueta: "Intervenciones", valor: fmt(intervenciones) },
    { etiqueta: "Total a pagar", valor: fmt(total) },
  ]);

  if (!filas.length) {
    doc.setFontSize(10);
    doc.text("No hay facturas emitidas en este período.", MARGEN, y + 4);
    return cerrar();
  }

  if (faltan) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...AMBAR);
    doc.text(
      t(
        `${faltan === 1 ? "1 facilitador no tiene" : `${faltan} facilitadores no tienen`} banco o número de cuenta cargado.`,
      ),
      MARGEN,
      y - 2,
    );
    doc.setFont("helvetica", "normal");
    y += 4;
  }

  // ── 1. A pagar por facilitador ───────────────────────────────────────
  y = dibujarSeccion(doc, y, "A pagar por facilitador", "la cuenta y el total de cada uno");
  autoTable(doc, {
    ...ESTILO_TABLA,
    startY: y,
    didDrawPage: rotuloContinuacion(doc, doc.getNumberOfPages(), "A pagar por facilitador"),
    styles: { ...ESTILO_TABLA.styles, fontSize: 7.8 },
    head: [["Facilitador", "Banco", "Tipo", "Nro. de cuenta", "Titular", "CI titular", "Total"]],
    body: lista.map((g) => {
      const p = g[0];
      return [
        t(p.facilitador),
        t(o(p.banco)),
        t(p.tipoCuenta),
        t(o(p.nroCuenta)),
        t(p.titular),
        t(p.ciTitular),
        fmt(g.reduce((s, x) => s + x.monto, 0)),
      ];
    }),
    foot: [["Total", "", "", "", "", "", fmt(total)]],
    columnStyles: {
      0: { cellWidth: 40 },
      2: { cellWidth: 18 },
      3: { cellWidth: 28 },
      5: { cellWidth: 18 },
      6: { halign: "right", cellWidth: 22 },
    },
    didParseCell: (data) => {
      if (data.section !== "body" && data.column.index === 6) data.cell.styles.halign = "right";
      if (data.section !== "body") return;
      const p = lista[data.row.index][0];
      // Lo que falta para transferir, en ámbar: igual que en la pantalla.
      if (
        (data.column.index === 1 && !p.banco.trim()) ||
        (data.column.index === 3 && !p.nroCuenta.trim())
      ) {
        data.cell.styles.textColor = AMBAR;
        data.cell.styles.fontStyle = "bold";
      }
      if (data.column.index === 6) data.cell.styles.fontStyle = "bold";
    },
  });
  y = despuesDeTabla(doc, y, 12);

  // ── 2. El detalle, por facilitador ───────────────────────────────────
  for (const g of lista) {
    const p = g[0];
    const subtotal = g.reduce((s, x) => s + x.monto, 0);

    // Título + recuadro + unas filas: si no entra, a la página siguiente.
    if (y > ALTO - 70) {
      doc.addPage();
      y = TOPE_CONTENIDO + 4;
    }
    y = dibujarSeccion(
      doc,
      y,
      p.facilitador,
      `${g.length} factura${g.length === 1 ? "" : "s"} · ${fmt(subtotal)}`,
    );

    // El recuadro con los datos para pagar.
    const lineas: [string, string][][] = [
      [
        ["Banco", o(p.banco)],
        ["Sucursal", o(p.sucursalBanco)],
        ["Tipo de cuenta", o(p.tipoCuenta)],
        ["Nro. de cuenta", o(p.nroCuenta)],
      ],
      [
        ["Titular", o(p.titular)],
        ["CI titular", o(p.ciTitular)],
        ["CI", o(p.nroCi)],
        ["RUC", o(p.ruc)],
      ],
      [["Emisor", o(p.nombreEmisor)]],
    ];
    const alto = 4 + lineas.length * 5;
    doc.setFillColor(...SUAVE);
    doc.roundedRect(MARGEN, y, ANCHO - 2 * MARGEN, alto, 1.5, 1.5, "F");
    doc.setFontSize(8);
    lineas.forEach((linea, i) => {
      let x = MARGEN + 3;
      const yl = y + 5 + i * 5;
      for (const [etiqueta, valor] of linea) {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...GRIS);
        const et = t(`${etiqueta}: `);
        doc.text(et, x, yl);
        x += doc.getTextWidth(et);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...(valor === "Sin cargar" ? AMBAR : NAVY));
        const v = t(valor);
        doc.text(v, x, yl);
        x += doc.getTextWidth(v) + 6;
      }
    });
    doc.setFont("helvetica", "normal");
    y += alto + 3;

    autoTable(doc, {
      ...ESTILO_TABLA,
      startY: y,
      didDrawPage: rotuloContinuacion(doc, doc.getNumberOfPages(), p.facilitador),
      styles: { ...ESTILO_TABLA.styles, fontSize: 7.8 },
      head: [
        [
          "Nro. Factura",
          "Timbrado",
          "Fecha",
          "Período",
          "Interv.",
          "Sueldo",
          "Monto",
          "Observación",
        ],
      ],
      body: g.map((x) => [
        x.nroFactura,
        x.timbrado,
        dmy(x.fechaFactura),
        `${dmy(x.fechaDesde)} al ${dmy(x.fechaHasta)}`,
        fmt(x.cantidad),
        fmt(x.sueldo),
        fmt(x.monto),
        t(x.observacion),
      ]),
      foot: [
        ["Subtotal", "", "", "", fmt(g.reduce((s, x) => s + x.cantidad, 0)), "", fmt(subtotal), ""],
      ],
      columnStyles: {
        0: { cellWidth: 26 },
        1: { cellWidth: 17 },
        2: { cellWidth: 19 },
        3: { cellWidth: 38 },
        4: { halign: "right", cellWidth: 13 },
        5: { halign: "right", cellWidth: 16 },
        6: { halign: "right", cellWidth: 21 },
      },
      didParseCell: (data) => {
        if (data.section !== "body" && [4, 5, 6].includes(data.column.index)) {
          data.cell.styles.halign = "right";
        }
        if (data.section === "body" && data.column.index === 6) {
          data.cell.styles.fontStyle = "bold";
        }
      },
    });
    y = despuesDeTabla(doc, y, 9);
  }

  // ── Total general ────────────────────────────────────────────────────
  if (y > ALTO - 30) {
    doc.addPage();
    y = TOPE_CONTENIDO + 4;
  }
  doc.setFillColor(...NAVY);
  doc.roundedRect(MARGEN, y, ANCHO - 2 * MARGEN, 11, 1.5, 1.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text(
    t(`Total a pagar: ${fmt(lista.length)} facilitadores · ${fmt(filas.length)} facturas`),
    MARGEN + 4,
    y + 7.2,
  );
  doc.text(fmt(total), ANCHO - MARGEN - 4, y + 7.2, { align: "right" });
  doc.setFont("helvetica", "normal");

  return cerrar();
}
