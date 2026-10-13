/**
 * El Excel de UNA transferencia con el MISMO formato que su PDF (pedido el
 * 13/10/2026): logo y título, datos y estado, las tarjetas de resumen, "Por
 * manual", el "Detalle" con facilitador e institución unidos por grupo y las
 * firmas. Lo común (libro, encabezado, tarjetas, tablas, firmas) está en
 * `excel-base.ts`; acá va solo el cuerpo.
 *
 * Columnas: A margen (logo), B Facilitador (y Manual en "Por manual"),
 * C Institución, D Manual, E Cantidad.
 *
 * Sale de lo GUARDADO (`TransferenciaDetalle`), igual que el PDF.
 */

import {
  abajo,
  BLANCO,
  bajarLibro,
  cabecera,
  CEBRA,
  CEBRA_SUAVE,
  encabezado,
  escribir,
  filaTotal,
  firmas,
  GRIS_CHICO,
  letra,
  letras,
  nuevoLibro,
  numero,
  relleno,
  seccion,
  tarjetas,
} from "@/lib/excel-base";
import { AMBAR, NAVY } from "@/lib/pdf-base";
import type { LineaDetalle, TransferenciaDetalle } from "@/lib/transferencias";

/** Genera y descarga `transferencia-<n>.xlsx`. */
export async function descargarExcelTransferencia(
  x: TransferenciaDetalle,
  usuario: string,
): Promise<void> {
  const titulo = `Transferencia Nº ${x.id_transferencia}`;
  // El ancho de E deja entrar la tarjeta "En camino".
  const libro = await nuevoLibro(
    titulo,
    `Transferencia ${x.id_transferencia}`,
    [8, 30, 32, 20, 16],
  );
  const { wb, ws } = libro;
  const archivo = `transferencia-${x.id_transferencia}.xlsx`;

  encabezado(libro, {
    titulo,
    subtitulo: `${x.origen} > ${x.destino}`,
    usuario,
    colTitulo: ["B", "C"],
    colEmitido: ["D", "E"],
    ultima: "E",
  });

  const unidades = x.detalle.reduce((s, l) => s + l.cantidad, 0);
  const porManual = new Map<string, number>();
  for (const l of x.detalle) porManual.set(l.manual, (porManual.get(l.manual) ?? 0) + l.cantidad);
  const facilitadores = new Set(x.detalle.map((l) => l.facilitador ?? "Sin asignar"));

  // ── Datos y estado ───────────────────────────────────────────────────
  escribir(
    ws,
    "B5:E5",
    `Fecha: ${x.fecha ?? "-"}   ·   Sale de: ${x.origen}   ·   Llega a: ${x.destino}`,
    GRIS_CHICO,
  );
  escribir(
    ws,
    "B6:E6",
    x.recibida
      ? `Recibida${x.recibida_el ? ` el ${x.recibida_el}` : ""}${x.recibida_por ? ` por ${x.recibida_por}` : ""}.`
      : "En camino: todavía no se confirmó la recepción.",
    GRIS_CHICO,
  );

  tarjetas(ws, 8, [
    { desde: "B", hasta: "B", etiqueta: "Libros", valor: unidades },
    { desde: "C", hasta: "C", etiqueta: "Manuales", valor: porManual.size },
    { desde: "D", hasta: "D", etiqueta: "Facilitadores", valor: facilitadores.size },
    {
      desde: "E",
      hasta: "E",
      etiqueta: "Estado",
      valor: x.recibida ? "Recibida" : "En camino",
      color: x.recibida ? NAVY : AMBAR,
    },
  ]);

  let fila = 11;
  if (x.detalle.length === 0) {
    escribir(ws, `B${fila}:E${fila}`, "La transferencia no tiene manuales.", GRIS_CHICO);
    await bajarLibro(wb, archivo);
    return;
  }

  // ── Por manual ───────────────────────────────────────────────────────
  const manuales = [...porManual].sort((a, b) => a[0].localeCompare(b[0], "es"));
  seccion(ws, fila, "Por manual", `${manuales.length} manual${manuales.length === 1 ? "" : "es"}`, [
    "B",
    "E",
  ]);
  fila += 1;
  cabecera(
    ws,
    fila,
    [
      ["B", "D", "Manual"],
      ["E", "E", "Libros"],
    ],
    { derecha: ["E"] },
  );
  fila += 1;
  manuales.forEach(([m, c], i) => {
    const fondo = relleno(i % 2 ? CEBRA_SUAVE : BLANCO);
    escribir(ws, `B${fila}:D${fila}`, m, { font: letra(), fill: fondo, border: abajo });
    numero(ws.getCell(`E${fila}`), c, { fill: fondo, border: abajo });
    ws.getRow(fila).height = 18;
    fila += 1;
  });
  filaTotal(ws, fila, { pintar: ["B", "E"], rotulo: ["B", "D"], valores: [["E", unidades]] });
  fila += 3;

  // ── Detalle: un grupo de filas por facilitador e institución ─────────
  const grupos = new Map<string, LineaDetalle[]>();
  for (const l of x.detalle) {
    const k = `${l.id_facilitador ?? ""}|${l.id_institucion ?? ""}`;
    const g = grupos.get(k);
    if (g) g.push(l);
    else grupos.set(k, [l]);
  }
  seccion(
    ws,
    fila,
    "Detalle",
    `${grupos.size} destinatario${grupos.size === 1 ? "" : "s"} · ${unidades.toLocaleString("es-PY")} libros`,
    ["B", "E"],
  );
  fila += 1;
  cabecera(
    ws,
    fila,
    [
      ["B", "B", "Facilitador"],
      ["C", "C", "Institución"],
      ["D", "D", "Manual"],
      ["E", "E", "Cant."],
    ],
    { derecha: ["E"] },
  );
  fila += 1;
  [...grupos.values()].forEach((lineas, gi) => {
    const fondo = relleno(gi % 2 ? CEBRA : BLANCO);
    const desde = fila;
    const hasta = fila + lineas.length - 1;
    const l0 = lineas[0];
    const sinAsignar = l0.id_facilitador == null && l0.id_institucion == null;
    // Facilitador e institución abarcan las filas de sus manuales, como el rowSpan del PDF.
    const unida = {
      font: letra(),
      fill: fondo,
      alignment: { vertical: "middle", wrapText: true },
    } as const;
    escribir(
      ws,
      `B${desde}:B${hasta}`,
      sinAsignar ? "Sin asignar" : (l0.facilitador ?? "Sin facilitador"),
      unida,
    );
    escribir(
      ws,
      `C${desde}:C${hasta}`,
      sinAsignar ? "-" : (l0.institucion ?? "Sin institución"),
      unida,
    );
    lineas.forEach((l) => {
      escribir(ws, `D${fila}`, l.manual, { font: letra(), fill: fondo, border: abajo });
      numero(ws.getCell(`E${fila}`), l.cantidad, { fill: fondo, border: abajo });
      ws.getRow(fila).height = 18;
      fila += 1;
    });
    // La línea que cierra el grupo, de punta a punta.
    for (const c of letras("B", "E")) ws.getCell(`${c}${hasta}`).border = abajo;
  });
  filaTotal(ws, fila, { pintar: ["B", "E"], rotulo: ["D", "D"], valores: [["E", unidades]] });
  fila += 5;

  // ── Firmas ───────────────────────────────────────────────────────────
  fila = firmas(
    ws,
    fila,
    [`Entregó · ${x.origen}`, `Recibió · ${x.destino}`],
    ["B", "B"],
    ["D", "E"],
  );

  ws.pageSetup.printArea = `A1:E${fila}`;
  await bajarLibro(wb, archivo);
}
