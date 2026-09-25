/**
 * El PDF de la consulta de inventarios: resumen y una tabla por sucursal.
 *
 * Lo común de los reportes —encabezado con logo, pie, tarjetas, estilo de
 * tabla, abrir en pestaña nueva— está en `pdf-base.ts`. Acá va solo el cuerpo.
 */

import {
  AMBAR,
  conSigno,
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
  ROJO,
  rotuloContinuacion,
  t,
} from "@/lib/pdf-base";
import { diferenciaDe, type ConteoHistorial } from "@/lib/inventarios";

export { abrirPdfEnPestana } from "@/lib/pdf-base";

/** Lo que el encabezado dice del filtro usado. Ya en texto legible. */
export type MetaPdf = {
  sucursal: string;
  estado: string;
  periodo: string;
  manuales: string;
  usuario: string;
};

export async function generarPdfHistorial(filas: ConteoHistorial[], meta: MetaPdf): Promise<Blob> {
  const { doc, autoTable, cerrar } = await nuevoReporte({
    titulo: "Inventario de manuales",
    subtitulo: `Consulta de detalle · ${meta.sucursal}`,
    usuario: meta.usuario,
  });

  // ── Filtros y resumen (solo en la primera página) ────────────────────
  let y = dibujarFiltros(doc, INICIO_PRIMERA, [
    `Estado: ${meta.estado}   ·   Período: ${meta.periodo}`,
    `Manuales: ${meta.manuales}`,
  ]);

  const pendientes = filas.filter((f) => f.estado === "ABIERTO").length;
  const neta = filas.reduce((s, f) => s + (diferenciaDe(f) ?? 0), 0);
  y = dibujarTarjetas(doc, y, [
    { etiqueta: "Conteos", valor: fmt(filas.length) },
    { etiqueta: "Pendientes", valor: fmt(pendientes), color: pendientes ? AMBAR : NAVY },
    { etiqueta: "Cerrados", valor: fmt(filas.length - pendientes) },
    {
      etiqueta: "Diferencia neta",
      valor: conSigno(neta),
      color: neta < 0 ? ROJO : neta > 0 ? AMBAR : NAVY,
    },
  ]);

  // ── Una tabla por sucursal ───────────────────────────────────────────
  const grupos = new Map<string, ConteoHistorial[]>();
  for (const f of filas) {
    const g = grupos.get(f.sucursal);
    if (g) g.push(f);
    else grupos.set(f.sucursal, [f]);
  }

  if (grupos.size === 0) {
    doc.setFontSize(10);
    doc.text("No hay conteos con estos filtros.", MARGEN, y + 4);
  }

  for (const [sucursal, conteos] of grupos) {
    const pend = conteos.filter((c) => c.estado === "ABIERTO").length;
    const cerr = conteos.length - pend;
    y = dibujarSeccion(
      doc,
      y,
      sucursal,
      `${conteos.length} conteo${conteos.length === 1 ? "" : "s"} · ${pend} pendiente${pend === 1 ? "" : "s"} · ${cerr} cerrado${cerr === 1 ? "" : "s"}`,
    );

    const suma = (fn: (c: ConteoHistorial) => number | null) =>
      conteos.reduce((s, c) => s + (fn(c) ?? 0), 0);

    autoTable(doc, {
      ...ESTILO_TABLA,
      startY: y,
      // En las páginas que la tabla CONTINÚA, de qué sucursal es.
      didDrawPage: rotuloContinuacion(doc, doc.getNumberOfPages(), sucursal),
      head: [["Fecha", "Manual", "Sistema", "Física", "Dif.", "Estado"]],
      body: conteos.map((c) => {
        const d = diferenciaDe(c);
        return [
          c.fecha ?? "-",
          t(c.manual),
          fmt(c.cantidad_sistema),
          fmt(c.cantidad_fisica),
          d == null ? "-" : conSigno(d),
          c.estado === "ABIERTO" ? "Pendiente" : "Cerrado",
        ];
      }),
      foot: [
        [
          "",
          "Total",
          fmt(suma((c) => c.cantidad_sistema)),
          fmt(suma((c) => c.cantidad_fisica)),
          conSigno(suma(diferenciaDe)),
          "",
        ],
      ],
      columnStyles: {
        0: { cellWidth: 28 },
        2: { halign: "right", cellWidth: 18 },
        3: { halign: "right", cellWidth: 18 },
        4: { halign: "right", cellWidth: 16 },
        5: { cellWidth: 22 },
      },
      didParseCell: (data) => {
        // Las cabeceras numéricas alineadas con sus números.
        if (data.section !== "body" && [2, 3, 4].includes(data.column.index)) {
          data.cell.styles.halign = "right";
        }
        if (data.section !== "body") return;
        const c = conteos[data.row.index];
        if (data.column.index === 4) {
          const d = diferenciaDe(c);
          // Faltan en rojo, sobran en ámbar: igual que en la pantalla.
          if (d != null && d < 0) data.cell.styles.textColor = ROJO;
          if (d != null && d > 0) data.cell.styles.textColor = AMBAR;
          if (d) data.cell.styles.fontStyle = "bold";
        }
        if (data.column.index === 5 && c.estado === "ABIERTO") {
          data.cell.styles.textColor = AMBAR;
          data.cell.styles.fontStyle = "bold";
        }
      },
    });

    y = despuesDeTabla(doc, y);
  }

  return cerrar();
}
