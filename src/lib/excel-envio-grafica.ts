/**
 * El Excel de UN envío de gráficas, con el MISMO formato que su comprobante en
 * PDF (`generarPdfEnvio`, pedido el 13/10/2026): logo y título, datos, tarjetas,
 * "Por manual" con sus colores, "Destinos" (cada comentario en su destino), el "Armado de
 * paquetes" (100, 50, 25 y sueltos) y las firmas. Lo común está en
 * `excel-base.ts`; acá va solo el cuerpo.
 *
 * Columnas: A margen (logo), B Nº de destino, C Sucursal, D Ciudad, E…K los
 * siete manuales, L Total. Las otras tablas reusan esas columnas uniendo
 * celdas ("Por manual": Manual en B:D, Libros en E:F, % en G:H).
 *
 * Sale de lo GUARDADO, igual que el PDF.
 */

import {
  abajo,
  argb,
  argbHex,
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
  pintar,
  relleno,
  seccion,
  tarjetas,
} from "@/lib/excel-base";
import {
  dividir,
  PAQUETES,
  sumarDivisiones,
  textoDivision,
  type EnvioGrafica,
} from "@/lib/envios-graficas";
import { GRIS } from "@/lib/pdf-base";
import { MANUALES } from "@/lib/postulaciones";

const GRIS_TEXTO = argb(GRIS);

/** "13/10/2026" a partir de `YYYY-MM-DD`. */
const fechaCorta = (f: string) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : "-");
/** "13/10/2026 18:40" a partir de `YYYY-MM-DDTHH:MI`. */
const fechaHora = (f: string) => (f ? `${fechaCorta(f)} ${f.slice(11, 16)}` : "-");

/** Las columnas de los siete manuales en "Destinos": E … K. */
const COL_MANUAL = letras("E", "K");

/** El color de cada manual para las cabeceras, por la columna en que va. */
const coloresManuales = Object.fromEntries(
  MANUALES.map((m, i) => [COL_MANUAL[i], { fondo: argbHex(m.color), tinta: argbHex(m.tinta) }]),
);

/** Genera y descarga `envio-de-graficas-<n>.xlsx`. */
export async function descargarExcelEnvio(e: EnvioGrafica, usuario: string): Promise<void> {
  const titulo = `Envío de gráficas Nº ${e.id}`;
  const libro = await nuevoLibro(titulo, `Envío ${e.id}`, [
    8, // A margen / logo
    5, // B Nº
    18, // C Sucursal
    24, // D Ciudad
    ...MANUALES.map(() => 8), // E … K
    10, // L Total
  ]);
  const { wb, ws } = libro;

  encabezado(libro, {
    titulo,
    subtitulo: `${e.grafica} · ${fechaCorta(e.fecha)}`,
    usuario,
    colTitulo: ["B", "H"],
    colEmitido: ["I", "L"],
    ultima: "L",
  });

  const sucursales = [...new Set(e.lineas.map((l) => l.sucursal))];

  // ── Datos ────────────────────────────────────────────────────────────
  escribir(
    ws,
    "B5:L5",
    `Gráfica: ${e.grafica}   ·   Fecha del envío: ${fechaCorta(e.fecha)}`,
    GRIS_CHICO,
  );
  escribir(
    ws,
    "B6:L6",
    [
      e.cargadoEl &&
        `Cargado el ${fechaHora(e.cargadoEl)}${e.cargadoPor ? ` por ${e.cargadoPor}` : ""}`,
      e.modificadoEl &&
        `modificado el ${fechaHora(e.modificadoEl)}${e.modificadoPor ? ` por ${e.modificadoPor}` : ""}`,
    ]
      .filter(Boolean)
      .join(" · "),
    GRIS_CHICO,
  );

  tarjetas(ws, 8, [
    { desde: "B", hasta: "D", etiqueta: "Manuales", valor: e.cantidad },
    { desde: "E", hasta: "G", etiqueta: "Destinos", valor: e.lineas.length },
    { desde: "H", hasta: "J", etiqueta: "Sucursales", valor: sucursales.length },
    {
      desde: "K",
      hasta: "L",
      etiqueta: "Ciudades",
      valor: new Set(e.lineas.map((l) => l.idCiudad)).size,
    },
  ]);

  // ── Por manual ───────────────────────────────────────────────────────
  let fila = 11;
  seccion(ws, fila, "Por manual", "", ["B", "L"]);
  fila += 1;
  cabecera(
    ws,
    fila,
    [
      ["B", "D", "Manual"],
      ["E", "F", "Libros"],
      ["G", "H", "% del total"],
    ],
    { derecha: ["E", "G"] },
  );
  fila += 1;
  MANUALES.forEach((m, i) => {
    const fondo = relleno(i % 2 ? CEBRA_SUAVE : BLANCO);
    const c = e.manuales[m.clave];
    // El nombre del manual con su color, como las pastillas de la pantalla.
    pintar(ws, fila, "B", "D", argbHex(m.color));
    escribir(ws, `B${fila}:D${fila}`, m.nombre, {
      font: letra({ bold: true, color: { argb: argbHex(m.tinta) } }),
      fill: relleno(argbHex(m.color)),
    });
    pintar(ws, fila, "E", "H", i % 2 ? CEBRA_SUAVE : BLANCO);
    ws.mergeCells(`E${fila}:F${fila}`);
    numero(ws.getCell(`E${fila}`), c, { fill: fondo, border: abajo });
    escribir(
      ws,
      `G${fila}:H${fila}`,
      e.cantidad && c ? `${Math.round((c * 100) / e.cantidad)}%` : "-",
      {
        font: letra(),
        fill: fondo,
        border: abajo,
        alignment: { horizontal: "right", vertical: "middle" },
      },
    );
    ws.getRow(fila).height = 18;
    fila += 1;
  });
  filaTotal(ws, fila, { pintar: ["B", "H"], rotulo: ["B", "D"], valores: [["E", e.cantidad]] });
  ws.mergeCells(`E${fila}:F${fila}`);
  escribir(ws, `G${fila}:H${fila}`, "100%", {
    font: letra({ bold: true }),
    alignment: { horizontal: "right", vertical: "middle" },
  });
  fila += 3;

  // ── Destinos ─────────────────────────────────────────────────────────
  seccion(
    ws,
    fila,
    "Destinos",
    `${e.lineas.length} destino${e.lineas.length === 1 ? "" : "s"} · ${e.cantidad.toLocaleString("es-PY")} manuales`,
    ["B", "L"],
  );
  fila += 1;
  cabecera(
    ws,
    fila,
    [
      ["B", "B", "Nº"],
      ["C", "C", "Sucursal"],
      ["D", "D", "Ciudad"],
      ...MANUALES.map((m, i): [string, string, string] => [COL_MANUAL[i], COL_MANUAL[i], m.corto]),
      ["L", "L", "Total"],
    ],
    { derecha: [...COL_MANUAL, "L"], colores: coloresManuales },
  );
  fila += 1;
  e.lineas.forEach((l, i) => {
    // El comentario va en SU registro: una fila debajo, de C a L, con el mismo
    // fondo (pedido de Jose el 13/10/2026: no al final). La línea de abajo
    // cierra el destino después del comentario.
    const coment = l.comentario.trim();
    const fondo = relleno(i % 2 ? CEBRA : BLANCO);
    const borde = coment ? {} : abajo;
    const texto = { font: letra(), fill: fondo, border: borde };
    escribir(ws, `B${fila}`, i + 1, {
      ...texto,
      font: letra({ bold: true }),
      alignment: { horizontal: "left", vertical: "middle" },
    });
    escribir(ws, `C${fila}`, l.sucursal, texto);
    escribir(ws, `D${fila}`, [l.ciudad, l.departamento].filter(Boolean).join(", ") || "-", texto);
    MANUALES.forEach((m, k) =>
      numero(ws.getCell(`${COL_MANUAL[k]}${fila}`), l.manuales[m.clave], {
        fill: fondo,
        border: borde,
        numFmt: "#,##0;-#,##0;-",
      }),
    );
    numero(ws.getCell(`L${fila}`), l.cantidad, {
      fill: fondo,
      border: borde,
      font: letra({ bold: true }),
    });
    ws.getRow(fila).height = 18;
    fila += 1;
    if (coment) {
      pintar(ws, fila, "B", "L", i % 2 ? CEBRA : BLANCO);
      for (const c of letras("B", "L")) ws.getCell(`${c}${fila}`).border = abajo;
      escribir(ws, `C${fila}:L${fila}`, `Comentario: ${coment}`, {
        font: letra({ size: 9, italic: true, color: { argb: GRIS_TEXTO } }),
        fill: fondo,
        border: abajo,
        alignment: { vertical: "top", wrapText: true },
      });
      // Una fila más alta por cada ~120 caracteres o salto de línea.
      const renglones = coment
        .split("\n")
        .reduce((a, r) => a + Math.max(1, Math.ceil((r.length + 12) / 120)), 0);
      ws.getRow(fila).height = Math.max(16, 13 * renglones);
      fila += 1;
    }
  });
  filaTotal(ws, fila, {
    pintar: ["B", "L"],
    rotulo: ["D", "D"],
    valores: [
      ...MANUALES.map((m, k): [string, number] => [COL_MANUAL[k], e.manuales[m.clave]]),
      ["L", e.cantidad],
    ],
  });
  fila += 3;

  // ── Armado de paquetes: por destino y manual ─────────────────────────
  const divisiones = e.lineas.flatMap((l) =>
    MANUALES.filter((m) => l.manuales[m.clave] > 0).map((m) => dividir(l.manuales[m.clave])),
  );
  const todo = sumarDivisiones(divisiones);
  seccion(ws, fila, "Armado de paquetes", textoDivision(todo), ["B", "L"]);
  fila += 1;
  cabecera(
    ws,
    fila,
    [
      ["B", "B", "Nº"],
      ["C", "D", "Destino"],
      ["E", "F", "Manual"],
      ["G", "G", "Cant."],
      ...PAQUETES.map((p, i): [string, string, string] => [
        letras("H", "J")[i],
        letras("H", "J")[i],
        `De ${p}`,
      ]),
      ["K", "K", "Sueltos"],
    ],
    { derecha: ["G", "H", "I", "J", "K"] },
  );
  fila += 1;
  e.lineas.forEach((l, gi) => {
    const manuales = MANUALES.filter((m) => l.manuales[m.clave] > 0);
    if (!manuales.length) return;
    const fondo = relleno(gi % 2 ? CEBRA : BLANCO);
    const desde = fila;
    const hasta = fila + manuales.length - 1;
    for (let r = desde; r <= hasta; r++) pintar(ws, r, "B", "K", gi % 2 ? CEBRA : BLANCO);
    const unida = {
      font: letra(),
      fill: fondo,
      alignment: { vertical: "middle", wrapText: true },
    } as const;
    escribir(ws, `B${desde}:B${hasta}`, gi + 1, { ...unida, font: letra({ bold: true }) });
    escribir(ws, `C${desde}:D${hasta}`, `${l.sucursal} · ${l.ciudad}`, unida);
    for (const m of manuales) {
      const d = dividir(l.manuales[m.clave]);
      pintar(ws, fila, "E", "F", argbHex(m.color));
      escribir(ws, `E${fila}:F${fila}`, m.nombre, {
        font: letra({ bold: true, color: { argb: argbHex(m.tinta) } }),
        fill: relleno(argbHex(m.color)),
      });
      const cero = { fill: fondo, border: abajo, numFmt: "#,##0;-#,##0;-" };
      numero(ws.getCell(`G${fila}`), l.manuales[m.clave], cero);
      PAQUETES.forEach((p, i) =>
        numero(ws.getCell(`${letras("H", "J")[i]}${fila}`), d.paquetes[p], cero),
      );
      numero(ws.getCell(`K${fila}`), d.sueltos, cero);
      ws.getRow(fila).height = 18;
      fila += 1;
    }
    for (const c of letras("B", "K")) ws.getCell(`${c}${hasta}`).border = abajo;
  });
  filaTotal(ws, fila, {
    pintar: ["B", "K"],
    rotulo: ["E", "F"],
    valores: [
      ["G", e.cantidad],
      ...PAQUETES.map((p, i): [string, number] => [letras("H", "J")[i], todo.paquetes[p]]),
      ["K", todo.sueltos],
    ],
  });
  fila += 5;

  // ── Firmas: la gráfica que entrega y cada sucursal que recibe ────────
  fila = firmas(
    ws,
    fila,
    [`Entregó · ${e.grafica}`, ...sucursales.map((s) => `Recibió · ${s}`)],
    ["B", "E"],
    ["H", "L"],
  );

  ws.pageSetup.printArea = `A1:L${fila}`;
  await bajarLibro(wb, `envio-de-graficas-${e.id}.xlsx`);
}
