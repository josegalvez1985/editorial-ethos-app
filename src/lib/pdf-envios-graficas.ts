/**
 * El comprobante en PDF de UN envío de gráficas: cabecera y detalle (pedido el
 * 13/10/2026). El mismo día se sacó el informe general del listado: el PDF y
 * el Excel salen solo por envío, y el Excel tiene este mismo formato
 * (`excel-envio-grafica.ts`): si se cambia uno, se cambia el otro.
 *
 * De arriba abajo: datos del envío, tarjetas, "Por manual" (con sus colores),
 * "Destinos" (con el comentario de cada uno debajo), el "Armado de paquetes" (100, 50, 25 y sueltos,
 * por destino y manual: ver "Los paquetes" en lib/envios-graficas) y las
 * firmas de la gráfica que entrega y de cada sucursal que recibe.
 *
 * Lo común —encabezado con logo, pie, tarjetas, secciones, estilo de tabla,
 * abrir en pestaña nueva— está en `pdf-base.ts`.
 */

import type { CellDef, CellHookData, CellInput } from "jspdf-autotable";

import {
  dividir,
  PAQUETES,
  sumarDivisiones,
  textoDivision,
  type EnvioGrafica,
} from "@/lib/envios-graficas";
import {
  ALTO,
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
  type RGB,
} from "@/lib/pdf-base";
import { MANUALES } from "@/lib/postulaciones";

export { abrirPdfEnPestana } from "@/lib/pdf-base";

const BLANCO: RGB = [255, 255, 255];
const CEBRA: RGB = [247, 248, 252];

const rgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** "13/10/2026" a partir de `YYYY-MM-DD`. */
const fechaCorta = (f: string) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "-");
/** "13/10/2026 18:40" a partir de `YYYY-MM-DDTHH:MI`. */
const fechaHora = (f: string) => (f ? `${fechaCorta(f)} ${f.slice(11, 16)}` : "-");

const cant = (n: number) => (n ? fmt(n) : "-");

/**
 * Pinta con el color de su manual las celdas de las columnas `desde` …
 * `desde + 6` de la cabecera (una columna por manual, en el orden de MANUALES).
 */
function colorearCabecera(desde: number) {
  return (d: CellHookData) => {
    const m = MANUALES[d.column.index - desde];
    if (d.section !== "head" || !m) return;
    d.cell.styles.fillColor = rgb(m.color);
    d.cell.styles.textColor = rgb(m.tinta);
  };
}

/** Sale de lo GUARDADO, no de lo que se esté editando en el formulario. */
export async function generarPdfEnvio(e: EnvioGrafica, usuario: string): Promise<Blob> {
  const { doc, autoTable, cerrar } = await nuevoReporte({
    titulo: `Envío de gráficas Nº ${e.id}`,
    subtitulo: `${e.grafica} · ${fechaCorta(e.fecha)}`,
    usuario,
  });

  const sucursales = [...new Set(e.lineas.map((l) => l.sucursal))];

  let y = dibujarFiltros(doc, INICIO_PRIMERA, [
    `Gráfica: ${e.grafica}   ·   Fecha del envío: ${fechaCorta(e.fecha)}`,
    [
      e.cargadoEl &&
        `Cargado el ${fechaHora(e.cargadoEl)}${e.cargadoPor ? ` por ${e.cargadoPor}` : ""}`,
      e.modificadoEl &&
        `modificado el ${fechaHora(e.modificadoEl)}${e.modificadoPor ? ` por ${e.modificadoPor}` : ""}`,
    ]
      .filter(Boolean)
      .join(" · ") || " ",
  ]);
  y = dibujarTarjetas(doc, y, [
    { etiqueta: "Manuales", valor: fmt(e.cantidad) },
    { etiqueta: "Destinos", valor: fmt(e.lineas.length) },
    { etiqueta: "Sucursales", valor: fmt(sucursales.length) },
    { etiqueta: "Ciudades", valor: fmt(new Set(e.lineas.map((l) => l.idCiudad)).size) },
  ]);

  // ── Por manual: cada uno con su color, la cantidad y el % ────────────
  y = dibujarSeccion(doc, y, "Por manual");
  autoTable(doc, {
    ...ESTILO_TABLA,
    startY: y,
    head: [["Manual", "Libros", "% del total"]],
    body: MANUALES.map((m) => [
      t(m.nombre),
      cant(e.manuales[m.clave]),
      e.cantidad && e.manuales[m.clave]
        ? `${Math.round((e.manuales[m.clave] * 100) / e.cantidad)}%`
        : "-",
    ]),
    foot: [["Total", fmt(e.cantidad), "100%"]],
    tableWidth: 100,
    columnStyles: {
      0: { cellWidth: 44 },
      1: { halign: "right", cellWidth: 28 },
      2: { halign: "right", cellWidth: 28 },
    },
    didParseCell: (d) => {
      if (d.section !== "body" && d.column.index >= 1) d.cell.styles.halign = "right";
      if (d.section === "body" && d.column.index === 0) {
        const m = MANUALES[d.row.index];
        d.cell.styles.fillColor = rgb(m.color);
        d.cell.styles.textColor = rgb(m.tinta);
        d.cell.styles.fontStyle = "bold";
      }
    },
  });
  y = despuesDeTabla(doc, y);

  // ── Destinos ─────────────────────────────────────────────────────────
  y = dibujarSeccion(
    doc,
    y,
    "Destinos",
    `${e.lineas.length} destino${e.lineas.length === 1 ? "" : "s"} · ${fmt(e.cantidad)} manuales`,
  );
  // El comentario de cada destino va en SU registro: una fila debajo, a lo
  // ancho, con el mismo fondo (pedido de Jose el 13/10/2026: no al final). Por
  // eso la cebra va por destino y no por fila.
  const filasDestinos: CellInput[][] = [];
  e.lineas.forEach((l, i) => {
    const fondo = i % 2 ? CEBRA : BLANCO;
    const coment = l.comentario.trim();
    const celda = (content: string, extra: Record<string, unknown> = {}): CellDef => ({
      content,
      styles: { fillColor: fondo, ...extra },
    });
    filasDestinos.push([
      celda(String(i + 1), { fontStyle: "bold" }),
      celda(t(l.sucursal)),
      celda(t([l.ciudad, l.departamento].filter(Boolean).join(", ") || "-")),
      ...MANUALES.map((m) => celda(cant(l.manuales[m.clave]), { halign: "right" })),
      celda(fmt(l.cantidad), { halign: "right", fontStyle: "bold" }),
    ]);
    if (coment)
      filasDestinos.push([
        celda(""),
        {
          // De Sucursal a Total. Los saltos de línea del comentario se
          // respetan: t() se aplica por renglón.
          ...celda(`Comentario: ${coment.split("\n").map(t).join("\n")}`, {
            fontStyle: "italic",
            textColor: GRIS,
            fontSize: 7.5,
          }),
          colSpan: 2 + MANUALES.length + 1,
        },
      ]);
  });
  autoTable(doc, {
    ...ESTILO_TABLA,
    alternateRowStyles: {},
    startY: y,
    rowPageBreak: "avoid",
    styles: { ...ESTILO_TABLA.styles, fontSize: 8 },
    didDrawPage: rotuloContinuacion(doc, doc.getNumberOfPages(), "Destinos"),
    head: [["Nº", "Sucursal", "Ciudad", ...MANUALES.map((m) => m.corto), "Total"]],
    body: filasDestinos,
    foot: [["", "", "Total", ...MANUALES.map((m) => fmt(e.manuales[m.clave])), fmt(e.cantidad)]],
    columnStyles: {
      0: { cellWidth: 8 },
      ...Object.fromEntries(MANUALES.map((_, i) => [3 + i, { cellWidth: 11 }])),
      10: { cellWidth: 14 },
    },
    didParseCell: (d) => {
      if (d.section !== "body" && d.column.index >= 3) d.cell.styles.halign = "right";
      colorearCabecera(3)(d);
    },
  });
  y = despuesDeTabla(doc, y);

  // ── Armado de paquetes: por destino y manual ─────────────────────────
  const divisiones = e.lineas.flatMap((l) =>
    MANUALES.filter((m) => l.manuales[m.clave] > 0).map((m) => dividir(l.manuales[m.clave])),
  );
  const todo = sumarDivisiones(divisiones);
  y = dibujarSeccion(doc, y, "Armado de paquetes", textoDivision(todo));
  const cuerpo: CellInput[][] = [];
  e.lineas.forEach((l, gi) => {
    const manuales = MANUALES.filter((m) => l.manuales[m.clave] > 0);
    const fondo = gi % 2 ? CEBRA : BLANCO;
    const unida = (content: string, extra: Record<string, unknown> = {}): CellInput => ({
      content,
      rowSpan: manuales.length,
      styles: { valign: "middle", fillColor: fondo, ...extra },
    });
    manuales.forEach((m, i) => {
      const d = dividir(l.manuales[m.clave]);
      const celda = (n: number): CellInput => ({
        content: cant(n),
        styles: { fillColor: fondo, halign: "right" },
      });
      const fila: CellInput[] = [];
      if (i === 0)
        fila.push(
          unida(String(gi + 1), { fontStyle: "bold" }),
          unida(t(`${l.sucursal} · ${l.ciudad}`)),
        );
      fila.push(
        {
          content: t(m.nombre),
          styles: { fillColor: rgb(m.color), textColor: rgb(m.tinta), fontStyle: "bold" },
        },
        celda(l.manuales[m.clave]),
        ...PAQUETES.map((p) => celda(d.paquetes[p])),
        celda(d.sueltos),
      );
      cuerpo.push(fila);
    });
  });
  autoTable(doc, {
    ...ESTILO_TABLA,
    alternateRowStyles: {},
    startY: y,
    rowPageBreak: "avoid",
    styles: { ...ESTILO_TABLA.styles, fontSize: 8 },
    didDrawPage: rotuloContinuacion(doc, doc.getNumberOfPages(), "Armado de paquetes"),
    head: [["Nº", "Destino", "Manual", "Cant.", ...PAQUETES.map((p) => `De ${p}`), "Sueltos"]],
    body: cuerpo,
    foot: [
      [
        "",
        "",
        "Total",
        fmt(e.cantidad),
        ...PAQUETES.map((p) => fmt(todo.paquetes[p])),
        fmt(todo.sueltos),
      ],
    ],
    columnStyles: {
      0: { cellWidth: 8 },
      2: { cellWidth: 24 },
      3: { cellWidth: 16 },
      4: { cellWidth: 16 },
      5: { cellWidth: 16 },
      6: { cellWidth: 16 },
      7: { cellWidth: 16 },
    },
    didParseCell: (d) => {
      if (d.section !== "body" && d.column.index >= 3) d.cell.styles.halign = "right";
    },
  });
  y = despuesDeTabla(doc, y, 6);

  // ── Firmas: la gráfica que entrega y cada sucursal que recibe ────────
  const firmas: [string, string][] = [
    ["Entregó", e.grafica],
    ...sucursales.map((s): [string, string] => ["Recibió", s]),
  ];
  const ancho = (ANCHO - 2 * MARGEN - 20) / 2;
  for (let i = 0; i < firmas.length; i += 2) {
    if (y > ALTO - 50) {
      doc.addPage();
      y = TOPE_CONTENIDO + 4;
    }
    const yLinea = y + 22;
    firmas.slice(i, i + 2).forEach(([quien, quienEs], j) => {
      const x0 = MARGEN + j * (ancho + 20);
      doc.setDrawColor(...GRIS);
      doc.setLineWidth(0.3);
      doc.line(x0, yLinea, x0 + ancho, yLinea);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...NAVY);
      doc.text(t(`${quien} · ${quienEs}`), x0, yLinea + 5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...GRIS);
      doc.text("Nombre, firma y fecha", x0, yLinea + 9.5);
    });
    y = yLinea + 12;
  }

  return cerrar();
}
